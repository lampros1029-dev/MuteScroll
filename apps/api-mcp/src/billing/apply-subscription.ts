import type { UserStore } from "../accounts/types.js";
import { authorizeBillingSubject, type BillingLinkStore } from "./billing-links.js";
import type { BillingEventLog } from "./event-log.js";
import type { SubscriptionChange } from "./provider.js";

export type ApplyResult = "applied" | "duplicate" | "ignored";

/**
 * Applies one verified notification. A repeated event id does not change the plan again.
 * A signature-valid event whose user does not match the checkout link is ignored and does not call setPlan.
 */
export async function applySubscriptionChange(
  users: UserStore,
  events: BillingEventLog,
  links: BillingLinkStore,
  eventId: string,
  change: SubscriptionChange,
  now: number,
): Promise<ApplyResult> {
  const claimed = await events.claim(eventId, now);
  if (!claimed) return "duplicate";
  try {
    const owner = await authorizeBillingSubject(links, change.subject, change.userId);
    if (owner !== change.userId) return "ignored";
    await applyChange(users, events, change, now);
  } catch (error) {
    await events.forget(eventId).catch(() => undefined);
    throw error;
  }
  return "applied";
}

/** Users whose cancel-at-period-end time has arrived become free. */
export async function applyDueDowngrades(users: UserStore, events: BillingEventLog, now: number): Promise<void> {
  const due = await events.dueFree(now);
  for (const userId of due) {
    await users.setPlan(userId, "free");
    await events.clearSchedule(userId);
  }
}

async function applyChange(users: UserStore, events: BillingEventLog, change: SubscriptionChange, now: number): Promise<void> {
  switch (change.kind) {
    case "assign":
      await users.setPlan(change.userId, change.plan);
      if (change.freeAt !== null && change.freeAt > now) await events.scheduleFree(change.userId, change.freeAt);
      else await events.clearSchedule(change.userId);
      return;
    case "cancel":
      await applyCancel(users, events, change, now);
      return;
    default: {
      const neverChange: never = change;
      throw neverChange;
    }
  }
}

async function applyCancel(
  users: UserStore,
  events: BillingEventLog,
  change: Extract<SubscriptionChange, { kind: "cancel" }>,
  now: number,
): Promise<void> {
  switch (change.when) {
    case "immediate":
      await events.clearSchedule(change.userId);
      await users.setPlan(change.userId, "free");
      return;
    case "period_end":
      if (change.effectiveAt !== null && change.effectiveAt > now) {
        await events.scheduleFree(change.userId, change.effectiveAt);
        return;
      }
      await events.clearSchedule(change.userId);
      await users.setPlan(change.userId, "free");
      return;
    default: {
      const neverWhen: never = change.when;
      throw neverWhen;
    }
  }
}
