import { createHash, randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { api, signUp, sessionHeaders } from "../helpers/rest.js";
import { startTestServer, testConfig, type RunningServer } from "../helpers/harness.js";

const REDIRECT = "https://chatgpt.com/connector/oauth/callback";

describe("ChatGPT OAuth account linking", () => {
  let server: RunningServer;

  afterEach(async () => {
    await server.close();
  });

  it("lets a signed-in account approve ChatGPT and call the API with the issued token", async () => {
    server = await startTestServer(testConfig());
    const metadata = await api(server, "/.well-known/oauth-authorization-server");
    expect(metadata.status).toBe(200);
    expect(metadata.body.registration_endpoint).toBe(`${server.baseUrl}/oauth/register`);
    const resource = await api(server, "/.well-known/oauth-protected-resource/mcp");
    expect(resource.status).toBe(200);
    expect(resource.body.scopes_supported).toEqual(["transcribe"]);

    const registered = await api(server, "/oauth/register", {
      method: "POST",
      json: { client_name: "ChatGPT", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" },
    });
    expect(registered.status).toBe(201);
    const clientId = registered.body.client_id as string;

    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = "chatgpt-state";
    const authorize = await fetch(authorizeUrl(server.baseUrl, clientId, challenge, state), { redirect: "manual" });
    expect(authorize.status).toBe(302);
    expect(authorize.headers.get("location")).toContain("https://mutescroll.xyz/connect?");
    expect(authorize.headers.get("location")).toContain(encodeURIComponent(REDIRECT));

    const session = await signUp(server);
    const approved = await api(server, "/oauth/approve", {
      method: "POST",
      headers: sessionHeaders(session),
      json: {
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        scope: "transcribe",
      },
    });
    expect(approved.status).toBe(200);
    const back = new URL(approved.body.redirect_to as string);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe(state);
    const code = back.searchParams.get("code");
    expect(code).toEqual(expect.any(String));

    const token = await exchange(server.baseUrl, clientId, code ?? "", verifier);
    const reused = await exchange(server.baseUrl, clientId, code ?? "", verifier);
    expect(token.status).toBe(200);
    expect(reused.status).toBe(400);

    const me = await api(server, "/v1/me", { headers: { authorization: `Bearer ${token.body.access_token}` } });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(session.email);

    const refreshed = await fetch(`${server.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.body.refresh_token as string,
        client_id: clientId,
      }),
    });
    expect(refreshed.status).toBe(200);
  });

  it("grants the MCP resource only the transcribe scope", async () => {
    server = await startTestServer(testConfig());
    const registered = await api(server, "/oauth/register", {
      method: "POST",
      json: { client_name: "ChatGPT", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" },
    });
    const clientId = registered.body.client_id as string;
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = await fetch(authorizeUrl(server.baseUrl, clientId, challenge, "scope-state", "transcribe library:read"), {
      redirect: "manual",
    });
    const location = authorize.headers.get("location") ?? "";
    expect(new URL(location).searchParams.get("scope")).toBe("transcribe");

    const session = await signUp(server);
    const approved = await api(server, "/oauth/approve", {
      method: "POST",
      headers: sessionHeaders(session),
      json: {
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "scope-state",
        scope: "transcribe library:read",
        resource: `${server.baseUrl}/mcp`,
      },
    });
    const code = new URL(approved.body.redirect_to as string).searchParams.get("code") ?? "";
    const token = await exchange(server.baseUrl, clientId, code, verifier);
    expect(token.body.scope).toBe("transcribe");
  });

  it("rejects a redirect that is not an assistant host", async () => {
    server = await startTestServer(testConfig());
    const registered = await api(server, "/oauth/register", {
      method: "POST",
      json: { redirect_uris: ["https://evil.example/steal"] },
    });
    expect(registered.status).toBe(400);
    expect(registered.body.error).toBe("invalid_redirect_uri");
  });
});

function authorizeUrl(baseUrl: string, clientId: string, challenge: string, state: string, scope = "transcribe"): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope,
    resource: `${baseUrl}/mcp`,
  });
  return `${baseUrl}/oauth/authorize?${params.toString()}`;
}

function exchange(baseUrl: string, clientId: string, code: string, verifier: string): Promise<{ status: number; body: { access_token?: string; refresh_token?: string; scope?: string } }> {
  return fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    }),
  }).then(async (response) => {
    const body = (await response.json()) as { access_token?: string; refresh_token?: string };
    return { status: response.status, body };
  });
}
