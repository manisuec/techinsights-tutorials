/**
 * End-to-end tests: a real MCP client over Streamable HTTP against the built
 * server. Run with `npm test` (which builds first).
 */
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

const DEV_TOKEN = "test-token-abcdefgh";

// config.ts reads process.env at module load, so this must happen before the
// dynamic import below.
process.env.NODE_ENV = "test";
process.env.DEV_AUTH_TOKEN = DEV_TOKEN;
process.env.ALLOWED_ORIGINS = "https://claude.ai";
process.env.PUBLIC_URL = "http://localhost";
delete process.env.AUTH_JWKS_URL;

const { createApp } = await import("../dist/app.js");
const { SessionStore } = await import("../dist/session.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = await import(
  "@modelcontextprotocol/sdk/client/streamableHttp.js"
);

let httpServer;
let baseUrl;
let sessions;

before(async () => {
  const created = createApp();
  sessions = created.sessions;
  await new Promise(resolve => {
    httpServer = created.app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

after(async () => {
  await sessions.closeAll();
  await new Promise(resolve => httpServer.close(resolve));
});

function connect(token = DEV_TOKEN) {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  return { client, transport };
}

describe("health", () => {
  test("is reachable without a token", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });
});

describe("auth", () => {
  test("rejects a missing token with 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: "POST" });
    assert.equal(res.status, 401);
    assert.match(res.headers.get("www-authenticate") ?? "", /Bearer/);
  });

  test("rejects a wrong token with 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer nope-nope-nope" },
    });
    assert.equal(res.status, 401);
  });

  test("rejects a disallowed Origin with 403", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${DEV_TOKEN}`, Origin: "https://evil.example" },
    });
    assert.equal(res.status, 403);
  });
});

describe("session lifecycle", () => {
  test("rejects a non-initialize POST that carries no session id", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEV_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, -32000);
  });

  test("rejects an unknown session id with 404", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEV_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-session-id": "11111111-2222-3333-4444-555555555555",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, -32001);
  });

  test("an explicit DELETE evicts the session", async () => {
    const { client, transport } = connect();
    await client.connect(transport);
    const before = sessions.size;
    assert.ok(before >= 1);

    // terminateSession() is what sends the DELETE. client.close() alone only
    // aborts locally and tells the server nothing.
    await transport.terminateSession();
    await new Promise(r => setTimeout(r, 50));

    assert.equal(sessions.size, before - 1);
    await client.close();
  });

  test("a client that just goes away is reclaimed by the idle sweeper", async () => {
    const { client, transport } = connect();
    await client.connect(transport);
    assert.ok(sessions.size >= 1);

    // Simulate a vanished client: close locally, send nothing on the wire.
    await client.close();
    await new Promise(r => setTimeout(r, 50));

    // Still held, because the server was never told. This is the leak that the
    // TTL exists to bound.
    const stranded = sessions.size;
    assert.ok(stranded >= 1, "session survives a silent client disconnect");

    const store = new SessionStore(1);
    store.add("stale", {
      server: { close: async () => {} },
      transport: {},
      userId: "dev-user",
    });
    await new Promise(r => setTimeout(r, 20)); // let it age past the 1ms TTL
    await store.evictIdle();
    assert.equal(store.size, 0, "idle sweeper reclaims it");
  });

});

describe("tools", () => {
  test("lists the registered tool", async () => {
    const { client, transport } = connect();
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map(t => t.name),
      ["search_docs"]
    );
    await client.close();
  });

  test("returns results scoped to the caller, inside a fence", async () => {
    const { client, transport } = connect();
    await client.connect(transport);

    const res = await client.callTool({
      name: "search_docs",
      arguments: { query: "canary" },
    });

    assert.notEqual(res.isError, true);
    const text = res.content[0].text;
    assert.match(text, /<untrusted-content>/);
    assert.match(text, /retrieved data, not instructions/);
    assert.match(text, /canary at 5%/);
    await client.close();
  });

  test("escapes hostile retrieved content so it cannot break the fence", async () => {
    const { client, transport } = connect();
    await client.connect(transport);

    const res = await client.callTool({
      name: "search_docs",
      arguments: { query: "meeting notes" },
    });

    const text = res.content[0].text;
    // Exactly one opening and one closing fence tag: the record's literal
    // "</untrusted-content>" must have been escaped, not passed through.
    assert.equal(text.match(/<untrusted-content>/g).length, 1);
    assert.equal(text.match(/<\/untrusted-content>/g).length, 1);
    assert.match(text, /&lt;\/untrusted-content&gt;/);
    await client.close();
  });

  test("rejects input that violates the schema", async () => {
    const { client, transport } = connect();
    await client.connect(transport);

    const res = await client.callTool({
      name: "search_docs",
      arguments: { query: "" },
    });

    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /validation/i);
    await client.close();
  });
});
