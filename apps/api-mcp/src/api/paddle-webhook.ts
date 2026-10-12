import type { IncomingMessage, ServerResponse } from "node:http";

import { applySubscriptionChange } from "../billing/apply-subscription.js";
import { authorizeBillingSubject } from "../billing/billing-links.js";
import type { WebhookFailure } from "../billing/provider.js";
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
    logEvent("billing.webhook_ignored", { eventType: verified.eventType });
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
  }
  sendJson(res, 200, { ok: true });
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
