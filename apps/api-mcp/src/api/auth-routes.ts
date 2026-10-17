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

/** POST /v1/auth/signup: creates a free account and opens a session. Limited per client IP. */
export async function signup(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const clientKey = clientKeyFor(req, ctx.config.trustProxy, ctx.config.clientIpHeader);
  const limit = ctx.signupLimiter.hit(clientKey);
  if (!limit.allowed) throw rateLimited(ctx, { kind: "anonymous", clientKey }, limit.retryAfterMs);

  const body = objectBody(await readJsonRequest(req, ctx.config.jsonMaxBodyBytes), ["email", "password"]);
  const email = normalizeEmail(requiredString(body, "email", 320));
  if (email === null) throw new ApiError(400, "invalid_request", "Enter a valid email address.");
  const password = requiredString(body, "password", 1024);
  const policy = passwordPolicyError(password);
  if (policy !== null) throw new ApiError(400, "invalid_request", policy);

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
  await openAccountSession(ctx, res, user, 201);
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
