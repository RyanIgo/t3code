// Fleet hub: the Dev Desk's view of one GitHub project. Syncs the project's items (issues and
// PRs with their Status, Priority, Size, Initiative and Lane) every few minutes into
// data/desk.json, and sets an item's Lane. GitHub stays the record; this is a cache.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const SYNC_EVERY_MS = 5 * 60_000;
const MIN_REFRESH_MS = 30_000;
const KEEP_CLOSED_DAYS = 14;
export const LANES = ["Now", "Next", "Later", "Blocked"];
const DETAIL_TTL_MS = 60_000;
/** Fields the Desk may change: single selects by option name, Sprint by iteration title. */
const EDITABLE_FIELDS = new Set(["Lane", "Priority", "Stage", "Sprint", "Work type", "Feature"]);

const DETAIL_QUERY = `query($id: ID!) { node(id: $id) { ... on ProjectV2Item { content {
  __typename
  ... on Issue { number title url state body createdAt author { login }
    labels(first: 10) { nodes { name } }
    comments(last: 15) { totalCount nodes { author { login } body createdAt url } }
    parent { number title url state repository { nameWithOwner } }
    subIssues(first: 50) { nodes { number title url state repository { nameWithOwner } } }
    closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes {
      number title url state isDraft reviewDecision mergeable
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } }
  ... on PullRequest { number title url state body createdAt isDraft reviewDecision mergeable
    author { login } labels(first: 10) { nodes { name } }
    comments(last: 15) { totalCount nodes { author { login } body createdAt url } }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
  ... on DraftIssue { title body createdAt }
} } } }`;

const prSummary = (pr) => ({
  number: pr.number,
  title: pr.title,
  url: pr.url,
  state: pr.isDraft && pr.state === "OPEN" ? "draft" : pr.state.toLowerCase(),
  review: pr.reviewDecision ?? null,
  mergeable: pr.mergeable ?? null,
  checks: pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
});

const PROJECT_QUERY = `query($owner: String!, $number: Int!, $cursor: String) {
  organization(login: $owner) { projectV2(number: $number) {
    id title
    fields(first: 60) { nodes {
      ... on ProjectV2SingleSelectField { id name options { id name } }
      ... on ProjectV2IterationField { id name configuration { iterations { id title startDate duration } } }
    } }
    items(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id isArchived
        fieldValues(first: 30) { nodes {
          ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } }
          ... on ProjectV2ItemFieldIterationValue { title startDate duration field { ... on ProjectV2IterationField { name } } }
        } }
        content {
          __typename
          ... on Issue { number title url state body updatedAt closedAt
            repository { nameWithOwner }
            assignees(first: 5) { nodes { login } }
            closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes { number title url state isDraft reviewDecision mergeable } } }
          ... on PullRequest { number title url state body updatedAt closedAt isDraft reviewDecision mergeable
            commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
            repository { nameWithOwner } assignees(first: 5) { nodes { login } } }
          ... on DraftIssue { title body updatedAt }
        }
      }
    }
  } }
}`;

/** The "## In plain words" section agents keep on each issue: What / Why it matters / Where it stands. */
export function readPlainWords(body) {
  if (typeof body !== "string") return null;
  const section = /^##\s*In plain words\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(body)?.[1];
  if (!section) return null;
  const line = (label) =>
    new RegExp(`\\*\\*${label}:?\\*\\*:?\\s*(.+)`, "i").exec(section)?.[1]?.trim().slice(0, 400) ??
    null;
  const plain = { what: line("What"), why: line("Why it matters"), where: line("Where it stands") };
  return plain.what || plain.why || plain.where ? plain : null;
}

const sectionOf = (body, heading) =>
  new RegExp(`^##\\s*${heading}\\s*$([\\s\\S]*?)(?=^##\\s|^---\\s*$|(?![\\s\\S]))`, "im").exec(
    body,
  )?.[1];

/** Markdown emphasis and code marks dropped, for showing as plain text. */
const plainText = (text) => text.replace(/\*\*|`/g, "").trim();

/** A user story: its "## User story" text and the "## Acceptance criteria" checklist. */
export function readStory(body) {
  if (typeof body !== "string") return null;
  const story = sectionOf(body, "User story");
  const criteria = [
    ...(sectionOf(body, "Acceptance criteria") ?? "").matchAll(/^\s*[-*]\s*\[([ xX])\]\s*(.+)$/gm),
  ]
    .slice(0, 30)
    .map((match) => ({ done: match[1] !== " ", text: plainText(match[2]).slice(0, 500) }));
  if (!story && criteria.length === 0) return null;
  return { text: plainText(story ?? "").slice(0, 1500), criteria };
}

function checksOf(state) {
  if (state === "SUCCESS") return "passing";
  if (state === "FAILURE" || state === "ERROR") return "failing";
  if (state === "PENDING" || state === "EXPECTED") return "pending";
  return null;
}

function normalizeItem(node) {
  const content = node.content;
  if (!content || node.isArchived) return null;
  const fields = {};
  let sprint = null;
  for (const value of node.fieldValues?.nodes ?? []) {
    if (!value?.field?.name) continue;
    if (value.field.name === "Sprint" && value.title) {
      sprint = { title: value.title, startDate: value.startDate, duration: value.duration };
    } else {
      fields[value.field.name] = value.name;
    }
  }
  const kind =
    content.__typename === "Issue"
      ? "issue"
      : content.__typename === "PullRequest"
        ? "pr"
        : "draft";
  const state = (content.state ?? "OPEN").toLowerCase();
  return {
    itemId: node.id,
    kind,
    repo: content.repository?.nameWithOwner ?? null,
    number: content.number ?? null,
    title: content.title ?? "",
    url: content.url ?? null,
    state: kind === "pr" && content.isDraft && state === "open" ? "draft" : state,
    updatedAt: content.updatedAt ?? null,
    closedAt: content.closedAt ?? null,
    status: fields.Status ?? null,
    priority: fields.Priority ?? null,
    size: fields.Size ?? null,
    initiative: fields.Initiative ?? null,
    app: fields.App ?? null,
    feature: fields.Feature ?? null,
    stage: fields.Stage ?? null,
    workType: fields["Work type"] ?? null,
    sprint,
    lane: LANES.includes(fields.Lane) ? fields.Lane : null,
    assignees: (content.assignees?.nodes ?? []).map((user) => user.login),
    pullRequests: (content.closedByPullRequestsReferences?.nodes ?? []).map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.isDraft && pr.state === "OPEN" ? "draft" : pr.state.toLowerCase(),
      review: pr.reviewDecision ?? null,
      mergeable: pr.mergeable?.toLowerCase() ?? null,
    })),
    // A PR item's own review decision and merge state.
    review: kind === "pr" ? (content.reviewDecision ?? null) : null,
    // Only when the token may read commit statuses; GitHub refuses it per field otherwise.
    checks:
      kind === "pr"
        ? checksOf(content.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state)
        : null,
    mergeable: kind === "pr" ? (content.mergeable?.toLowerCase() ?? null) : null,
    plain: readPlainWords(content.body),
    story: readStory(content.body),
  };
}

const recentlyClosed = (item, now) =>
  item.state === "open" ||
  item.state === "draft" ||
  (item.closedAt && now - Date.parse(item.closedAt) < KEEP_CLOSED_DAYS * 86_400_000);

export function createDesk({ dataRoot, project, token, log }) {
  const [owner, number] = (project ?? "").split("/");
  const file = NodePath.join(dataRoot, "desk.json");
  let snapshot = { syncedAt: null, error: null, project: null, fields: {}, items: [] };
  let syncing = null;
  let lastSync = 0;

  /**
   * GitHub answers what the token may see and refuses the rest field by field ("Resource not
   * accessible"). With `partial`, keep the data and return those refusals instead of failing.
   */
  async function graphql(query, variables, partial = false) {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        authorization: `bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "t3-fleet-hub",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => null);
    if (partial && response.ok && body?.data) return { data: body.data, errors: body.errors ?? [] };
    if (!response.ok || body?.errors?.length) {
      throw new Error(
        `GitHub ${response.status}: ${body?.errors?.[0]?.message ?? body?.message ?? "request failed"}`,
      );
    }
    return body.data;
  }

  async function sync() {
    const now = Date.now();
    const items = [];
    let cursor = null;
    let meta = null;
    for (let page = 0; page < 30; page += 1) {
      // Partial: a field the token can't read (commit statuses) must not stop the whole sync.
      const { data, errors } = await graphql(
        PROJECT_QUERY,
        { owner, number: Number(number), cursor },
        true,
      );
      // Items whose checks the token was refused, by position on this page.
      const unreadable = new Set(
        errors
          .filter((error) => (error.path ?? []).includes("commits"))
          .map((error) => error.path[(error.path.indexOf("nodes") ?? -1) + 1]),
      );
      const projectV2 = data?.organization?.projectV2;
      if (!projectV2) throw new Error(`No project ${project} for this token.`);
      meta ??= projectV2;
      for (const [index, node] of projectV2.items.nodes.entries()) {
        const item = normalizeItem(node);
        // Readable but no rollup: the repo runs no checks on it.
        if (item?.kind === "pr" && item.checks === null && !unreadable.has(index)) {
          item.checks = "none";
        }
        if (item && recentlyClosed(item, now)) items.push(item);
      }
      if (!projectV2.items.pageInfo.hasNextPage) break;
      cursor = projectV2.items.pageInfo.endCursor;
    }
    const fields = {};
    let sprints = [];
    let sprintFieldId = null;
    for (const field of meta.fields.nodes) {
      if (field?.name === "Sprint" && field.configuration) {
        sprints = field.configuration.iterations;
        sprintFieldId = field.id;
      }
      if (field?.name && Array.isArray(field.options)) {
        fields[field.name] = {
          id: field.id,
          options: Object.fromEntries(field.options.map((option) => [option.name, option.id])),
        };
      }
    }
    snapshot = {
      syncedAt: new Date().toISOString(),
      error: null,
      project: { id: meta.id, title: meta.title, owner, number: Number(number) },
      fields,
      sprints,
      sprintFieldId,
      items,
    };
    await NodeFSP.writeFile(file, JSON.stringify(snapshot), { mode: 0o600 });
    log("desk synced", { items: items.length });
  }

  function run() {
    if (syncing) return syncing;
    lastSync = Date.now();
    syncing = sync()
      .catch((error) => {
        snapshot = { ...snapshot, error: String(error.message ?? error) };
        log("desk sync failed", { error: snapshot.error });
      })
      .finally(() => {
        syncing = null;
      });
    return syncing;
  }

  const details = new Map();

  return {
    configured: Boolean(token && owner && number),
    /** An item's full text, comments, PRs and family, fetched on demand and kept a minute. */
    async detail(itemId) {
      const cached = details.get(itemId);
      if (cached && Date.now() - cached.at < DETAIL_TTL_MS) return cached.value;
      const answer = await graphql(DETAIL_QUERY, { id: itemId }, true);
      const content = answer.data?.node?.content;
      if (!content && answer.errors.length) {
        throw new Error(`GitHub: ${answer.errors[0]?.message ?? "request failed"}`);
      }
      if (!content) throw new Error("No such item.");
      const value = {
        kind: content.__typename,
        title: content.title,
        url: content.url ?? null,
        state: (content.state ?? "OPEN").toLowerCase(),
        body: content.body ?? "",
        createdAt: content.createdAt ?? null,
        author: content.author?.login ?? null,
        labels: (content.labels?.nodes ?? []).map((label) => label.name),
        comments: {
          total: content.comments?.totalCount ?? 0,
          recent: (content.comments?.nodes ?? []).map((comment) => ({
            author: comment.author?.login ?? null,
            body: comment.body,
            createdAt: comment.createdAt,
            url: comment.url,
          })),
        },
        parent: content.parent
          ? {
              title: content.parent.title,
              number: content.parent.number,
              url: content.parent.url,
              state: content.parent.state.toLowerCase(),
              repo: content.parent.repository.nameWithOwner,
            }
          : null,
        subIssues: (content.subIssues?.nodes ?? []).map((issue) => ({
          title: issue.title,
          number: issue.number,
          url: issue.url,
          state: issue.state.toLowerCase(),
          repo: issue.repository.nameWithOwner,
        })),
        // Parts the hub's token can't read (e.g. check results without "Commit statuses").
        unavailable: [
          ...new Set(
            answer.errors.map((error) =>
              (error.path ?? []).some((part) => part === "statusCheckRollup" || part === "commits")
                ? "check results"
                : "some details",
            ),
          ),
        ],
        pullRequests:
          content.__typename === "PullRequest"
            ? [prSummary(content)]
            : (content.closedByPullRequestsReferences?.nodes ?? []).map(prSummary),
      };
      details.set(itemId, { at: Date.now(), value });
      return value;
    },
    async start() {
      try {
        snapshot = JSON.parse(await NodeFSP.readFile(file, "utf8"));
      } catch {
        // First run: nothing cached yet.
      }
      if (!this.configured) return;
      void run();
      setInterval(() => void run(), SYNC_EVERY_MS).unref();
    },
    view() {
      return {
        configured: this.configured,
        syncedAt: snapshot.syncedAt,
        error: snapshot.error,
        project: snapshot.project,
        lanes: LANES,
        initiatives: Object.keys(snapshot.fields?.Initiative?.options ?? {}),
        options: Object.fromEntries(
          ["Lane", "Priority", "Stage", "Work type", "Feature"].map((name) => [
            name,
            Object.keys(snapshot.fields?.[name]?.options ?? {}),
          ]),
        ),
        apps: Object.keys(snapshot.fields?.App?.options ?? {}),
        sprints: (snapshot.sprints ?? []).map(({ title, startDate, duration }) => ({
          title,
          startDate,
          duration,
        })),
        items: snapshot.items,
      };
    },
    async refresh() {
      if (Date.now() - lastSync < MIN_REFRESH_MS) return syncing ?? Promise.resolve();
      return run();
    },
    /** Sets (or clears, with null) an item's Lane on GitHub, then in the cache. */
    async setLane(itemId, lane) {
      return this.setField(itemId, "Lane", lane);
    },
    /** Sets (or clears) one editable field: a single select by option name, Sprint by title. */
    async setField(itemId, name, value) {
      if (!EDITABLE_FIELDS.has(name)) throw new Error(`"${name}" can't be changed here.`);
      const item = snapshot.items.find((entry) => entry.itemId === itemId);
      if (!item) throw new Error("No such item.");
      if (name === "Sprint") {
        const sprint = (snapshot.sprints ?? []).find((entry) => entry.title === value);
        if (value !== null && !sprint) throw new Error(`No sprint "${value}".`);
        const fieldId = snapshot.sprintFieldId;
        if (!fieldId) throw new Error('The project has no "Sprint" field.');
        const vars = { project: snapshot.project.id, item: itemId, field: fieldId };
        if (value === null) {
          await graphql(
            `
              mutation ($project: ID!, $item: ID!, $field: ID!) {
                clearProjectV2ItemFieldValue(
                  input: { projectId: $project, itemId: $item, fieldId: $field }
                ) {
                  clientMutationId
                }
              }
            `,
            vars,
          );
          item.sprint = null;
        } else {
          await graphql(
            `
              mutation ($project: ID!, $item: ID!, $field: ID!, $iteration: String!) {
                updateProjectV2ItemFieldValue(
                  input: {
                    projectId: $project
                    itemId: $item
                    fieldId: $field
                    value: { iterationId: $iteration }
                  }
                ) {
                  clientMutationId
                }
              }
            `,
            { ...vars, iteration: sprint.id },
          );
          item.sprint = {
            title: sprint.title,
            startDate: sprint.startDate,
            duration: sprint.duration,
          };
        }
        await NodeFSP.writeFile(file, JSON.stringify(snapshot), { mode: 0o600 });
        return item;
      }
      const field = snapshot.fields?.[name];
      if (!field) throw new Error(`The project has no "${name}" field.`);
      if (value !== null && !field.options[value]) throw new Error(`No ${name} "${value}".`);
      const lane = value;
      const variables = { project: snapshot.project.id, item: itemId, field: field.id };
      if (lane === null) {
        await graphql(
          `
            mutation ($project: ID!, $item: ID!, $field: ID!) {
              clearProjectV2ItemFieldValue(
                input: { projectId: $project, itemId: $item, fieldId: $field }
              ) {
                clientMutationId
              }
            }
          `,
          variables,
        );
      } else {
        await graphql(
          `
            mutation ($project: ID!, $item: ID!, $field: ID!, $option: String!) {
              updateProjectV2ItemFieldValue(
                input: {
                  projectId: $project
                  itemId: $item
                  fieldId: $field
                  value: { singleSelectOptionId: $option }
                }
              ) {
                clientMutationId
              }
            }
          `,
          { ...variables, option: field.options[lane] },
        );
      }
      const key = {
        Lane: "lane",
        Priority: "priority",
        Stage: "stage",
        "Work type": "workType",
        Feature: "feature",
      }[name];
      item[key] = name === "Lane" && !LANES.includes(value) ? null : value;
      await NodeFSP.writeFile(file, JSON.stringify(snapshot), { mode: 0o600 });
      return item;
    },
  };
}
