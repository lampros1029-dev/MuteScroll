import type { Pool } from "pg";

import { MCP_CLIENT_SESSION_TTL_MS, type McpClientIdentity, type McpClientSessionStore } from "../mcp/client-session.js";

interface SessionRow {
  readonly client_name: string | null;
  readonly client_version: string | null;
}

export class PgMcpClientSessionStore implements McpClientSessionStore {
  constructor(private readonly pool: Pool) {}

  async remember(key: string, identity: McpClientIdentity, now: number): Promise<void> {
    const created = new Date(now);
    const expires = new Date(now + MCP_CLIENT_SESSION_TTL_MS);
    await this.pool.query(
      `INSERT INTO mcp_client_sessions (session_key, client_name, client_version, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_key) DO UPDATE
         SET client_name = EXCLUDED.client_name,
             client_version = EXCLUDED.client_version,
             expires_at = EXCLUDED.expires_at`,
      [key, identity.clientName, identity.clientVersion, created, expires],
    );
  }

  async recall(key: string, now: number): Promise<McpClientIdentity | undefined> {
    const result = await this.pool.query<SessionRow>(
      "SELECT client_name, client_version FROM mcp_client_sessions WHERE session_key = $1 AND expires_at > $2",
      [key, new Date(now)],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return { clientName: row.client_name, clientVersion: row.client_version };
  }

  async pruneExpired(now: number): Promise<void> {
    await this.pool.query("DELETE FROM mcp_client_sessions WHERE expires_at <= $1", [new Date(now)]);
  }
}
