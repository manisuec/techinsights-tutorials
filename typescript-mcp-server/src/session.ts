import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  /** The authenticated subject that opened this session. */
  userId: string;
  lastSeen: number;
}

export type SessionLookup =
  | { ok: true; session: Session }
  | { ok: false; reason: "unknown" | "forbidden" };

/**
 * Registry of live sessions.
 *
 * Eviction has three paths, and the third is the one that actually carries the
 * load. An explicit DELETE fires onsessionclosed. A dropped connection fires
 * transport.onclose. But a client that simply goes away triggers *neither*:
 * StreamableHTTPClientTransport.close() only aborts locally and sends nothing
 * on the wire, so unless the client calls terminateSession() the server never
 * hears about it. The idle sweeper below is what keeps that from being a leak.
 *
 * Every lookup also checks ownership: the mcp-session-id header is the only
 * thing naming a session, so it must be matched against the authenticated
 * caller rather than trusted on presentation.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(private readonly idleMs: number) {
    this.sweeper = setInterval(() => void this.evictIdle(), 60_000);
    this.sweeper.unref();
  }

  get size(): number {
    return this.sessions.size;
  }

  add(id: string, session: Omit<Session, "lastSeen">): void {
    this.sessions.set(id, { ...session, lastSeen: Date.now() });
  }

  /** Looks a session up and confirms it belongs to the caller. */
  get(id: string | undefined, userId: string): SessionLookup {
    if (!id) return { ok: false, reason: "unknown" };
    const session = this.sessions.get(id);
    if (!session) return { ok: false, reason: "unknown" };
    if (session.userId !== userId) return { ok: false, reason: "forbidden" };
    session.lastSeen = Date.now();
    return { ok: true, session };
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  /** Drops sessions idle past the TTL. Public so it can be driven in tests. */
  async evictIdle(): Promise<void> {
    const cutoff = Date.now() - this.idleMs;
    for (const [id, session] of this.sessions) {
      if (session.lastSeen < cutoff) {
        this.sessions.delete(id);
        await session.server.close().catch(() => undefined);
      }
    }
  }

  /** Closes every live session. Used on SIGTERM. */
  async closeAll(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    clearInterval(this.sweeper);
    await Promise.allSettled(all.map(s => s.server.close()));
  }
}
