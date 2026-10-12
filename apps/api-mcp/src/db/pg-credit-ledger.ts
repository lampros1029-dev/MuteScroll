import type { Pool, PoolClient } from "pg";

import {
  chargeKey,
  releaseKey,
  reserveKey,
  type CreditLedger,
  type ReserveInput,
  type SettleInput,
} from "../billing/credit-ledger.js";
import { withTransaction } from "./pool.js";

const USAGE_SQL = `SELECT COALESCE(SUM(CASE WHEN kind = 'release' THEN -credits ELSE credits END), 0) AS total
                     FROM credit_ledger
                    WHERE user_id = $1 AND period = $2`;

interface UsageRow {
  readonly total: string;
}

/**
 * Postgres credit ledger. A reservation locks the user's row, so two concurrent reservations for one
 * account cannot both pass the allowance check. Every write is `ON CONFLICT DO NOTHING` on its key.
 */
export class PgCreditLedger implements CreditLedger {
  constructor(private readonly pool: Pool) {}

  async reserve(input: ReserveInput): Promise<{ readonly ok: boolean }> {
    return withTransaction(this.pool, async (client) => {
      const locked = await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [input.userId]);
      if ((locked.rowCount ?? 0) === 0) throw new Error("reserve: unknown user");
      const existing = await client.query("SELECT 1 FROM credit_ledger WHERE idempotency_key = $1", [reserveKey(input.runKey)]);
      if ((existing.rowCount ?? 0) > 0) return { ok: true };
      const used = await usageIn(client, input.userId, input.period);
      if (used + input.credits > input.allowance) return { ok: false };
      await insertEntry(client, {
        key: reserveKey(input.runKey),
        userId: input.userId,
        jobId: input.jobId,
        period: input.period,
        kind: "reserve",
        credits: input.credits,
        now: input.now,
      });
      return { ok: true };
    });
  }

  async settle(input: SettleInput): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await insertEntry(client, {
        key: releaseKey(input.runKey),
        userId: input.userId,
        jobId: input.jobId,
        period: input.period,
        kind: "release",
        credits: input.reserved,
        now: input.now,
      });
      if (input.charged > 0) {
        await insertEntry(client, {
          key: chargeKey(input.runKey),
          userId: input.userId,
          jobId: input.jobId,
          period: input.period,
          kind: "charge",
          credits: input.charged,
          now: input.now,
        });
      }
    });
  }

  async releaseStaleHolds(cutoff: number, now: number): Promise<number> {
    // `substr(key, 9)` strips the 'reserve:' prefix, so the release key matches what settle would write.
    const result = await this.pool.query(
      `INSERT INTO credit_ledger (idempotency_key, user_id, job_id, kind, credits, period, created_at)
       SELECT 'release:' || substr(hold.idempotency_key, 9), hold.user_id, hold.job_id, 'release', hold.credits, hold.period, $2::timestamptz
         FROM credit_ledger AS hold
        WHERE hold.kind = 'reserve'
          AND hold.created_at <= $1::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM credit_ledger AS done
             WHERE done.idempotency_key = 'release:' || substr(hold.idempotency_key, 9)
          )
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [new Date(cutoff), new Date(now)],
    );
    return result.rowCount ?? 0;
  }

  async used(userId: string, period: string): Promise<number> {
    const result = await this.pool.query<UsageRow>(USAGE_SQL, [userId, period]);
    return Number(result.rows[0]?.total ?? 0);
  }
}

interface EntryInput {
  readonly key: string;
  readonly userId: string;
  readonly jobId: string;
  readonly period: string;
  readonly kind: "reserve" | "release" | "charge";
  readonly credits: number;
  readonly now: number;
}

async function usageIn(client: PoolClient, userId: string, period: string): Promise<number> {
  const result = await client.query<UsageRow>(USAGE_SQL, [userId, period]);
  return Number(result.rows[0]?.total ?? 0);
}

async function insertEntry(client: PoolClient, entry: EntryInput): Promise<void> {
  await client.query(
    `INSERT INTO credit_ledger (idempotency_key, user_id, job_id, kind, credits, period, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [entry.key, entry.userId, entry.jobId, entry.kind, entry.credits, entry.period, new Date(entry.now)],
  );
}
