import type { Request, Response, NextFunction } from "express";
import { allowedOrigins } from "./config.js";

/**
 * DNS-rebinding guard. The transport's built-in `enableDnsRebindingProtection`
 * option is deprecated in favour of exactly this, done as middleware.
 *
 * Requests with no Origin header pass: native MCP clients do not send one.
 * Requests from a browser page carry an Origin and must be on the list, which
 * is what stops a random site the user visits from driving a local server.
 */
export function checkOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin !== undefined && !allowedOrigins.has(origin)) {
    res.status(403).json({ error: "forbidden_origin" });
    return;
  }
  next();
}
