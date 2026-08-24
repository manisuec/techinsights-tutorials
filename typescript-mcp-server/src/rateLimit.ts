import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const IDLE_EVICT_MS = 10 * 60_000;
const buckets = new Map<string, Bucket>();

// An unbounded keyed map is an availability bug waiting to happen. unref() so
// this timer never holds the process open during shutdown.
const sweeper = setInterval(() => {
  const cutoff = Date.now() - IDLE_EVICT_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.lastRefill < cutoff) buckets.delete(key);
  }
}, 60_000);
sweeper.unref();

/**
 * Token bucket, keyed on the authenticated subject.
 *
 * A bucket tolerates bursts, which is what you want here: ten quick calls in a
 * row are usually legitimate work, while a model stuck in a loop is not.
 * The key is the auth subject rather than the session id (client-chosen) or
 * the IP (shared by everyone behind a NAT).
 */
export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const userId = req.auth?.extra?.userId;
  const key =
    (typeof userId === "string" ? userId : undefined) ??
    req.auth?.clientId ??
    req.ip ??
    "anonymous";

  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: config.RATE_LIMIT_CAPACITY, lastRefill: now };

  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(
    config.RATE_LIMIT_CAPACITY,
    bucket.tokens + elapsed * config.RATE_LIMIT_REFILL_PER_SEC
  );
  bucket.lastRefill = now;
  buckets.set(key, bucket);

  if (bucket.tokens < 1) {
    // Computed, not hardcoded: a caller deep in the hole should not be told to
    // come back in one second and immediately fail again.
    const waitSec = Math.ceil((1 - bucket.tokens) / config.RATE_LIMIT_REFILL_PER_SEC);
    res.set("Retry-After", String(waitSec)).status(429).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Rate limit exceeded" },
      id: null,
    });
    return;
  }

  bucket.tokens -= 1;
  next();
}

/** Test seam. */
export function resetRateLimit(): void {
  buckets.clear();
}
