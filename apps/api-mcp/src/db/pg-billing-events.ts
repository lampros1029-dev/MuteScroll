import type { Pool } from "pg";

import type { BillingEventLog } from "../billing/event-log.js";

/** Postgres log of Paddle event ids and scheduled downgrades. Survives a restart. */
export class PgBillingEventLog implements BillingEventLog {
  constructor(private readonly pool: Pool) {}

  async claim(eventId: string, now: number): Promise<boolean> {
    const result = await this.pool.query(
      "INSERT INTO billing_events (event_id, received_at) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING",
      [eventId, new Date(now)],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async forget(eventId: string): Promise<void> {
    await this.pool.query("DELETE FROM billing_events WHERE event_id = $1", [eventId]);
  }

  async scheduleFree(userId: string, effectiveAt: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO billing_downgrades (user_id, effective_at) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET effective_at = EXCLUDED.effective_at`,
      [userId, new Date(effectiveAt)],
    );
  }

  async clearSchedule(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM billing_downgrades WHERE user_id = $1", [userId]);
  }

  async dueFree(now: number): Promise<readonly string[]> {
    const result = await this.pool.query<{ user_id: string }>(
      "SELECT user_id FROM billing_downgrades WHERE effective_at <= $1 ORDER BY user_id",
      [new Date(now)],
    );
    return result.rows.map((row) => row.user_id);
  }
}
