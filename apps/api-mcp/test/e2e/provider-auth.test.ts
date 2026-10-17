import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { GoogleAuthClient, GoogleIdentity } from "../../src/accounts/google-oauth.js";
import { api, cookieValue, GOOD_PASSWORD, sessionHeaders, signUp } from "../helpers/rest.js";
import { startTestServer, testConfig, type RunningServer } from "../helpers/harness.js";

const CLIENT_ID = "test-google-client";
const CLIENT_SECRET = "test-google-secret-value";
const REDIRECT = "https://chatgpt.com/connector/oauth/callback";

describe("Google and ChatGPT sign-in", () => {
  let server: RunningServer;

  afterEach(async () => {
    await server.close();
  });

  it("tells the truth when Google sign-in is not configured, and does not use the Gmail client", async () => {
    server = await startTestServer(
      testConfig({
        GMAIL_OAUTH_CLIENT_ID: "gmail-desktop-client",
        GMAIL_OAUTH_CLIENT_SECRET: "gmail-desktop-secret",
      }),
    );
    const started = await fetch(`${server.baseUrl}/v1/auth/google?mode=signup`, { redirect: "manual" });
    expect(started.status).toBe(302);
    expect(started.headers.get("location")).toBe("/signup?error=google_not_configured");
    expect(started.headers.get("location")).not.toContain("accounts.google.com");
    expect(started.headers.get("location")).not.toContain("gmail");
  });

  it("sends the browser to Google without putting the client secret in the URL", async () => {
    server = await startTestServer(testConfig({ GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: CLIENT_SECRET }));
    const started = await fetch(`${server.baseUrl}/v1/auth/google?mode=login&next=/account`, { redirect: "manual" });
    const location = started.headers.get("location") ?? "";
    expect(started.status).toBe(302);
    expect(location.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    expect(location).toContain(`client_id=${CLIENT_ID}`);
    expect(location).not.toContain(CLIENT_SECRET);
    expect(location).toContain(encodeURIComponent("https://mutescroll.xyz/api/v1/auth/google/callback"));
    expect(started.headers.getSetCookie().some((line) => line.startsWith("ms_google_tx=") && line.includes("HttpOnly"))).toBe(true);
  });

  it("creates an account from a verified Google email and opens the same session", async () => {
    const identity: GoogleIdentity = { subject: "google-subject-1", email: "Person@Example.test", emailVerified: true };
    server = await startTestServer(googleConfig(), { google: fakeGoogle(identity) });
    const done = await finishGoogle(server, "/account");
    expect(done.headers.get("location")).toBe("/account");
    const session = cookieValue(done.headers.getSetCookie(), "ms_session");
    expect(cookieValue(done.headers.getSetCookie(), "ms_csrf").length).toBeGreaterThan(10);
    const me = await api(server, "/v1/me", { headers: { cookie: `ms_session=${session}` } });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("person@example.test");
    expect(me.body.email_verified).toBe(true);

    const created = await server.ctx.stores.users.findByEmail("person@example.test");
    const again = await finishGoogle(server, "/account");
    const second = cookieValue(again.headers.getSetCookie(), "ms_session");
    const meAgain = await api(server, "/v1/me", { headers: { cookie: `ms_session=${second}` } });
    expect(meAgain.body.email).toBe("person@example.test");
    const same = await server.ctx.stores.users.findByEmail("person@example.test");
    expect(same?.id).toBe(created?.id);

    const offsite = await finishGoogle(server, "https://evil.example/phish");
    expect(offsite.headers.get("location")).toBe("/account");
    expect(offsite.headers.get("location")).not.toContain("evil.example");

    const password = await api(server, "/v1/auth/login", {
      method: "POST",
      json: { email: "person@example.test", password: GOOD_PASSWORD },
    });
    expect(password.status).toBe(401);
  });

  it("signs into an account whose email is already verified", async () => {
    server = await startTestServer(googleConfig(), {
      google: fakeGoogle({ subject: "google-subject-2", email: "owner@example.test", emailVerified: true }),
    });
    const existing = await signUp(server, "owner@example.test");
    const owner = await server.ctx.stores.users.findByEmail(existing.email);
    if (owner === undefined) throw new Error("account missing");
    await server.ctx.stores.users.markEmailVerified(owner.id, server.ctx.now());

    const done = await finishGoogle(server, "/pricing");
    expect(done.headers.get("location")).toBe("/pricing");
    const session = cookieValue(done.headers.getSetCookie(), "ms_session");
    const me = await api(server, "/v1/me", { headers: { cookie: `ms_session=${session}` } });
    expect(me.body.email).toBe(owner.email);
    const still = await api(server, "/v1/auth/login", {
      method: "POST",
      json: { email: existing.email, password: existing.password },
    });
    expect(still.status).toBe(200);
  });

  it("does not take over an account whose email was never verified", async () => {
    server = await startTestServer(googleConfig(), {
      google: fakeGoogle({ subject: "google-subject-4", email: "reserved@example.test", emailVerified: true }),
    });
    const existing = await signUp(server, "reserved@example.test");
    const done = await finishGoogle(server, "/account");
    expect(done.headers.get("location")).toBe("/login?error=google_existing_unverified");
    expect(done.headers.getSetCookie().some((line) => line.startsWith("ms_session="))).toBe(false);
    const user = await server.ctx.stores.users.findByEmail(existing.email);
    expect(user?.emailVerifiedAt).toBeNull();
  });

  it("rejects an unverified Google email, a bad state, and a tampered cookie", async () => {
    server = await startTestServer(googleConfig(), {
      google: fakeGoogle({ subject: "google-subject-5", email: "unverified@example.test", emailVerified: false }),
    });
    const unverified = await finishGoogle(server, "/account");
    expect(unverified.headers.get("location")).toBe("/login?error=google_unverified");

    const mismatched = await beginGoogle(server, "/account");
    const tx = cookiePair(mismatched.cookie);
    const badState = await fetch(`${server.baseUrl}/v1/auth/google/callback?code=good-code&state=nope`, {
      redirect: "manual",
      headers: { cookie: tx },
    });
    expect(badState.headers.get("location")).toBe("/login?error=google_failed");

    const started = await beginGoogle(server, "/account");
    const pair = cookiePair(started.cookie);
    const eq = pair.indexOf("=");
    const value = pair.slice(eq + 1);
    const changed = value.startsWith("A") ? `B${value.slice(1)}` : `A${value.slice(1)}`;
    const flipped = `${pair.slice(0, eq + 1)}${changed}`;
    const tampered = await fetch(
      `${server.baseUrl}/v1/auth/google/callback?code=good-code&state=${encodeURIComponent(started.state)}`,
      { redirect: "manual", headers: { cookie: flipped } },
    );
    expect(tampered.headers.get("location")).toBe("/login?error=google_failed");
  });

  it("opens MuteScroll's connector page, and the approval screen when ChatGPT already sent a request", async () => {
    server = await startTestServer(testConfig());
    const started = await fetch(`${server.baseUrl}/v1/auth/chatgpt?mode=signup`, { redirect: "manual" });
    expect(started.status).toBe(302);
    expect(started.headers.get("location")).toBe("/connect");

    const pending = await fetch(
      `${server.baseUrl}/v1/auth/chatgpt?mode=login&client_id=client&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=challenge&state=chatgpt-state`,
      { redirect: "manual" },
    );
    expect(pending.status).toBe(302);
    const location = pending.headers.get("location") ?? "";
    expect(location.startsWith("/connect?")).toBe(true);
    expect(location).toContain("client_id=client");
    expect(location).toContain(`redirect_uri=${encodeURIComponent(REDIRECT)}`);
    expect(location).toContain("state=chatgpt-state");
    expect(location).not.toContain("openai.com");
  });

  it("approves ChatGPT for the signed-in account and keeps that session", async () => {
    server = await startTestServer(testConfig());
    const registered = await api(server, "/oauth/register", {
      method: "POST",
      json: { client_name: "ChatGPT", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" },
    });
    expect(registered.status).toBe(201);
    const clientId = registered.body.client_id as string;
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = "chatgpt-state";
    const account = await signUp(server, `chatgpt-${randomUUID()}@example.test`);

    const missing = await api(server, "/v1/auth/chatgpt", {
      method: "POST",
      headers: { cookie: account.cookie },
      json: connectorBody(clientId, challenge, state),
    });
    expect(missing.status).toBe(403);

    const anonymous = await api(server, "/v1/auth/chatgpt", { method: "POST", json: connectorBody(clientId, challenge, state) });
    expect(anonymous.status).toBe(401);

    const approved = await api(server, "/v1/auth/chatgpt", {
      method: "POST",
      headers: sessionHeaders(account),
      json: connectorBody(clientId, challenge, state),
    });
    expect(approved.status).toBe(200);
    expect(approved.body.redirect_to).toContain(`${REDIRECT}?`);
    expect(approved.body.redirect_to).toContain("code=");
    expect(approved.body.redirect_to).toContain("state=chatgpt-state");

    const code = new URL(approved.body.redirect_to as string).searchParams.get("code") ?? "";
    const token = await fetch(`${server.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
        client_id: clientId,
      }),
    });
    expect(token.status).toBe(200);
    const me = await api(server, "/v1/me", { headers: { cookie: account.cookie } });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(account.email);
  });
});

function googleConfig() {
  return testConfig({ GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: CLIENT_SECRET });
}

function fakeGoogle(identity: GoogleIdentity): GoogleAuthClient {
  return {
    configured: true,
    authorizationUrl(request) {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", CLIENT_ID);
      url.searchParams.set("state", request.state);
      url.searchParams.set("nonce", request.nonce);
      url.searchParams.set("redirect_uri", request.redirectUri);
      url.searchParams.set("code_challenge", request.codeChallenge);
      return url.toString();
    },
    async exchangeCode(request) {
      if (request.code !== "good-code") throw new Error("exchange failed");
      return identity;
    },
  };
}

async function beginGoogle(server: RunningServer, next: string): Promise<{ state: string; cookie: string }> {
  const started = await fetch(`${server.baseUrl}/v1/auth/google?mode=login&next=${encodeURIComponent(next)}`, { redirect: "manual" });
  const location = started.headers.get("location") ?? "";
  const state = new URL(location).searchParams.get("state");
  const cookie = started.headers.getSetCookie().find((line) => line.startsWith("ms_google_tx="));
  if (state === null || cookie === undefined) throw new Error("Google start did not return state");
  return { state, cookie };
}

async function finishGoogle(server: RunningServer, next: string): Promise<Response> {
  const started = await beginGoogle(server, next);
  return fetch(`${server.baseUrl}/v1/auth/google/callback?code=good-code&state=${encodeURIComponent(started.state)}`, {
    redirect: "manual",
    headers: { cookie: cookiePair(started.cookie) },
  });
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

function connectorBody(clientId: string, challenge: string, state: string) {
  return {
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "transcribe",
  };
}
