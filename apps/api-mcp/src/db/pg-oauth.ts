import type { Pool } from "pg";

import { clientLinksFrom } from "../oauth/links.js";
import type { GrantKind, OAuthClient, OAuthClientLink, OAuthGrant, OAuthStore } from "../oauth/types.js";

interface ClientRow {
  readonly id: string;
  readonly name: string;
  readonly redirect_uris: string[];
  readonly secret_hash: string | null;
  readonly created_at: Date;
}

interface GrantRow {
  readonly token_hash: string;
  readonly user_id: string;
  readonly client_id: string;
  readonly kind: GrantKind;
  readonly redirect_uri: string | null;
  readonly code_challenge: string | null;
  readonly scope: string;
  readonly created_at: Date;
  readonly expires_at: Date;
}

export class PgOAuthStore implements OAuthStore {
  constructor(private readonly pool: Pool) {}

  async saveClient(client: OAuthClient): Promise<void> {
    await this.pool.query(
      "INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash, created_at) VALUES ($1, $2, $3, $4, $5)",
      [client.id, client.name, client.redirectUris, client.secretHash, new Date(client.createdAt)],
    );
  }

  async findClient(id: string): Promise<OAuthClient | undefined> {
    const result = await this.pool.query<ClientRow>("SELECT * FROM oauth_clients WHERE id = $1", [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : toClient(row);
  }

  async saveGrant(grant: OAuthGrant): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_grants (token_hash, user_id, client_id, kind, redirect_uri, code_challenge, scope, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        grant.tokenHash,
        grant.userId,
        grant.clientId,
        grant.kind,
        grant.redirectUri,
        grant.codeChallenge,
        grant.scope,
        new Date(grant.createdAt),
        new Date(grant.expiresAt),
      ],
    );
  }

  async takeCode(codeHash: string): Promise<OAuthGrant | undefined> {
    const result = await this.pool.query<GrantRow>(
      "DELETE FROM oauth_grants WHERE token_hash = $1 AND kind = 'code' RETURNING *",
      [codeHash],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toGrant(row);
  }

  async findGrant(tokenHash: string, kind: Exclude<GrantKind, "code">): Promise<OAuthGrant | undefined> {
    const result = await this.pool.query<GrantRow>("SELECT * FROM oauth_grants WHERE token_hash = $1 AND kind = $2", [tokenHash, kind]);
    const row = result.rows[0];
    return row === undefined ? undefined : toGrant(row);
  }

  async deleteGrant(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM oauth_grants WHERE token_hash = $1", [tokenHash]);
  }

  async deleteGrantsForUser(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM oauth_grants WHERE user_id = $1", [userId]);
  }

  async deleteGrantsForUserClient(userId: string, clientId: string): Promise<void> {
    await this.pool.query("DELETE FROM oauth_grants WHERE user_id = $1 AND client_id = $2", [userId, clientId]);
  }

  async listClientLinks(userId: string, now: number): Promise<OAuthClientLink[]> {
    const result = await this.pool.query<GrantRow>(
      "SELECT * FROM oauth_grants WHERE user_id = $1 AND kind IN ('access', 'refresh') AND expires_at > $2",
      [userId, new Date(now)],
    );
    return clientLinksFrom(result.rows.map(toGrant), userId, now);
  }

  async pruneExpired(now: number): Promise<void> {
    await this.pool.query("DELETE FROM oauth_grants WHERE expires_at <= $1", [new Date(now)]);
  }
}

function toClient(row: ClientRow): OAuthClient {
  return {
    id: row.id,
    name: row.name,
    redirectUris: row.redirect_uris,
    secretHash: row.secret_hash,
    createdAt: row.created_at.getTime(),
  };
}

function toGrant(row: GrantRow): OAuthGrant {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    clientId: row.client_id,
    kind: row.kind,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    scope: row.scope,
    createdAt: row.created_at.getTime(),
    expiresAt: row.expires_at.getTime(),
  };
}
