import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { normalizeEmail } from "../accounts/email.js";
import { hashPassword, passwordPolicyError, spendPasswordCheck, verifyPassword } from "../accounts/passwords.js";
import { newCsrfToken } from "../accounts/secrets.js";
import { closeSession, openSession } from "../accounts/sessions.js";
import { EmailTakenError, type UserRecord } from "../accounts/types.js";
import { rememberBillingInterval } from "../billing/remember-interval.js";
import type { Caller } from "../caller.js";
import type { AppContext } from "../context.js";
import { clientKeyFor } from "../http/client-key.js";
import { clearedSessionCookies, sessionCookies } from "../http/cookies.js";
import { sendJson } from "../http/respond.js";
import { objectBody, readJsonRequest, requiredString } from "./body.js";
import { ApiError } from "./errors.js";
import { rateLimited } from "./failures.js";
import { callerOf, cookieSettingsFor, identify, requireAccount, requireCsrf } from "./identity.js";
import { meView } from "./views.js";
import { attributionFromCookieHeader } from "../attribution/cookie.js";
import { parseAttributionData } from "../attribution/sanitize.js";
import { recordSignupConversion, recordUserAttribution } from "../attribution/service.js";

const SIGNUP_FIELDS = [
  "email",
  "password",
  "first_utm_source",
  "first_utm_medium",
  "first_utm_campaign",
  "first_utm_content",
  "first_utm_term",
  "first_referrer_host",
  "first_landing_path",
  "first_captured_at",
  "last_utm_source",
  "last_utm_medium",
  "last_utm_campaign",
  "last_utm_content",
  "last_utm_term",
  "last_referrer_host",
  "last_landing_path",
  "last_captured_at",
] as const;

/** POST /v1/auth/signup: creates a free account and opens a session. Limited per client IP. */
export async function signup(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const clientKey = clientKeyFor(req, ctx.config.trustProxy, ctx.config.clientIpHeader);
  const limit = ctx.signupLimiter.hit(clientKey);
  if (!limit.allowed) throw rateLimited(ctx, { kind: "anonymous", clientKey }, limit.retryAfterMs);

  const body = objectBody(await readJsonRequest(req, ctx.config.jsonMaxBodyBytes), SIGNUP_FIELDS);
  const email = normalizeEmail(requiredString(body, "email", 320));
  if (email === null) throw new ApiError(400, "invalid_request", "Enter a valid email address.");
  const password = requiredString(body, "password", 1024);
  const policy = passwordPolicyError(password);
  if (policy !== null) throw new ApiError(400, "invalid_request", policy);

  const fromCookie = attributionFromCookieHeader(req.headers.cookie, ctx.now());
  const firstTouch = parseAttributionFromBody(body, "first", ctx.now()) ?? fromCookie.firstTouch;
  const lastTouch = parseAttributionFromBody(body, "last", ctx.now()) ?? fromCookie.lastTouch;

  const passwordHash = await hashPassword(password);
  let user: UserRecord;
  try {
    user = await ctx.stores.users.create({ id: `usr_${randomUUID()}`, email, passwordHash, plan: "free", createdAt: ctx.now() });
  } catch (error) {
    if (error instanceof EmailTakenError) {
      throw new ApiError(409, "email_taken", "An account with this email already exists. Sign in instead.");
    }
    throw error;
  }

  await recordUserAttribution(ctx.stores.userAttribution, user.id, firstTouch, lastTouch);
  await recordSignupConversion(ctx.stores.userAttribution, ctx.stores.conversionEvents, user.id, ctx.now());

  await openAccountSession(ctx, res, user, 201);
}

function parseAttributionFromBody(body: Record<string, unknown>, prefix: "first" | "last", now: number) {
  const utmSource = optionalString(body[`${prefix}_utm_source`]);
  const utmMedium = optionalString(body[`${prefix}_utm_medium`]);
  const utmCampaign = optionalString(body[`${prefix}_utm_campaign`]);
  const utmContent = optionalString(body[`${prefix}_utm_content`]);
  const utmTerm = optionalString(body[`${prefix}_utm_term`]);
  const referrerHost = optionalString(body[`${prefix}_referrer_host`]);
  const landingPath = optionalString(body[`${prefix}_landing_path`]);
  const capturedAtValue = body[`${prefix}_captured_at`];
  const capturedAt = typeof capturedAtValue === "number" ? capturedAtValue : now;

  return parseAttributionData({
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    referrerHost,
    landingPath,
    capturedAt,
  });
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * POST /v1/auth/login. The address is validated and checked for an account, then the password is
 * verified. Unknown addresses still pay one scrypt check, so timing does not reveal accounts.
 */
export async function login(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const clientKey = clientKeyFor(req, ctx.config.trustProxy, ctx.config.clientIpHeader);
  const limit = ctx.loginLimiter.hit(clientKey);
  if (!limit.allowed) throw rateLimited(ctx, { kind: "anonymous", clientKey }, limit.retryAfterMs);

  const body = objectBody(await readJsonRequest(req, ctx.config.jsonMaxBodyBytes), ["email", "password"]);
  const email = normalizeEmail(requiredString(body, "email", 320));
  const password = requiredString(body, "password", 1024);
  const user = email === null ? undefined : await ctx.stores.users.findByEmail(email);
  if (user === undefined) {
    await spendPasswordCheck(password);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(password, user.passwordHash))) throw invalidCredentials();
  await openAccountSession(ctx, res, user, 200);
}

/** POST /v1/auth/logout. Ends the cookie session (CSRF-checked) and clears the cookies. Always 204. */
export async function logout(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const requester = await identify(req, res, ctx, { allowSession: true });
  if (requester.kind === "account" && requester.cookieAuth && requester.sessionToken !== undefined) {
    requireCsrf(req, requester);
    await closeSession(ctx.stores.sessions, requester.sessionToken);
  }
  res.writeHead(204, { "cache-control": "no-store", "set-cookie": clearedSessionCookies(ctx.config.secureCookies) });
  res.end();
}

/** GET /v1/me: the signed-in account and its credits for the current period. */
export async function me(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const requester = requireAccount(await identify(req, res, ctx, { allowSession: true }));
  const caller = callerOf(requester);
  if (caller.kind !== "account") throw new ApiError(401, "unauthorized", "Sign in to see this account.");
  const user = await rememberBillingInterval(ctx.stores.users, ctx.billingProvider, requester.user);
  sendJson(res, 200, meView(user, await ctx.billing.accountSnapshot(caller.userId, caller.plan)));
}

async function openAccountSession(ctx: AppContext, res: ServerResponse, user: UserRecord, status: number): Promise<void> {
  const token = await openSession({ store: ctx.stores.sessions, ttlMs: ctx.config.sessionTtlMs, now: ctx.now }, user.id);
  const cookies = sessionCookies(token, newCsrfToken(), cookieSettingsFor(ctx));
  const caller: Caller = { kind: "account", userId: user.id, plan: user.plan };
  sendJson(res, status, meView(user, await ctx.billing.accountSnapshot(caller.userId, caller.plan)), { "set-cookie": cookies });
}

function invalidCredentials(): ApiError {
  return new ApiError(401, "invalid_credentials", "The email or password is not correct.");
}
