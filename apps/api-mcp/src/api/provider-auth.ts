import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { accountForGoogle, GoogleLinkError } from "../accounts/google-account.js";
import { codeChallengeFor, googleRedirectUri } from "../accounts/google-oauth.js";
import { newCsrfToken } from "../accounts/secrets.js";
import { openSession } from "../accounts/sessions.js";
import {
  GOOGLE_TX_COOKIE,
  authMode,
  googleTransactionExpiry,
  openGoogleTransaction,
  safeNextPath,
  sealGoogleTransaction,
} from "../accounts/google-transaction.js";
import type { AppContext } from "../context.js";
import { clientKeyFor } from "../http/client-key.js";
import { parseCookies, sessionCookies } from "../http/cookies.js";
import { sendJson } from "../http/respond.js";
import { OAuthFailure, approveAuthorization } from "../oauth/service.js";
import { objectBody, readJsonRequest, requiredString } from "./body.js";
import { ApiError } from "./errors.js";
import { rateLimited } from "./failures.js";
import { cookieSettingsFor, identify, requireAccount, requireCsrf } from "./identity.js";

type AuthPage = "login" | "signup";

/** GET /v1/auth/google. Sends the browser to Google, or back to the form when sign-in is not configured. */
export async function startGoogle(req: IncomingMessage, res: ServerResponse, ctx: AppContext, query: URLSearchParams): Promise<void> {
  const mode = authMode(query.get("mode"));
  if (!(await allowAttempt(req, res, ctx, mode))) return;
  const secret = ctx.config.google.clientSecret;
  if (!ctx.google.configured || secret === undefined || ctx.config.google.clientId === undefined) {
    redirect(res, pageLocation(mode, "google_not_configured"));
    return;
  }
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const next = safeNextPath(query.get("next"));
  const sealed = sealGoogleTransaction(
    { state, verifier, nonce, next, mode, exp: googleTransactionExpiry(ctx.now()) },
    secret,
  );
  let location: string;
  try {
    location = ctx.google.authorizationUrl({
      state,
      nonce,
      codeChallenge: codeChallengeFor(verifier),
      redirectUri: googleRedirectUri(ctx.config.webOrigin),
    });
  } catch {
    redirect(res, pageLocation(mode, "google_not_configured"));
    return;
  }
  redirect(res, location, [googleTxCookie(sealed, ctx.config.secureCookies, 600)]);
}

/** GET /v1/auth/google/callback. Verifies Google's code and opens the same session as email sign-in. */
export async function finishGoogle(req: IncomingMessage, res: ServerResponse, ctx: AppContext, query: URLSearchParams): Promise<void> {
  const secret = ctx.config.google.clientSecret;
  const token = parseCookies(req.headers.cookie).get(GOOGLE_TX_COOKIE);
  const transaction = secret === undefined || token === undefined ? undefined : openGoogleTransaction(token, secret, ctx.now());
  const mode: AuthPage = transaction?.mode ?? "login";
  const clear = googleTxCookie("", ctx.config.secureCookies, 0);
  if (!(await allowAttempt(req, res, ctx, mode))) return;
  if (transaction === undefined || secret === undefined || query.get("state") !== transaction.state) {
    redirect(res, pageLocation(mode, "google_failed"), [clear]);
    return;
  }
  if (query.get("error") !== null) {
    const code = query.get("error") === "access_denied" ? "google_denied" : "google_failed";
    redirect(res, pageLocation(mode, code), [clear]);
    return;
  }
  const code = query.get("code");
  if (code === null || code.length === 0 || code.length > 2048) {
    redirect(res, pageLocation(mode, "google_failed"), [clear]);
    return;
  }
  try {
    const identity = await ctx.google.exchangeCode({
      code,
      codeVerifier: transaction.verifier,
      redirectUri: googleRedirectUri(ctx.config.webOrigin),
      nonce: transaction.nonce,
    });
    const user = await accountForGoogle(ctx.stores.users, ctx.stores.identities, identity, ctx.now());
    const session = await openSession({ store: ctx.stores.sessions, ttlMs: ctx.config.sessionTtlMs, now: ctx.now }, user.id);
    const cookies = sessionCookies(session, newCsrfToken(), cookieSettingsFor(ctx));
    redirect(res, transaction.next, [...cookies, clear]);
  } catch (error) {
    if (error instanceof GoogleLinkError) {
      const code = error.problem === "unverified_existing" ? "google_existing_unverified" : "google_unverified";
      redirect(res, pageLocation(mode, code), [clear]);
      return;
    }
    redirect(res, pageLocation(mode, "google_failed"), [clear]);
  }
}

/**
 * GET /v1/auth/chatgpt. ChatGPT has no website sign-in for MuteScroll. This opens MuteScroll's
 * connector page, including the approval screen when ChatGPT already sent an authorization request.
 */
export async function startChatgpt(req: IncomingMessage, res: ServerResponse, ctx: AppContext, query: URLSearchParams): Promise<void> {
  const mode = authMode(query.get("mode"));
  if (!(await allowAttempt(req, res, ctx, mode))) return;
  const connect = connectSearch(query);
  redirect(res, connect === null ? "/connect" : `/connect?${connect.toString()}`);
}

/** POST /v1/auth/chatgpt. The signed-in account approves the ChatGPT connector and keeps its session. */
export async function approveChatgpt(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const clientKey = clientKeyFor(req, ctx.config.trustProxy, ctx.config.clientIpHeader);
  const limit = ctx.loginLimiter.hit(clientKey);
  if (!limit.allowed) throw rateLimited(ctx, { kind: "anonymous", clientKey }, limit.retryAfterMs);
  const account = requireAccount(await identify(req, res, ctx, { allowSession: true }));
  requireCsrf(req, account);
  const body = objectBody(await readJsonRequest(req, ctx.config.jsonMaxBodyBytes), [
    "client_id",
    "redirect_uri",
    "code_challenge",
    "code_challenge_method",
    "state",
    "scope",
    "resource",
  ]);
  try {
    const redirectTo = await approveAuthorization(
      {
        store: ctx.stores.oauth,
        now: ctx.now,
        issuer: ctx.config.publicBaseUrl,
        webOrigin: ctx.config.webOrigin,
        allowLocalHttp: !ctx.config.secureCookies,
      },
      {
        userId: account.user.id,
        clientId: requiredString(body, "client_id", 128),
        redirectUri: requiredString(body, "redirect_uri", 2048),
        codeChallenge: requiredString(body, "code_challenge", 256),
        codeChallengeMethod: requiredString(body, "code_challenge_method", 16),
        state: requiredString(body, "state", 2048),
        scope: optionalString(body["scope"]),
        resource: optionalString(body["resource"]),
      },
    );
    sendJson(res, 200, { redirect_to: redirectTo });
  } catch (error) {
    if (error instanceof OAuthFailure) throw new ApiError(400, "invalid_request", error.description);
    throw error;
  }
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ApiError(400, "invalid_request", "Optional fields must be strings.");
  return value;
}

async function allowAttempt(req: IncomingMessage, res: ServerResponse, ctx: AppContext, mode: AuthPage): Promise<boolean> {
  const clientKey = clientKeyFor(req, ctx.config.trustProxy, ctx.config.clientIpHeader);
  const limit = ctx.loginLimiter.hit(clientKey);
  if (limit.allowed) return true;
  redirect(res, pageLocation(mode, "rate_limited"));
  return false;
}

function connectSearch(query: URLSearchParams): URLSearchParams | null {
  const clientId = query.get("client_id") ?? "";
  const redirectUri = query.get("redirect_uri") ?? "";
  const codeChallenge = query.get("code_challenge") ?? "";
  const state = query.get("state") ?? "";
  if (clientId === "" || redirectUri === "" || codeChallenge === "" || state === "") return null;
  const search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: query.get("code_challenge_method") || "S256",
    state,
    scope: query.get("scope") || "transcribe",
  });
  const resource = query.get("resource");
  if (resource !== null && resource !== "") search.set("resource", resource);
  return search;
}

function pageLocation(mode: AuthPage, error: string): string {
  return `/${mode}?error=${encodeURIComponent(error)}`;
}

function googleTxCookie(value: string, secure: boolean, maxAge: number): string {
  const flag = secure ? "; Secure" : "";
  return `${GOOGLE_TX_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${flag}`;
}

function redirect(res: ServerResponse, location: string, cookies: readonly string[] = []): void {
  res.writeHead(302, {
    location,
    "cache-control": "no-store",
    ...(cookies.length === 0 ? {} : { "set-cookie": [...cookies] }),
  });
  res.end();
}
