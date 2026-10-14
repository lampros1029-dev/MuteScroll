import { createHash, createPublicKey, createVerify, type JsonWebKey } from "node:crypto";

import { logEvent } from "../log.js";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const CERT_CACHE_MS = 10 * 60 * 1000;

export interface GoogleIdentity {
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

export interface GoogleAuthorizationRequest {
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
  readonly redirectUri: string;
}

export interface GoogleCodeExchange {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly nonce: string;
}

export interface GoogleAuthClient {
  readonly configured: boolean;
  authorizationUrl(request: GoogleAuthorizationRequest): string;
  exchangeCode(request: GoogleCodeExchange): Promise<GoogleIdentity>;
}

export interface GoogleClientOptions {
  readonly clientId: string | undefined;
  readonly clientSecret: string | undefined;
}

/** Browser callback on the website, so the session cookie is set on mutescroll.xyz rather than the API host. */
export function googleRedirectUri(webOrigin: string): string {
  return `${webOrigin}/api/v1/auth/google/callback`;
}

export function createGoogleAuthClient(options: GoogleClientOptions, fetchImpl: typeof fetch = fetch): GoogleAuthClient {
  const clientId = options.clientId;
  const clientSecret = options.clientSecret;
  const configured = clientId !== undefined && clientSecret !== undefined;
  return {
    configured,
    authorizationUrl(request) {
      if (clientId === undefined) throw new Error("Google sign-in is not configured");
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", request.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", request.state);
      url.searchParams.set("nonce", request.nonce);
      url.searchParams.set("code_challenge", request.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("prompt", "select_account");
      return url.toString();
    },
    exchangeCode(request) {
      if (clientId === undefined || clientSecret === undefined) return Promise.reject(new Error("Google sign-in is not configured"));
      return exchangeGoogleCode({ clientId, clientSecret, fetchImpl }, request);
    },
  };
}

interface ExchangeDeps {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetchImpl: typeof fetch;
}

async function exchangeGoogleCode(deps: ExchangeDeps, request: GoogleCodeExchange): Promise<GoogleIdentity> {
  const body = new URLSearchParams({
    code: request.code,
    client_id: deps.clientId,
    client_secret: deps.clientSecret,
    redirect_uri: request.redirectUri,
    grant_type: "authorization_code",
    code_verifier: request.codeVerifier,
  });
  let response: Response;
  try {
    response = await deps.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
    });
  } catch {
    logEvent("auth.google_exchange_failed", { status: 0 });
    throw new Error("Google token exchange failed");
  }
  if (!response.ok) {
    logEvent("auth.google_exchange_failed", { status: response.status });
    throw new Error("Google token exchange failed");
  }
  const payload = (await response.json()) as { id_token?: unknown };
  if (typeof payload.id_token !== "string") throw new Error("Google token exchange failed");
  return verifyGoogleIdToken(payload.id_token, deps.clientId, request.nonce, deps.fetchImpl);
}

interface CachedCerts {
  readonly keys: readonly JsonWebKey[];
  readonly expiresAt: number;
}

let cachedCerts: CachedCerts | undefined;

async function verifyGoogleIdToken(idToken: string, clientId: string, nonce: string, fetchImpl: typeof fetch): Promise<GoogleIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Google token exchange failed");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (encodedHeader === undefined || encodedPayload === undefined || encodedSignature === undefined) {
    throw new Error("Google token exchange failed");
  }
  const header = parseJson(encodedHeader) as { alg?: unknown; kid?: unknown };
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Google token exchange failed");
  const key = await googleKey(header.kid, fetchImpl);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  if (!verifier.verify(key, Buffer.from(encodedSignature, "base64url"))) throw new Error("Google token exchange failed");
  const claims = parseJson(encodedPayload) as Record<string, unknown>;
  if (claims["iss"] !== "https://accounts.google.com" && claims["iss"] !== "accounts.google.com") {
    throw new Error("Google token exchange failed");
  }
  const audience = claims["aud"];
  const audienceOk = audience === clientId || (Array.isArray(audience) && audience.includes(clientId));
  if (!audienceOk) throw new Error("Google token exchange failed");
  const expiresAt = claims["exp"];
  if (typeof expiresAt !== "number" || expiresAt * 1000 <= Date.now()) throw new Error("Google token exchange failed");
  if (claims["nonce"] !== nonce) throw new Error("Google token exchange failed");
  if (typeof claims["sub"] !== "string" || claims["sub"].length === 0 || claims["sub"].length > 255) {
    throw new Error("Google token exchange failed");
  }
  if (typeof claims["email"] !== "string") throw new Error("Google token exchange failed");
  return {
    subject: claims["sub"],
    email: claims["email"],
    emailVerified: claims["email_verified"] === true,
  };
}

async function googleKey(kid: string, fetchImpl: typeof fetch): Promise<ReturnType<typeof createPublicKey>> {
  const now = Date.now();
  if (cachedCerts === undefined || cachedCerts.expiresAt <= now) {
    const response = await fetchImpl(CERTS_URL, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("Google token exchange failed");
    const body = (await response.json()) as { keys?: JsonWebKey[] };
    if (!Array.isArray(body.keys)) throw new Error("Google token exchange failed");
    cachedCerts = { keys: body.keys, expiresAt: now + CERT_CACHE_MS };
  }
  const jwk = cachedCerts.keys.find((key) => key.kid === kid);
  if (jwk === undefined) throw new Error("Google token exchange failed");
  return createPublicKey({ key: jwk, format: "jwk" });
}

function parseJson(encoded: string): unknown {
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

/** PKCE S256 challenge for a verifier. */
export function codeChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
