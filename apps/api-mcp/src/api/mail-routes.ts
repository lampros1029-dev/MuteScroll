import type { IncomingMessage, ServerResponse } from "node:http";

import { isAuthToken, newAuthToken, type AuthTokenPurpose } from "../accounts/auth-tokens.js";
import { normalizeEmail } from "../accounts/email.js";
import { hashPassword, passwordPolicyError } from "../accounts/passwords.js";
import { hashSecret } from "../accounts/secrets.js";
import type { AppContext } from "../context.js";
import { clientKeyFor } from "../http/client-key.js";
import { sendJson } from "../http/respond.js";
import { MailDeliveryError, MailNotConfiguredError } from "../mail/gmail.js";
import { objectBody, readJsonRequest, requiredString } from "./body.js";
import { ApiError } from "./errors.js";
import { rateLimited } from "./failures.js";
import { identify, requireAccount, requireCsrf } from "./identity.js";
import { sendNoContent } from "./send.js";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

const FORGOT_BODY = { status: "accepted" } as const;

/**
 * POST /v1/auth/email/verification. Session and CSRF.
 * Missing Gmail env, or a failed token refresh, is 503 and does not claim the mail was sent.
 */
export async function requestEmailVerification(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const account = requireAccount(await identify(req, res, ctx, { allowSession: true }));
  if (!account.cookieAuth) throw new ApiError(403, "forbidden", "Sign in on the website to verify this email.");
  requireCsrf(req, account);
  if (account.user.emailVerifiedAt !== null) {
    sendJson(res, 200, { email_verified: true });
    return;
  }
  requireMailer(ctx);
  await limitMail(req, ctx);
  const token = newAuthToken();
  await deliver(ctx, {
    to: account.user.email,
    subject: "Confirm your MuteScroll email",
    text: `Confirm your MuteScroll email:\n${ctx.config.webOrigin}/verify-email?token=${encodeURIComponent(token)}\n\nIf you did not ask for this, you can ignore it.\n`,
  });
  await saveToken(ctx, account.user.id, "verify_email", token, VERIFY_TTL_MS);
  sendJson(res, 202, { status: "accepted" });
}

/** POST /v1/auth/email/verification/confirm. The token works once. */
export async function confirmEmailVerification(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const body = objectBody(await readJsonRequest(req, ctx.config.jsonMaxBodyBytes), ["token"]);
  const record = await takeToken(ctx, requiredString(body, "token", 80), "verify_email");
  if (record === undefined) throw invalidLink();
  await ctx.stores.users.markEmailVerified(record.userId, ctx.now());
  sendJson(res, 200, { email_verified: true });
}

/**
 * POST /v1/auth/forgot-password.
 * The response is the same whether or not the address has an account.
 * When mail is not configured, that shared response is 503 and nothing is sent.
 */
export async function forgotPassword(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  requireMailer(ctx);
  await limitMail(req, ctx);
  const body = objectBody(await readJsonRequest(req, ctx.config.jsonMaxBodyBytes), ["email"]);
  const email = normalizeEmail(requiredString(body, "email", 320));
  if (email === null) throw new ApiError(400, "invalid_request", "Enter a valid email address.");
  const user = await ctx.stores.users.findByEmail(email);
  if (user === undefined) {
    sendJson(res, 202, FORGOT_BODY);
    return;
  }
  const token = newAuthToken();
  await deliver(ctx, {
    to: user.email,
    subject: "Reset your MuteScroll password",
    text: `Reset your MuteScroll password:\n${ctx.config.webOrigin}/reset-password?token=${encodeURIComponent(token)}\n\nThis link works once and expires in one hour.\nIf you did not ask for this, you can ignore it.\n`,
  });
  await saveToken(ctx, user.id, "reset_password", token, RESET_TTL_MS);
  sendJson(res, 202, FORGOT_BODY);
}

/** POST /v1/auth/reset-password. The token works once and ends the account's sessions. */
export async function resetPassword(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const body = objectBody(await readJsonRequest(req, ctx.config.jsonMaxBodyBytes), ["token", "password"]);
  const password = requiredString(body, "password", 1024);
  const policy = passwordPolicyError(password);
  if (policy !== null) throw new ApiError(400, "invalid_request", policy);
  const record = await takeToken(ctx, requiredString(body, "token", 80), "reset_password");
  if (record === undefined) throw invalidLink();
  const passwordHash = await hashPassword(password);
  if (!(await ctx.stores.users.setPassword(record.userId, passwordHash))) throw invalidLink();
  await ctx.stores.sessions.removeForUser(record.userId);
  sendNoContent(res);
}

function requireMailer(ctx: AppContext): void {
  if (!ctx.mailer.configured) throw emailNotConfigured();
}

async function deliver(ctx: AppContext, mail: { readonly to: string; readonly subject: string; readonly text: string }): Promise<void> {
  try {
    await ctx.mailer.send(mail);
  } catch (error) {
    if (error instanceof MailNotConfiguredError) throw emailNotConfigured();
    if (error instanceof MailDeliveryError) throw new ApiError(502, "unavailable", "Email could not be sent. Try again in a few minutes.");
    throw error;
  }
}

async function saveToken(ctx: AppContext, userId: string, purpose: AuthTokenPurpose, token: string, ttlMs: number): Promise<void> {
  await ctx.stores.authTokens.save({
    tokenHash: hashSecret(token),
    userId,
    purpose,
    expiresAt: ctx.now() + ttlMs,
  });
}

async function takeToken(ctx: AppContext, token: string, purpose: AuthTokenPurpose) {
  if (!isAuthToken(token)) return undefined;
  return ctx.stores.authTokens.take(hashSecret(token), purpose, ctx.now());
}

async function limitMail(req: IncomingMessage, ctx: AppContext): Promise<void> {
  const clientKey = clientKeyFor(req, ctx.config.trustProxy, ctx.config.clientIpHeader);
  const limit = ctx.mailLimiter.hit(clientKey);
  if (!limit.allowed) throw rateLimited(ctx, { kind: "anonymous", clientKey }, limit.retryAfterMs);
}

function emailNotConfigured(): ApiError {
  return new ApiError(503, "email_not_configured", "Email is not configured.");
}

function invalidLink(): ApiError {
  return new ApiError(400, "invalid_request", "This link is not valid or has expired.");
}
