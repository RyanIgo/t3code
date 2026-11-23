#!/usr/bin/env node
// Fleet hub: serves the hosted fleet UI, the shared documents (connection catalog, board) and
// artifacts (test sheets and pages agents publish, at /a/<id>). Listens on loopback behind
// `tailscale serve`, which adds the caller's `Tailscale-User-Login`. HUB_OWNERS may use all of it;
// HUB_GUESTS may only open and fill in artifacts. Node 20+, no dependencies. See fleet/README.md.

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import { createConnector } from "./connector.mjs";
import { createDesk } from "./desk.mjs";

const PORT = Number(process.env.HUB_PORT ?? 3790);
// The Dev Desk connector's own port, published by `tailscale funnel`; only connector paths answer.
const CONNECTOR_PORT = Number(process.env.HUB_CONNECTOR_PORT ?? 3791);
const WEB_ROOT = NodePath.resolve(process.env.HUB_WEB ?? "./web");
const DATA_ROOT = NodePath.resolve(process.env.HUB_DATA ?? "./data");
const OWNERS = new Set(
  (process.env.HUB_OWNERS ?? "")
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean),
);
const GUESTS = new Set(
  (process.env.HUB_GUESTS ?? "")
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean),
);
const HISTORY_DIR = NodePath.join(DATA_ROOT, "history");
const ARTIFACT_DIR = NodePath.join(DATA_ROOT, "artifacts");
const ARTIFACT_HISTORY_KEEP = 200;
// Each shared document: its file, and the check a saved document must pass.
const DOCUMENTS = {
  catalog: (parsed) => Array.isArray(parsed?.targets),
  board: (parsed) => Array.isArray(parsed?.cards),
  // Dev Desk notes: per-app agent notes, sprint goals and notes (see apps/web …/deskNotes.logic.ts).
  desknotes: (parsed) => typeof parsed?.apps === "object" && parsed.apps !== null,
};
const HISTORY_KEEP = 20;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function log(message, extra = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), message, ...extra }));
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(payload);
}

/** The caller's Tailscale login, or null. Only `tailscale serve` on this machine sets it. */
function callerLogin(req) {
  const login = req.headers["tailscale-user-login"];
  return typeof login === "string" && login.trim() !== "" ? login.trim().toLowerCase() : null;
}

const documentFile = (name) => NodePath.join(DATA_ROOT, `${name}.json`);

async function readDocument(name) {
  try {
    return JSON.parse(await NodeFSP.readFile(documentFile(name), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT")
      return { version: 0, updatedAt: null, updatedBy: null, document: null };
    throw error;
  }
}

async function writeDocument(name, record) {
  await NodeFSP.mkdir(HISTORY_DIR, { recursive: true, mode: 0o700 });
  const file = documentFile(name);
  const tmp = `${file}.${process.pid}.tmp`;
  await NodeFSP.writeFile(tmp, JSON.stringify(record), { mode: 0o600 });
  await NodeFSP.rename(tmp, file);
  await NodeFSP.writeFile(
    NodePath.join(HISTORY_DIR, `${name}-${String(record.version).padStart(6, "0")}.json`),
    JSON.stringify(record),
    { mode: 0o600 },
  );
  const kept = (await NodeFSP.readdir(HISTORY_DIR))
    .filter((entry) => entry.startsWith(`${name}-`))
    .sort();
  for (const entry of kept.slice(0, Math.max(0, kept.length - HISTORY_KEEP))) {
    await NodeFSP.rm(NodePath.join(HISTORY_DIR, entry), { force: true });
  }
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_CATALOG_BYTES) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Writes are serialized so two devices saving at once cannot both pass the version check.
let writeQueue = Promise.resolve();

async function handleDocument(name, req, res, login) {
  if (req.method === "GET") {
    const record = await readDocument(name);
    send(res, 200, record);
    return;
  }
  if (req.method !== "PUT") {
    send(res, 405, { error: "method-not-allowed" }, { allow: "GET, PUT" });
    return;
  }
  const body = JSON.parse(await readBody(req));
  if (typeof body?.document !== "string" || !Number.isInteger(body?.baseVersion)) {
    send(res, 400, { error: "expected { baseVersion: number, document: string }" });
    return;
  }
  const parsed = JSON.parse(body.document);
  if (!DOCUMENTS[name](parsed)) {
    send(res, 400, { error: `not a ${name} document` });
    return;
  }
  const result = (writeQueue = writeQueue.then(async () => {
    const current = await readDocument(name);
    if (current.version !== body.baseVersion) return { conflict: current };
    const next = {
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: login,
      document: body.document,
    };
    await writeDocument(name, next);
    return { saved: next };
  }));
  const outcome = await result;
  if (outcome.conflict) {
    send(res, 409, { error: "version-conflict", ...outcome.conflict });
    return;
  }
  log(`${name} saved`, { version: outcome.saved.version, by: login });
  send(res, 200, { version: outcome.saved.version, updatedAt: outcome.saved.updatedAt });
}

// Pictures attached to inbox notes: images only, kept in the data folder, served to owners.
const FILES_DIR = NodePath.join(DATA_ROOT, "files");
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
};

async function handleFiles(pathname, req, res) {
  if (pathname === "/fleet/files" && req.method === "POST") {
    const type = String(req.headers["content-type"] ?? "")
      .split(";")[0]
      .trim();
    const ext = IMAGE_TYPES[type];
    if (!ext) {
      send(res, 415, { error: "Only images (PNG, JPEG, GIF, WebP, HEIC) can be attached." });
      return true;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_FILE_BYTES) {
        send(res, 413, { error: "Pictures can be up to 8 MB." });
        return true;
      }
      chunks.push(chunk);
    }
    const name = `${NodeCrypto.randomBytes(9).toString("hex")}.${ext}`;
    await NodeFSP.mkdir(FILES_DIR, { recursive: true, mode: 0o700 });
    await NodeFSP.writeFile(NodePath.join(FILES_DIR, name), Buffer.concat(chunks), { mode: 0o600 });
    send(res, 200, { path: `/fleet/files/${name}` });
    return true;
  }
  const file = pathname.match(/^\/fleet\/files\/([a-f0-9]{18}\.(png|jpg|gif|webp|heic))$/);
  if (file && req.method === "GET") {
    try {
      const data = await NodeFSP.readFile(NodePath.join(FILES_DIR, file[1]));
      const type = Object.entries(IMAGE_TYPES).find(([, ext]) => ext === file[2])?.[0];
      res.writeHead(200, {
        "content-type": type ?? "application/octet-stream",
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      });
      res.end(data);
    } catch {
      send(res, 404, { error: "not-found" });
    }
    return true;
  }
  return false;
}

async function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed");
    return;
  }
  const path = decodeURIComponent(new URL(req.url, "http://hub").pathname);
  const candidate = NodePath.normalize(NodePath.join(WEB_ROOT, path));
  const inside = candidate === WEB_ROOT || candidate.startsWith(WEB_ROOT + NodePath.sep);
  let file = inside ? candidate : null;
  if (file) {
    const info = await NodeFSP.stat(file).catch(() => null);
    if (info?.isDirectory()) file = NodePath.join(file, "index.html");
    else if (!info) file = null;
  }
  // Client-side routes (/pair, /<environment>/<thread>, …) all load the app shell.
  const isAsset = file !== null && !file.endsWith("index.html");
  if (!file) file = NodePath.join(WEB_ROOT, "index.html");
  const info = await NodeFSP.stat(file).catch(() => null);
  if (!info) {
    send(res, 503, "The hub has no UI deployed yet.");
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[NodePath.extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
    "cache-control":
      isAsset && file.includes(`${NodePath.sep}assets${NodePath.sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  NodeFS.createReadStream(file).pipe(res);
}

// An artifact is a page an agent publishes (a test sheet or its own HTML) plus what people did on
// it: row results or saved page state, submissions, and who changed what. Agents publish through
// their T3 server; people open /a/<id> inline in a chat, in the Review window, or on their own.

const ARTIFACT_ID = /^[a-z0-9]{12}$/;
// The sheet page and T3's page theme, built from packages/shared by fleet/deploy-hub.sh.
const ARTIFACT_ASSETS = (() => {
  try {
    return JSON.parse(
      NodeFS.readFileSync(new URL("./artifact-assets.json", import.meta.url), "utf8"),
    );
  } catch {
    return { sheetHtml: null, themeHead: "" };
  }
})();
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_NOTE = 4000;

const isGuestPath = (pathname) =>
  /^\/a\/[a-z0-9]{12}$/.test(pathname) ||
  /^\/fleet\/artifacts\/[a-z0-9]{12}(?:\/(?:state|submit|files))?$/.test(pathname) ||
  /^\/fleet\/artifacts\/[a-z0-9]{12}\/files\/[a-f0-9]{18}\.(?:png|jpg|gif|webp|heic)$/.test(
    pathname,
  ) ||
  pathname === "/fleet/whoami";

const artifactFile = (id) => NodePath.join(ARTIFACT_DIR, `${id}.json`);

async function readArtifact(id) {
  try {
    return JSON.parse(await NodeFSP.readFile(artifactFile(id), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeArtifact(artifact) {
  await NodeFSP.mkdir(ARTIFACT_DIR, { recursive: true, mode: 0o700 });
  const file = artifactFile(artifact.id);
  const tmp = `${file}.${process.pid}.tmp`;
  await NodeFSP.writeFile(tmp, JSON.stringify(artifact), { mode: 0o600 });
  await NodeFSP.rename(tmp, file);
}

// Pages may be opened from a chat on another origin, so the artifact API answers any origin.
// It carries no credentials: tailscale serve identifies the caller by machine.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "600",
};

const isWebUrl = (value) => {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

/** Links for review: `url` and/or `links: [{ url, label? }]`, web URLs only, at most 10. */
function cleanLinks(source) {
  const links = [];
  if (isWebUrl(source?.url)) links.push({ url: source.url });
  for (const link of Array.isArray(source?.links) ? source.links : []) {
    if (!isWebUrl(link?.url)) continue;
    links.push({
      url: link.url,
      ...(typeof link.label === "string" && link.label.trim()
        ? { label: link.label.trim().slice(0, 120) }
        : {}),
    });
  }
  return links.slice(0, 10);
}

/** The app under review: its URL and the one-line command that starts it again. */
function cleanApp(app) {
  if (!isWebUrl(app?.url)) return null;
  return {
    url: app.url,
    ...(typeof app.start === "string" && app.start.trim()
      ? { start: app.start.trim().slice(0, 1000) }
      : {}),
    ...(typeof app.machine === "string" && app.machine.trim()
      ? { machine: app.machine.trim().slice(0, 120) }
      : {}),
  };
}

function cleanRows(rows) {
  if (!Array.isArray(rows)) return null;
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (typeof row?.id !== "string" || typeof row?.title !== "string" || seen.has(row.id)) {
      return null;
    }
    seen.add(row.id);
    const links = cleanLinks(row);
    out.push({
      id: row.id.slice(0, 80),
      title: row.title.slice(0, 500),
      ...(links.length > 0 ? { links } : {}),
      ...(typeof row.detail === "string" ? { detail: row.detail.slice(0, 4000) } : {}),
      ...(typeof row.group === "string" ? { group: row.group.slice(0, 120) } : {}),
      // Set by the chat when it fixed this check: what changed, so Rigo knows what to re-test.
      ...(typeof row.retest === "string" && row.retest.trim()
        ? { retest: row.retest.trim().slice(0, 1000) }
        : {}),
    });
  }
  return out;
}

const SHEET_STATUSES = new Set(["pass", "fail", "skip", "blocked"]);

/** What an artifact looks like to a reader: no page HTML, state and history included. */
function artifactSummary(artifact) {
  const { html: _html, ...rest } = artifact;
  return rest;
}

function sheetCounts(artifact) {
  const counts = {
    total: artifact.rows?.length ?? 0,
    pass: 0,
    fail: 0,
    skip: 0,
    blocked: 0,
    retest: 0,
  };
  for (const row of artifact.rows ?? []) {
    const status = artifact.state?.rows?.[row.id]?.status;
    if (status && counts[status] !== undefined) counts[status] += 1;
    // A fixed check Rigo hasn't looked at again yet.
    if (row.retest && !status) counts.retest += 1;
  }
  return counts;
}

function pushHistory(artifact, entry) {
  artifact.history = [...(artifact.history ?? []), entry].slice(-ARTIFACT_HISTORY_KEEP);
}

/** The artifact's page with what it needs to talk back to the hub. Served sandboxed (see below). */
function artifactPage(artifact) {
  const boot = JSON.stringify({
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    version: artifact.version,
    intro: artifact.intro ?? null,
    app: artifact.app ?? null,
    rows: artifact.rows ?? null,
    state: artifact.state ?? null,
    submittedAt: artifact.submissions?.at(-1)?.at ?? null,
  }).replace(/</g, "\\u003c");
  const script = `<script>window.__T3_ARTIFACT__=${boot};</script><script>${ARTIFACT_BRIDGE}</script>`;
  let html =
    artifact.kind === "sheet"
      ? (ARTIFACT_ASSETS.sheetHtml ?? "<!doctype html><p>Redeploy the hub to show test sheets.</p>")
      : artifact.html;
  if (artifact.kind === "html" && !html.includes('id="t3-theme"')) {
    const at = /<head(?:\s[^>]*)?>/i.exec(html);
    html = at
      ? html.slice(0, at.index + at[0].length) +
        ARTIFACT_ASSETS.themeHead +
        html.slice(at.index + at[0].length)
      : `<!doctype html><head>${ARTIFACT_ASSETS.themeHead}</head>${html}`;
  }
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  return script + html;
}

// `t3.state`, `t3.save(state)`, `t3.submit(text, data)` and `t3.onChange(fn)` for artifact pages.
// Saves go to the hub; a submit also reaches the chat the page is shown in, as a page message.
const ARTIFACT_BRIDGE = `(function(){var A=window.__T3_ARTIFACT__,base=new URL(location.href).origin+"/fleet/artifacts/"+A.id,fns=[],n=0;
function call(path,method,body){return fetch(base+path,{method:method,headers:{"content-type":"text/plain"},body:body===undefined?undefined:JSON.stringify(body)}).then(function(r){if(!r.ok)throw new Error("hub "+r.status);return r.json();});}
function toChat(text,data){if(window.parent===window)return Promise.resolve(false);return new Promise(function(done){var id="t3a-"+(++n);function on(e){var m=e.data;if(m&&m.type==="t3-page:result"&&m.id===id){removeEventListener("message",on);done(m.ok===true);}}addEventListener("message",on);parent.postMessage({type:"t3-page:send",id:id,text:text,data:data},"*");setTimeout(function(){removeEventListener("message",on);done(false);},8000);});}
function refresh(){return call("","GET").then(function(a){if(a.version!==A.version){location.reload();return;}if(JSON.stringify(a.state)!==JSON.stringify(A.state)){A.state=a.state;fns.forEach(function(f){f(A.state);});}}).catch(function(){});}
setInterval(function(){if(document.visibilityState==="visible")refresh();},15000);document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")refresh();});
window.t3artifact={get state(){return A.state;},id:A.id,rows:A.rows,title:A.title,intro:A.intro,app:A.app,submittedAt:A.submittedAt,
save:function(value){return call("/state","POST",A.kind==="sheet"?value:{data:value}).then(function(a){A.state=a.state;return a.state;});},
submit:function(text,data){return call("/submit","POST",{text:text}).then(function(){return toChat(text,data);}).then(function(chat){return{saved:true,chat:chat};});},
onChange:function(f){fns.push(f);},
upload:function(file){return fetch(base+"/files?type="+encodeURIComponent(file.type),{method:"POST",headers:{"content-type":"text/plain"},body:file}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j&&j.error||("hub "+r.status));return new URL(location.href).origin+j.path;});});}};})();`;

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (Buffer.byteLength(raw) > MAX_ARTIFACT_BYTES) {
    throw Object.assign(new Error("too large"), { status: 413 });
  }
  return JSON.parse(raw);
}

let artifactQueue = Promise.resolve();
const serialized = (task) => (artifactQueue = artifactQueue.then(task, task));

async function handleArtifacts(pathname, req, res, login, owner) {
  const page = pathname.match(/^\/a\/([a-z0-9]{12})$/);
  if (page) {
    const artifact = await readArtifact(page[1]);
    if (!artifact) {
      send(res, 404, "No artifact here. It may have been removed.");
      return true;
    }
    // An owner opening a sheet in its own tab lands on the Board's Test page (the sheet with its
    // chat, terminal and the app beside it). Embedded copies and ?plain still get the bare sheet.
    if (
      owner &&
      artifact.kind === "sheet" &&
      req.headers["sec-fetch-dest"] === "document" &&
      !new URL(req.url, "http://hub").searchParams.has("plain")
    ) {
      res.writeHead(302, {
        location: `/board#desk=test&sheet=${artifact.id}`,
        "cache-control": "no-store",
      });
      res.end();
      return true;
    }
    const body = artifactPage(artifact);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // Agent-written HTML on the hub's origin: the sandbox gives it an opaque origin, so it can
      // never read the catalog (machine sign-ins) or anything else owners can reach.
      // allow-popups-to-escape-sandbox: a tab the page opens (the Board's Test page, the app,
      // a PR) is a normal page, not one stuck with this page's opaque origin.
      "content-security-policy":
        "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    res.end(body);
    return true;
  }
  if (!pathname.startsWith("/fleet/artifacts")) return false;
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return true;
  }
  const reply = (status, body) => send(res, status, body, CORS);
  if (pathname === "/fleet/artifacts") {
    if (!owner) return (reply(403, { error: "owners only" }), true);
    if (req.method === "GET") {
      await NodeFSP.mkdir(ARTIFACT_DIR, { recursive: true, mode: 0o700 });
      const files = (await NodeFSP.readdir(ARTIFACT_DIR)).filter((f) => f.endsWith(".json"));
      const list = [];
      for (const file of files) {
        const artifact = await readArtifact(file.slice(0, -5));
        if (!artifact) continue;
        list.push({
          id: artifact.id,
          title: artifact.title,
          kind: artifact.kind,
          thread: artifact.thread,
          version: artifact.version,
          updatedAt: artifact.updatedAt,
          ...(artifact.kind === "sheet" ? { counts: sheetCounts(artifact) } : {}),
        });
      }
      reply(200, {
        artifacts: list.sort((a, b) => String(b.updatedAt).localeCompare(a.updatedAt)),
      });
      return true;
    }
    if (req.method !== "POST") return (reply(405, { error: "method-not-allowed" }), true);
    const id = NodeCrypto.randomBytes(6).toString("hex");
    return publishArtifact(id, true, req, reply, login);
  }
  // Pictures pasted into a sheet's notes: kept beside the artifact, readable by anyone who can
  // open the sheet. Sent as text/plain so the sandboxed page needs no preflight.
  const fileUpload = pathname.match(/^\/fleet\/artifacts\/([a-z0-9]{12})\/files$/);
  if (fileUpload && req.method === "POST") {
    const ext = IMAGE_TYPES[new URL(req.url, "http://hub").searchParams.get("type") ?? ""];
    if (!ext) return (reply(415, { error: "Only images can be attached." }), true);
    if (!(await readArtifact(fileUpload[1]))) return (reply(404, { error: "not-found" }), true);
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_FILE_BYTES)
        return (reply(413, { error: "Pictures can be up to 8 MB." }), true);
      chunks.push(chunk);
    }
    const name = `${NodeCrypto.randomBytes(9).toString("hex")}.${ext}`;
    const dir = NodePath.join(ARTIFACT_DIR, `${fileUpload[1]}-files`);
    await NodeFSP.mkdir(dir, { recursive: true, mode: 0o700 });
    await NodeFSP.writeFile(NodePath.join(dir, name), Buffer.concat(chunks), { mode: 0o600 });
    reply(200, { path: `/fleet/artifacts/${fileUpload[1]}/files/${name}` });
    return true;
  }
  const fileRead = pathname.match(
    /^\/fleet\/artifacts\/([a-z0-9]{12})\/files\/([a-f0-9]{18}\.(png|jpg|gif|webp|heic))$/,
  );
  if (fileRead && req.method === "GET") {
    try {
      const data = await NodeFSP.readFile(
        NodePath.join(ARTIFACT_DIR, `${fileRead[1]}-files`, fileRead[2]),
      );
      const type = Object.entries(IMAGE_TYPES).find(([, value]) => value === fileRead[3])?.[0];
      res.writeHead(200, {
        ...CORS,
        "content-type": type ?? "application/octet-stream",
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      });
      res.end(data);
    } catch {
      reply(404, { error: "not-found" });
    }
    return true;
  }
  const match = pathname.match(/^\/fleet\/artifacts\/([a-z0-9]{12})(?:\/(state|submit))?$/);
  if (!match || !ARTIFACT_ID.test(match[1])) return (reply(404, { error: "not-found" }), true);
  const [, id, action] = match;
  if (!action) {
    if (req.method === "GET") {
      const artifact = await readArtifact(id);
      if (!artifact) return (reply(404, { error: "not-found" }), true);
      reply(200, {
        ...artifactSummary(artifact),
        ...(artifact.kind === "sheet" ? { counts: sheetCounts(artifact) } : {}),
      });
      return true;
    }
    if (req.method !== "PUT") return (reply(405, { error: "method-not-allowed" }), true);
    if (!owner) return (reply(403, { error: "owners only" }), true);
    return publishArtifact(id, false, req, reply, login);
  }
  if (req.method !== "POST") return (reply(405, { error: "method-not-allowed" }), true);
  const body = await readJsonBody(req);
  const outcome = await serialized(async () => {
    const artifact = await readArtifact(id);
    if (!artifact) return { status: 404, body: { error: "not-found" } };
    const at = new Date().toISOString();
    if (action === "submit") {
      const text = typeof body?.text === "string" ? body.text.slice(0, MAX_NOTE) : "";
      artifact.submissions = [...(artifact.submissions ?? []), { at, by: login, text }].slice(-50);
      pushHistory(artifact, { at, by: login, change: "submitted" });
    } else if (artifact.kind === "sheet") {
      const rows = body?.rows;
      if (typeof rows !== "object" || rows === null) {
        return {
          status: 400,
          body: { error: "expected { rows: { <rowId>: { status?, note? } } }" },
        };
      }
      const known = new Set((artifact.rows ?? []).map((row) => row.id));
      const current = { ...artifact.state?.rows };
      for (const [rowId, change] of Object.entries(rows)) {
        if (!known.has(rowId) || typeof change !== "object" || change === null) continue;
        const next = { ...current[rowId] };
        if ("status" in change) {
          if (change.status === null) delete next.status;
          else if (SHEET_STATUSES.has(change.status)) next.status = change.status;
        }
        if (typeof change.note === "string") next.note = change.note.slice(0, MAX_NOTE);
        current[rowId] = { ...next, by: login, at };
        pushHistory(artifact, {
          at,
          by: login,
          change: `${rowId}: ${[next.status, change.note !== undefined ? "note" : null].filter(Boolean).join(", ") || "cleared"}`,
        });
      }
      artifact.state = { rows: current };
    } else {
      if (!("data" in (body ?? {}))) return { status: 400, body: { error: "expected { data }" } };
      const data = JSON.stringify(body.data);
      if (data.length > 256 * 1024) return { status: 413, body: { error: "state too large" } };
      artifact.state = { data: body.data, by: login, at };
      pushHistory(artifact, { at, by: login, change: "saved" });
    }
    artifact.stateUpdatedAt = at;
    await writeArtifact(artifact);
    return { status: 200, body: { state: artifact.state, version: artifact.version } };
  });
  reply(outcome.status, outcome.body);
  return true;
}

async function publishArtifact(id, create, req, reply, login) {
  const body = await readJsonBody(req);
  const kind = body?.kind;
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
  if ((kind !== "sheet" && kind !== "html") || !title) {
    reply(400, { error: "expected { kind: 'sheet'|'html', title, rows? | html? }" });
    return true;
  }
  if (kind === "html" && (typeof body.html !== "string" || body.html.trim() === "")) {
    reply(400, { error: "an html artifact needs html" });
    return true;
  }
  const rows = kind === "sheet" ? cleanRows(body.rows) : null;
  if (kind === "sheet" && rows === null) {
    reply(400, { error: "a sheet needs rows: [{ id, title, detail?, group? }] with unique ids" });
    return true;
  }
  // A sheet that reviews something running must say where it runs and how to start it again;
  // a plain checklist (decisions, acceptance criteria) says so with `checklist: true`.
  if (kind === "sheet" && body.checklist !== true && !cleanApp(body.app)?.start) {
    reply(400, {
      error:
        'a test sheet needs "app": { "url": "<the Tailscale URL to open>", "start": "<one-line start command>", "machine": "<machine>" } and a url or links on each check. For a checklist with nothing running, send "checklist": true.',
    });
    return true;
  }
  const thread =
    typeof body.thread?.environmentId === "string" && typeof body.thread?.threadId === "string"
      ? { environmentId: body.thread.environmentId, threadId: body.thread.threadId }
      : null;
  const outcome = await serialized(async () => {
    const existing = create ? null : await readArtifact(id);
    if (!create && !existing) return { status: 404, body: { error: "not-found" } };
    if (existing && existing.kind !== kind) {
      return { status: 400, body: { error: `this artifact is a ${existing.kind}` } };
    }
    const at = new Date().toISOString();
    const keep = new Set((rows ?? []).map((row) => row.id));
    const artifact = {
      id,
      kind,
      title,
      thread: thread ?? existing?.thread ?? null,
      ...(kind === "html" ? { html: body.html } : {}),
      ...(cleanApp(body.app) ? { app: cleanApp(body.app) } : {}),
      ...(typeof body.intro === "string" && body.intro.trim()
        ? { intro: body.intro.trim().slice(0, 2000) }
        : {}),
      ...(rows ? { rows } : {}),
      // Results for rows that are still there survive an update, except a check the chat marks
      // fixed (a new `retest`): its result moves to `previous` and it opens again for a re-test.
      state:
        kind === "sheet"
          ? {
              rows: Object.fromEntries(
                Object.entries(existing?.state?.rows ?? {})
                  .filter(([rowId]) => keep.has(rowId))
                  .map(([rowId, result]) => {
                    const row = rows?.find((entry) => entry.id === rowId);
                    const before = existing?.rows?.find((entry) => entry.id === rowId);
                    if (!row?.retest || row.retest === before?.retest || !result?.status) {
                      return [rowId, result];
                    }
                    return [
                      rowId,
                      {
                        previous: {
                          status: result.status,
                          note: result.note ?? "",
                          by: result.by ?? null,
                          at: result.at ?? null,
                        },
                      },
                    ];
                  }),
              ),
            }
          : (existing?.state ?? null),
      submissions: existing?.submissions ?? [],
      history: existing?.history ?? [],
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? at,
      createdBy: existing?.createdBy ?? login,
      updatedAt: at,
    };
    pushHistory(artifact, { at, by: login, change: create ? "published" : "updated" });
    await writeArtifact(artifact);
    return { status: create ? 201 : 200, body: { id, version: artifact.version } };
  });
  reply(outcome.status, outcome.body);
  return true;
}

// The Dev Desk reads the GitHub project named in data/desk-project ("owner/number") with the
// token in data/github-token (or HUB_DESK_PROJECT / HUB_GITHUB_TOKEN). Never logged or served.
const readSetting = (name, env) => {
  if (process.env[env]?.trim()) return process.env[env].trim();
  try {
    return NodeFS.readFileSync(NodePath.join(DATA_ROOT, name), "utf8").trim();
  } catch {
    return "";
  }
};
const desk = createDesk({
  dataRoot: DATA_ROOT,
  project: readSetting("desk-project", "HUB_DESK_PROJECT"),
  token: readSetting("github-token", "HUB_GITHUB_TOKEN"),
  log,
});

async function handleDesk(pathname, req, res) {
  if (pathname === "/fleet/desk" && req.method === "GET") {
    send(res, 200, desk.view());
    return true;
  }
  if (pathname === "/fleet/desk/refresh" && req.method === "POST") {
    await desk.refresh();
    send(res, 200, desk.view());
    return true;
  }
  const detail = pathname.match(/^\/fleet\/desk\/items\/([\w-]+)\/detail$/);
  if (detail && req.method === "GET") {
    try {
      send(res, 200, await desk.detail(detail[1]));
    } catch (error) {
      send(res, 400, { error: String(error.message ?? error) });
    }
    return true;
  }
  // Filing from the inbox: a new issue on the project, or a comment on an existing one.
  if (pathname === "/fleet/desk/items" && req.method === "POST") {
    const body = JSON.parse(await readBody(req));
    try {
      const repos = new Set(
        desk
          .view()
          .items.map((entry) => entry.repo)
          .filter(Boolean),
      );
      if (!repos.has(body?.repo)) throw new Error(`Not a project repo: ${body?.repo}`);
      if (typeof body?.title !== "string" || !body.title.trim())
        throw new Error("A title is needed.");
      const fields = Object.fromEntries(
        Object.entries(body?.fields ?? {}).filter(
          ([name, value]) =>
            ["App", "Work type", "Priority", "Status", "Sprint", "Feature"].includes(name) &&
            typeof value === "string",
        ),
      );
      send(res, 200, {
        item: await desk.createItem({
          repo: body.repo,
          title: body.title.trim().slice(0, 200),
          body: typeof body.body === "string" ? body.body.slice(0, 60_000) : "",
          fields,
        }),
      });
    } catch (error) {
      send(res, 400, { error: String(error.message ?? error) });
    }
    return true;
  }
  if (pathname === "/fleet/desk/comment" && req.method === "POST") {
    const body = JSON.parse(await readBody(req));
    try {
      send(res, 200, await desk.addComment(body?.url, body?.body));
    } catch (error) {
      send(res, 400, { error: String(error.message ?? error) });
    }
    return true;
  }
  const fieldEdit = pathname.match(/^\/fleet\/desk\/items\/([\w-]+)\/fields$/);
  if (fieldEdit && req.method === "POST") {
    const body = JSON.parse(await readBody(req));
    try {
      send(res, 200, {
        item: await desk.setField(fieldEdit[1], String(body?.field), body?.value ?? null),
      });
    } catch (error) {
      send(res, 400, { error: String(error.message ?? error) });
    }
    return true;
  }
  const item = pathname.match(/^\/fleet\/desk\/items\/([\w-]+)$/);
  if (item && req.method === "POST") {
    const body = JSON.parse(await readBody(req));
    try {
      send(res, 200, { item: await desk.setLane(item[1], body?.lane ?? null) });
    } catch (error) {
      send(res, 400, { error: String(error.message ?? error) });
    }
    return true;
  }
  return false;
}

const server = NodeHttp.createServer(async (req, res) => {
  try {
    const login = callerLogin(req);
    const { pathname } = new URL(req.url, "http://hub");
    const owner = login !== null && OWNERS.has(login);
    const guest = login !== null && GUESTS.has(login);
    if (!owner && !(guest && isGuestPath(pathname))) {
      log("refused", { login, path: req.url });
      send(res, 403, "This hub only answers its owner's Tailscale login.");
      return;
    }
    if (await handleArtifacts(pathname, req, res, login, owner)) return;
    if (pathname.startsWith("/fleet/desk") && (await handleDesk(pathname, req, res))) return;
    if (pathname.startsWith("/fleet/files") && (await handleFiles(pathname, req, res))) return;
    if (pathname === "/fleet/whoami") {
      send(res, 200, { login });
      return;
    }
    const documentName = pathname.match(/^\/fleet\/(\w+)$/)?.[1];
    if (documentName && Object.hasOwn(DOCUMENTS, documentName)) {
      await handleDocument(documentName, req, res, login);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    const status = error?.status ?? (error instanceof SyntaxError ? 400 : 500);
    log("error", { status, error: String(error?.message ?? error) });
    if (!res.headersSent)
      send(res, status, { error: status === 500 ? "internal" : String(error.message) });
    else res.destroy();
  }
});

if (OWNERS.size === 0) {
  console.error("Set HUB_OWNERS to your Tailscale login (for example you@example.com).");
  process.exit(1);
}
await NodeFSP.mkdir(DATA_ROOT, { recursive: true, mode: 0o700 });
await desk.start();
const connector = createConnector({
  dataRoot: DATA_ROOT,
  owners: OWNERS,
  readSetting,
  desk,
  // The connector's writes (inbox notes) go through the same queue and version as the Board's.
  changeNotes: (change) => {
    const run = writeQueue.then(async () => {
      const current = await readDocument("desknotes");
      const doc = current.document ? JSON.parse(current.document) : { schemaVersion: 1 };
      change(doc, new Date().toISOString());
      await writeDocument("desknotes", {
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: "connector",
        document: JSON.stringify(doc),
      });
    });
    // A failed write mustn't stop the queue for the Board's saves.
    writeQueue = run.catch(() => undefined);
    return run;
  },
  readNotes: async () => {
    const record = await readDocument("desknotes");
    try {
      return record.document ? JSON.parse(record.document) : null;
    } catch {
      return null;
    }
  },
  log,
});
NodeHttp.createServer((req, res) => void connector(req, res)).listen(
  CONNECTOR_PORT,
  "127.0.0.1",
  () => {
    log("connector listening", { port: CONNECTOR_PORT });
  },
);
server.listen(PORT, "127.0.0.1", () => {
  log("hub listening", { port: PORT, web: WEB_ROOT, data: DATA_ROOT, owners: [...OWNERS] });
});
