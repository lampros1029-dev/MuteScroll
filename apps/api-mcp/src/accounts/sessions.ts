import { hashSecret, newSessionToken, safeEqual } from "./secrets.js";
import type { SessionStore } from "./types.js";

/** A session is re-stamped at most this often, so ordinary requests do not each write to the database. */
export const SESSION_TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export interface SessionDeps {
  readonly store: SessionStore;
  readonly ttlMs: number;
  readonly now: () => number;
}

export interface SessionHit {
  readonly userId: string;
  /** True when the expiry slid forward, so the browser cookie should be re-issued too. */
  readonly refreshed: boolean;
}

/** Opens a session and returns its cookie token. Only the token's hash is stored. */
export async function openSession(deps: SessionDeps, userId: string): Promise<string> {
  const token = newSessionToken();
  const now = deps.now();
  await deps.store.create({
    tokenHash: hashSecret(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + deps.ttlMs,
  });
  return token;
}

/** Resolves a cookie token to its user, sliding the expiry forward. Undefined when unknown or expired. */
export async function resolveSession(deps: SessionDeps, token: string): Promise<SessionHit | undefined> {
  const tokenHash = hashSecret(token);
  const record = await deps.store.find(tokenHash);
  const now = deps.now();
  if (record === undefined || !safeEqual(record.tokenHash, tokenHash) || record.expiresAt <= now) return undefined;
  const refreshed = now - record.lastSeenAt >= SESSION_TOUCH_INTERVAL_MS;
  if (refreshed) await deps.store.extend(tokenHash, now, now + deps.ttlMs);
  return { userId: record.userId, refreshed };
}

export async function closeSession(store: SessionStore, token: string): Promise<void> {
  await store.remove(hashSecret(token));
}
