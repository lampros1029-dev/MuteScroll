import { clientLinksFrom } from "./links.js";
import type { GrantKind, OAuthClient, OAuthClientLink, OAuthGrant, OAuthStore } from "./types.js";

export class MemoryOAuthStore implements OAuthStore {
  private readonly clients = new Map<string, OAuthClient>();
  private readonly grants = new Map<string, OAuthGrant>();

  async saveClient(client: OAuthClient): Promise<void> {
    this.clients.set(client.id, client);
  }

  async findClient(id: string): Promise<OAuthClient | undefined> {
    return this.clients.get(id);
  }

  async saveGrant(grant: OAuthGrant): Promise<void> {
    this.grants.set(grant.tokenHash, grant);
  }

  async takeCode(codeHash: string): Promise<OAuthGrant | undefined> {
    const grant = this.grants.get(codeHash);
    if (grant === undefined || grant.kind !== "code") return undefined;
    this.grants.delete(codeHash);
    return grant;
  }

  async findGrant(tokenHash: string, kind: Exclude<GrantKind, "code">): Promise<OAuthGrant | undefined> {
    const grant = this.grants.get(tokenHash);
    if (grant === undefined || grant.kind !== kind) return undefined;
    return grant;
  }

  async deleteGrant(tokenHash: string): Promise<void> {
    this.grants.delete(tokenHash);
  }

  async deleteGrantsForUser(userId: string): Promise<void> {
    for (const [hash, grant] of this.grants) {
      if (grant.userId === userId) this.grants.delete(hash);
    }
  }

  async deleteGrantsForUserClient(userId: string, clientId: string): Promise<void> {
    for (const [hash, grant] of this.grants) {
      if (grant.userId === userId && grant.clientId === clientId) this.grants.delete(hash);
    }
  }

  async listClientLinks(userId: string, now: number): Promise<OAuthClientLink[]> {
    return clientLinksFrom([...this.grants.values()], userId, now);
  }

  async pruneExpired(now: number): Promise<void> {
    for (const [hash, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(hash);
    }
  }
}
