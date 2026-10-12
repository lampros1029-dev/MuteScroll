import { BillingNotConfiguredError, type BillingProvider, type CheckoutInput, type CheckoutSession, type PortalSession, type WebhookVerification } from "./provider.js";

/**
 * No merchant. Used when PADDLE_API_KEY is unset so the process still starts.
 * Checkout is recorded in memory and webhooks are refused (there is no signature secret).
 */
export class FakeBillingProvider implements BillingProvider {
  readonly kind = "fake" as const;
  readonly checkouts: CheckoutInput[] = [];

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    this.checkouts.push(input);
    return { transactionId: `fake_${this.checkouts.length}`, url: null };
  }

  async createPortalSession(_userId: string): Promise<PortalSession> {
    throw new BillingNotConfiguredError();
  }

  async cancelSubscriptions(_userId: string): Promise<void> {
    return undefined;
  }

  verifyWebhook(_rawBody: Uint8Array, _signatureHeader: string | undefined, _now: number): WebhookVerification {
    return { ok: false, reason: "missing_signature" };
  }
}
