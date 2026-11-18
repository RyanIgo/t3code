// The Dev Desk as a remote MCP connector for Claude, on its own port that `tailscale funnel`
// publishes. It is its own OAuth server for Claude (registration, PKCE, refresh) and sends people
// to Microsoft Entra to sign in; only HUB_OWNERS get in, and the Microsoft and GitHub tokens
// never leave the hub.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const TX_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 60_000;
const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_BODY = 256 * 1024;
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_TOKENS = 200;

// Claude's own callbacks, and loopback for desktop clients; nothing else may receive a code.
function isAllowedRedirect(uri) {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol === "https:") {
    return (
      (url.hostname === "claude.ai" || url.hostname === "claude.com") &&
      url.pathname === "/api/mcp/auth_callback"
    );
  }
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

const random = (bytes = 32) => NodeCrypto.randomBytes(bytes).toString("base64url");
const sha256 = (value) => NodeCrypto.createHash("sha256").update(value).digest("base64url");
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && NodeCrypto.timingSafeEqual(x, y);
};
const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

function readCookies(header) {
  const cookies = new Map();
  for (const part of String(header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) cookies.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return cookies;
}

async function readRaw(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request too large."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:30rem;margin:12vh auto;padding:0 16px;color:#18181b}
h1{font-size:20px}button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #18181b;background:#18181b;color:#fff;cursor:pointer}
button.secondary{background:#fff;color:#18181b;margin-left:8px}p.muted{color:#71717a;font-size:13px}
@media (prefers-color-scheme:dark){body{background:#18181b;color:#fafafa}button{background:#fafafa;color:#18181b;border-color:#fafafa}button.secondary{background:#18181b;color:#fafafa}}</style>
</head><body>${body}</body></html>`;
}

/** A small JSON file in the hub's data folder, written private. */
function jsonFile(path, empty) {
  let cache = null;
  return {
    async read() {
      if (cache) return cache;
      try {
        cache = JSON.parse(await NodeFSP.readFile(path, "utf8"));
      } catch {
        cache = structuredClone(empty);
      }
      return cache;
    },
    async write(value) {
      cache = value;
      await NodeFSP.writeFile(path, JSON.stringify(value), { mode: 0o600 });
    },
  };
}

export function createConnector({ dataRoot, owners, readSetting, desk, readNotes, log }) {
  const clients = jsonFile(NodePath.join(dataRoot, "connector-clients.json"), {});
  const tokens = jsonFile(NodePath.join(dataRoot, "connector-tokens.json"), {});
  const pending = new Map(); // login transactions and auth codes, in memory only
  const settings = () => ({
    origin: readSetting("connector-origin", "HUB_CONNECTOR_ORIGIN").replace(/\/$/, ""),
    tenant: readSetting("entra-tenant-id", "HUB_ENTRA_TENANT_ID"),
    clientId: readSetting("entra-client-id", "HUB_ENTRA_CLIENT_ID"),
    clientSecret: readSetting("entra-client-secret", "HUB_ENTRA_CLIENT_SECRET"),
  });
  const configured = (s) => Boolean(s.origin && s.tenant && s.clientId && s.clientSecret);

  function sweep() {
    const now = Date.now();
    for (const [key, entry] of pending) if (entry.expires < now) pending.delete(key);
  }

  async function issueTokens(login, clientId) {
    const all = await tokens.read();
    const now = Date.now();
    for (const [hash, entry] of Object.entries(all)) if (entry.expires < now) delete all[hash];
    const access = random();
    const refresh = random();
    all[sha256(access)] = { kind: "access", login, clientId, expires: now + ACCESS_TTL_MS };
    all[sha256(refresh)] = { kind: "refresh", login, clientId, expires: now + REFRESH_TTL_MS };
    const entries = Object.entries(all).sort((a, b) => b[1].expires - a[1].expires);
    await tokens.write(Object.fromEntries(entries.slice(0, MAX_TOKENS)));
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_MS / 1000,
      refresh_token: refresh,
    };
  }

  async function loginFor(req) {
    const header = String(req.headers.authorization ?? "");
    if (!header.startsWith("Bearer ")) return null;
    const entry = (await tokens.read())[sha256(header.slice(7).trim())];
    if (!entry || entry.kind !== "access" || entry.expires < Date.now()) return null;
    return owners.has(entry.login) ? entry.login : null;
  }

  function metadata(s) {
    return {
      resource: {
        resource: `${s.origin}/mcp`,
        authorization_servers: [s.origin],
        bearer_methods_supported: ["header"],
        resource_name: "Dev Desk",
      },
      server: {
        issuer: s.origin,
        authorization_endpoint: `${s.origin}/oauth/authorize`,
        token_endpoint: `${s.origin}/oauth/token`,
        registration_endpoint: `${s.origin}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["desk"],
      },
    };
  }

  async function register(body, reply) {
    const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (uris.length === 0 || !uris.every(isAllowedRedirect)) {
      return reply(400, { error: "invalid_redirect_uri" });
    }
    const all = await clients.read();
    if (Object.keys(all).length >= 100) return reply(400, { error: "too_many_clients" });
    const clientId = random(16);
    all[clientId] = {
      redirectUris: uris.slice(0, 5),
      name: String(body?.client_name ?? "").slice(0, 80),
      createdAt: new Date().toISOString(),
    };
    await clients.write(all);
    return reply(201, {
      client_id: clientId,
      redirect_uris: all[clientId].redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  }

  async function authorize(url, s, res) {
    const q = url.searchParams;
    const client = (await clients.read())[q.get("client_id") ?? ""];
    const redirectUri = q.get("redirect_uri") ?? "";
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return sendHtml(res, 400, page("Can't sign in", "<h1>Unknown app or return address.</h1>"));
    }
    if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256") {
      return sendHtml(res, 400, page("Can't sign in", "<h1>Unsupported sign-in request.</h1>"));
    }
    sweep();
    const tx = random(16);
    const nonce = random();
    const verifier = random();
    pending.set(`tx:${tx}`, {
      expires: Date.now() + TX_TTL_MS,
      clientId: q.get("client_id"),
      redirectUri,
      state: q.get("state") ?? "",
      challenge: q.get("code_challenge") ?? "",
      nonceHash: sha256(nonce),
      verifier,
    });
    const entra = new URL(`https://login.microsoftonline.com/${s.tenant}/oauth2/v2.0/authorize`);
    entra.search = new URLSearchParams({
      client_id: s.clientId,
      response_type: "code",
      redirect_uri: `${s.origin}/oauth/callback`,
      response_mode: "query",
      scope: "openid profile email",
      state: tx,
      code_challenge: sha256(verifier),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    res.writeHead(302, {
      location: entra.toString(),
      // Binds the login to this browser: the callback and consent need the same cookie.
      "set-cookie": `__Host-desk_login_${tx}=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      "cache-control": "no-store",
    });
    res.end();
  }

  async function callback(url, req, s, res) {
    const tx = url.searchParams.get("state") ?? "";
    const entry = pending.get(`tx:${tx}`);
    const nonce = readCookies(req.headers.cookie).get(`__Host-desk_login_${tx}`);
    if (
      !entry ||
      entry.expires < Date.now() ||
      !nonce ||
      !safeEqual(sha256(nonce), entry.nonceHash)
    ) {
      return sendHtml(
        res,
        400,
        page("Sign-in expired", "<h1>This sign-in expired. Start again from Claude.</h1>"),
      );
    }
    if (url.searchParams.get("error")) {
      pending.delete(`tx:${tx}`);
      return sendHtml(
        res,
        400,
        page("Sign-in cancelled", "<h1>Microsoft sign-in didn't finish.</h1>"),
      );
    }
    const response = await fetch(
      `https://login.microsoftonline.com/${s.tenant}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: s.clientId,
          client_secret: s.clientSecret,
          grant_type: "authorization_code",
          code: url.searchParams.get("code") ?? "",
          redirect_uri: `${s.origin}/oauth/callback`,
          code_verifier: entry.verifier,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const answer = await response.json().catch(() => null);
    // The ID token comes straight from Microsoft's token endpoint over TLS, so its claims are
    // read without a signature check (OpenID Connect Core 3.1.3.7).
    const claims = (() => {
      try {
        return JSON.parse(
          Buffer.from(String(answer?.id_token).split(".")[1], "base64url").toString(),
        );
      } catch {
        return null;
      }
    })();
    const login = String(claims?.preferred_username ?? claims?.email ?? "").toLowerCase();
    if (!response.ok || !claims || claims.tid !== s.tenant || !owners.has(login)) {
      pending.delete(`tx:${tx}`);
      log("connector login refused", { login: login || null, status: response.status });
      return sendHtml(
        res,
        403,
        page(
          "No access",
          `<h1>No access</h1><p>${escapeHtml(login || "This account")} can't use the Dev Desk connector.</p>`,
        ),
      );
    }
    entry.login = login;
    const client = (await clients.read())[entry.clientId];
    const csrf = NodeCrypto.createHmac("sha256", nonce).update(tx).digest("base64url");
    return sendHtml(
      res,
      200,
      page(
        "Allow Claude",
        `<h1>Allow Claude to use your Dev Desk?</h1>
<p>Signed in as <b>${escapeHtml(login)}</b>. ${escapeHtml(client?.name || "Claude")} will be able to read your development work and file or update items in your GitHub project.</p>
<form method="post" action="/oauth/consent"><input type="hidden" name="tx" value="${escapeHtml(tx)}"><input type="hidden" name="csrf" value="${csrf}">
<button name="decision" value="allow">Allow</button><button class="secondary" name="decision" value="deny">Deny</button></form>
<p class="muted">You can disconnect any time in Claude's connector settings.</p>`,
      ),
    );
  }

  async function consent(form, req, res) {
    const tx = form.get("tx") ?? "";
    const entry = pending.get(`tx:${tx}`);
    const nonce = readCookies(req.headers.cookie).get(`__Host-desk_login_${tx}`);
    const expected = nonce
      ? NodeCrypto.createHmac("sha256", nonce).update(tx).digest("base64url")
      : "";
    if (
      !entry?.login ||
      entry.expires < Date.now() ||
      !nonce ||
      !safeEqual(form.get("csrf") ?? "", expected)
    ) {
      return sendHtml(
        res,
        400,
        page("Sign-in expired", "<h1>This sign-in expired. Start again from Claude.</h1>"),
      );
    }
    pending.delete(`tx:${tx}`);
    const back = new URL(entry.redirectUri);
    if (form.get("decision") !== "allow") {
      back.searchParams.set("error", "access_denied");
    } else {
      const code = random();
      pending.set(`code:${sha256(code)}`, {
        expires: Date.now() + CODE_TTL_MS,
        clientId: entry.clientId,
        redirectUri: entry.redirectUri,
        challenge: entry.challenge,
        login: entry.login,
      });
      back.searchParams.set("code", code);
    }
    if (entry.state) back.searchParams.set("state", entry.state);
    res.writeHead(302, {
      location: back.toString(),
      "set-cookie": `__Host-desk_login_${tx}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      "cache-control": "no-store",
    });
    res.end();
  }

  async function token(form, reply) {
    const grant = form.get("grant_type");
    const clientId = form.get("client_id") ?? "";
    if (grant === "authorization_code") {
      const key = `code:${sha256(form.get("code") ?? "")}`;
      const entry = pending.get(key);
      pending.delete(key);
      if (
        !entry ||
        entry.expires < Date.now() ||
        entry.clientId !== clientId ||
        entry.redirectUri !== form.get("redirect_uri") ||
        !safeEqual(sha256(form.get("code_verifier") ?? ""), entry.challenge)
      ) {
        return reply(400, { error: "invalid_grant" });
      }
      return reply(200, await issueTokens(entry.login, clientId));
    }
    if (grant === "refresh_token") {
      const all = await tokens.read();
      const hash = sha256(form.get("refresh_token") ?? "");
      const entry = all[hash];
      if (
        !entry ||
        entry.kind !== "refresh" ||
        entry.expires < Date.now() ||
        entry.clientId !== clientId ||
        !owners.has(entry.login)
      ) {
        return reply(400, { error: "invalid_grant" });
      }
      delete all[hash]; // rotate
      await tokens.write(all);
      return reply(200, await issueTokens(entry.login, clientId));
    }
    return reply(400, { error: "unsupported_grant_type" });
  }

  const tools = createTools({ desk, readNotes });

  async function mcp(message, login) {
    const { id, method, params } = message ?? {};
    const result = (value) => ({ jsonrpc: "2.0", id, result: value });
    const failure = (code, text) => ({ jsonrpc: "2.0", id, error: { code, message: text } });
    if (method === "initialize") {
      const asked = params?.protocolVersion;
      return result({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "dev-desk", title: "Dev Desk", version: "1.0.0" },
        instructions:
          "Rigo's development work across his applications, from the GitHub project the T3 fleet hub syncs. Every item is a GitHub issue with a type (Story, Bug, Maintenance, Research, Support), an app, a status (Todo, In Progress, In Review, Done), a priority (P0-P3) and maybe a sprint. Start with desk_overview; refer to items as repo#number. Write titles in plain words a manager can read.",
      });
    }
    if (method === "ping") return result({});
    if (method === "tools/list") return result({ tools: tools.list });
    if (method === "tools/call") {
      const tool = tools.byName.get(params?.name);
      if (!tool) return failure(-32602, `Unknown tool ${params?.name}`);
      try {
        const text = await tool.run(params?.arguments ?? {}, login);
        return result({ content: [{ type: "text", text }] });
      } catch (error) {
        return result({
          content: [{ type: "text", text: String(error.message ?? error) }],
          isError: true,
        });
      }
    }
    if (id === undefined) return null; // notifications
    return failure(-32601, `Method not found: ${method}`);
  }

  function sendHtml(res, status, html) {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      "x-frame-options": "DENY",
    });
    res.end(html);
  }

  return async function handle(req, res) {
    const s = settings();
    const url = new URL(req.url, s.origin || "http://connector");
    const reply = (status, body, headers = {}) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        ...headers,
      });
      res.end(body === null ? "" : JSON.stringify(body));
    };
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
          "access-control-max-age": "600",
        });
        return res.end();
      }
      if (!configured(s))
        return reply(503, { error: "The Dev Desk connector isn't set up on the hub yet." });
      const path = url.pathname;
      if (path.startsWith("/.well-known/oauth-protected-resource"))
        return reply(200, metadata(s).resource);
      if (path === "/.well-known/oauth-authorization-server") return reply(200, metadata(s).server);
      if (path === "/oauth/register" && req.method === "POST") {
        return register(JSON.parse((await readRaw(req)) || "{}"), reply);
      }
      if (path === "/oauth/authorize" && req.method === "GET") return authorize(url, s, res);
      if (path === "/oauth/callback" && req.method === "GET") return callback(url, req, s, res);
      if (path === "/oauth/consent" && req.method === "POST") {
        return consent(new URLSearchParams(await readRaw(req)), req, res);
      }
      if (path === "/oauth/token" && req.method === "POST") {
        const raw = await readRaw(req);
        const form = String(req.headers["content-type"]).includes("json")
          ? new URLSearchParams(JSON.parse(raw || "{}"))
          : new URLSearchParams(raw);
        return token(form, reply);
      }
      if (path === "/mcp") {
        const login = await loginFor(req);
        if (!login) {
          return reply(
            401,
            { error: "invalid_token" },
            {
              "www-authenticate": `Bearer resource_metadata="${s.origin}/.well-known/oauth-protected-resource"`,
            },
          );
        }
        if (req.method !== "POST") return reply(405, { error: "Use POST." }, { allow: "POST" });
        const message = JSON.parse((await readRaw(req)) || "null");
        if (Array.isArray(message)) {
          const answers = (await Promise.all(message.map((entry) => mcp(entry, login)))).filter(
            Boolean,
          );
          return answers.length ? reply(200, answers) : reply(202, null);
        }
        const answer = await mcp(message, login);
        return answer ? reply(200, answer) : reply(202, null);
      }
      if (path === "/") {
        return sendHtml(
          res,
          200,
          page(
            "Dev Desk",
            "<h1>Dev Desk connector</h1><p>Add this address with /mcp at the end as a custom connector in Claude.</p>",
          ),
        );
      }
      return reply(404, { error: "not_found" });
    } catch (error) {
      log("connector error", { error: String(error?.message ?? error) });
      if (!res.headersSent) reply(error?.status ?? 400, { error: "bad_request" });
      else res.destroy();
    }
  };
}

const KINDS = ["Story", "Bug", "Maintenance", "Research", "Support"];
const STATUSES = ["Todo", "In Progress", "In Review", "Done"];
const PRIORITY = { P0: 0, P1: 1, P2: 2, P3: 3 };

const kindOf = (item) =>
  item.workType === "Feature work" ? "Story" : item.workType === "Fix" ? "Bug" : item.workType;
const isOpen = (item) => item.state === "open" || item.state === "draft";
const refOf = (item) => (item.repo ? `${item.repo.split("/").pop()}#${item.number}` : item.title);
const titleOf = (item) => item.plain?.what ?? item.title;
const statusOf = (item) => {
  if (!isOpen(item) || item.status === "Done") return "Done";
  if (item.status === "In Progress" || item.status === "In Review") return item.status;
  if (item.pullRequests?.some((pr) => pr.state === "open")) return "In Review";
  if (item.pullRequests?.some((pr) => pr.state === "draft")) return "In Progress";
  return "Todo";
};
const byPriority = (a, b) =>
  (PRIORITY[a.priority] ?? 9) - (PRIORITY[b.priority] ?? 9) ||
  String(b.updatedAt).localeCompare(String(a.updatedAt));

function currentSprint(sprints, now = Date.now()) {
  const sorted = [...(sprints ?? [])].sort(
    (a, b) => Date.parse(a.startDate) - Date.parse(b.startDate),
  );
  return (
    sorted.find(
      (s) =>
        Date.parse(s.startDate) <= now && now < Date.parse(s.startDate) + s.duration * 86_400_000,
    ) ??
    sorted.find((s) => Date.parse(s.startDate) > now) ??
    null
  );
}

function prStage(pr) {
  if (pr.landed) return "already in main (close it)";
  if (pr.state === "draft") return "draft";
  if (
    pr.mergeable === "conflicting" ||
    pr.checks === "failing" ||
    pr.review === "CHANGES_REQUESTED"
  )
    return "needs a fix";
  if (pr.stackedOn) return `waiting (merges into ${pr.stackedOn})`;
  if (pr.mergeable === "mergeable" && pr.checks !== "pending") return "ready to merge";
  return "waiting";
}

function line(item) {
  const bits = [
    kindOf(item),
    item.app,
    item.priority,
    statusOf(item),
    item.sprint?.title,
    item.lane === "Blocked" ? "BLOCKED" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `- ${refOf(item)}: ${titleOf(item)} (${bits}) ${item.url ?? ""}`.trim();
}

function createTools({ desk, readNotes }) {
  const view = () => {
    const v = desk.view();
    if (!v.configured) throw new Error("The Desk isn't connected to GitHub on the hub.");
    return v;
  };
  const work = (v) => v.items.filter((item) => kindOf(item) !== "Tracking" && item.kind !== "pr");
  const prs = (v) => v.items.filter((item) => item.kind === "pr" && isOpen(item));
  const appArg = (v, app) => {
    if (!app) return null;
    const found =
      v.apps.find((name) => name.toLowerCase() === String(app).toLowerCase()) ??
      v.apps.find((name) => name.toLowerCase().includes(String(app).toLowerCase()));
    if (!found) throw new Error(`No app "${app}". Apps: ${v.apps.join(", ")}`);
    return found;
  };
  const findItem = (v, ref) => {
    const text = String(ref ?? "").trim();
    const url = /^https:\/\/github\.com\//.test(text) ? text.replace(/\/$/, "") : null;
    const m = /^([\w.-]+)#(\d+)$/.exec(text);
    const item = v.items.find((entry) =>
      url
        ? entry.url === url
        : m && entry.repo?.split("/").pop() === m[1] && entry.number === Number(m[2]),
    );
    if (!item)
      throw new Error(`No item ${text} on the Desk. Use repo#number, e.g. cfe-drawings#312.`);
    return item;
  };

  const list = [];
  const byName = new Map();
  const add = (name, description, inputSchema, run, readOnly = true) => {
    const tool = {
      name,
      description,
      inputSchema: { type: "object", additionalProperties: false, ...inputSchema },
      annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
    };
    list.push(tool);
    byName.set(name, { ...tool, run });
  };

  add(
    "desk_overview",
    "Where to focus: for each application (or one), the current sprint's progress, what's in review, PRs to merge or fix, blocked work and sprint work nobody has started. Use first, e.g. 'what needs me today?'.",
    {
      properties: {
        app: { type: "string", description: "One application, e.g. Precon. Omit for all." },
      },
    },
    async ({ app }) => {
      const v = view();
      const only = appArg(v, app);
      const sprint = currentSprint(v.sprints);
      const out = [
        `Dev Desk, synced ${v.syncedAt ?? "never"}${sprint ? `. ${sprint.title}: ${sprint.startDate} for ${sprint.duration} days` : ""}.`,
      ];
      for (const name of only ? [only] : v.apps) {
        const mine = work(v).filter((item) => item.app === name);
        const inSprint = sprint ? mine.filter((item) => item.sprint?.title === sprint.title) : [];
        const myPrs = prs(v).filter(
          (item) =>
            item.app === name || mine.some((m) => m.pullRequests?.some((p) => p.url === item.url)),
        );
        const blocked = mine.filter((item) => isOpen(item) && item.lane === "Blocked");
        const review = inSprint.filter((item) => statusOf(item) === "In Review");
        const todo = inSprint.filter((item) => statusOf(item) === "Todo");
        const ready = myPrs.filter(
          (pr) => prStage(pr) === "ready to merge" && !/^bump /i.test(pr.title),
        );
        const fix = myPrs.filter((pr) => prStage(pr) === "needs a fix");
        const landed = myPrs.filter((pr) => pr.landed);
        if (
          !only &&
          !inSprint.length &&
          !ready.length &&
          !fix.length &&
          !blocked.length &&
          !landed.length
        )
          continue;
        const done = inSprint.filter((item) => statusOf(item) === "Done").length;
        out.push(
          `\n## ${name}${inSprint.length ? ` (sprint: ${done} of ${inSprint.length} done)` : ""}`,
        );
        if (review.length) out.push("In review (waiting on Rigo):", ...review.map(line));
        if (fix.length) out.push("PRs to fix:", ...fix.map(line));
        if (ready.length) out.push("PRs ready to merge:", ...ready.map(line));
        if (landed.length) out.push("PRs already in main (close them):", ...landed.map(line));
        if (blocked.length) out.push("Blocked:", ...blocked.map(line));
        if (todo.length) out.push("Sprint work not started:", ...todo.map(line));
      }
      return out.join("\n");
    },
  );

  add(
    "list_work",
    "List work items, filtered. sprint: 'current', 'backlog' (not in a current or later sprint) or a sprint title. Highest priority first.",
    {
      properties: {
        app: { type: "string" },
        sprint: { type: "string", description: "'current', 'backlog' or e.g. 'Sprint 2'." },
        status: { type: "string", enum: STATUSES },
        type: { type: "string", enum: KINDS },
        query: { type: "string", description: "Words to find in titles." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
    },
    async ({ app, sprint, status, type, query, limit = 25 }) => {
      const v = view();
      const only = appArg(v, app);
      const current = currentSprint(v.sprints);
      const now = Date.now();
      const planned = new Set(
        (v.sprints ?? [])
          .filter((s) => Date.parse(s.startDate) + s.duration * 86_400_000 > now)
          .map((s) => s.title),
      );
      const words = String(query ?? "").toLowerCase();
      const found = work(v)
        .filter((item) => isOpen(item) || status === "Done")
        .filter((item) => !only || item.app === only)
        .filter((item) => !type || kindOf(item) === type)
        .filter((item) => !status || statusOf(item) === status)
        .filter((item) =>
          !sprint
            ? true
            : sprint === "current"
              ? item.sprint?.title === current?.title
              : sprint === "backlog"
                ? !(item.sprint && planned.has(item.sprint.title))
                : item.sprint?.title?.toLowerCase() === sprint.toLowerCase(),
        )
        .filter(
          (item) =>
            !words || `${item.title} ${item.plain?.what ?? ""}`.toLowerCase().includes(words),
        )
        .sort(byPriority);
      const shown = found.slice(0, Math.min(100, Number(limit) || 25));
      return shown.length
        ? `${found.length} item${found.length === 1 ? "" : "s"}${found.length > shown.length ? `, first ${shown.length}` : ""}:\n${shown.map(line).join("\n")}`
        : "Nothing matches.";
    },
  );

  add(
    "get_item",
    "One item in full: plain words, user story and acceptance criteria, fields, its PRs and their merge state.",
    {
      properties: { item: { type: "string", description: "repo#number or the GitHub URL." } },
      required: ["item"],
    },
    async ({ item: ref }) => {
      const v = view();
      const item = findItem(v, ref);
      const out = [`${refOf(item)}: ${titleOf(item)}`, line(item)];
      if (item.plain?.what && item.plain.what !== item.title) out.push(`On GitHub: ${item.title}`);
      if (item.plain?.why) out.push(`Why it matters: ${item.plain.why}`);
      if (item.plain?.where) out.push(`Where it stands: ${item.plain.where}`);
      if (item.story?.text) out.push(`\nUser story: ${item.story.text}`);
      for (const criterion of item.story?.criteria ?? [])
        out.push(`[${criterion.done ? "x" : " "}] ${criterion.text}`);
      for (const pr of item.pullRequests ?? [])
        out.push(`PR #${pr.number} ${pr.state}: ${prStage(pr)} ${pr.url}`);
      return out.join("\n");
    },
  );

  add(
    "file_item",
    "File a new work item (a GitHub issue) and add it to the project, e.g. from an email. Title in plain words. Puts it in the backlog unless a sprint is given.",
    {
      properties: {
        repo: {
          type: "string",
          description: "owner/repo, one of the project's repos, e.g. cfevans/cfe-drawings.",
        },
        title: { type: "string" },
        body: {
          type: "string",
          description: "What and why, and where it came from (e.g. the email's sender and date).",
        },
        type: { type: "string", enum: KINDS },
        app: { type: "string" },
        priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
        sprint: {
          type: "string",
          description: "A sprint title, e.g. 'Sprint 2'. Omit for the backlog.",
        },
      },
      required: ["repo", "title", "type"],
    },
    async ({ repo, title, body, type, app, priority, sprint }) => {
      const v = view();
      const repos = new Set(v.items.map((item) => item.repo).filter(Boolean));
      if (!repos.has(repo))
        throw new Error(`Not a project repo: ${repo}. Repos: ${[...repos].sort().join(", ")}`);
      const item = await desk.createItem({
        repo,
        title: String(title).slice(0, 200),
        body: String(body ?? ""),
        fields: {
          "Work type": type,
          App: appArg(v, app),
          Priority: priority ?? null,
          Sprint: sprint ?? null,
        },
      });
      return `Filed ${refOf(item)}: ${item.url}`;
    },
    false,
  );

  add(
    "update_item",
    "Change an item's status, priority, sprint ('none' to move it to the backlog), type, or blocked flag.",
    {
      properties: {
        item: { type: "string", description: "repo#number or the GitHub URL." },
        status: { type: "string", enum: STATUSES },
        priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
        sprint: { type: "string" },
        type: { type: "string", enum: KINDS },
        blocked: { type: "boolean" },
      },
      required: ["item"],
    },
    async ({ item: ref, status, priority, sprint, type, blocked }) => {
      const v = view();
      const item = findItem(v, ref);
      const changes = [];
      if (status) changes.push(["Status", status]);
      if (priority) changes.push(["Priority", priority]);
      if (sprint) changes.push(["Sprint", sprint.toLowerCase() === "none" ? null : sprint]);
      if (type) changes.push(["Work type", type]);
      if (blocked !== undefined) changes.push(["Lane", blocked ? "Blocked" : null]);
      if (!changes.length) return "Nothing to change.";
      for (const [field, value] of changes) await desk.setField(item.itemId, field, value);
      return `Updated ${refOf(item)}: ${changes.map(([f, value]) => `${f} → ${value ?? "none"}`).join(", ")}.`;
    },
    false,
  );

  add(
    "status_brief",
    "A short status brief in plain words for one application (or all): the sprint goal, what's done, in progress, in review and blocked. Good for a manager update or an email reply.",
    { properties: { app: { type: "string" } } },
    async ({ app }) => {
      const v = view();
      const only = appArg(v, app);
      const sprint = currentSprint(v.sprints);
      const notes = await readNotes();
      const out = [];
      for (const name of only ? [only] : v.apps) {
        const inSprint = sprint
          ? work(v).filter((item) => item.app === name && item.sprint?.title === sprint.title)
          : [];
        if (!inSprint.length && !only) continue;
        const goal = sprint ? notes?.sprintGoals?.[sprint.title]?.[name]?.text : null;
        const group = (status) =>
          inSprint.filter((item) => statusOf(item) === status).map((item) => titleOf(item));
        out.push(`## ${name}${sprint ? ` · ${sprint.title}` : ""}`);
        if (goal) out.push(`Goal: ${goal}`);
        for (const [label, status] of [
          ["Done", "Done"],
          ["In review", "In Review"],
          ["In progress", "In Progress"],
          ["Not started", "Todo"],
        ]) {
          const titles = group(status);
          if (titles.length) out.push(`${label}: ${titles.join("; ")}`);
        }
        const blocked = work(v).filter(
          (item) => item.app === name && isOpen(item) && item.lane === "Blocked",
        );
        if (blocked.length) out.push(`Blocked: ${blocked.map(titleOf).join("; ")}`);
        out.push("");
      }
      return out.join("\n").trim() || "Nothing planned in the current sprint.";
    },
  );

  return { list, byName };
}
