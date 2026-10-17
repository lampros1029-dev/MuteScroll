import type { Pool } from "pg";

import {
  EmailTakenError,
  type ApiKeyRecord,
  type ApiKeyStore,
  type GrantKind,
  type NewUser,
  type SessionRecord,
  type SessionStore,
  type UserRecord,
  type UserStore,
} from "../accounts/types.js";
import { parsePlanId } from "../billing/plans.js";
import { isUniqueViolation } from "./pool.js";

interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly password_hash: string;
  readonly plan: string;
  readonly billing_interval: string | null;
  readonly bonus_credits: number | string;
  readonly extra_seats: number | string;
  readonly email_verified_at: Date | null;
  readonly created_at: Date;
}

interface SessionRow {
  readonly token_hash: string;
  readonly user_id: string;
  readonly created_at: Date;
  readonly last_seen_at: Date;
  readonly expires_at: Date;
}

interface ApiKeyRow {
  readonly id: string;
  readonly user_id: string;
  readonly key_prefix: string;
  readonly key_hash: string;
  readonly created_at: Date;
  readonly last_used_at: Date | null;
}

export class PgUserStore implements UserStore {
  constructor(private readonly pool: Pool) {}

  async create(input: NewUser): Promise<UserRecord> {
    try {
      const result = await this.pool.query<UserRow>(
        "INSERT INTO users (id, email, password_hash, plan, email_verified_at, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
        [
          input.id,
          input.email,
          input.passwordHash,
          input.plan,
          input.emailVerifiedAt === undefined || input.emailVerifiedAt === null ? null : new Date(input.emailVerifiedAt),
          new Date(input.createdAt),
        ],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error("insert returned no row");
      return toUser(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new EmailTakenError();
      throw error;
    }
  }

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    const result = await this.pool.query<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
    const row = result.rows[0];
    return row === undefined ? undefined : toUser(row);
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    const result = await this.pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : toUser(row);
  }

  async setPlan(id: string, plan: UserRecord["plan"]): Promise<boolean> {
    const result = await this.pool.query("UPDATE users SET plan = $2 WHERE id = $1", [id, plan]);
    return (result.rowCount ?? 0) > 0;
  }

  async setBillingInterval(id: string, interval: UserRecord["billingInterval"]): Promise<boolean> {
    const result = await this.pool.query("UPDATE users SET billing_interval = $2 WHERE id = $1", [id, interval]);
    return (result.rowCount ?? 0) > 0;
  }

  async setPassword(id: string, passwordHash: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE users SET password_hash = $2 WHERE id = $1", [id, passwordHash]);
    return (result.rowCount ?? 0) > 0;
  }

  async markEmailVerified(id: string, verifiedAt: number): Promise<boolean> {
    const result = await this.pool.query("UPDATE users SET email_verified_at = $2 WHERE id = $1", [id, new Date(verifiedAt)]);
    return (result.rowCount ?? 0) > 0;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM users WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async addBonusCredits(id: string, credits: number): Promise<boolean> {
    if (credits <= 0) return false;
    const result = await this.pool.query("UPDATE users SET bonus_credits = bonus_credits + $2 WHERE id = $1", [id, credits]);
    return (result.rowCount ?? 0) > 0;
  }

  async consumeBonus(id: string, credits: number): Promise<void> {
    if (credits <= 0) return;
    await this.pool.query("UPDATE users SET bonus_credits = GREATEST(0, bonus_credits - $2) WHERE id = $1", [id, credits]);
  }

  async addExtraSeat(id: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE users SET extra_seats = extra_seats + 1 WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async removeExtraSeat(id: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE users SET extra_seats = GREATEST(0, extra_seats - 1) WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async claimGrant(key: string, userId: string, kind: GrantKind, now: number): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO billing_grants (grant_key, user_id, kind, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (grant_key) DO NOTHING`,
      [key, userId, kind, new Date(now)],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async releaseGrant(key: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM billing_grants WHERE grant_key = $1 AND kind = 'seat'", [key]);
    return (result.rowCount ?? 0) > 0;
  }
}

export class PgSessionStore implements SessionStore {
  constructor(private readonly pool: Pool) {}

  async create(record: SessionRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES ($1, $2, $3, $4, $5)",
      [record.tokenHash, record.userId, new Date(record.createdAt), new Date(record.lastSeenAt), new Date(record.expiresAt)],
    );
  }

  async find(tokenHash: string): Promise<SessionRecord | undefined> {
    const result = await this.pool.query<SessionRow>("SELECT * FROM sessions WHERE token_hash = $1", [tokenHash]);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      tokenHash: row.token_hash,
      userId: row.user_id,
      createdAt: row.created_at.getTime(),
      lastSeenAt: row.last_seen_at.getTime(),
      expiresAt: row.expires_at.getTime(),
    };
  }

  async extend(tokenHash: string, lastSeenAt: number, expiresAt: number): Promise<void> {
    await this.pool.query("UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE token_hash = $1", [
      tokenHash,
      new Date(lastSeenAt),
      new Date(expiresAt),
    ]);
  }

  async remove(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  async removeForUser(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  }

  async removeExpired(now: number): Promise<number> {
    const result = await this.pool.query("DELETE FROM sessions WHERE expires_at <= $1", [new Date(now)]);
    return result.rowCount ?? 0;
  }
}

export class PgApiKeyStore implements ApiKeyStore {
  constructor(private readonly pool: Pool) {}

  async create(record: ApiKeyRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO api_keys (id, user_id, key_prefix, key_hash, created_at, last_used_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [record.id, record.userId, record.prefix, record.keyHash, new Date(record.createdAt), record.lastUsedAt === null ? null : new Date(record.lastUsedAt)],
    );
  }

  async findByHash(keyHash: string): Promise<ApiKeyRecord | undefined> {
    const result = await this.pool.query<ApiKeyRow>("SELECT * FROM api_keys WHERE key_hash = $1", [keyHash]);
    const row = result.rows[0];
    return row === undefined ? undefined : toApiKey(row);
  }

  async listForUser(userId: string): Promise<ApiKeyRecord[]> {
    const result = await this.pool.query<ApiKeyRow>("SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at, id", [userId]);
    return result.rows.map(toApiKey);
  }

  async markUsed(id: string, usedAt: number): Promise<void> {
    await this.pool.query("UPDATE api_keys SET last_used_at = $2 WHERE id = $1", [id, new Date(usedAt)]);
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM api_keys WHERE id = $1 AND user_id = $2", [id, userId]);
    return (result.rowCount ?? 0) > 0;
  }

  async removeForUser(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM api_keys WHERE user_id = $1", [userId]);
  }
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    plan: parsePlanId(row.plan),
    billingInterval: row.billing_interval === "month" || row.billing_interval === "year" ? row.billing_interval : null,
    bonusCredits: wholeNumber(row.bonus_credits),
    extraSeats: wholeNumber(row.extra_seats),
    emailVerifiedAt: row.email_verified_at === null ? null : row.email_verified_at.getTime(),
    createdAt: row.created_at.getTime(),
  };
}

function wholeNumber(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function toApiKey(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    prefix: row.key_prefix,
    keyHash: row.key_hash,
    createdAt: row.created_at.getTime(),
    lastUsedAt: row.last_used_at === null ? null : row.last_used_at.getTime(),
  };
}
