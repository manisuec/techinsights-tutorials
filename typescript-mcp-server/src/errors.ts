import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Wraps a tool body.
 *
 * The distinction that matters is who reads the error. A thrown McpError
 * becomes a JSON-RPC error response for the *client* -- right for an unknown
 * method or a missing scope, none of which the model can fix by retrying with
 * different arguments. An `isError` result goes into *model* context, where the
 * model can read it and adapt. Tool failures are the second kind.
 *
 * Note the SDK already converts `inputSchema` violations into an isError result
 * before the handler runs, so the ZodError branch below only fires for parsing
 * done inside the handler -- validating a third-party response, say.
 */
export async function withErrorBoundary(
  name: string,
  fn: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof McpError) throw err;

    const traceId = randomUUID();
    console.error(
      JSON.stringify({
        level: "error",
        traceId,
        tool: name,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      })
    );

    if (err instanceof z.ZodError) {
      const detail = err.issues
        .map(i => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return {
        isError: true,
        content: [{ type: "text", text: `Invalid arguments for ${name}: ${detail}` }],
      };
    }

    // Opaque outward, full detail in the log. Anything in this string reaches
    // model context, then the user's chat, then a support-ticket screenshot.
    // The instruction matters: an unexplained failure invites a retry loop.
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            `Tool '${name}' failed (trace ${traceId}). Do not retry with the same ` +
            `arguments. Tell the user the tool is temporarily unavailable.`,
        },
      ],
    };
  }
}
