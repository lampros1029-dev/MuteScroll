import type { PlanId } from "./plans.js";

/** Plans a customer can buy. `founding` is the $79/yr Pro pass (PRD 20.3), not a separate entitlement. */
export const CATALOG_PLANS = ["creator", "pro", "team", "founding"] as const;
export type CatalogPlan = (typeof CATALOG_PLANS)[number];

export type BillingInterval = "month" | "year";

export interface CheckoutInput {
  readonly userId: string;
  readonly email: string;
  readonly plan: CatalogPlan;
  readonly interval: BillingInterval;
}

export interface CheckoutSession {
  readonly transactionId: string;
  readonly url: string | null;
}

/** One-time credit packs and the monthly extra seat. These do not change the subscription plan. */
export const ADDON_KEYS = ["pack_500", "pack_2000", "seat"] as const;
export type AddonKey = (typeof ADDON_KEYS)[number];

export interface AddonCheckoutInput {
  readonly userId: string;
  readonly email: string;
  readonly addon: AddonKey;
}

/**
 * Ids on a Paddle notification. `checkoutNonce` is issued here when checkout is created; Paddle only echoes it.
 * A bare `custom_data.user_id` is not one of these ids.
 */
export interface PaddleSubject {
  readonly subscriptionId: string | null;
  readonly customerId: string | null;
  readonly transactionId: string | null;
  readonly checkoutNonce: string | null;
}

/**
 * What a verified subscription notification should do.
 * `freeAt` / `period_end` keep the paid plan until Paddle's effective time.
 * `subject` is how apply checks that this server created the subscription for `userId`.
 */
export type SubscriptionChange =
  | {
      readonly kind: "assign";
      readonly userId: string;
      readonly plan: PlanId;
      /** Null when the event did not say month or year. Callers must not treat that as yearly. */
      readonly interval: BillingInterval | null;
      readonly freeAt: number | null;
      readonly subject: PaddleSubject;
    }
  | {
      readonly kind: "cancel";
      readonly userId: string;
      readonly when: "immediate" | "period_end";
      readonly effectiveAt: number | null;
      readonly subject: PaddleSubject;
    }
  | {
      readonly kind: "grant_pack";
      readonly userId: string;
      readonly credits: number;
      readonly grantKey: string;
      readonly subject: PaddleSubject;
    }
  | {
      readonly kind: "add_seat";
      readonly userId: string;
      readonly grantKey: string;
      readonly subject: PaddleSubject;
    }
  | {
      readonly kind: "remove_seat";
      readonly userId: string;
      readonly grantKey: string;
      readonly subject: PaddleSubject;
    };

export type WebhookFailure = "missing_signature" | "bad_signature" | "stale_timestamp" | "malformed";

export type WebhookVerification =
  | {
      readonly ok: true;
      readonly eventId: string;
      readonly eventType: string;
      readonly change: SubscriptionChange | null;
      readonly subject: PaddleSubject | null;
      /** Account named in custom_data. Null when the event does not name one. Not trusted on its own. */
      readonly claimedUserId: string | null;
    }
  | { readonly ok: false; readonly reason: WebhookFailure };

/**
 * Merchant billing (PRD D1). Paddle is the implementation; a fake stands in when no API key is set,
 * so Stripe could replace Paddle without touching credit holds.
 */
export interface PortalSession {
  readonly url: string;
}

export interface BillingProvider {
  readonly kind: "fake" | "paddle";
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  /** Opens a pack or extra-seat checkout. Does not change the subscription plan by itself. */
  createAddonCheckout(input: AddonCheckoutInput): Promise<CheckoutSession>;
  /** Opens the Paddle customer portal. The fake provider never returns a URL. */
  createPortalSession(userId: string): Promise<PortalSession>;
  /**
   * Cancels subscriptions this server linked to the user.
   * The fake provider does nothing: there is no merchant to call.
   */
  cancelSubscriptions(userId: string): Promise<void>;
  /**
   * Month or year on a linked Paddle subscription. Null when there is no subscription,
   * the cycle is missing, or it is not month or year. Never guesses year.
   */
  subscriptionInterval(userId: string): Promise<BillingInterval | null>;
  /** Signature first. Unknown event types verify and return `change: null`. */
  verifyWebhook(rawBody: Uint8Array, signatureHeader: string | undefined, now: number): WebhookVerification;
}

/** Thrown when checkout is asked for a plan that has no configured price id. */
export class BillingNotConfiguredError extends Error {
  constructor() {
    super("No Paddle price is configured for that plan");
    this.name = "BillingNotConfiguredError";
  }
}

/** Thrown when a portal session is asked for an account with no stored Paddle customer id. */
export class BillingCustomerMissingError extends Error {
  constructor() {
    super("No Paddle customer is linked to this account");
    this.name = "BillingCustomerMissingError";
  }
}
