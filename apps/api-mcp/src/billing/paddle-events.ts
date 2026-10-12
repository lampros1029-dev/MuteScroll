import { isAccountId, readCheckoutNonce, readPaddleId } from "./billing-links.js";
import { planForPriceKey, PRICE_KEYS } from "./paddle-config.js";
import type { PlanId } from "./plans.js";
import type { PaddleSubject, SubscriptionChange } from "./provider.js";

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
  return { ok: true, eventId, eventType, change: changeFor(eventType, data, planByPriceId(prices), now, subject, claimedUserId), subject, claimedUserId };
}

function changeFor(
  eventType: string,
  data: unknown,
  catalog: ReadonlyMap<string, PlanId>,
  now: number,
  subject: PaddleSubject | null,
  claimedUserId: string | null,
): SubscriptionChange | null {
  if (!isHandled(eventType) || subject === null || claimedUserId === null) return null;
  switch (eventType) {
    case "subscription.activated":
    case "subscription.updated":
      return changeForUpdate(data, catalog, now, subject, claimedUserId);
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
  now: number,
  subject: PaddleSubject,
  claimedUserId: string,
): SubscriptionChange | null {
  const record = asRecord(data);
  if (record === undefined) return null;
  if (record["status"] === "canceled") return changeForCancel(record, now, subject, claimedUserId);
  const plan = planFromItems(record, catalog);
  if (plan === undefined) return null;
  return { kind: "assign", userId: claimedUserId, plan, freeAt: futureCancelAt(record, now), subject };
}

function changeForCancel(data: unknown, now: number, subject: PaddleSubject, claimedUserId: string): SubscriptionChange | null {
  const record = asRecord(data);
  if (record === undefined) return null;
  const effectiveAt = futureCancelAt(record, now) ?? futurePeriodEnd(record, now);
  if (effectiveAt === null) return { kind: "cancel", userId: claimedUserId, when: "immediate", effectiveAt: null, subject };
  return { kind: "cancel", userId: claimedUserId, when: "period_end", effectiveAt, subject };
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
    const record = asRecord(item);
    const price = asRecord(record?.["price"]);
    const fromPrice = price?.["id"];
    const fromItem = record?.["price_id"];
    const priceId = typeof fromPrice === "string" ? fromPrice : typeof fromItem === "string" ? fromItem : undefined;
    if (priceId === undefined) continue;
    const plan = catalog.get(priceId);
    if (plan !== undefined) return plan;
  }
  return undefined;
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
