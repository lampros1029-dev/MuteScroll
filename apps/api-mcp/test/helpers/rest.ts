import { randomUUID } from "node:crypto";

import type { RunningServer } from "./harness.js";

export interface ApiResult {
  readonly status: number;
  // Test bodies are inspected loosely, so the parsed JSON stays untyped here.
  readonly body: any;
  readonly headers: Headers;
  readonly text: string;
}

export interface ApiRequest {
  readonly method?: string;
  readonly json?: unknown;
  /** Raw body: a string, or the bytes of a file (typed loosely because Node's BodyInit is stricter). */
  readonly body?: string | Uint8Array;
  readonly headers?: Record<string, string>;
}

/** Calls the REST API over real HTTP. Cookies are never stored automatically: tests pass them explicitly. */
export async function api(server: RunningServer, path: string, request: ApiRequest = {}): Promise<ApiResult> {
  const headers: Record<string, string> = { ...(request.headers ?? {}) };
  let body: BodyInit | undefined = request.body as BodyInit | undefined;
  if (request.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(request.json);
  }
  const response = await fetch(`${server.baseUrl}${path}`, {
    method: request.method ?? "GET",
    headers,
    ...(body === undefined ? {} : { body }),
  });
  const text = await response.text();
  let parsed: unknown = undefined;
  if (text !== "") {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  return { status: response.status, body: parsed, headers: response.headers, text };
}

export interface AccountSession {
  readonly email: string;
  readonly password: string;
  readonly cookie: string;
  readonly csrf: string;
}

export const GOOD_PASSWORD = "correct horse battery staple";

/** The value of one named cookie from Set-Cookie header lines. */
export function cookieValue(setCookies: readonly string[], name: string): string {
  const line = setCookies.find((entry) => entry.startsWith(`${name}=`));
  if (line === undefined) throw new Error(`no ${name} cookie was set`);
  return line.slice(name.length + 1).split(";")[0] ?? "";
}

export function sessionFrom(result: ApiResult, email: string, password: string): AccountSession {
  const setCookies = result.headers.getSetCookie();
  const session = cookieValue(setCookies, "ms_session");
  const csrf = cookieValue(setCookies, "ms_csrf");
  return { email, password, cookie: `ms_session=${session}; ms_csrf=${csrf}`, csrf };
}

export async function signUp(server: RunningServer, email = `user-${randomUUID()}@example.test`): Promise<AccountSession> {
  const result = await api(server, "/v1/auth/signup", { method: "POST", json: { email, password: GOOD_PASSWORD } });
  if (result.status !== 201) throw new Error(`signup failed with ${result.status}`);
  return sessionFrom(result, email, GOOD_PASSWORD);
}

/** Headers for a cookie-authenticated mutating request: the session cookie plus the CSRF echo. */
export function sessionHeaders(session: AccountSession): Record<string, string> {
  return { cookie: session.cookie, "x-csrf-token": session.csrf };
}

export function bearer(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

/**
 * Creates an API key through the web session. Only the Team plan may hold keys, so this puts the
 * account on Team first. Tests of the Free-plan refusal call the route themselves.
 */
export async function createKey(server: RunningServer, session: AccountSession): Promise<{ id: string; key: string }> {
  const user = await server.ctx.stores.users.findByEmail(session.email);
  if (user === undefined) throw new Error("account missing");
  if (user.plan !== "team") await server.ctx.stores.users.setPlan(user.id, "team");
  const result = await api(server, "/v1/api-keys", { method: "POST", headers: sessionHeaders(session) });
  if (result.status !== 201) throw new Error(`key creation failed with ${result.status}`);
  return { id: result.body.id, key: result.body.key };
}
