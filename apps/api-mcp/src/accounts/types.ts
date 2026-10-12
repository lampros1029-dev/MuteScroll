import type { PlanId } from "../billing/plans.js";

export interface UserRecord {
  readonly id: string;
  /** Lower-cased, trimmed address. Unique. */
  readonly email: string;
  /** Self-describing scrypt string: `scrypt$N$r$p$salt$key`. Never returned by the API. */
  readonly passwordHash: string;
  readonly plan: PlanId;
  /** When the address was confirmed. Null until the verification link is used. */
  readonly emailVerifiedAt: number | null;
  readonly createdAt: number;
}

/** `emailVerifiedAt` defaults to null when omitted. */
export type NewUser = Omit<UserRecord, "emailVerifiedAt"> & { readonly emailVerifiedAt?: number | null };

/** Thrown when a sign-up uses an address that already has an account. */
export class EmailTakenError extends Error {
  constructor() {
    super("email already registered");
    this.name = "EmailTakenError";
  }
}

export interface UserStore {
  create(input: NewUser): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | undefined>;
  findById(id: string): Promise<UserRecord | undefined>;
  /** Sets the plan. False when the user does not exist. */
  setPlan(id: string, plan: PlanId): Promise<boolean>;
  /** Replaces the password hash. False when the user does not exist. */
  setPassword(id: string, passwordHash: string): Promise<boolean>;
  /** Records that the address was confirmed. False when the user does not exist. */
  markEmailVerified(id: string, verifiedAt: number): Promise<boolean>;
  /** Deletes the user row. Related rows are removed by the caller (and by SQL cascade). */
  delete(id: string): Promise<boolean>;
}

export interface SessionRecord {
  /** SHA-256 of the cookie token. The token itself is never stored. */
  readonly tokenHash: string;
  readonly userId: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
}

export interface SessionStore {
  create(record: SessionRecord): Promise<void>;
  find(tokenHash: string): Promise<SessionRecord | undefined>;
  /** Slides the session forward. */
  extend(tokenHash: string, lastSeenAt: number, expiresAt: number): Promise<void>;
  remove(tokenHash: string): Promise<void>;
  removeForUser(userId: string): Promise<void>;
  removeExpired(now: number): Promise<number>;
}

export interface ApiKeyRecord {
  readonly id: string;
  readonly userId: string;
  /** First characters of the key, shown in listings so users can tell keys apart. */
  readonly prefix: string;
  /** SHA-256 of the full key. The key itself is shown once, at creation. */
  readonly keyHash: string;
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
}

export interface ApiKeyStore {
  create(record: ApiKeyRecord): Promise<void>;
  findByHash(keyHash: string): Promise<ApiKeyRecord | undefined>;
  listForUser(userId: string): Promise<ApiKeyRecord[]>;
  markUsed(id: string, usedAt: number): Promise<void>;
  /** Deletes the key when it belongs to the user. */
  remove(userId: string, id: string): Promise<boolean>;
  /** Deletes every key for the user. Does not imply the keys were invalid before deletion. */
  removeForUser(userId: string): Promise<void>;
}
