import { isAccountId, readCheckoutNonce, readPaddleId } from "./billing-links.js";
import { intervalForPriceId, packCredits, planForPriceKey, PRICE_KEYS } from "./paddle-config.js";
import type { PlanId } from "./plans.js";
import { ADDON_KEYS, type AddonKey, type BillingInterval, type PaddleSubject, type SubscriptionChange } from "./provider.js";

const HANDLED_EVENTS = ["subscription.activated", "subscription.updated", "subscription.canceled"] as const;
type HandledEvent = (typeof HANDLED_EVENTS)[number];

export type InterpretedNotification =
  | {
      readonly ok: true;
      readonly eventId: string;
      readonly eventType: string;
      readonly change: SubscriptionChange | null;
      readonly subject: PaddleSubject | null;
      readonly claimedUserId: string | null;
    }
  | { readonly ok: false };

/** Maps a raw Paddle notification body to a plan change. Unknown event types succeed with `change: null`. */
export function interpretPaddleNotification(rawBody: string, prices: Readonly<Record<string, string>>, now: number): InterpretedNotification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return { ok: false };
  }
  const root = asRecord(parsed);
  const eventId = root?.["event_id"];
  const eventType = root?.["event_type"];
  if (root === undefined || typeof eventId !== "string" || eventId.length < 1 || eventId.length > 200 || typeof eventType !== "string") {
    return { ok: false };
  }
  const data = root["data"];
  const subject = subjectFrom(data);
  const claimedUserId = claimedUserFrom(data);
  return {
    ok: true,
    eventId,
    eventType,
    change: changeFor(eventType, data, prices, planByPriceId(prices), addonByPriceId(prices), now, subject, claimedUserId),
    subject,
    claimedUserId,
  };
}

function changeFor(
  eventType: string,
  data: unknown,
  prices: Readonly<Record<string, string>>,
  catalog: ReadonlyMap<string, PlanId>,
  addons: ReadonlyMap<string, AddonKey>,
  now: number,
  subject: PaddleSubject | null,
  claimedUserId: string | null,
): SubscriptionChange | null {
  const addon = addonChange(eventType, data, addons, subject, claimedUserId);
  if (addon !== null) return addon;
  if (!isHandled(eventType) || subject === null || claimedUserId === null) return null;
  switch (eventType) {
    case "subscription.activated":
    case "subscription.updated":
      return changeForUpdate(data, catalog, prices, now, subject, claimedUserId);
    case "subscription.canceled":
      return changeForCancel(data, now, subject, claimedUserId);
    default: {
      const neverType: never = eventType;
      return neverType;
    }
  }
}

function changeForUpdate(
  data: unknown,
  catalog: ReadonlyMap<string, PlanId>,
  prices: Readonly<Record<string, string>>,
  now: number,
  subject: PaddleSubject,
  claimedUserId: string,
): SubscriptionChange | null {
  const record = asRecord(data);
  if (record === undefined) return null;
  if (record["status"] === "canceled") return changeForCancel(record, now, subject, claimedUserId);
  const plan = planFromItems(record, catalog);
  if (plan === undefined) return null;
  return {
    kind: "assign",
    userId: claimedUserId,
    plan,
    interval: billingIntervalFromRecord(record, prices),
    freeAt: futureCancelAt(record, now),
    subject,
  };
}

/**
 * Month or year from Paddle's billing cycle, then from the catalog key for the price.
 * A week, a day, a bare plan key, or a missing cycle stays null. That is not a yearly plan.
 */
export function billingIntervalFromRecord(data: Record<string, unknown>, prices: Readonly<Record<string, string>>): BillingInterval | null {
  const stated = statedBillingCycle(data);
  if (stated !== undefined) return stated;
  return intervalFromItemPrices(data, prices);
}

/** `undefined` when the payload has no cycle. `null` when it has one that is not month or year. */
function statedBillingCycle(data: Record<string, unknown>): BillingInterval | null | undefined {
  const top = asRecord(data["billing_cycle"]);
  if (top !== undefined) return readBillingCycle(top);
  if (!Array.isArray(data["items"])) return undefined;
  for (const item of data["items"]) {
    const price = asRecord(asRecord(item)?.["price"]);
    const cycle = asRecord(price?.["billing_cycle"]);
    if (cycle !== undefined) return readBillingCycle(cycle);
  }
  return undefined;
}

function changeForCancel(data: unknown, now: number, subject: PaddleSubject, claimedUserId: string): SubscriptionChange | null {
  const record = asRecord(data);
  if (record === undefined) return null;
  const effectiveAt = futureCancelAt(record, now) ?? futurePeriodEnd(record, now);
  if (effectiveAt === null) return { kind: "cancel", userId: claimedUserId, when: "immediate", effectiveAt: null, subject };
  return { kind: "cancel", userId: claimedUserId, when: "period_end", effectiveAt, subject };
}

function addonByPriceId(prices: Readonly<Record<string, string>>): Map<string, AddonKey> {
  const map = new Map<string, AddonKey>();
  for (const key of ADDON_KEYS) {
    const priceId = prices[key];
    if (priceId !== undefined) map.set(priceId, key);
  }
  return map;
}

function addonChange(
  eventType: string,
  data: unknown,
  addons: ReadonlyMap<string, AddonKey>,
  subject: PaddleSubject | null,
  claimedUserId: string | null,
): SubscriptionChange | null {
  if (subject === null || claimedUserId === null) return null;
  const addon = addonFromItems(data, addons);
  if (addon === undefined) return null;
  const record = asRecord(data);
  if (record === undefined) return null;
  switch (addon) {
    case "pack_500":
    case "pack_2000":
      if (eventType !== "transaction.completed" || subject.transactionId === null) return null;
      return { kind: "grant_pack", userId: claimedUserId, credits: packCredits(addon), grantKey: subject.transactionId, subject };
    case "seat": {
      if (subject.subscriptionId === null) return null;
      const canceled = eventType === "subscription.canceled" || (eventType !== "transaction.completed" && record["status"] === "canceled");
      if (canceled) return { kind: "remove_seat", userId: claimedUserId, grantKey: subject.subscriptionId, subject };
      if (eventType === "transaction.completed" || eventType === "subscription.activated" || eventType === "subscription.updated") {
        return { kind: "add_seat", userId: claimedUserId, grantKey: subject.subscriptionId, subject };
      }
      return null;
    }
    default: {
      const neverAddon: never = addon;
      return neverAddon;
    }
  }
}

function addonFromItems(data: unknown, addons: ReadonlyMap<string, AddonKey>): AddonKey | undefined {
  const record = asRecord(data);
  if (record === undefined || !Array.isArray(record["items"])) return undefined;
  for (const item of record["items"]) {
    const row = asRecord(item);
    const price = asRecord(row?.["price"]);
    const fromPrice = price?.["id"];
    const fromItem = row?.["price_id"];
    const priceId = typeof fromPrice === "string" ? fromPrice : typeof fromItem === "string" ? fromItem : undefined;
    if (priceId === undefined) continue;
    const addon = addons.get(priceId);
    if (addon !== undefined) return addon;
  }
  return undefined;
}

function planByPriceId(prices: Readonly<Record<string, string>>): Map<string, PlanId> {
  const map = new Map<string, PlanId>();
  for (const key of PRICE_KEYS) {
    const priceId = prices[key];
    if (priceId !== undefined) map.set(priceId, planForPriceKey(key));
  }
  return map;
}

function planFromItems(data: Record<string, unknown>, catalog: ReadonlyMap<string, PlanId>): PlanId | undefined {
  if (!Array.isArray(data["items"])) return undefined;
  for (const item of data["items"]) {
    const priceId = priceIdOf(asRecord(item));
    if (priceId === undefined) continue;
    const plan = catalog.get(priceId);
    if (plan !== undefined) return plan;
  }
  return undefined;
}

function intervalFromItemPrices(data: Record<string, unknown>, prices: Readonly<Record<string, string>>): BillingInterval | null {
  if (!Array.isArray(data["items"])) return null;
  for (const item of data["items"]) {
    const priceId = priceIdOf(asRecord(item));
    if (priceId === undefined) continue;
    const interval = intervalForPriceId(prices, priceId);
    if (interval !== null) return interval;
  }
  return null;
}

function priceIdOf(record: Record<string, unknown> | undefined): string | undefined {
  const price = asRecord(record?.["price"]);
  const fromPrice = price?.["id"];
  const fromItem = record?.["price_id"];
  if (typeof fromPrice === "string") return fromPrice;
  if (typeof fromItem === "string") return fromItem;
  return undefined;
}

function readBillingCycle(value: unknown): BillingInterval | null {
  const record = asRecord(value);
  const interval = record?.["interval"];
  if (interval === "month" || interval === "year") return interval;
  return null;
}

/** Account named by the payer. Untrusted until it matches a checkout link. */
function userIdFrom(data: Record<string, unknown>): string | undefined {
  const custom = asRecord(data["custom_data"]);
  const raw = custom?.["user_id"] ?? custom?.["userId"];
  if (typeof raw !== "string" || !isAccountId(raw)) return undefined;
  return raw;
}

function claimedUserFrom(data: unknown): string | null {
  const record = asRecord(data);
  if (record === undefined) return null;
  return userIdFrom(record) ?? null;
}

function subjectFrom(data: unknown): PaddleSubject | null {
  const record = asRecord(data);
  if (record === undefined) return null;
  const custom = asRecord(record["custom_data"]);
  return {
    subscriptionId: readPaddleId(record["id"], "sub") ?? readPaddleId(record["subscription_id"], "sub"),
    customerId: readPaddleId(record["customer_id"], "ctm"),
    transactionId: readPaddleId(record["transaction_id"], "txn") ?? readPaddleId(record["id"], "txn"),
    checkoutNonce: readCheckoutNonce(custom?.["checkout_nonce"]),
  };
}

/** Paddle's scheduled cancel. A future `effective_at` means the plan stays until period end. */
function futureCancelAt(data: Record<string, unknown>, now: number): number | null {
  const scheduled = asRecord(data["scheduled_change"]);
  if (scheduled?.["action"] !== "cancel") return null;
  const at = parseTime(scheduled["effective_at"]);
  if (at === null || at <= now) return null;
  return at;
}

function futurePeriodEnd(data: Record<string, unknown>, now: number): number | null {
  const period = asRecord(data["current_billing_period"]);
  const ends = parseTime(period?.["ends_at"]);
  if (ends === null || ends <= now) return null;
  return ends;
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isHandled(eventType: string): eventType is HandledEvent {
  return (HANDLED_EVENTS as readonly string[]).includes(eventType);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
