import type { Pool } from "pg";

import type { ExternalIdentity, ExternalIdentityStore } from "../accounts/external-identities.js";
import { isUniqueViolation } from "./pool.js";

interface IdentityRow {
  readonly provider: string;
  readonly subject: string;
  readonly user_id: string;
  readonly email: string;
  readonly created_at: Date;
}

export class PgExternalIdentityStore implements ExternalIdentityStore {
  constructor(private readonly pool: Pool) {}

  async find(provider: ExternalIdentity["provider"], subject: string): Promise<ExternalIdentity | undefined> {
    const result = await this.pool.query<IdentityRow>(
      "SELECT provider, subject, user_id, email, created_at FROM external_identities WHERE provider = $1 AND subject = $2",
      [provider, subject],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toIdentity(row);
  }

  async link(identity: ExternalIdentity): Promise<boolean> {
    try {
      await this.pool.query(
        "INSERT INTO external_identities (provider, subject, user_id, email, created_at) VALUES ($1, $2, $3, $4, $5)",
        [identity.provider, identity.subject, identity.userId, identity.email, new Date(identity.createdAt)],
      );
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async removeForUser(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM external_identities WHERE user_id = $1", [userId]);
  }
}

function toIdentity(row: IdentityRow): ExternalIdentity {
  if (row.provider !== "google") {
    throw new Error("external identity provider is not supported");
  }
  return {
    provider: "google",
    subject: row.subject,
    userId: row.user_id,
    email: row.email,
    createdAt: row.created_at.getTime(),
  };
}
