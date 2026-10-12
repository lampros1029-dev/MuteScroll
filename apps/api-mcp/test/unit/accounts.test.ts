import { describe, expect, it } from "vitest";

import { userIdForApiKey, issueApiKey, API_KEY_TOUCH_INTERVAL_MS } from "../../src/accounts/api-keys.js";
import { normalizeEmail } from "../../src/accounts/email.js";
import {
  hashSecret,
  isApiKeyFormat,
  keyDisplayPrefix,
  newApiKey,
  newSessionToken,
  safeEqual,
} from "../../src/accounts/secrets.js";
import { closeSession, openSession, resolveSession, SESSION_TOUCH_INTERVAL_MS } from "../../src/accounts/sessions.js";
import { MemoryApiKeyStore, MemorySessionStore } from "../../src/accounts/memory-stores.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("normalizeEmail", () => {
  it.each([
    [" Ada@Example.COM ", "ada@example.com"],
    ["name+tag@sub.example.co.uk", "name+tag@sub.example.co.uk"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it.each([
    "no-at-sign",
    "a@b",
    "a b@example.com",
    "x@-bad.com",
    "x@@example.com",
    `${"a".repeat(65)}@example.com`,
    `${"a".repeat(250)}@example.com`,
    "<script>@example.com",
  ])("rejects %j", (input) => {
    expect(normalizeEmail(input)).toBeNull();
  });
});

describe("secrets", () => {
  it("makes msk_ keys of 256 random bits that match the key format", () => {
    const key = newApiKey();
    expect(key).toMatch(/^msk_[A-Za-z0-9_-]{43}$/);
    expect(isApiKeyFormat(key)).toBe(true);
    expect(newApiKey()).not.toBe(key);
    expect(keyDisplayPrefix(key)).toBe(key.slice(0, 12));
  });

  it("rejects keys that are short, mis-prefixed or contain spaces", () => {
    expect(isApiKeyFormat("msk_short")).toBe(false);
    expect(isApiKeyFormat(`sk_${"a".repeat(43)}`)).toBe(false);
    expect(isApiKeyFormat(`msk_${"a".repeat(42)} `)).toBe(false);
  });

  it("hashes secrets to a fixed-length hex digest and compares in constant time", () => {
    expect(hashSecret("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret("abc")).toBe(hashSecret("abc"));
    expect(hashSecret("abc")).not.toBe(hashSecret("abd"));
    expect(safeEqual("same", "same")).toBe(true);
    expect(safeEqual("same", "sane")).toBe(false);
    expect(safeEqual("short", "longer-value")).toBe(false);
  });

  it("generates 43-character session tokens", () => {
    expect(newSessionToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

function clockAt(start: number) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("sessions", () => {
  it("opens a session with a random token and stores only its hash", async () => {
    const clock = clockAt(1_000);
    const store = new MemorySessionStore();
    const token = await openSession({ store, ttlMs: 30 * DAY_MS, now: clock.now }, "usr_1");
    expect(await store.find(hashSecret(token))).toMatchObject({ userId: "usr_1", expiresAt: 1_000 + 30 * DAY_MS });
    expect(await store.find(token)).toBeUndefined();
  });

  it("resolves a live token to its user without refreshing a recent one", async () => {
    const clock = clockAt(1_000);
    const store = new MemorySessionStore();
    const deps = { store, ttlMs: 30 * DAY_MS, now: clock.now };
    const token = await openSession(deps, "usr_1");
    clock.advance(60_000);
    expect(await resolveSession(deps, token)).toEqual({ userId: "usr_1", refreshed: false });
  });

  it("slides the expiry forward once the session has been idle long enough", async () => {
    const clock = clockAt(1_000);
    const store = new MemorySessionStore();
    const deps = { store, ttlMs: 30 * DAY_MS, now: clock.now };
    const token = await openSession(deps, "usr_1");
    clock.advance(SESSION_TOUCH_INTERVAL_MS + 1);
    expect(await resolveSession(deps, token)).toEqual({ userId: "usr_1", refreshed: true });
    const record = await store.find(hashSecret(token));
    expect(record?.expiresAt).toBe(clock.now() + 30 * DAY_MS);
    // 29 days later the slid session is still valid, though the original would have expired.
    clock.advance(29 * DAY_MS);
    expect(await resolveSession(deps, token)).toBeDefined();
  });

  it("refuses expired, unknown and closed sessions", async () => {
    const clock = clockAt(1_000);
    const store = new MemorySessionStore();
    const deps = { store, ttlMs: DAY_MS, now: clock.now };
    const token = await openSession(deps, "usr_1");
    expect(await resolveSession(deps, "not-a-session")).toBeUndefined();
    clock.advance(DAY_MS);
    expect(await resolveSession(deps, token)).toBeUndefined();
    const fresh = await openSession(deps, "usr_2");
    await closeSession(store, fresh);
    expect(await resolveSession(deps, fresh)).toBeUndefined();
  });

  it("removes expired rows during maintenance and reports how many", async () => {
    const clock = clockAt(0);
    const store = new MemorySessionStore();
    await openSession({ store, ttlMs: 10, now: clock.now }, "usr_1");
    await openSession({ store, ttlMs: 1000, now: clock.now }, "usr_2");
    clock.advance(100);
    expect(await store.removeExpired(clock.now())).toBe(1);
  });
});

describe("API keys", () => {
  it("issues a key once and stores its hash and prefix only", async () => {
    const store = new MemoryApiKeyStore();
    const issued = await issueApiKey({ store, now: () => 5 }, "usr_1");
    expect(issued.key).toMatch(/^msk_/);
    expect(issued.id).toMatch(/^key_/);
    const [record] = await store.listForUser("usr_1");
    expect(record).toMatchObject({ id: issued.id, prefix: issued.key.slice(0, 12), lastUsedAt: null });
    expect(record?.keyHash).toBe(hashSecret(issued.key));
    expect(JSON.stringify(record)).not.toContain(issued.key);
  });

  it("maps a presented key to its owner and ignores malformed or unknown keys", async () => {
    const store = new MemoryApiKeyStore();
    const deps = { store, now: () => 5 };
    const issued = await issueApiKey(deps, "usr_1");
    expect(await userIdForApiKey(deps, issued.key)).toBe("usr_1");
    expect(await userIdForApiKey(deps, "msk_" + "A".repeat(43))).toBeUndefined();
    expect(await userIdForApiKey(deps, "not a key")).toBeUndefined();
  });

  it("refreshes last_used_at at most every few minutes", async () => {
    let now = 1_000;
    const store = new MemoryApiKeyStore();
    const deps = { store, now: () => now };
    const issued = await issueApiKey(deps, "usr_1");
    await userIdForApiKey(deps, issued.key);
    expect((await store.listForUser("usr_1"))[0]?.lastUsedAt).toBe(1_000);
    now += API_KEY_TOUCH_INTERVAL_MS - 1;
    await userIdForApiKey(deps, issued.key);
    expect((await store.listForUser("usr_1"))[0]?.lastUsedAt).toBe(1_000);
    now += 2;
    await userIdForApiKey(deps, issued.key);
    expect((await store.listForUser("usr_1"))[0]?.lastUsedAt).toBe(now);
  });

  it("lets only the owner remove a key", async () => {
    const store = new MemoryApiKeyStore();
    const issued = await issueApiKey({ store, now: () => 5 }, "usr_1");
    expect(await store.remove("usr_2", issued.id)).toBe(false);
    expect(await store.remove("usr_1", issued.id)).toBe(true);
    expect(await userIdForApiKey({ store, now: () => 5 }, issued.key)).toBeUndefined();
  });
});
