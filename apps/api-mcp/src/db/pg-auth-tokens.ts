import type { Pool } from "pg";

import type { AuthTokenPurpose, AuthTokenRecord, AuthTokenStore } from "../accounts/auth-tokens.js";
import { withTransaction } from "./pool.js";

interface TokenRow {
  readonly token_hash: string;
  readonly user_id: string;
  readonly purpose: string;
  readonly expires_at: Date;
}

export class PgAuthTokenStore implements AuthTokenStore {
  constructor(private readonly pool: Pool) {}

  async save(record: AuthTokenRecord): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query("DELETE FROM auth_tokens WHERE user_id = $1 AND purpose = $2", [record.userId, record.purpose]);
      await client.query(
        "INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)",
        [record.tokenHash, record.userId, record.purpose, new Date(record.expiresAt), new Date()],
      );
    });
  }

  async take(tokenHash: string, purpose: AuthTokenPurpose, now: number): Promise<AuthTokenRecord | undefined> {
    const result = await this.pool.query<TokenRow>(
      "DELETE FROM auth_tokens WHERE token_hash = $1 AND purpose = $2 RETURNING token_hash, user_id, purpose, expires_at",
      [tokenHash, purpose],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const parsed = parsePurpose(row.purpose);
    if (parsed === undefined || row.expires_at.getTime() <= now) return undefined;
    return { tokenHash: row.token_hash, userId: row.user_id, purpose: parsed, expiresAt: row.expires_at.getTime() };
  }

  async removeForUser(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM auth_tokens WHERE user_id = $1", [userId]);
  }
}

function parsePurpose(value: string): AuthTokenPurpose | undefined {
  switch (value) {
    case "verify_email":
    case "reset_password":
      return value;
    default:
      return undefined;
  }
}
