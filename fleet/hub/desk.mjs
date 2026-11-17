// Fleet hub: the Dev Desk's view of one GitHub project. Syncs the project's items (issues and
// PRs with their Status, Priority, Size, Initiative and Lane) every few minutes into
// data/desk.json, and sets an item's Lane. GitHub stays the record; this is a cache.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const SYNC_EVERY_MS = 5 * 60_000;
const MIN_REFRESH_MS = 30_000;
const KEEP_CLOSED_DAYS = 14;
export const LANES = ["Now", "Next", "Later", "Blocked"];

const PROJECT_QUERY = `query($owner: String!, $number: Int!, $cursor: String) {
  organization(login: $owner) { projectV2(number: $number) {
    id title
    fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } }
    items(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id isArchived
        fieldValues(first: 30) { nodes { ... on ProjectV2ItemFieldSingleSelectValue {
          name field { ... on ProjectV2SingleSelectField { name } } } } }
        content {
          __typename
          ... on Issue { number title url state body updatedAt closedAt
            repository { nameWithOwner }
            assignees(first: 5) { nodes { login } }
            closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes { number url state isDraft } } }
          ... on PullRequest { number title url state body updatedAt closedAt isDraft
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

function normalizeItem(node) {
  const content = node.content;
  if (!content || node.isArchived) return null;
  const fields = {};
  for (const value of node.fieldValues?.nodes ?? []) {
    if (value?.field?.name) fields[value.field.name] = value.name;
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
    lane: LANES.includes(fields.Lane) ? fields.Lane : null,
    assignees: (content.assignees?.nodes ?? []).map((user) => user.login),
    pullRequests: (content.closedByPullRequestsReferences?.nodes ?? []).map((pr) => ({
      number: pr.number,
      url: pr.url,
      state: pr.isDraft && pr.state === "OPEN" ? "draft" : pr.state.toLowerCase(),
    })),
    plain: readPlainWords(content.body),
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

  async function graphql(query, variables) {
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
      const data = await graphql(PROJECT_QUERY, { owner, number: Number(number), cursor });
      const projectV2 = data?.organization?.projectV2;
      if (!projectV2) throw new Error(`No project ${project} for this token.`);
      meta ??= projectV2;
      for (const node of projectV2.items.nodes) {
        const item = normalizeItem(node);
        if (item && recentlyClosed(item, now)) items.push(item);
      }
      if (!projectV2.items.pageInfo.hasNextPage) break;
      cursor = projectV2.items.pageInfo.endCursor;
    }
    const fields = {};
    for (const field of meta.fields.nodes) {
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

  return {
    configured: Boolean(token && owner && number),
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
        items: snapshot.items,
      };
    },
    async refresh() {
      if (Date.now() - lastSync < MIN_REFRESH_MS) return syncing ?? Promise.resolve();
      return run();
    },
    /** Sets (or clears, with null) an item's Lane on GitHub, then in the cache. */
    async setLane(itemId, lane) {
      const field = snapshot.fields?.Lane;
      if (!field) throw new Error('The project has no "Lane" field.');
      if (lane !== null && !field.options[lane]) throw new Error(`No lane "${lane}".`);
      const item = snapshot.items.find((entry) => entry.itemId === itemId);
      if (!item) throw new Error("No such item.");
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
      item.lane = lane;
      await NodeFSP.writeFile(file, JSON.stringify(snapshot), { mode: 0o600 });
      return item;
    },
  };
}
