import { randomBytes } from "node:crypto";

export const AUTH_TOKEN_PREFIX = "mst_";
const TOKEN_PATTERN = /^mst_[A-Za-z0-9_-]{43}$/;

export type AuthTokenPurpose = "verify_email" | "reset_password";

export interface AuthTokenRecord {
  readonly tokenHash: string;
  readonly userId: string;
  readonly purpose: AuthTokenPurpose;
  readonly expiresAt: number;
}

export interface AuthTokenStore {
  /** Replaces any live token of the same purpose for this user. */
  save(record: AuthTokenRecord): Promise<void>;
  /** Deletes the token and returns it. A second take, or an expired token, returns undefined. */
  take(tokenHash: string, purpose: AuthTokenPurpose, now: number): Promise<AuthTokenRecord | undefined>;
  removeForUser(userId: string): Promise<void>;
}

export function newAuthToken(): string {
  return `${AUTH_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isAuthToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export class MemoryAuthTokenStore implements AuthTokenStore {
  private readonly tokens = new Map<string, AuthTokenRecord>();

  async save(record: AuthTokenRecord): Promise<void> {
    for (const [hash, existing] of this.tokens) {
      if (existing.userId === record.userId && existing.purpose === record.purpose) this.tokens.delete(hash);
    }
    this.tokens.set(record.tokenHash, { ...record });
  }

  async take(tokenHash: string, purpose: AuthTokenPurpose, now: number): Promise<AuthTokenRecord | undefined> {
    const record = this.tokens.get(tokenHash);
    if (record === undefined || record.purpose !== purpose) return undefined;
    this.tokens.delete(tokenHash);
    if (record.expiresAt <= now) return undefined;
    return { ...record };
  }

  async removeForUser(userId: string): Promise<void> {
    for (const [hash, record] of this.tokens) {
      if (record.userId === userId) this.tokens.delete(hash);
    }
  }
}
