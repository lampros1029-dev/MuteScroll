import type { IncomingMessage, ServerResponse } from "node:http";

import { userIdForApiKey } from "../accounts/api-keys.js";
import { safeEqual } from "../accounts/secrets.js";
import { resolveSession } from "../accounts/sessions.js";
import type { UserRecord } from "../accounts/types.js";
import type { Caller } from "../caller.js";
import type { AppContext } from "../context.js";
import { clientKeyFor } from "../http/client-key.js";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, csrfCookie, parseCookies, sessionCookie, type CookieSettings } from "../http/cookies.js";
import { headerString } from "../http/headers.js";
import { isOauthAccessToken, userIdForAccessToken } from "../oauth/service.js";
import { ApiError } from "./errors.js";

export interface AnonymousRequester {
  readonly kind: "anonymous";
  readonly clientKey: string;
}

export interface AccountRequester {
  readonly kind: "account";
  readonly clientKey: string;
  readonly user: UserRecord;
  /** True when the session cookie authenticated the request, so CSRF rules apply. */
  readonly cookieAuth: boolean;
  /** The session cookie value, used by logout. Only set for cookie auth. */
  readonly sessionToken?: string;
  /** Space-separated OAuth scope. Absent for sessions and API keys, which are not scope-limited. */
  readonly oauthScope?: string;
  /** Presented OAuth access token, so it can revoke itself. Never logged. */
  readonly oauthAccessToken?: string;
}

export type Requester = AnonymousRequester | AccountRequester;

export interface IdentityOptions {
  /** Web sessions are accepted on /v1 only. MCP accepts Bearer API keys and ChatGPT OAuth tokens. */
  readonly allowSession: boolean;
}

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Works out who is calling. A presented Bearer key must be valid (401 otherwise, never a silent
 * fallback to anonymous). Without one, a live session cookie identifies a web user. No credentials
 * means an anonymous caller keyed by IP.
 */
export async function identify(req: IncomingMessage, res: ServerResponse, ctx: AppContext, options: IdentityOptions): Promise<Requester> {
  const clientKey = clientKeyFor(req, ctx.config.trustProxy, ctx.config.clientIpHeader);
  const authorization = headerString(req.headers["authorization"]);
  if (authorization !== undefined) {
    const presented = BEARER.exec(authorization)?.[1];
    if (presented !== undefined && isOauthAccessToken(presented)) {
      const principal = await userIdForAccessToken({ store: ctx.stores.oauth, now: ctx.now }, presented);
      const user = principal === undefined ? undefined : await ctx.stores.users.findById(principal.userId);
      if (principal === undefined || user === undefined) {
        throw new ApiError(401, "unauthorized", "This ChatGPT connection expired. Connect the account again.");
      }
      return { kind: "account", clientKey, user, cookieAuth: false, oauthScope: principal.scope, oauthAccessToken: presented };
    }
    const userId = presented === undefined ? undefined : await userIdForApiKey({ store: ctx.stores.apiKeys, now: ctx.now }, presented);
    const user = userId === undefined ? undefined : await ctx.stores.users.findById(userId);
    // A key whose owner is not on Team is refused exactly like an unknown key. The row stays.
    if (user === undefined || user.plan !== "team") {
      throw new ApiError(401, "unauthorized", "The API key is not valid. Check the key or create a new one.");
    }
    return { kind: "account", clientKey, user, cookieAuth: false };
  }
  if (options.allowSession) {
    const jar = parseCookies(req.headers.cookie);
    const token = jar.get(SESSION_COOKIE);
    const hit =
      token === undefined
        ? undefined
        : await resolveSession({ store: ctx.stores.sessions, ttlMs: ctx.config.sessionTtlMs, now: ctx.now }, token);
    const user = hit === undefined ? undefined : await ctx.stores.users.findById(hit.userId);
    if (token !== undefined && hit !== undefined && user !== undefined) {
      if (hit.refreshed) refreshSessionCookies(res, ctx, token, jar.get(CSRF_COOKIE));
      return { kind: "account", clientKey, user, cookieAuth: true, sessionToken: token };
    }
  }
  return { kind: "anonymous", clientKey };
}

/** OAuth tokens must include `required`. Sessions and API keys are not scope-limited. */
export function requireOauthScope(requester: Requester, required: "transcribe" | "library:read"): void {
  if (requester.kind !== "account" || requester.oauthScope === undefined) return;
  if (requester.oauthScope.split(" ").includes(required)) return;
  throw new ApiError(403, "insufficient_scope", `This connection does not include the ${required} permission.`);
}

export function requireAccount(requester: Requester): AccountRequester {
  if (requester.kind === "anonymous") throw new ApiError(401, "unauthorized", "Sign in or send an API key to use this endpoint.");
  return requester;
}

/** Cookie-authenticated POST and DELETE must echo the CSRF cookie in the x-csrf-token header (double submit). */
export function requireCsrf(req: IncomingMessage, requester: Requester): void {
  if (requester.kind !== "account" || !requester.cookieAuth) return;
  const sent = headerString(req.headers[CSRF_HEADER]);
  const expected = parseCookies(req.headers.cookie).get(CSRF_COOKIE);
  if (sent === undefined || expected === undefined || !safeEqual(sent, expected)) {
    throw new ApiError(403, "csrf_failed", "The security token is missing or wrong. Reload the page and try again.");
  }
}

export function callerOf(requester: Requester): Caller {
  return requester.kind === "account"
    ? { kind: "account", userId: requester.user.id, plan: requester.user.plan }
    : { kind: "anonymous", clientKey: requester.clientKey };
}

export function cookieSettingsFor(ctx: AppContext): CookieSettings {
  return { secure: ctx.config.secureCookies, maxAgeSeconds: Math.floor(ctx.config.sessionTtlMs / 1000) };
}

/** Re-issues the cookies with a fresh expiry after the session slid forward. */
function refreshSessionCookies(res: ServerResponse, ctx: AppContext, token: string, csrfValue: string | undefined): void {
  const settings = cookieSettingsFor(ctx);
  const cookies = [sessionCookie(token, settings)];
  if (csrfValue !== undefined) cookies.push(csrfCookie(csrfValue, settings));
  res.setHeader("set-cookie", cookies);
}
