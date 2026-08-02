// Cloudflare Pages Function — serves every /api/* route.
//
// Two things differ from a Node server and both are deliberate:
//
// 1. The data is imported statically, not read from disk. Workers have no
//    filesystem at runtime; these imports are inlined into the bundle at build
//    time, which is also why raw/*.json must be committed for deploys to work.
// 2. Rate limiting is per-isolate. Cloudflare may run many isolates, so this
//    throttles accidental hammering and cheap scraping, not a distributed
//    attack. For that, use Cloudflare's own Rate Limiting rules or a Durable
//    Object — noted in docs/verificacion.md rather than silently overclaimed.

import meta from "../../raw/meta.json";
import funnel from "../../raw/funnel.json";
import experiments from "../../raw/experiment-results.json";
import operations from "../../raw/operations.json";
import derived from "../../raw/derived.json";
import { createApi } from "../../src/web/handlers.js";
import { createRateLimiter, clientKeyFrom } from "../../src/lib/rate-limit.js";

const api = createApi({ meta, funnel, experiments, operations, derived });
const limiter = createRateLimiter({ capacity: 60, refillPerSecond: 1 });

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=300",
      ...headers,
    },
  });

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method_not_allowed", allowed: ["GET"] }, 405, { allow: "GET" });
  }

  const key = clientKeyFrom(request.headers, "unknown");
  const verdict = limiter.check(key);
  const rateHeaders = {
    "x-ratelimit-limit": String(verdict.limit),
    "x-ratelimit-remaining": String(verdict.remaining),
  };

  if (!verdict.allowed) {
    return json(
      {
        error: "rate_limited",
        message: "Demasiadas solicitudes. Intenta de nuevo en unos segundos.",
        retry_after_seconds: verdict.retryAfterSeconds,
      },
      429,
      { ...rateHeaders, "retry-after": String(verdict.retryAfterSeconds), "cache-control": "no-store" }
    );
  }

  try {
    const result = api.route(url.pathname, Object.fromEntries(url.searchParams));
    if (result === null) return json({ error: "unknown_endpoint", path: url.pathname }, 404, rateHeaders);
    return json(result, result?.error === "not_found" ? 404 : 200, rateHeaders);
  } catch (err) {
    return json({ error: "handler_failed", message: err.message }, 500, { ...rateHeaders, "cache-control": "no-store" });
  }
}
