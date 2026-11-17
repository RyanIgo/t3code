#!/usr/bin/env node
// Publish and read fleet hub artifacts: `publish <spec.json | ->`, `read <id>`, `list`.
// Specs and usage are in SKILL.md. The hub address comes from T3_FLEET_HUB_URL or
// ~/.config/t3-fleet/hub-url; Tailscale identifies this machine to the hub. Node 18+.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hubUrl() {
  let configured = process.env.T3_FLEET_HUB_URL?.trim();
  if (!configured) {
    try {
      configured = NodeFS.readFileSync(
        NodePath.join(NodeOS.homedir(), ".config", "t3-fleet", "hub-url"),
        "utf8",
      ).trim();
    } catch {
      configured = "";
    }
  }
  if (!configured) {
    fail(
      "No fleet hub address. Ask the user for it, then save it with:\n" +
        "  mkdir -p ~/.config/t3-fleet && echo https://<hub>.<tailnet>.ts.net > ~/.config/t3-fleet/hub-url",
    );
  }
  try {
    return new URL(configured).origin;
  } catch {
    fail(`The fleet hub address "${configured}" isn't a URL.`);
  }
}

async function call(path, init = {}) {
  const hub = hubUrl();
  let response;
  try {
    response = await fetch(`${hub}${path}`, {
      ...init,
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    fail(`Couldn't reach the fleet hub at ${hub} (${error.cause?.code ?? error.message}).`);
  }
  const text = await response.text();
  if (!response.ok) fail(`The fleet hub answered ${response.status}: ${text.slice(0, 400)}`);
  return { hub, body: JSON.parse(text) };
}

function readSpec(arg) {
  if (!arg) fail("Usage: node artifact.mjs publish <spec.json | ->");
  const raw = arg === "-" ? NodeFS.readFileSync(0, "utf8") : NodeFS.readFileSync(arg, "utf8");
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (error) {
    fail(`The spec isn't JSON: ${error.message}`);
  }
  if (typeof spec.htmlFile === "string") {
    const base = arg === "-" ? process.cwd() : NodePath.dirname(NodePath.resolve(arg));
    spec.html = NodeFS.readFileSync(NodePath.resolve(base, spec.htmlFile), "utf8");
  }
  if (typeof spec.title !== "string" || !spec.title.trim()) fail("The spec needs a title.");
  if (Array.isArray(spec.rows) === (typeof spec.html === "string")) {
    fail('Give either "rows" (a test sheet) or "html" / "htmlFile" (a page).');
  }
  return spec;
}

async function publish(arg) {
  const spec = readSpec(arg);
  const threadId = process.env.T3CODE_THREAD_ID;
  const body = JSON.stringify({
    kind: spec.rows ? "sheet" : "html",
    title: spec.title,
    ...(spec.intro ? { intro: spec.intro } : {}),
    ...(spec.rows ? { rows: spec.rows } : { html: spec.html }),
    ...(threadId ? { thread: { environmentId: "", threadId } } : {}),
  });
  const { hub, body: saved } = spec.id
    ? await call(`/fleet/artifacts/${spec.id}`, { method: "PUT", body })
    : await call("/fleet/artifacts", { method: "POST", body });
  const url = `${hub}/a/${saved.id}`;
  console.log(
    JSON.stringify(
      { id: saved.id, version: saved.version, url, markdown: `[${spec.title}](${url})` },
      null,
      2,
    ),
  );
  console.error(
    `Put the markdown link in your reply on its own line: the chat shows the ${spec.rows ? "sheet" : "page"} there. Keep the id to update it or read results.`,
  );
}

async function read(id) {
  if (!/^[a-z0-9]{12}$/.test(id ?? "")) fail("Usage: node artifact.mjs read <id>");
  const { hub, body: artifact } = await call(`/fleet/artifacts/${id}`);
  const rowState = artifact.state?.rows ?? {};
  console.log(
    JSON.stringify(
      {
        id: artifact.id,
        url: `${hub}/a/${artifact.id}`,
        title: artifact.title,
        kind: artifact.kind,
        version: artifact.version,
        ...(artifact.counts ? { counts: artifact.counts } : {}),
        ...(artifact.kind === "sheet"
          ? {
              rows: (artifact.rows ?? []).map((row) => ({
                id: row.id,
                title: row.title,
                status: rowState[row.id]?.status ?? null,
                note: rowState[row.id]?.note || null,
                by: rowState[row.id]?.by ?? null,
                at: rowState[row.id]?.at ?? null,
              })),
            }
          : { data: artifact.state?.data ?? null }),
        submissions: (artifact.submissions ?? []).slice(-5),
        recentChanges: (artifact.history ?? []).slice(-20),
      },
      null,
      2,
    ),
  );
}

async function list() {
  const { hub, body } = await call("/fleet/artifacts");
  for (const artifact of body.artifacts) {
    const counts = artifact.counts
      ? ` · ${artifact.counts.pass} passed, ${artifact.counts.fail} failed of ${artifact.counts.total}`
      : "";
    console.log(`${artifact.id}  ${artifact.title}${counts}  ${hub}/a/${artifact.id}`);
  }
}

const [command, arg] = process.argv.slice(2);
if (command === "publish") await publish(arg);
else if (command === "read") await read(arg);
else if (command === "list") await list();
else fail("Usage: node artifact.mjs publish <spec.json | -> | read <id> | list");
