import { createHash, randomBytes, randomUUID } from "node:crypto";

import { hashSecret, safeEqual } from "../accounts/secrets.js";
import { redirectUriAllowed } from "./redirects.js";
import type { OAuthClient, OAuthStore } from "./types.js";

const CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCOPES = new Set(["transcribe", "library:read"]);
const CLIENT_ID_PATTERN = /^oac_[A-Za-z0-9_-]{16,80}$/;
const TOKEN_PATTERN = /^mso_[A-Za-z0-9_-]{43}$/;
const PKCE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export interface OAuthDeps {
  readonly store: OAuthStore;
  readonly now: () => number;
  /** Public API origin, no trailing slash. The MCP resource is `${issuer}/mcp`. */
  readonly issuer: string;
  /** Website origin that renders the approval page. */
  readonly webOrigin: string;
  readonly allowLocalHttp: boolean;
}

export class OAuthFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly description: string,
  ) {
    super(code);
    this.name = "OAuthFailure";
  }
}

export interface RegisteredClient {
  readonly clientId: string;
  readonly clientSecret: string | undefined;
  readonly redirectUris: readonly string[];
  readonly clientName: string;
  readonly tokenEndpointAuthMethod: "none" | "client_secret_post";
  readonly issuedAt: number;
}

export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly scope: string;
}

export function isOauthAccessToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export function mcpResource(issuer: string): string {
  return `${issuer}/mcp`;
}

export interface AccessTokenPrincipal {
  readonly userId: string;
  readonly scope: string;
}

/** The account and scope of a live access token, or undefined when the token is unknown or expired. */
export async function userIdForAccessToken(deps: Pick<OAuthDeps, "store" | "now">, token: string): Promise<AccessTokenPrincipal | undefined> {
  if (!isOauthAccessToken(token)) return undefined;
  const grant = await deps.store.findGrant(hashSecret(token), "access");
  if (grant === undefined || grant.expiresAt <= deps.now()) return undefined;
  return { userId: grant.userId, scope: grant.scope };
}

/** Revokes the access token and every other grant that client holds for the same user. */
export async function revokeAccessTokenFamily(deps: Pick<OAuthDeps, "store" | "now">, token: string): Promise<void> {
  const grant = await liveAccessGrant(deps, token);
  if (grant === undefined) return;
  await deps.store.deleteGrantsForUserClient(grant.userId, grant.clientId);
}

/** Revokes every grant this user issued to one client. Unknown clients are a no-op. */
export async function revokeClientForUser(deps: Pick<OAuthDeps, "store">, userId: string, clientId: string): Promise<void> {
  await deps.store.deleteGrantsForUserClient(userId, clientId);
}

/** Revokes one access or refresh token when it belongs to the user. */
export async function revokeTokenForUser(deps: Pick<OAuthDeps, "store" | "now">, userId: string, token: string): Promise<void> {
  if (!TOKEN_PATTERN.test(token)) return;
  const hash = hashSecret(token);
  const access = await deps.store.findGrant(hash, "access");
  const grant = access ?? (await deps.store.findGrant(hash, "refresh"));
  if (grant === undefined || grant.userId !== userId || grant.expiresAt <= deps.now()) return;
  await deps.store.deleteGrant(hash);
}

async function liveAccessGrant(deps: Pick<OAuthDeps, "store" | "now">, token: string) {
  if (!isOauthAccessToken(token)) return undefined;
  const grant = await deps.store.findGrant(hashSecret(token), "access");
  if (grant === undefined || grant.expiresAt <= deps.now()) return undefined;
  return grant;
}

export async function registerClient(
  deps: OAuthDeps,
  input: { readonly name: string | undefined; readonly redirectUris: readonly string[]; readonly authMethod: string | undefined },
): Promise<RegisteredClient> {
  if (input.redirectUris.length < 1 || input.redirectUris.length > 5) {
    throw new OAuthFailure(400, "invalid_client_metadata", "Send between 1 and 5 redirect URIs.");
  }
  const redirectUris = [...new Set(input.redirectUris)];
  if (redirectUris.some((uri) => !redirectUriAllowed(uri, deps.allowLocalHttp))) {
    throw new OAuthFailure(400, "invalid_redirect_uri", "That redirect URI is not an allowed assistant address.");
  }
  const authMethod = input.authMethod ?? "none";
  if (authMethod !== "none" && authMethod !== "client_secret_post") {
    throw new OAuthFailure(400, "invalid_client_metadata", "token_endpoint_auth_method must be none or client_secret_post.");
  }
  const name = cleanName(input.name);
  const secret = authMethod === "none" ? undefined : `ocs_${randomBytes(32).toString("base64url")}`;
  const client: OAuthClient = {
    id: `oac_${randomUUID().replaceAll("-", "")}`,
    name,
    redirectUris,
    secretHash: secret === undefined ? null : hashSecret(secret),
    createdAt: deps.now(),
  };
  await deps.store.saveClient(client);
  return {
    clientId: client.id,
    clientSecret: secret,
    redirectUris,
    clientName: name,
    tokenEndpointAuthMethod: authMethod,
    issuedAt: client.createdAt,
  };
}

export interface AuthorizeInput {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
  readonly state: string;
  readonly scope: string | undefined;
  readonly resource: string | undefined;
}

export type AuthorizeDecision =
  | { readonly kind: "consent"; readonly location: string }
  | { readonly kind: "reject"; readonly status: number; readonly code: string; readonly description: string };

/**
 * Checks the authorization request and, when it is safe, points the browser at the website
 * approval page. A bad client or redirect is not followed.
 */
export async function beginAuthorization(deps: OAuthDeps, input: AuthorizeInput): Promise<AuthorizeDecision> {
  const client = await deps.store.findClient(input.clientId);
  if (client === undefined || !CLIENT_ID_PATTERN.test(input.clientId)) {
    return { kind: "reject", status: 400, code: "invalid_request", description: "Unknown client." };
  }
  if (!client.redirectUris.includes(input.redirectUri) || !redirectUriAllowed(input.redirectUri, deps.allowLocalHttp)) {
    return { kind: "reject", status: 400, code: "invalid_request", description: "That redirect URI is not registered." };
  }
  const problem = authorizeProblem(deps, input);
  if (problem !== undefined) {
    return { kind: "reject", status: 400, code: problem, description: "The authorization request is not valid." };
  }
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    state: input.state,
    scope: normalizeScope(input.scope) ?? "transcribe",
  });
  if (input.resource !== undefined && input.resource !== "") params.set("resource", input.resource);
  return { kind: "consent", location: `${deps.webOrigin}/connect?${params.toString()}` };
}

export interface ApprovalInput extends AuthorizeInput {
  readonly userId: string;
}

/** Creates a one-time code and the URL ChatGPT should return to. */
export async function approveAuthorization(deps: OAuthDeps, input: ApprovalInput): Promise<string> {
  const decision = await beginAuthorization(deps, input);
  if (decision.kind === "reject") throw new OAuthFailure(decision.status, decision.code, decision.description);
  const scope = normalizeScope(input.scope);
  if (scope === undefined) throw new OAuthFailure(400, "invalid_scope", "The requested scope is not available.");
  const code = `msc_${randomBytes(32).toString("base64url")}`;
  await deps.store.saveGrant({
    tokenHash: hashSecret(code),
    userId: input.userId,
    clientId: input.clientId,
    kind: "code",
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope,
    createdAt: deps.now(),
    expiresAt: deps.now() + CODE_TTL_MS,
  });
  const back = new URL(input.redirectUri);
  back.searchParams.set("code", code);
  back.searchParams.set("state", input.state);
  return back.toString();
}

export interface TokenInput {
  readonly grantType: string;
  readonly code: string | undefined;
  readonly redirectUri: string | undefined;
  readonly codeVerifier: string | undefined;
  readonly refreshToken: string | undefined;
  readonly clientId: string;
  readonly clientSecret: string | undefined;
}

export async function issueToken(deps: OAuthDeps, input: TokenInput): Promise<IssuedTokens> {
  const client = await authenticatedClient(deps, input.clientId, input.clientSecret);
  if (input.grantType === "authorization_code") return exchangeCode(deps, client, input);
  if (input.grantType === "refresh_token") return rotateRefresh(deps, client, input.refreshToken);
  throw new OAuthFailure(400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
}

async function exchangeCode(deps: OAuthDeps, client: OAuthClient, input: TokenInput): Promise<IssuedTokens> {
  if (input.code === undefined || input.redirectUri === undefined || input.codeVerifier === undefined) {
    throw new OAuthFailure(400, "invalid_request", "code, redirect_uri and code_verifier are required.");
  }
  if (!PKCE_PATTERN.test(input.codeVerifier)) throw new OAuthFailure(400, "invalid_grant", "The code verifier is not valid.");
  const grant = await deps.store.takeCode(hashSecret(input.code));
  if (grant === undefined || grant.expiresAt <= deps.now() || grant.clientId !== client.id || grant.redirectUri !== input.redirectUri) {
    throw new OAuthFailure(400, "invalid_grant", "The authorization code is not valid.");
  }
  const expected = createHash("sha256").update(input.codeVerifier).digest("base64url");
  if (grant.codeChallenge === null || !safeEqual(grant.codeChallenge, expected)) {
    throw new OAuthFailure(400, "invalid_grant", "The code verifier does not match.");
  }
  return saveTokenPair(deps, client.id, grant.userId, grant.scope, grant.createdAt);
}

async function rotateRefresh(deps: OAuthDeps, client: OAuthClient, refreshToken: string | undefined): Promise<IssuedTokens> {
  if (refreshToken === undefined || !TOKEN_PATTERN.test(refreshToken)) {
    throw new OAuthFailure(400, "invalid_grant", "The refresh token is not valid.");
  }
  const hash = hashSecret(refreshToken);
  const grant = await deps.store.findGrant(hash, "refresh");
  await deps.store.deleteGrant(hash);
  if (grant === undefined || grant.expiresAt <= deps.now() || grant.clientId !== client.id) {
    throw new OAuthFailure(400, "invalid_grant", "The refresh token is not valid.");
  }
  return saveTokenPair(deps, client.id, grant.userId, grant.scope, grant.createdAt);
}

async function saveTokenPair(deps: OAuthDeps, clientId: string, userId: string, scope: string, createdAt: number): Promise<IssuedTokens> {
  const accessToken = `mso_${randomBytes(32).toString("base64url")}`;
  const refreshToken = `mso_${randomBytes(32).toString("base64url")}`;
  const now = deps.now();
  await deps.store.saveGrant({
    tokenHash: hashSecret(accessToken),
    userId,
    clientId,
    kind: "access",
    redirectUri: null,
    codeChallenge: null,
    scope,
    createdAt,
    expiresAt: now + ACCESS_TTL_MS,
  });
  await deps.store.saveGrant({
    tokenHash: hashSecret(refreshToken),
    userId,
    clientId,
    kind: "refresh",
    redirectUri: null,
    codeChallenge: null,
    scope,
    createdAt,
    expiresAt: now + REFRESH_TTL_MS,
  });
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_MS / 1000, scope };
}

async function authenticatedClient(deps: OAuthDeps, clientId: string, clientSecret: string | undefined): Promise<OAuthClient> {
  const client = await deps.store.findClient(clientId);
  if (client === undefined) throw new OAuthFailure(401, "invalid_client", "Unknown client.");
  if (client.secretHash === null) return client;
  const presented = clientSecret === undefined ? "" : hashSecret(clientSecret);
  if (!safeEqual(presented, client.secretHash)) throw new OAuthFailure(401, "invalid_client", "The client secret is not valid.");
  return client;
}

function authorizeProblem(deps: OAuthDeps, input: AuthorizeInput): string | undefined {
  if (input.codeChallengeMethod !== "S256" || !PKCE_PATTERN.test(input.codeChallenge)) return "invalid_request";
  if (input.state.trim() === "" || input.state.length > 512 || /[\r\n]/.test(input.state)) return "invalid_request";
  if (normalizeScope(input.scope) === undefined) return "invalid_scope";
  if (input.resource !== undefined && input.resource !== "" && input.resource !== mcpResource(deps.issuer)) return "invalid_target";
  return undefined;
}

function normalizeScope(raw: string | undefined): string | undefined {
  const parts = (raw === undefined || raw.trim() === "" ? "transcribe" : raw).split(" ").filter((part) => part !== "");
  if (parts.length === 0 || parts.some((part) => !SCOPES.has(part))) return undefined;
  return [...new Set(parts)].join(" ");
}

function cleanName(name: string | undefined): string {
  const trimmed = (name ?? "MCP client").replace(/[^\x20-\x7E]/g, "").trim();
  if (trimmed === "") return "MCP client";
  return trimmed.slice(0, 80);
}
