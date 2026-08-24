# typescript-mcp-server

A Model Context Protocol server in TypeScript, built the way you would build any
other backend service: Streamable HTTP transport, OAuth bearer auth, rate
limiting at two layers, error boundaries, and per-session isolation.

Companion code for the post *Building a Production MCP Server in TypeScript*.

Built against `@modelcontextprotocol/sdk` 1.30, Express 5, Zod 4, Node 20+.

## Quickstart

```bash
npm install
cp .env.example .env      # the defaults run a local dev-token server
npm run dev
```

Then point an MCP client at `http://localhost:3000/mcp` with the header
`Authorization: Bearer local-dev-token-change-me`.

```bash
npm test          # builds, then runs end-to-end tests against a real MCP client
npm run typecheck # tsc --noEmit
npm run build && npm start
```

## Layout

```
src/
  index.ts          entry point: listen, signal handlers, graceful shutdown
  app.ts            Express wiring, MCP routes, session lifecycle
  config.ts         environment parsed and validated once, at boot
  auth.ts           OAuthTokenVerifier (JWKS or dev token) + scope helpers
  origin.ts         DNS-rebinding guard
  rateLimit.ts      transport-level token bucket, keyed on the auth subject
  toolQuota.ts      per-tool, per-user budget for expensive work
  errors.ts         the tool error boundary
  session.ts        session registry, ownership checks, idle eviction
  mcp.ts            per-session McpServer factory
  tools/
    searchDocs.ts   the example tool
    docsIndex.ts    stand-in search backend
    fence.ts        untrusted-content fencing and escaping
test/
  server.test.mjs   end-to-end, using the MCP client SDK
```

## The parts that are easy to get wrong

**One server per session.** `Protocol.connect()` takes ownership of its
transport and assumes it is the only user of it, so a single shared `McpServer`
cannot serve two concurrent sessions. `mcp.ts` builds a fresh one per session.

**Sessions leak by default.** Three eviction paths exist and only the third
carries the load. An explicit `DELETE` fires `onsessionclosed`; a dropped
connection fires `transport.onclose`; but a client that simply stops calling
triggers *neither*, because `StreamableHTTPClientTransport.close()` aborts
locally and sends nothing on the wire. Only `terminateSession()` issues the
DELETE. The idle sweeper in `session.ts` is what bounds that. There is a test
for each path.

**Session ids need an ownership check.** The `mcp-session-id` header is the only
thing naming a session, so `SessionStore.get()` takes the authenticated subject
and refuses a mismatch. Without it, any valid token can resume anyone's session.

**Only `initialize` may open a session.** Otherwise any POST that reaches the
endpoint allocates memory, which is a free denial-of-service.

**Errors have two audiences.** A thrown `McpError` becomes a JSON-RPC error for
the *client* — right for an unknown method or a missing scope, none of which the
model can fix by retrying. An `{ isError: true }` result goes into *model*
context, where the model can read it and adapt. Tool failures are the second
kind. See `errors.ts`.

**Identity comes from the token, never from tool arguments.** `searchDocs.ts`
passes `ownerId: userIdOf(extra.authInfo)` into the query. An argument named
`userId` came from the model, which got it from the user, and the user can lie.

**Retrieved content is fenced and escaped.** `fence.ts` wraps results in a
labelled envelope and escapes markup inside it, so a document whose title
contains a literal closing tag cannot break out. `docsIndex.ts` ships a
deliberately hostile record, and a test asserts the fence holds.

**`requireBearerAuth` has two sharp edges.** It rejects any `AuthInfo` whose
`expiresAt` is not a number, so a token with no `exp` claim fails with a message
about expiry rather than about the missing claim. And it maps errors by type:
`InvalidTokenError` becomes 401, anything unrecognised becomes 500 — so a raw
`jose` throw would read as a server fault when it is really a bad token.
`auth.ts` translates.

## Auth modes

`config.ts` requires exactly one and validates at boot.

**JWKS (production).** Set `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`.
Tokens are verified against the issuer's published keys; `sub` becomes the
identity and `scope` becomes the scope list.

**Static token (local only).** Set `DEV_AUTH_TOKEN`. Startup is refused when
`NODE_ENV=production`, and the server logs a warning on every boot.

Scopes are checked inside the handler, not at registration. The SDK's tool
config accepts `title`, `description`, `inputSchema`, `outputSchema`,
`annotations`, and `_meta` — there is no scopes field to pass through.

## Before deploying

- TLS termination in front of it. The SDK does not terminate TLS.
- `helmet` or equivalent, alongside the `Origin` check already in `origin.ts`.
- Sticky sessions at the load balancer, or an `eventStore` for resumability.
  Session state lives in the process that created it, so round-robin will send a
  client's second request to a node that has never heard of it.
- Redis instead of the in-memory maps in `rateLimit.ts`, `toolQuota.ts`, and
  `session.ts`. The algorithms do not change.
- An alert on session-map size. It is the first thing to grow when eviction
  breaks. `/healthz` reports the current count.
- A test that feeds adversarial retrieved content through a tool and asserts the
  model does not act on it.

## License

MIT
