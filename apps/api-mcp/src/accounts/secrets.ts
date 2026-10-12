import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const API_KEY_PREFIX = "msk_";
const API_KEY_PATTERN = /^msk_[A-Za-z0-9_-]{43}$/;
const DISPLAY_PREFIX_LENGTH = 12;

/** 256 random bits as base64url (43 characters). Used as the session cookie value. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Anti-CSRF value for the double-submit cookie. Readable by the web app, never a credential. */
export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/** `msk_` plus 256 random bits. Only its hash is stored. */
export function newApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isApiKeyFormat(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}

export function keyDisplayPrefix(key: string): string {
  return key.slice(0, DISPLAY_PREFIX_LENGTH);
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Constant-time string equality, used for every secret or digest comparison. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
