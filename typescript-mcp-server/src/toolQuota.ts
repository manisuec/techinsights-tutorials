import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const windows = new Map<string, { count: number; reset: number }>();

/**
 * Per-tool, per-user budget for expensive work (a GPU job, a metered API).
 * Scoped per user on purpose: a single global counter would let one noisy
 * caller deny the tool to everyone else.
 *
 * Returns null when the call is allowed, or the result to hand back when it is
 * not. It returns rather than throws because a quota rejection is something
 * the model should see and plan around, not a protocol-level failure.
 */
export function checkToolQuota(
  tool: string,
  userId: string,
  limit: number,
  windowMs: number
): CallToolResult | null {
  const key = `${tool}:${userId}`;
  const now = Date.now();
  const entry = windows.get(key);

  if (!entry || now > entry.reset) {
    windows.set(key, { count: 1, reset: now + windowMs });
    return null;
  }
  if (entry.count >= limit) {
    const waitSec = Math.ceil((entry.reset - now) / 1000);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Tool '${tool}' quota exhausted. Retry after ${waitSec}s, or ask the user how to proceed.`,
        },
      ],
    };
  }
  entry.count += 1;
  return null;
}

/** Test seam. */
export function resetToolQuota(): void {
  windows.clear();
}
