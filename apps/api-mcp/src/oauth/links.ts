import type { OAuthClientLink, OAuthGrant } from "./types.js";

/** One connected app per client. Authorization codes and token hashes stay out of the result. */
export function clientLinksFrom(grants: readonly OAuthGrant[], userId: string, now: number): OAuthClientLink[] {
  const byClient = new Map<string, OAuthClientLink>();
  for (const grant of grants) {
    if (grant.userId !== userId || grant.kind === "code" || grant.expiresAt <= now) continue;
    const existing = byClient.get(grant.clientId);
    if (existing === undefined || grant.createdAt < existing.createdAt) {
      byClient.set(grant.clientId, { id: grant.clientId, scope: grant.scope, createdAt: grant.createdAt });
    }
  }
  return [...byClient.values()].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
}
