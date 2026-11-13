import type { IncomingMessage, ServerResponse } from "node:http";

import { parseAttributionFromCustomData } from "../attribution/sanitize.js";
import { recordPurchaseConversion } from "../attribution/service.js";
import { applySubscriptionChange } from "../billing/apply-subscription.js";
import { authorizeBillingSubject } from "../billing/billing-links.js";
import { parsePaddlePurchase } from "../billing/paddle-money.js";
import type { WebhookFailure, WebhookVerification } from "../billing/provider.js";
import type { AppContext } from "../context.js";
import { BodyError, readRawBody } from "../http/body.js";
import { headerString } from "../http/headers.js";
import { sendJson } from "../http/respond.js";
import { logEvent } from "../log.js";
import { ApiError } from "./errors.js";

const WEBHOOK_MAX_BYTES = 1024 * 1024;

/**
 * POST /v1/paddle/webhook. Paddle calls this directly. It is not a browser request:
 * no session, no API key, and no CSRF cookie. The Paddle-Signature header is the authenticator.
 */
export async function paddleWebhook(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const raw = await readWebhookBody(req);
  const verified = ctx.billingProvider.verifyWebhook(raw, headerString(req.headers["paddle-signature"]), ctx.now());
  if (!verified.ok) throw webhookError(verified.reason);

  if (verified.change === null) {
    if (verified.subject !== null) {
      await authorizeBillingSubject(ctx.stores.billingLinks, verified.subject, verified.claimedUserId);
    }
    const recorded = await recordCompletedPurchase(ctx, verified, raw, false);
    if (!recorded) logEvent("billing.webhook_ignored", { eventType: verified.eventType });
  } else {
    const result = await applySubscriptionChange(
      ctx.stores.users,
      ctx.stores.billingEvents,
      ctx.stores.billingLinks,
      verified.eventId,
      verified.change,
      ctx.now(),
    );
    if (result === "ignored") logEvent("billing.webhook_unlinked", { eventType: verified.eventType });
    if (result === "applied") await recordCompletedPurchase(ctx, verified, raw, true);
  }
  sendJson(res, 200, { ok: true });
}

/**
 * Stores one purchase for a completed transaction. A repeated event id does not add a second row.
 * `eventAlreadyClaimed` is set when applySubscriptionChange already recorded the event id.
 */
async function recordCompletedPurchase(
  ctx: AppContext,
  verified: Extract<WebhookVerification, { ok: true }>,
  raw: Uint8Array,
  eventAlreadyClaimed: boolean,
): Promise<boolean> {
  if (verified.eventType !== "transaction.completed" || verified.claimedUserId === null || verified.subject === null) return false;
  const owner = await authorizeBillingSubject(ctx.stores.billingLinks, verified.subject, verified.claimedUserId);
  if (owner !== verified.claimedUserId) return false;
  if (!eventAlreadyClaimed) {
    const claimed = await ctx.stores.billingEvents.claim(verified.eventId, ctx.now());
    if (!claimed) return false;
  }
  try {
    const money = parsePaddlePurchase(raw);
    const attribution = parseAttributionFromCustomData(money.customData);
    await recordPurchaseConversion(
      ctx.stores.userAttribution,
      ctx.stores.conversionEvents,
      verified.claimedUserId,
      attribution,
      money.amountCents,
      money.currency,
      ctx.now(),
    );
    return true;
  } catch (error) {
    await ctx.stores.billingEvents.forget(verified.eventId).catch(() => undefined);
    throw error;
  }
}

async function readWebhookBody(req: IncomingMessage): Promise<Buffer> {
  try {
    return await readRawBody(req, WEBHOOK_MAX_BYTES);
  } catch (error) {
    if (!(error instanceof BodyError)) throw error;
    switch (error.reason) {
      case "too_large":
        throw new ApiError(413, "too_large", "The request body is too large.");
      case "invalid_json":
        throw new ApiError(400, "invalid_request", "The request body must be valid JSON.");
      default: {
        const neverReason: never = error.reason;
        throw neverReason;
      }
    }
  }
}

function webhookError(reason: WebhookFailure): ApiError {
  switch (reason) {
    case "malformed":
      return new ApiError(400, "invalid_request", "The webhook body is not a Paddle event.");
    case "missing_signature":
    case "bad_signature":
    case "stale_timestamp":
      return new ApiError(401, "unauthorized", "The webhook signature is not valid.");
    default: {
      const neverReason: never = reason;
      return neverReason;
    }
  }
}
