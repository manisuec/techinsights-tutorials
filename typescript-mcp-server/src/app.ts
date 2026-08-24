import express, { type Express, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { requireAuth, userIdOf } from "./auth.js";
import { checkOrigin } from "./origin.js";
import { rateLimitMiddleware } from "./rateLimit.js";
import { buildServer } from "./mcp.js";
import { SessionStore } from "./session.js";
import { config } from "./config.js";

function rpcError(code: number, message: string) {
  return { jsonrpc: "2.0" as const, error: { code, message }, id: null };
}

export interface App {
  app: Express;
  sessions: SessionStore;
}

export function createApp(): App {
  const app = express();
  const sessions = new SessionStore(config.SESSION_IDLE_MS);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  // Registered before the auth middleware on purpose: a health check that
  // requires a token is useless to a load balancer.
  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, sessions: sessions.size });
  });

  app.use("/mcp", checkOrigin, requireAuth, rateLimitMiddleware);

  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const userId = userIdOf(req.auth);

      if (sessionId) {
        const found = sessions.get(sessionId, userId);
        if (!found.ok) {
          if (found.reason === "forbidden") {
            res.status(403).json(rpcError(-32003, "Session does not belong to caller"));
          } else {
            res.status(404).json(rpcError(-32001, "Unknown session"));
          }
          return;
        }
        await found.session.transport.handleRequest(req, res, req.body);
        return;
      }

      // Without a session id, only an initialize request may open one.
      // Otherwise any POST that reaches this endpoint can allocate memory.
      if (!isInitializeRequest(req.body)) {
        res.status(400).json(rpcError(-32000, "Missing mcp-session-id header"));
        return;
      }

      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: id => {
          sessions.add(id, { server, transport, userId });
        },
        onsessionclosed: id => {
          sessions.delete(id);
        },
      });

      // Covers a dropped connection. Note that neither this nor
      // onsessionclosed fires for a client that just stops calling -- the
      // SessionStore idle sweeper is what reclaims those.
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("mcp_post_failed", err);
      if (!res.headersSent) {
        res.status(500).json(rpcError(-32603, "Internal error"));
      } else {
        // The SSE stream is already committed, so there is no status code left
        // to send. End it and let the client reconnect.
        res.end();
      }
    }
  });

  // GET opens the server-to-client SSE stream; DELETE tears the session down.
  for (const method of ["get", "delete"] as const) {
    app[method]("/mcp", async (req: Request, res: Response) => {
      try {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        const found = sessions.get(sessionId, userIdOf(req.auth));
        if (!found.ok) {
          res.status(found.reason === "forbidden" ? 403 : 404).end();
          return;
        }
        await found.session.transport.handleRequest(req, res);
      } catch (err) {
        console.error(`mcp_${method}_failed`, err);
        if (!res.headersSent) res.status(500).end();
        else res.end();
      }
    });
  }

  return { app, sessions };
}
