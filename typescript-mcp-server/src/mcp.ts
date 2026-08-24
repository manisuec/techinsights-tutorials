import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchDocs } from "./tools/searchDocs.js";

/**
 * Builds a server instance for one session.
 *
 * Protocol.connect() takes ownership of its transport and assumes it is the
 * only user of it, so a single shared McpServer cannot serve two concurrent
 * sessions. One server per session is the supported shape.
 */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "docs-mcp", version: "1.0.0" });
  registerSearchDocs(server);
  return server;
}
