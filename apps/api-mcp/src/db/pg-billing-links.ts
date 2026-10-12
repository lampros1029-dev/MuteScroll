import type { Pool } from "pg";

import { isAccountId, isBillingLinkKey, type BillingLinkStore } from "../billing/billing-links.js";

/** Postgres map from a checkout id to the user this server created it for. Survives a restart. */
export class PgBillingLinkStore implements BillingLinkStore {
  constructor(private readonly pool: Pool) {}

  async bind(paddleId: string, userId: string): Promise<boolean> {
    if (!isBillingLinkKey(paddleId) || !isAccountId(userId)) return false;
    const inserted = await this.pool.query(
      "INSERT INTO billing_links (paddle_id, user_id) VALUES ($1, $2) ON CONFLICT (paddle_id) DO NOTHING",
      [paddleId, userId],
    );
    if ((inserted.rowCount ?? 0) > 0) return true;
    const existing = await this.pool.query<{ user_id: string }>("SELECT user_id FROM billing_links WHERE paddle_id = $1", [paddleId]);
    return existing.rows[0]?.user_id === userId;
  }

  async userFor(paddleId: string): Promise<string | undefined> {
    if (!isBillingLinkKey(paddleId)) return undefined;
    const result = await this.pool.query<{ user_id: string }>("SELECT user_id FROM billing_links WHERE paddle_id = $1", [paddleId]);
    return result.rows[0]?.user_id;
  }

  async idsForUser(userId: string): Promise<readonly string[]> {
    if (!isAccountId(userId)) return [];
    const result = await this.pool.query<{ paddle_id: string }>("SELECT paddle_id FROM billing_links WHERE user_id = $1", [userId]);
    return result.rows.map((row) => row.paddle_id);
  }

  async removeForUser(userId: string): Promise<void> {
    if (!isAccountId(userId)) return;
    await this.pool.query("DELETE FROM billing_links WHERE user_id = $1", [userId]);
  }
}
