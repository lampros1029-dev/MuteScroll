import type { IncomingMessage, ServerResponse } from "node:http";

import { PaddleApiError } from "../billing/paddle-client.js";
import type { BillingInterval, CatalogPlan } from "../billing/provider.js";
import { BillingCustomerMissingError, BillingNotConfiguredError } from "../billing/provider.js";
import type { AppContext } from "../context.js";
import { sendJson } from "../http/respond.js";
import { deleteAccountData } from "../accounts/delete-account.js";
import { clearedSessionCookies } from "../http/cookies.js";
import { objectBody, readJsonRequest, requiredString } from "./body.js";
import { ApiError } from "./errors.js";
import { identify, requireAccount, requireCsrf, type AccountRequester } from "./identity.js";

/** POST /v1/checkout. Session and CSRF. Returns the Paddle checkout URL. */
export async function checkout(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const account = await webSession(req, res, ctx);
  const body = objectBody(await readJsonRequest(req, ctx.config.jsonMaxBodyBytes), ["plan", "interval"]);
  const plan = catalogPlan(requiredString(body, "plan", 32));
  const interval = billingInterval(requiredString(body, "interval", 16));
  if (plan === undefined || interval === undefined) {
    throw new ApiError(400, "invalid_request", "plan must be creator, pro, team or founding, and interval must be month or year.");
  }
  const url = await openCheckout(ctx, { userId: account.user.id, email: account.user.email, plan, interval });
  sendJson(res, 200, { url });
}

/** POST /v1/billing/portal. Session and CSRF. The in-memory provider never returns a URL. */
export async function billingPortal(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const account = await webSession(req, res, ctx);
  if (ctx.billingProvider.kind === "fake") throw billingNotConfigured();
  try {
    const portal = await ctx.billingProvider.createPortalSession(account.user.id);
    if (!portal.url.startsWith("https://")) throw billingNotConfigured();
    sendJson(res, 200, { url: portal.url });
  } catch (error) {
    throw billingFailure(error);
  }
}

/** DELETE /v1/me. Session and CSRF. Cancels a real Paddle subscription, then deletes local state. */
export async function deleteAccount(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const account = await webSession(req, res, ctx);
  await cancelLinkedSubscription(ctx, account.user.id);
  const removed = await deleteAccountData(ctx.stores, account.user.id);
  if (!removed) throw new ApiError(404, "not_found", "This account has already been deleted.");
  res.writeHead(204, { "cache-control": "no-store", "set-cookie": clearedSessionCookies(ctx.config.secureCookies) });
  res.end();
}

async function openCheckout(
  ctx: AppContext,
  input: { readonly userId: string; readonly email: string; readonly plan: CatalogPlan; readonly interval: BillingInterval },
): Promise<string> {
  if (ctx.billingProvider.kind === "fake") throw billingNotConfigured();
  try {
    const session = await ctx.billingProvider.createCheckout(input);
    if (session.url === null || !session.url.startsWith("https://")) throw billingNotConfigured();
    return session.url;
  } catch (error) {
    throw billingFailure(error);
  }
}

async function cancelLinkedSubscription(ctx: AppContext, userId: string): Promise<void> {
  switch (ctx.billingProvider.kind) {
    case "fake":
      return;
    case "paddle":
      try {
        await ctx.billingProvider.cancelSubscriptions(userId);
      } catch (error) {
        if (error instanceof PaddleApiError) {
          throw new ApiError(502, "unavailable", "Billing could not be reached, so the account was not deleted.");
        }
        throw error;
      }
      return;
    default: {
      const unreachable: never = ctx.billingProvider.kind;
      throw new Error(`Unhandled billing provider: ${String(unreachable)}`);
    }
  }
}

function billingFailure(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  if (error instanceof BillingNotConfiguredError) return billingNotConfigured();
  if (error instanceof BillingCustomerMissingError) {
    return new ApiError(404, "not_found", "This account has no billing customer yet.");
  }
  if (error instanceof PaddleApiError) return new ApiError(502, "unavailable", "Billing could not be reached. Try again in a few minutes.");
  return error;
}

function billingNotConfigured(): ApiError {
  return new ApiError(503, "billing_not_configured", "Billing is not configured.");
}

function catalogPlan(value: string): CatalogPlan | undefined {
  switch (value) {
    case "creator":
    case "pro":
    case "team":
    case "founding":
      return value;
    default:
      return undefined;
  }
}

function billingInterval(value: string): BillingInterval | undefined {
  switch (value) {
    case "month":
    case "year":
      return value;
    default:
      return undefined;
  }
}

async function webSession(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<AccountRequester> {
  const account = requireAccount(await identify(req, res, ctx, { allowSession: true }));
  if (!account.cookieAuth) throw new ApiError(403, "forbidden", "Sign in on the website to use this endpoint.");
  requireCsrf(req, account);
  return account;
}
