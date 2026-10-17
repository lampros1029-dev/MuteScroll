import type { UserRecord, UserStore } from "../accounts/types.js";
import type { BillingProvider } from "./provider.js";

/**
 * Fills a paid account's interval from its linked Paddle subscription when we do not have one yet.
 * A missing or unreadable cycle stays null. This never writes `year` as a fallback.
 */
export async function rememberBillingInterval(users: UserStore, provider: BillingProvider, user: UserRecord): Promise<UserRecord> {
  if (user.plan === "free" || user.billingInterval !== null) return user;
  let interval: UserRecord["billingInterval"];
  try {
    interval = await provider.subscriptionInterval(user.id);
  } catch {
    return user;
  }
  if (interval === null) return user;
  if (!(await users.setBillingInterval(user.id, interval))) return user;
  return { ...user, billingInterval: interval };
}
