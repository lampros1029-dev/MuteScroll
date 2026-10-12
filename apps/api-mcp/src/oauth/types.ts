export type GrantKind = "code" | "access" | "refresh";

export interface OAuthClient {
  readonly id: string;
  readonly name: string;
  readonly redirectUris: readonly string[];
  /** Null for a public client that authenticates with PKCE only. */
  readonly secretHash: string | null;
  readonly createdAt: number;
}

export interface OAuthGrant {
  readonly tokenHash: string;
  readonly userId: string;
  readonly clientId: string;
  readonly kind: GrantKind;
  readonly redirectUri: string | null;
  readonly codeChallenge: string | null;
  readonly scope: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** One connected app for a user. `id` is the client id and is safe to show and revoke. */
export interface OAuthClientLink {
  readonly id: string;
  readonly scope: string;
  readonly createdAt: number;
}

export interface OAuthStore {
  saveClient(client: OAuthClient): Promise<void>;
  findClient(id: string): Promise<OAuthClient | undefined>;
  saveGrant(grant: OAuthGrant): Promise<void>;
  /** Deletes a code and returns it. A second take returns undefined. */
  takeCode(codeHash: string): Promise<OAuthGrant | undefined>;
  findGrant(tokenHash: string, kind: Exclude<GrantKind, "code">): Promise<OAuthGrant | undefined>;
  deleteGrant(tokenHash: string): Promise<void>;
  /** Deletes every code, access token and refresh token for the user. */
  deleteGrantsForUser(userId: string): Promise<void>;
  /** Deletes every grant this user issued to one client. */
  deleteGrantsForUserClient(userId: string, clientId: string): Promise<void>;
  /** Live access and refresh grants, one row per client. Tokens and hashes are not included. */
  listClientLinks(userId: string, now: number): Promise<OAuthClientLink[]>;
  pruneExpired(now: number): Promise<void>;
}
