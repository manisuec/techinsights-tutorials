import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertScope, userIdOf } from "../auth.js";
import { withErrorBoundary } from "../errors.js";
import { checkToolQuota } from "../toolQuota.js";
import { docsIndex } from "./docsIndex.js";
import { fenceRetrieved } from "./fence.js";

const QUOTA_LIMIT = 30;
const QUOTA_WINDOW_MS = 60_000;

export function registerSearchDocs(server: McpServer): void {
  server.registerTool(
    "search_docs",
    {
      title: "Search documentation",
      description: "Full-text search over the caller's internal documentation.",
      inputSchema: {
        query: z.string().min(1).max(500).describe("Free-text search query."),
        limit: z.number().int().min(1).max(20).default(5).describe("Max results."),
      },
      // Hints for the client UI. Advisory, not enforcement.
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }, extra) =>
      withErrorBoundary("search_docs", async () => {
        assertScope(extra.authInfo, "tools:invoke");
        const userId = userIdOf(extra.authInfo);

        const denied = checkToolQuota("search_docs", userId, QUOTA_LIMIT, QUOTA_WINDOW_MS);
        if (denied) return denied;

        // ownerId comes from the verified token, never from tool arguments.
        const hits = await docsIndex.search({ query, limit, ownerId: userId });

        return { content: [{ type: "text", text: fenceRetrieved(hits) }] };
      })
  );
}
