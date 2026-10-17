import { createHash, randomBytes } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";

import type { AddonCheckoutInput, BillingProvider, CheckoutInput, CheckoutSession, PortalSession, WebhookVerification } from "../../src/billing/provider.js";
import { PaddleApiError } from "../../src/billing/paddle-client.js";
import { MailNotConfiguredError, type OutboundMail } from "../../src/mail/gmail.js";
import { FakeWorker } from "../helpers/fake-worker.js";
import { sampleUrl } from "../helpers/fixtures.js";
import type { RunningServer } from "../helpers/harness.js";
import { api, bearer, createKey, GOOD_PASSWORD, sessionHeaders, signUp, type AccountSession } from "../helpers/rest.js";
import { STORE_MODES } from "../helpers/postgres.js";
import { serverStarter } from "../helpers/suite.js";

const REDIRECT = "https://chatgpt.com/connector/oauth/callback";

class RecordingBilling implements BillingProvider {
  readonly kind = "paddle" as const;
  readonly cancelled: string[] = [];
  failCancel = false;

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    void input;
    return { transactionId: "txn_test", url: "https://checkout.paddle.com/test" };
  }

  async createAddonCheckout(input: AddonCheckoutInput): Promise<CheckoutSession> {
    void input;
    return { transactionId: "txn_addon", url: "https://checkout.paddle.com/addon" };
  }

  async createPortalSession(userId: string): Promise<PortalSession> {
    void userId;
    return { url: "https://customer-portal.paddle.com/cpl_test" };
  }

  async cancelSubscriptions(userId: string): Promise<void> {
    if (this.failCancel) throw new PaddleApiError(500);
    this.cancelled.push(userId);
  }

  async subscriptionInterval(_userId: string): Promise<null> {
    return null;
  }

  verifyWebhook(): WebhookVerification {
    return { ok: false, reason: "missing_signature" };
  }
}

function capturingMailer(): { readonly mailer: { configured: true; send(mail: OutboundMail): Promise<void> }; readonly sent: OutboundMail[] } {
  const sent: OutboundMail[] = [];
  return { sent, mailer: { configured: true, async send(mail) { sent.push(mail); } } };
}

describe.each(STORE_MODES)("go-live API on $name stores", (mode) => {
  const start = serverStarter(mode);

  it("requires a session for checkout and portal, and never invents a URL when billing is fake", async () => {
    const server = await start();
    const account = await signUp(server);
    const anon = await api(server, "/v1/checkout", { method: "POST", json: { plan: "pro", interval: "month" } });
    expect(anon.status).toBe(401);
    const noCsrf = await api(server, "/v1/checkout", { method: "POST", headers: { cookie: account.cookie }, json: { plan: "pro", interval: "month" } });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe("csrf_failed");
    const checkout = await api(server, "/v1/checkout", { method: "POST", headers: sessionHeaders(account), json: { plan: "pro", interval: "month" } });
    expect(checkout.status).toBe(503);
    expect(checkout.body.error.code).toBe("billing_not_configured");
    expect(checkout.text).not.toMatch(/https?:\/\//);
    const portal = await api(server, "/v1/billing/portal", { method: "POST", headers: sessionHeaders(account) });
    expect(portal.status).toBe(503);
    expect(portal.body.error.code).toBe("billing_not_configured");
    expect(portal.text).not.toMatch(/https?:\/\//);
  });

  it("returns the provider checkout and portal URLs when Paddle is configured", async () => {
    const billing = new RecordingBilling();
    const server = await start({}, new FakeWorker(), { billingProvider: billing });
    const account = await signUp(server);
    const checkout = await api(server, "/v1/checkout", { method: "POST", headers: sessionHeaders(account), json: { plan: "pro", interval: "year" } });
    expect(checkout.status).toBe(200);
    expect(checkout.body.url).toBe("https://checkout.paddle.com/test");
    const portal = await api(server, "/v1/billing/portal", { method: "POST", headers: sessionHeaders(account) });
    expect(portal.body.url).toBe("https://customer-portal.paddle.com/cpl_test");
  });

  it("cancels a linked Paddle subscription and deletes jobs, keys, grants and billing links", async () => {
    const billing = new RecordingBilling();
    const server = await start({}, new FakeWorker(), { billingProvider: billing });
    const account = await signUp(server);
    const user = await server.ctx.stores.users.findByEmail(account.email);
    if (user === undefined) throw new Error("account missing");
    const made = await api(server, "/v1/transcriptions", { method: "POST", headers: sessionHeaders(account), json: { url: sampleUrl("kkkkkkkkkkk") } });
    expect(made.status).toBe(200);
    const jobId = made.body.job_id as string;
    const key = await createKey(server, account);
    await server.ctx.stores.billingLinks.bind("sub_delete1", user.id);
    await server.ctx.stores.billingLinks.bind("ctm_delete1", user.id);
    const access = await issueAccessToken(server, account, "transcribe");

    const refused = await api(server, "/v1/me", { method: "DELETE", headers: { cookie: account.cookie } });
    expect(refused.status).toBe(403);

    const deleted = await api(server, "/v1/me", { method: "DELETE", headers: sessionHeaders(account) });
    expect(deleted.status).toBe(204);
    expect(billing.cancelled).toEqual([user.id]);
    expect((await api(server, "/v1/me", { headers: { cookie: account.cookie } })).status).toBe(401);
    expect((await api(server, "/v1/me", { headers: bearer(key.key) })).status).toBe(401);
    expect((await api(server, "/v1/me", { headers: bearer(access) })).status).toBe(401);
    expect((await api(server, `/v1/transcriptions/${jobId}`)).status).toBe(404);
    expect(await server.ctx.stores.users.findByEmail(account.email)).toBeUndefined();
    expect(await server.ctx.stores.billingLinks.userFor("sub_delete1")).toBeUndefined();
    expect(await server.ctx.stores.apiKeys.listForUser(user.id)).toEqual([]);
  });

  it("keeps the account when Paddle cancel fails, and deletes local state when billing is fake", async () => {
    const billing = new RecordingBilling();
    billing.failCancel = true;
    const blocked = await start({}, new FakeWorker(), { billingProvider: billing });
    const kept = await signUp(blocked);
    const failed = await api(blocked, "/v1/me", { method: "DELETE", headers: sessionHeaders(kept) });
    expect(failed.status).toBe(502);
    expect((await api(blocked, "/v1/me", { headers: { cookie: kept.cookie } })).status).toBe(200);

    const server = await start();
    expect(server.ctx.billingProvider.kind).toBe("fake");
    const account = await signUp(server);
    expect((await api(server, "/v1/me", { method: "DELETE", headers: sessionHeaders(account) })).status).toBe(204);
    expect(await server.ctx.stores.users.findByEmail(account.email)).toBeUndefined();
  });

  it("returns the same 503 when mail is not configured, for an address that exists and one that does not", async () => {
    const server = await start();
    const account = await signUp(server);
    const known = await api(server, "/v1/auth/forgot-password", { method: "POST", json: { email: account.email } });
    const unknown = await api(server, "/v1/auth/forgot-password", { method: "POST", json: { email: `ghost-${account.email}` } });
    expect(known.status).toBe(503);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.error.code).toBe("email_not_configured");
    expect(known.text).not.toMatch(/mst_|accepted/);
    const verify = await api(server, "/v1/auth/email/verification", { method: "POST", headers: sessionHeaders(account) });
    expect(verify.status).toBe(503);
    expect(verify.body.error.code).toBe("email_not_configured");
  });

  it("sends a hashed single-use reset and verification token, with the same forgot-password reply either way", async () => {
    const { mailer, sent } = capturingMailer();
    const server = await start({}, new FakeWorker(), { mailer });
    const account = await signUp(server);
    expect((await api(server, "/v1/me", { headers: { cookie: account.cookie } })).body.email_verified).toBe(false);

    const known = await api(server, "/v1/auth/forgot-password", { method: "POST", json: { email: account.email } });
    const unknown = await api(server, "/v1/auth/forgot-password", { method: "POST", json: { email: `missing-${account.email}` } });
    expect(known.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(account.email);
    const resetToken = tokenFrom(sent[0]?.text ?? "");
    expect(await server.ctx.stores.authTokens.take(resetToken, "reset_password", server.ctx.now())).toBeUndefined();

    const reset = await api(server, "/v1/auth/reset-password", { method: "POST", json: { token: resetToken, password: "a different passphrase" } });
    expect(reset.status).toBe(204);
    expect((await api(server, "/v1/me", { headers: { cookie: account.cookie } })).status).toBe(401);
    expect((await api(server, "/v1/auth/reset-password", { method: "POST", json: { token: resetToken, password: "a different passphrase" } })).status).toBe(400);
    const relogin = await api(server, "/v1/auth/login", { method: "POST", json: { email: account.email, password: "a different passphrase" } });
    expect(relogin.status).toBe(200);
    expect((await api(server, "/v1/auth/login", { method: "POST", json: { email: account.email, password: GOOD_PASSWORD } })).status).toBe(401);

    const session = sessionFromLogin(relogin, account.email);
    const requested = await api(server, "/v1/auth/email/verification", { method: "POST", headers: sessionHeaders(session) });
    expect(requested.status).toBe(202);
    const verifyToken = tokenFrom(sent[1]?.text ?? "");
    const confirmed = await api(server, "/v1/auth/email/verification/confirm", { method: "POST", json: { token: verifyToken } });
    expect(confirmed.body).toEqual({ email_verified: true });
    expect((await api(server, "/v1/auth/email/verification/confirm", { method: "POST", json: { token: verifyToken } })).status).toBe(400);
    expect((await api(server, "/v1/me", { headers: { cookie: session.cookie } })).body.email_verified).toBe(true);
  });

  it("maps a failed Gmail refresh to email_not_configured and does not claim the mail was sent", async () => {
    const server = await start({}, new FakeWorker(), {
      mailer: {
        configured: true,
        async send() {
          throw new MailNotConfiguredError();
        },
      },
    });
    const account = await signUp(server);
    const result = await api(server, "/v1/auth/forgot-password", { method: "POST", json: { email: account.email } });
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe("email_not_configured");
    expect(result.body.status).toBeUndefined();
  });

  it("limits Free exports to txt and keeps the other formats on paid plans", async () => {
    const server = await start();
    const account = await signUp(server);
    const made = await api(server, "/v1/transcriptions", { method: "POST", headers: sessionHeaders(account), json: { url: sampleUrl("lllllllllll") } });
    const jobId = made.body.job_id as string;
    const txt = await api(server, `/v1/transcriptions/${jobId}/export`, { headers: { cookie: account.cookie } });
    expect(txt.status).toBe(200);
    expect(txt.headers.get("content-type")).toContain("text/plain");
    for (const format of ["md", "srt", "vtt", "json", "docx"]) {
      const refused = await api(server, `/v1/transcriptions/${jobId}/export?format=${format}`, { headers: { cookie: account.cookie } });
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe("plan_required");
    }
    const user = await server.ctx.stores.users.findByEmail(account.email);
    if (user === undefined) throw new Error("account missing");
    await server.ctx.stores.users.setPlan(user.id, "pro");
    const srt = await api(server, `/v1/transcriptions/${jobId}/export?format=srt`, { headers: { cookie: account.cookie } });
    expect(srt.status).toBe(200);
    expect(srt.headers.get("content-type")).toContain("subrip");
  });

  it("enforces OAuth scopes on transcribe and library, and lets one token with both scopes do both", async () => {
    const worker = new FakeWorker();
    const server = await start({}, worker);
    const account = await signUp(server);
    expect((await api(server, "/v1/me", { headers: { cookie: account.cookie } })).body.plan).toBe("free");

    const transcribeOnly = await issueAccessToken(server, account, "transcribe");
    const libraryOnly = await issueAccessToken(server, account, "library:read");
    const both = await issueAccessToken(server, account, "transcribe library:read");

    const libraryDenied = await api(server, "/v1/library", { headers: bearer(transcribeOnly) });
    expect(libraryDenied.status).toBe(403);
    expect(libraryDenied.body.error.code).toBe("insufficient_scope");
    expect((await api(server, "/v1/library", { headers: bearer(libraryOnly) })).status).toBe(200);

    const before = worker.requests.length;
    const deniedCall = await callTranscribe(server, libraryOnly);
    expect(deniedCall.output.error?.code).toBe("insufficient_scope");
    expect(worker.requests.length).toBe(before);

    const allowed = await callTranscribe(server, both);
    expect(allowed.output.status).toBe("completed");
    expect((await api(server, "/v1/library", { headers: bearer(both) })).status).toBe(200);
    expect((await api(server, "/v1/me", { headers: bearer(transcribeOnly) })).status).toBe(200);

    const key = await createKey(server, account);
    expect((await api(server, "/v1/library", { headers: bearer(key.key) })).status).toBe(200);
    const viaKey = await callTranscribe(server, key.key);
    expect(viaKey.output.status).toBe("completed");
  });

  it("revokes a grant from the signed-in session or from the bearer token itself", async () => {
    const server = await start();
    const account = await signUp(server);
    const clientId = await registerClient(server);
    const first = await issueAccessToken(server, account, "transcribe", clientId);
    const refresh = await lastRefresh(server, account, clientId);

    const noCsrf = await api(server, "/oauth/revoke", { method: "POST", headers: { cookie: account.cookie }, json: { client_id: clientId } });
    expect(noCsrf.status).toBe(403);

    const revoked = await api(server, "/oauth/revoke", { method: "POST", headers: sessionHeaders(account), json: { client_id: clientId } });
    expect(revoked.status).toBe(200);
    expect(revoked.body.revoked).toBe(true);
    expect((await api(server, "/v1/me", { headers: bearer(first) })).status).toBe(401);
    expect((await refreshGrant(server, clientId, refresh)).status).toBe(400);

    const second = await issueAccessToken(server, account, "transcribe", clientId);
    const self = await api(server, "/oauth/revoke", { method: "POST", headers: bearer(second) });
    expect(self.status).toBe(200);
    expect((await api(server, "/v1/me", { headers: bearer(second) })).status).toBe(401);
  });

  it("lists connected apps without tokens and revokes one by grant_id", async () => {
    const server = await start();
    expect((await api(server, "/v1/oauth/grants")).status).toBe(401);
    const account = await signUp(server);
    const access = await issueAccessToken(server, account, "transcribe library:read");
    const listed = await api(server, "/v1/oauth/grants", { headers: { cookie: account.cookie } });
    expect(listed.status).toBe(200);
    expect(listed.body.grants).toHaveLength(1);
    expect(listed.body.grants[0]).toMatchObject({ client_name: "ChatGPT", scope: "transcribe library:read" });
    expect(listed.body.grants[0].id).toMatch(/^oac_/);
    expect(listed.body.grants[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(listed.text).not.toContain(access);
    expect(listed.text).not.toMatch(/mso_|token_hash|secret/);

    const viaBearer = await api(server, "/v1/oauth/grants", { headers: bearer(access) });
    expect(viaBearer.body.grants).toEqual(listed.body.grants);

    const grantId = listed.body.grants[0].id as string;
    const revoked = await api(server, "/oauth/revoke", { method: "POST", headers: sessionHeaders(account), json: { grant_id: grantId } });
    expect(revoked.status).toBe(200);
    expect((await api(server, "/v1/oauth/grants", { headers: { cookie: account.cookie } })).body.grants).toEqual([]);
    expect((await api(server, "/v1/me", { headers: bearer(access) })).status).toBe(401);
  });
});

function tokenFrom(text: string): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (match?.[1] === undefined) throw new Error("mail did not include a token");
  return match[1];
}

function sessionFromLogin(result: { headers: Headers }, email: string): AccountSession {
  const setCookies = result.headers.getSetCookie();
  const session = setCookies.find((line) => line.startsWith("ms_session="))?.split(";")[0] ?? "";
  const csrf = setCookies.find((line) => line.startsWith("ms_csrf="))?.split(";")[0]?.slice("ms_csrf=".length) ?? "";
  const sessionValue = session.slice("ms_session=".length);
  return { email, password: "a different passphrase", cookie: `ms_session=${sessionValue}; ms_csrf=${csrf}`, csrf };
}

async function registerClient(server: RunningServer): Promise<string> {
  const registered = await api(server, "/oauth/register", {
    method: "POST",
    json: { client_name: "ChatGPT", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" },
  });
  expect(registered.status).toBe(201);
  return registered.body.client_id as string;
}

async function issueAccessToken(server: RunningServer, account: AccountSession, scope: string, clientId?: string): Promise<string> {
  const id = clientId ?? (await registerClient(server));
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const approved = await api(server, "/oauth/approve", {
    method: "POST",
    headers: sessionHeaders(account),
    json: {
      client_id: id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "state-1",
      scope,
    },
  });
  expect(approved.status).toBe(200);
  const code = new URL(approved.body.redirect_to as string).searchParams.get("code") ?? "";
  const token = await fetch(`${server.baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: id, code_verifier: verifier }),
  });
  const body = (await token.json()) as { access_token?: string };
  if (body.access_token === undefined) throw new Error("token was not issued");
  return body.access_token;
}

async function lastRefresh(server: RunningServer, account: AccountSession, clientId: string): Promise<string> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const approved = await api(server, "/oauth/approve", {
    method: "POST",
    headers: sessionHeaders(account),
    json: {
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "state-refresh",
      scope: "transcribe",
    },
  });
  const code = new URL(approved.body.redirect_to as string).searchParams.get("code") ?? "";
  const token = await fetch(`${server.baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }),
  });
  const body = (await token.json()) as { refresh_token?: string };
  if (body.refresh_token === undefined) throw new Error("refresh token was not issued");
  return body.refresh_token;
}

async function refreshGrant(server: RunningServer, clientId: string, refreshToken: string): Promise<{ status: number }> {
  const response = await fetch(`${server.baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
  });
  return { status: response.status };
}

async function callTranscribe(server: RunningServer, token: string): Promise<{ output: { status?: string; error?: { code?: string } } }> {
  const client = new Client({ name: "mutescroll-scope-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  try {
    const result = await client.callTool({ name: "transcribe_video", arguments: { url: sampleUrl("mmmmmmmmmmm") } });
    return { output: result.structuredContent as { status?: string; error?: { code?: string } } };
  } finally {
    await client.close();
  }
}
