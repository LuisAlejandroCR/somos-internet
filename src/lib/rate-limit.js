// Token-bucket rate limiter, shared by the local Node server and the
// Cloudflare Pages Function so both enforce the same policy.
//
// Why a token bucket and not a fixed window: a fixed window lets a caller fire
// the entire quota in the last millisecond of one window and again in the first
// of the next (double the intended burst at the boundary). A bucket refills
// continuously, so the average rate holds while still allowing a short burst.
//
// Scope note, stated plainly: this is per-instance memory. On Cloudflare it
// limits per isolate, not globally across the edge, so it is a guardrail
// against accidental hammering and cheap scraping — not a defence against a
// distributed attack. Real global limiting needs Durable Objects or the
// Cloudflare Rate Limiting rules; see docs/verificacion.md.

const DEFAULTS = {
  capacity: 60, // burst size
  refillPerSecond: 1, // sustained rate
  maxEntries: 10_000, // hard cap so the map can't grow without bound
  sweepIntervalMs: 60_000,
};

export function createRateLimiter(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  if (cfg.capacity <= 0) throw new RangeError("capacity must be > 0");
  if (cfg.refillPerSecond <= 0) throw new RangeError("refillPerSecond must be > 0");

  const buckets = new Map();
  let lastSweep = 0;

  // Drop buckets that have fully refilled — they carry no state worth keeping.
  function sweep(now) {
    if (now - lastSweep < cfg.sweepIntervalMs) return;
    lastSweep = now;
    for (const [key, b] of buckets) {
      const refilled = b.tokens + ((now - b.updated) / 1000) * cfg.refillPerSecond;
      if (refilled >= cfg.capacity) buckets.delete(key);
    }
  }

  // If the map is still oversized after a sweep, evict the oldest entries.
  // Unbounded growth under a spray of unique keys is itself a DoS vector.
  function evictIfNeeded() {
    if (buckets.size <= cfg.maxEntries) return;
    const sorted = [...buckets.entries()].sort((a, b) => a[1].updated - b[1].updated);
    const excess = buckets.size - cfg.maxEntries;
    for (let i = 0; i < excess; i++) buckets.delete(sorted[i][0]);
  }

  return {
    /**
     * @returns {{allowed: boolean, remaining: number, retryAfterSeconds: number, limit: number}}
     */
    check(key, now = Date.now()) {
      sweep(now);

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: cfg.capacity, updated: now };
        buckets.set(key, bucket);
        evictIfNeeded();
      }

      // Refill proportionally to elapsed time, capped at capacity.
      const elapsedSeconds = Math.max(0, (now - bucket.updated) / 1000);
      bucket.tokens = Math.min(cfg.capacity, bucket.tokens + elapsedSeconds * cfg.refillPerSecond);
      bucket.updated = now;

      if (bucket.tokens < 1) {
        const deficit = 1 - bucket.tokens;
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.ceil(deficit / cfg.refillPerSecond),
          limit: cfg.capacity,
        };
      }

      bucket.tokens -= 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0, limit: cfg.capacity };
    },
    size: () => buckets.size,
    reset: () => buckets.clear(),
    config: cfg,
  };
}

/**
 * Best-effort client identity. Behind Cloudflare, `cf-connecting-ip` is set by
 * the edge and cannot be spoofed by the client; the others are fallbacks for
 * local dev. Never trust `x-forwarded-for` alone in production — anyone can
 * send it.
 */
export function clientKeyFrom(headers, fallback = "unknown") {
  const get = (name) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name]);
  return (
    get("cf-connecting-ip") ||
    get("x-real-ip") ||
    (get("x-forwarded-for") || "").split(",")[0].trim() ||
    fallback
  );
}
