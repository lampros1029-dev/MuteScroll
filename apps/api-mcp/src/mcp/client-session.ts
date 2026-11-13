import { createHash } from "node:crypto";

import { boundClientText } from "../jobs/client.js";

export interface McpClientIdentity {
  readonly clientName: string | null;
  readonly clientVersion: string | null;
}

export interface McpClientSessionStore {
  remember(key: string, identity: McpClientIdentity, now: number): Promise<void>;
  recall(key: string, now: number): Promise<McpClientIdentity | undefined>;
  pruneExpired(now: number): Promise<void>;
}

export const MCP_CLIENT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const SESSION_ID = /^[A-Za-z0-9._~-]{8,200}$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

interface SessionRow {
  readonly identity: McpClientIdentity;
  readonly expiresAt: number;
}

/** In-process session store used when DATABASE_URL is unset. */
export class MemoryMcpClientSessionStore implements McpClientSessionStore {
  private readonly sessions = new Map<string, SessionRow>();

  async remember(key: string, identity: McpClientIdentity, now: number): Promise<void> {
    this.sessions.set(key, { identity, expiresAt: now + MCP_CLIENT_SESSION_TTL_MS });
  }

  async recall(key: string, now: number): Promise<McpClientIdentity | undefined> {
    const row = this.sessions.get(key);
    if (row === undefined) return undefined;
    if (row.expiresAt <= now) {
      this.sessions.delete(key);
      return undefined;
    }
    return row.identity;
  }

  async pruneExpired(now: number): Promise<void> {
    for (const [key, row] of this.sessions) {
      if (row.expiresAt <= now) this.sessions.delete(key);
    }
  }
}

/**
 * Key for MCP clientInfo. A client-supplied session id wins. Otherwise the bearer credential
 * is hashed. The raw token is not the key. Addresses are not accepted as session ids.
 */
export function mcpSessionKey(input: { sessionId: string | undefined; authorization: string | undefined }): string | undefined {
  const sessionId = input.sessionId?.trim();
  if (sessionId !== undefined && SESSION_ID.test(sessionId) && !IPV4.test(sessionId)) return `sid:${sessionId}`;
  const authorization = input.authorization?.trim();
  if (authorization === undefined || authorization.length === 0) return undefined;
  return `auth:${createHash("sha256").update(authorization, "utf8").digest("hex")}`;
}

/** clientInfo from an MCP `initialize` body, including a JSON-RPC batch. Undefined when this request is not initialize. */
export function clientIdentityFromBody(body: unknown): McpClientIdentity | undefined {
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (!isRecord(message) || message.method !== "initialize") continue;
    const params = isRecord(message.params) ? message.params : undefined;
    const info = params !== undefined && isRecord(params.clientInfo) ? params.clientInfo : undefined;
    if (info === undefined) return undefined;
    return { clientName: boundClientText(info.name), clientVersion: boundClientText(info.version) };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
