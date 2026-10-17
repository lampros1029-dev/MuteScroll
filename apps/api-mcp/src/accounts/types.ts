import type { PlanId } from "../billing/plans.js";
import type { BillingInterval } from "../billing/provider.js";

export interface UserRecord {
  readonly id: string;
  /** Lower-cased, trimmed address. Unique. */
  readonly email: string;
  /** Self-describing scrypt string: `scrypt$N$r$p$salt$key`. Never returned by the API. */
  readonly passwordHash: string;
  readonly plan: PlanId;
  /**
   * `month` or `year` when a Paddle subscription said so. Null for free accounts and for paid
   * accounts whose subscription has not reported an interval. Never invent `year`.
   */
  readonly billingInterval: BillingInterval | null;
  /** Pack credits still available. They are not part of the monthly allowance and do not change the plan. */
  readonly bonusCredits: number;
  /** Extra Team seats bought on top of the seats included with the plan. */
  readonly extraSeats: number;
  /** When the address was confirmed. Null until the verification link is used. */
  readonly emailVerifiedAt: number | null;
  readonly createdAt: number;
}

/** `emailVerifiedAt` defaults to null. Bonus credits and extra seats default to 0. */
export type NewUser = Omit<UserRecord, "emailVerifiedAt" | "bonusCredits" | "extraSeats" | "billingInterval"> & {
  readonly emailVerifiedAt?: number | null;
  readonly bonusCredits?: number;
  readonly extraSeats?: number;
  readonly billingInterval?: BillingInterval | null;
};

export type GrantKind = "pack" | "seat";

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
  /** Records month or year, or clears it. False when the user does not exist. */
  setBillingInterval(id: string, interval: BillingInterval | null): Promise<boolean>;
  /** Replaces the password hash. False when the user does not exist. */
  setPassword(id: string, passwordHash: string): Promise<boolean>;
  /** Records that the address was confirmed. False when the user does not exist. */
  markEmailVerified(id: string, verifiedAt: number): Promise<boolean>;
  /** Deletes the user row. Related rows are removed by the caller (and by SQL cascade). */
  delete(id: string): Promise<boolean>;
  /** Adds pack credits. False when the user does not exist. Does not change the plan. */
  addBonusCredits(id: string, credits: number): Promise<boolean>;
  /** Spends pack credits, never below zero. */
  consumeBonus(id: string, credits: number): Promise<void>;
  /** Adds one extra seat. False when the user does not exist. Does not change the plan. */
  addExtraSeat(id: string): Promise<boolean>;
  /** Removes one extra seat, never below zero. */
  removeExtraSeat(id: string): Promise<boolean>;
  /** True the first time this Paddle id is recorded for the user. */
  claimGrant(key: string, userId: string, kind: GrantKind, now: number): Promise<boolean>;
  /** True when a seat grant for this Paddle id was removed. */
  releaseGrant(key: string): Promise<boolean>;
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
