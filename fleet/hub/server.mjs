#!/usr/bin/env node
// Fleet hub: serves the hosted fleet UI and the shared documents (connection catalog, board). Listens on loopback
// behind `tailscale serve`, which adds the caller's `Tailscale-User-Login`; only HUB_OWNERS
// may use it. Node 20+, no dependencies. See fleet/README.md.

import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

const PORT = Number(process.env.HUB_PORT ?? 3790);
const WEB_ROOT = NodePath.resolve(process.env.HUB_WEB ?? "./web");
const DATA_ROOT = NodePath.resolve(process.env.HUB_DATA ?? "./data");
const OWNERS = new Set(
  (process.env.HUB_OWNERS ?? "")
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean),
);
const HISTORY_DIR = NodePath.join(DATA_ROOT, "history");
// Each shared document: its file, and the check a saved document must pass.
const DOCUMENTS = {
  catalog: (parsed) => Array.isArray(parsed?.targets),
  board: (parsed) => Array.isArray(parsed?.cards),
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

const server = NodeHttp.createServer(async (req, res) => {
  try {
    const login = callerLogin(req);
    if (login === null || !OWNERS.has(login)) {
      log("refused", { login, path: req.url });
      send(res, 403, "This hub only answers its owner's Tailscale login.");
      return;
    }
    const { pathname } = new URL(req.url, "http://hub");
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
server.listen(PORT, "127.0.0.1", () => {
  log("hub listening", { port: PORT, web: WEB_ROOT, data: DATA_ROOT, owners: [...OWNERS] });
});
