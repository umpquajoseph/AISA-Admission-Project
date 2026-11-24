/* Local dev server: serves site/ and the same /api handlers Cloudflare Pages runs.
 *   npm run dev            -> http://127.0.0.1:8788
 *   PORT=9000 npm run dev  -> another port
 * Reads ANTHROPIC_API_KEY (and optional ASSISTANT_EFFORT) from .dev.vars in the repo root,
 * the same file `wrangler pages dev` reads. .dev.vars is git-ignored; never commit it.
 */
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");
const PORT = +(process.env.PORT || 8788);

function devVars() {
  const f = path.join(ROOT, ".dev.vars"), env = {};
  if (!existsSync(f)) return env;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}
const ENV = { ...devVars() };
if (!ENV.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY) ENV.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// same routes as functions/api/*.js
const ROUTES = {};
for (const name of ["draft", "ask", "status"]) ROUTES["/api/" + name] = await import(pathToFileURL(path.join(ROOT, "functions", "api", name + ".js")).href);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".csv": "text/csv; charset=utf-8", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

async function api(req, res, url, mod) {
  const method = req.method.toUpperCase(), fn = mod["onRequest" + method[0] + method.slice(1).toLowerCase()] || mod.onRequest;
  if (!fn) { res.writeHead(405, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "Method not allowed", code: "method" })); }
  const chunks = []; for await (const c of req) chunks.push(c);
  const request = new Request(url, { method, headers: req.headers, body: ["GET", "HEAD"].includes(method) ? undefined : Buffer.concat(chunks) });
  const out = await fn({ request, env: ENV });
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}

async function file(res, pathname) {
  let p = path.normalize(path.join(SITE, decodeURIComponent(pathname)));
  if (!p.startsWith(SITE)) { res.writeHead(403); return res.end(); }
  try { if ((await stat(p)).isDirectory()) p = path.join(p, "index.html"); const body = await readFile(p);
    res.writeHead(200, { "content-type": TYPES[path.extname(p).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" }); res.end(body);
  } catch { res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found"); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  try {
    if (ROUTES[url.pathname]) return await api(req, res, url, ROUTES[url.pathname]);
    if (url.pathname.startsWith("/api/")) { res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "Unknown assistant call", code: "not_found" })); }
    return await file(res, url.pathname);
  } catch (e) { res.writeHead(500, { "content-type": "text/plain" }); res.end(String(e && e.message || e)); }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Supply Desk on http://127.0.0.1:${PORT}  (assistant ${ENV.ANTHROPIC_API_KEY ? "connected" : "not connected: add ANTHROPIC_API_KEY to .dev.vars"})`);
});
