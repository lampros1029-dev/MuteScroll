import { randomBytes } from "node:crypto";

import { readPaddleId, type BillingLinkStore } from "./billing-links.js";
import { billingIntervalFromRecord, interpretPaddleNotification } from "./paddle-events.js";
import { priceIdForAddon, priceIdForCheckout } from "./paddle-config.js";
import { verifyPaddleSignature } from "./paddle-signature.js";
import { PaddleApiError, PaddleClient, type PaddleTransaction } from "./paddle-client.js";
import {
  BillingCustomerMissingError,
  BillingNotConfiguredError,
  type BillingProvider,
  type AddonCheckoutInput,
  type CheckoutInput,
  type CheckoutSession,
  type PortalSession,
  type WebhookVerification,
} from "./provider.js";

/** Paddle Billing (merchant of record). Checkout opens a transaction; plan changes arrive as webhooks. */
export class PaddleBillingProvider implements BillingProvider {
  readonly kind = "paddle" as const;

  constructor(
    private readonly client: PaddleClient,
    private readonly webhookSecret: string | undefined,
    private readonly prices: Readonly<Record<string, string>>,
    private readonly links: BillingLinkStore,
  ) {}

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const priceId = priceIdForCheckout(this.prices, input.plan, input.interval);
    if (priceId === undefined) throw new BillingNotConfiguredError();
    return this.openTransaction(input.userId, input.email, priceId);
  }

  async createAddonCheckout(input: AddonCheckoutInput): Promise<CheckoutSession> {
    const priceId = priceIdForAddon(this.prices, input.addon);
    if (priceId === undefined) throw new BillingNotConfiguredError();
    return this.openTransaction(input.userId, input.email, priceId);
  }

  async createPortalSession(userId: string): Promise<PortalSession> {
    const customerId = (await this.links.idsForUser(userId)).find((id) => id.startsWith("ctm_"));
    if (customerId === undefined) throw new BillingCustomerMissingError();
    return { url: await this.client.createPortalSession(customerId) };
  }

  async subscriptionInterval(userId: string): Promise<"month" | "year" | null> {
    const ids = await this.links.idsForUser(userId);
    for (const id of ids) {
      if (readPaddleId(id, "sub") !== id) continue;
      const data = await this.client.readSubscription(id);
      if (data === null) continue;
      const interval = billingIntervalFromRecord(data, this.prices);
      if (interval !== null) return interval;
    }
    return null;
  }

  async cancelSubscriptions(userId: string): Promise<void> {
    const subscriptionIds = (await this.links.idsForUser(userId)).filter((id) => id.startsWith("sub_"));
    for (const subscriptionId of subscriptionIds) {
      await this.client.cancelSubscription(subscriptionId);
    }
  }

  verifyWebhook(rawBody: Uint8Array, signatureHeader: string | undefined, now: number): WebhookVerification {
    if (this.webhookSecret === undefined || this.webhookSecret.trim() === "") return { ok: false, reason: "missing_signature" };
    const signature = verifyPaddleSignature(rawBody, signatureHeader, this.webhookSecret, now);
    if (!signature.ok) return signature;
    const interpreted = interpretPaddleNotification(Buffer.from(rawBody).toString("utf8"), this.prices, now);
    if (!interpreted.ok) return { ok: false, reason: "malformed" };
    return {
      ok: true,
      eventId: interpreted.eventId,
      eventType: interpreted.eventType,
      change: interpreted.change,
      subject: interpreted.subject,
      claimedUserId: interpreted.claimedUserId,
    };
  }

  /**
   * Opens one automatic Paddle checkout. A stored `ctm_` is reused; an email is never sent as that id.
   * A customer id this Paddle account does not have is dropped, and checkout continues with the account email.
   */
  private async createTransaction(
    userId: string,
    email: string,
    priceId: string,
    checkoutNonce: string,
    customerId: string | undefined,
  ): Promise<PaddleTransaction> {
    try {
      return await this.client.createTransaction({ priceId, userId, checkoutNonce, email, customerId });
    } catch (error) {
      if (!(error instanceof PaddleApiError) || !error.customerMissing || customerId === undefined) throw error;
      await this.links.forget(customerId);
      return this.client.createTransaction({ priceId, userId, checkoutNonce, email });
    }
  }

  /** Opens one automatic Paddle checkout. A stored `ctm_` is reused; an email is never sent as that id. */
  private async openTransaction(userId: string, email: string, priceId: string): Promise<CheckoutSession> {
    const checkoutNonce = randomBytes(18).toString("base64url");
    if (!(await this.links.bind(checkoutNonce, userId))) throw new Error("Could not record the checkout");
    const customerId = await this.linkedCustomerId(userId);
    const created = await this.createTransaction(userId, email, priceId, checkoutNonce, customerId);
    const transactionId = readPaddleId(created.transactionId, "txn");
    if (transactionId === null) throw new PaddleApiError(200);
    if (!(await this.links.bind(transactionId, userId))) throw new Error("Could not record the checkout");
    const createdCustomerId = readPaddleId(created.customerId, "ctm");
    const subscriptionId = readPaddleId(created.subscriptionId, "sub");
    if (createdCustomerId !== null && !(await this.links.bind(createdCustomerId, userId))) throw new Error("Could not record the checkout");
    if (subscriptionId !== null && !(await this.links.bind(subscriptionId, userId))) throw new Error("Could not record the checkout");
    return { transactionId, url: created.url };
  }

  private async linkedCustomerId(userId: string): Promise<string | undefined> {
    const ids = await this.links.idsForUser(userId);
    for (const id of ids) {
      if (readPaddleId(id, "ctm") === id) return id;
    }
    return undefined;
  }
}
