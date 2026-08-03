// server.js — local Node dev server: serves static files from public/ and
// mounts the shared API handlers behind a rate limiter.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { createApi } from "./handlers.js";
import { loadData } from "./data-node.js";
import { createRateLimiter, clientKeyFrom } from "../lib/rate-limit.js";
import { isMain } from "../lib/is-main.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number(process.env.PORT ?? 3000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Mirrors production so local and Cloudflare behave identically.
// /pitch.html is canonicalized by the platform to /pitch (which serves the
// deck). A _redirects "200 rewrite" from /pitch looped, so it was removed —
// the clean URL is the canonical one and this rewrite mirrors it locally.
const REWRITES = { "/": "/index.html", "/pitch": "/pitch.html", "/metodologia": "/metodologia.html" };

// Same policy the Cloudflare Function applies.
const limiter = createRateLimiter({ capacity: 60, refillPerSecond: 1 });

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders });
  res.end(JSON.stringify(body, null, 2));
}

function serveStatic(res, urlPath) {
  const rel = REWRITES[urlPath] ?? urlPath;
  // normalize() + prefix check blocks ../ traversal out of public/.
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 — no encontrado");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
  res.end(readFileSync(filePath));
}

export function createApp() {
  return createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (!url.pathname.startsWith("/api/")) return serveStatic(res, url.pathname);

    // Only GET is ever valid here — this API is read-only by design.
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "method_not_allowed", allowed: ["GET"] }, { allow: "GET" });
    }

    const key = clientKeyFrom(req.headers, req.socket?.remoteAddress ?? "local");
    const verdict = limiter.check(key);
    const rateHeaders = {
      "x-ratelimit-limit": String(verdict.limit),
      "x-ratelimit-remaining": String(verdict.remaining),
    };
    if (!verdict.allowed) {
      return sendJson(
        res,
        429,
        { error: "rate_limited", message: "Demasiadas solicitudes. Intenta de nuevo en unos segundos.", retry_after_seconds: verdict.retryAfterSeconds },
        { ...rateHeaders, "retry-after": String(verdict.retryAfterSeconds) }
      );
    }

    try {
      const api = createApi(loadData());
      const result = api.route(url.pathname, Object.fromEntries(url.searchParams));
      if (result === null) return sendJson(res, 404, { error: "unknown_endpoint", path: url.pathname }, rateHeaders);
      return sendJson(res, result?.error === "not_found" ? 404 : 200, result, rateHeaders);
    } catch (err) {
      return sendJson(res, 500, { error: "handler_failed", message: err.message }, rateHeaders);
    }
  });
}

if (isMain(import.meta.url)) {
  createApp().listen(PORT, () => {
    console.log(`\n  Somos CRO Lab — datos SINTÉTICOS`);
    console.log(`  Dashboard  http://localhost:${PORT}/`);
    console.log(`  Pitch      http://localhost:${PORT}/pitch`);
    console.log(`  API        http://localhost:${PORT}/api/overview`);
    console.log(`  Rate limit ${limiter.config.capacity} req burst · ${limiter.config.refillPerSecond}/s sostenido\n`);
  });
}
