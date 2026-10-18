import type { IncomingMessage, ServerResponse } from "node:http";

import { requireAccount, requireCsrf, identify } from "../api/identity.js";
import { ApiError } from "../api/errors.js";
import type { AppContext } from "../context.js";
import { BodyError, readRawBody } from "../http/body.js";
import { sendJson } from "../http/respond.js";
import {
  OAuthFailure,
  approveAuthorization,
  beginAuthorization,
  issueToken,
  mcpResource,
  registerClient,
  revokeAccessTokenFamily,
  revokeClientForUser,
  revokeTokenForUser,
  type OAuthDeps,
} from "./service.js";

const OAUTH_BODY_BYTES = 16 * 1024;

/**
 * OAuth 2.1 for MCP account linking. ChatGPT discovers the metadata, registers itself, and sends
 * the person to the website to approve. Anonymous MCP calls stay open.
 */
export async function handleOAuth(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  if (!isOAuthPath(path)) return false;
  try {
    if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
      return metadata(req, res, protectedResource(ctx));
    }
    if (path === "/.well-known/oauth-authorization-server") return metadata(req, res, authorizationServer(ctx));
    if (path === "/oauth/register") return await register(req, res, ctx);
    if (path === "/oauth/client") return await clientDisplayName(req, res, ctx, url);
    if (path === "/oauth/authorize") return await authorize(req, res, ctx, url);
    if (path === "/oauth/token") return await token(req, res, ctx);
    if (path === "/oauth/approve") return await approve(req, res, ctx);
    if (path === "/oauth/revoke") return await revoke(req, res, ctx);
    sendJson(res, 404, { error: "not_found" });
    return true;
  } catch (error) {
    if (error instanceof OAuthFailure) {
      sendJson(res, error.status, { error: error.code, error_description: error.description });
      return true;
    }
    if (error instanceof BodyError) {
      sendJson(res, error.status, { error: "invalid_request", error_description: "The request body could not be read." });
      return true;
    }
    if (error instanceof ApiError) {
      sendJson(res, error.status, { error: { code: error.code, message: error.message } });
      return true;
    }
    throw error;
  }
}

function isOAuthPath(path: string): boolean {
  return (
    path.startsWith("/.well-known/oauth-") ||
    path === "/oauth/register" ||
    path === "/oauth/client" ||
    path === "/oauth/authorize" ||
    path === "/oauth/token" ||
    path === "/oauth/approve" ||
    path === "/oauth/revoke"
  );
}

function metadata(req: IncomingMessage, res: ServerResponse, body: unknown): boolean {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" }, { allow: "GET" });
    return true;
  }
  sendJson(res, 200, body);
  return true;
}

function protectedResource(ctx: AppContext): unknown {
  const resource = mcpResource(ctx.config.publicBaseUrl);
  return {
    resource,
    authorization_servers: [ctx.config.publicBaseUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: ["transcribe"],
  };
}

function authorizationServer(ctx: AppContext): unknown {
  const issuer = ctx.config.publicBaseUrl;
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    revocation_endpoint: `${issuer}/oauth/revoke`,
    // Connector discovery lists transcribe only. library:read remains valid for a library
    // token whose resource is not the MCP server, and is omitted here so ChatGPT does not request it.
    scopes_supported: ["transcribe"],
  };
}

async function register(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<boolean> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" }, { allow: "POST" });
    return true;
  }
  const body = await readObject(req);
  const uris = stringList(body["redirect_uris"]);
  if (uris === undefined) throw new OAuthFailure(400, "invalid_client_metadata", "redirect_uris must be a list of strings.");
  const registered = await registerClient(deps(ctx), {
    name: optionalString(body["client_name"]),
    redirectUris: uris,
    authMethod: optionalString(body["token_endpoint_auth_method"]),
  });
  sendJson(res, 201, {
    client_id: registered.clientId,
    ...(registered.clientSecret === undefined ? {} : { client_secret: registered.clientSecret }),
    client_id_issued_at: Math.floor(registered.issuedAt / 1000),
    client_secret_expires_at: 0,
    redirect_uris: registered.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: registered.tokenEndpointAuthMethod,
    client_name: registered.clientName,
  });
  return true;
}

/** The allow screen reads this. The body is the registered display name and nothing else. */
async function clientDisplayName(req: IncomingMessage, res: ServerResponse, ctx: AppContext, url: URL): Promise<boolean> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" }, { allow: "GET" });
    return true;
  }
  const clientId = url.searchParams.get("client_id") ?? "";
  const client = clientId === "" ? undefined : await ctx.stores.oauth.findClient(clientId);
  if (client === undefined) {
    sendJson(res, 404, { error: "not_found" });
    return true;
  }
  sendJson(res, 200, { client_name: client.name });
  return true;
}

async function authorize(req: IncomingMessage, res: ServerResponse, ctx: AppContext, url: URL): Promise<boolean> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" }, { allow: "GET" });
    return true;
  }
  const decision = await beginAuthorization(deps(ctx), {
    clientId: url.searchParams.get("client_id") ?? "",
    redirectUri: url.searchParams.get("redirect_uri") ?? "",
    codeChallenge: url.searchParams.get("code_challenge") ?? "",
    codeChallengeMethod: url.searchParams.get("code_challenge_method") ?? "",
    state: url.searchParams.get("state") ?? "",
    scope: url.searchParams.get("scope") ?? undefined,
    resource: url.searchParams.get("resource") ?? undefined,
  });
  if (decision.kind === "reject") {
    sendJson(res, decision.status, { error: decision.code, error_description: decision.description });
    return true;
  }
  res.writeHead(302, { location: decision.location, "cache-control": "no-store" });
  res.end();
  return true;
}

async function token(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<boolean> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" }, { allow: "POST" });
    return true;
  }
  const fields = await readFields(req);
  const issued = await issueToken(deps(ctx), {
    grantType: fields.get("grant_type") ?? "",
    code: fields.get("code"),
    redirectUri: fields.get("redirect_uri"),
    codeVerifier: fields.get("code_verifier"),
    refreshToken: fields.get("refresh_token"),
    clientId: fields.get("client_id") ?? "",
    clientSecret: fields.get("client_secret"),
  });
  sendJson(res, 200, {
    access_token: issued.accessToken,
    token_type: "Bearer",
    expires_in: issued.expiresIn,
    refresh_token: issued.refreshToken,
    scope: issued.scope,
  });
  return true;
}

async function approve(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<boolean> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" }, { allow: "POST" });
    return true;
  }
  const account = requireAccount(await identify(req, res, ctx, { allowSession: true }));
  requireCsrf(req, account);
  const body = await readObject(req);
  const redirectTo = await approveAuthorization(deps(ctx), {
    userId: account.user.id,
    clientId: requiredField(body, "client_id"),
    redirectUri: requiredField(body, "redirect_uri"),
    codeChallenge: requiredField(body, "code_challenge"),
    codeChallengeMethod: requiredField(body, "code_challenge_method"),
    state: requiredField(body, "state"),
    scope: optionalString(body["scope"]),
    resource: optionalString(body["resource"]),
  });
  sendJson(res, 200, { redirect_to: redirectTo });
  return true;
}

async function revoke(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<boolean> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" }, { allow: "POST" });
    return true;
  }
  const requester = await identify(req, res, ctx, { allowSession: true });
  if (requester.kind === "account" && requester.oauthAccessToken !== undefined) {
    await revokeAccessTokenFamily(deps(ctx), requester.oauthAccessToken);
    sendJson(res, 200, { revoked: true });
    return true;
  }
  if (requester.kind !== "account" || !requester.cookieAuth) {
    throw new ApiError(401, "unauthorized", "Sign in to revoke a connection.");
  }
  requireCsrf(req, requester);
  const body = await readObject(req);
  const clientId = presentString(optionalString(body["client_id"]));
  const grantId = presentString(optionalString(body["grant_id"]));
  const token = presentString(optionalString(body["token"]));
  if (clientId === undefined && grantId === undefined && token === undefined) {
    throw new OAuthFailure(400, "invalid_request", "client_id, grant_id or token is required.");
  }
  if (clientId !== undefined) await revokeClientForUser(deps(ctx), requester.user.id, clientId);
  if (grantId !== undefined) await revokeClientForUser(deps(ctx), requester.user.id, grantId);
  if (token !== undefined) await revokeTokenForUser(deps(ctx), requester.user.id, token);
  sendJson(res, 200, { revoked: true });
  return true;
}

/** GET /v1/oauth/grants. Cookie session or bearer. Names and scopes only: no tokens or hashes. */
export async function listOAuthGrants(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const account = requireAccount(await identify(req, res, ctx, { allowSession: true }));
  const links = await ctx.stores.oauth.listClientLinks(account.user.id, ctx.now());
  const grants = await Promise.all(
    links.map(async (link) => {
      const client = await ctx.stores.oauth.findClient(link.id);
      return {
        id: link.id,
        client_name: client?.name ?? "MCP client",
        scope: link.scope,
        created_at: new Date(link.createdAt).toISOString(),
      };
    }),
  );
  sendJson(res, 200, { grants });
}

function deps(ctx: AppContext): OAuthDeps {
  return {
    store: ctx.stores.oauth,
    now: ctx.now,
    issuer: ctx.config.publicBaseUrl,
    webOrigin: ctx.config.webOrigin,
    allowLocalHttp: !ctx.config.secureCookies,
  };
}

async function readObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = (await readRawBody(req, OAUTH_BODY_BYTES)).toString("utf8");
  const contentType = req.headers["content-type"] ?? "";
  if (contentType.includes("application/json")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new OAuthFailure(400, "invalid_request", "The request body is not JSON.");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new OAuthFailure(400, "invalid_request", "The request body must be an object.");
    }
    return parsed as Record<string, unknown>;
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

async function readFields(req: IncomingMessage): Promise<Map<string, string>> {
  const body = await readObject(req);
  const fields = new Map<string, string>();
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") fields.set(key, value);
  }
  return fields;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function presentString(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value;
}

function requiredField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value === "") throw new OAuthFailure(400, "invalid_request", `${key} is required.`);
  return value;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined;
  return value as string[];
}
