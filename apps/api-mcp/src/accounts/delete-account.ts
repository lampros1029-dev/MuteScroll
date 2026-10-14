import type { Stores } from "../stores.js";

/**
 * Removes the account and the rows that belong to it.
 * Credit-ledger rows stay: that table is append-only and has no user foreign key.
 * Callers cancel a real Paddle subscription before this runs.
 */
export async function deleteAccountData(stores: Stores, userId: string): Promise<boolean> {
  await stores.jobs.removeForUser(userId);
  await stores.sessions.removeForUser(userId);
  await stores.apiKeys.removeForUser(userId);
  await stores.oauth.deleteGrantsForUser(userId);
  await stores.billingLinks.removeForUser(userId);
  await stores.authTokens.removeForUser(userId);
  await stores.identities.removeForUser(userId);
  await stores.billingEvents.clearSchedule(userId);
  return stores.users.delete(userId);
}
