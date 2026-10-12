import { randomUUID } from "node:crypto";

import { hashSecret, isApiKeyFormat, keyDisplayPrefix, newApiKey, safeEqual } from "./secrets.js";
import type { ApiKeyStore } from "./types.js";

/** `last_used_at` is refreshed at most this often. */
export const API_KEY_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface ApiKeyDeps {
  readonly store: ApiKeyStore;
  readonly now: () => number;
}

export interface IssuedApiKey {
  readonly id: string;
  /** The full key. Shown once; only its hash is stored. */
  readonly key: string;
}

export async function issueApiKey(deps: ApiKeyDeps, userId: string): Promise<IssuedApiKey> {
  const key = newApiKey();
  const id = `key_${randomUUID()}`;
  await deps.store.create({
    id,
    userId,
    prefix: keyDisplayPrefix(key),
    keyHash: hashSecret(key),
    createdAt: deps.now(),
    lastUsedAt: null,
  });
  return { id, key };
}

/** The owner of a presented `msk_` key, or undefined for anything unknown or malformed. */
export async function userIdForApiKey(deps: ApiKeyDeps, key: string): Promise<string | undefined> {
  if (!isApiKeyFormat(key)) return undefined;
  const keyHash = hashSecret(key);
  const record = await deps.store.findByHash(keyHash);
  if (record === undefined || !safeEqual(record.keyHash, keyHash)) return undefined;
  const now = deps.now();
  if (record.lastUsedAt === null || now - record.lastUsedAt >= API_KEY_TOUCH_INTERVAL_MS) {
    await deps.store.markUsed(record.id, now);
  }
  return record.userId;
}
