import { describe, expect, it } from "vitest";

import { MemoryAuthTokenStore, newAuthToken } from "../../src/accounts/auth-tokens.js";
import { hashSecret } from "../../src/accounts/secrets.js";
import { loadConfig } from "../../src/config.js";
import { GMAIL_SEND_SCOPE, MailNotConfiguredError, createMailer } from "../../src/mail/gmail.js";

const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";
const REFRESH_TOKEN = "test-refresh-token";

describe("Gmail mailer configuration", () => {
  it("stays unconfigured unless all three Gmail OAuth names are set", () => {
    expect(createMailer(loadConfig({}, "linux")).configured).toBe(false);
    expect(createMailer(loadConfig({ GMAIL_OAUTH_CLIENT_ID: CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET: CLIENT_SECRET }, "linux")).configured).toBe(false);
    expect(
      createMailer(
        loadConfig(
          { GMAIL_OAUTH_CLIENT_ID: CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET: CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN: REFRESH_TOKEN },
          "linux",
        ),
      ).configured,
    ).toBe(true);
  });

  it("refreshes an access token at send time and does not put tokens in errors", async () => {
    const calls: Array<{ url: string; body: string; authorization: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : "";
      calls.push({ url, body, authorization: new Headers(init?.headers).get("authorization") ?? "" });
      if (url.endsWith("/token")) return new Response(JSON.stringify({ access_token: "ya29.test-access" }), { status: 200 });
      return new Response("{}", { status: 200 });
    };
    const mailer = createMailer(
      loadConfig({ GMAIL_OAUTH_CLIENT_ID: CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET: CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN: REFRESH_TOKEN }, "linux"),
      fetchImpl,
    );
    await mailer.send({ to: "ada@example.test", subject: "Confirm", text: "hello" });
    const refresh = calls[0];
    const send = calls[1];
    expect(refresh?.url).toBe("https://oauth2.googleapis.com/token");
    expect(refresh?.body).toContain("grant_type=refresh_token");
    expect(refresh?.body).toContain(encodeURIComponent(GMAIL_SEND_SCOPE));
    expect(send?.authorization).toBe("Bearer ya29.test-access");
    expect(send?.body).not.toContain(REFRESH_TOKEN);
    const raw = JSON.parse(send?.body ?? "{}") as { raw?: string };
    const message = Buffer.from(raw.raw ?? "", "base64url").toString("utf8");
    expect(message).toContain("From: mutescroll.xyz@gmail.com");
    expect(message).toContain("To: ada@example.test");
    expect(message).not.toContain(REFRESH_TOKEN);
    expect(message).not.toContain("ya29.test-access");
  });

  it("maps a failed refresh to email_not_configured without echoing the response", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ error: REFRESH_TOKEN }), { status: 400 });
    const mailer = createMailer(
      loadConfig({ GMAIL_OAUTH_CLIENT_ID: CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET: CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN: REFRESH_TOKEN }, "linux"),
      fetchImpl,
    );
    try {
      await mailer.send({ to: "ada@example.test", subject: "Reset", text: "hello" });
      throw new Error("expected MailNotConfiguredError");
    } catch (error) {
      expect(error).toBeInstanceOf(MailNotConfiguredError);
      expect((error as Error).message).toBe("email_not_configured");
      expect((error as Error).message).not.toContain(REFRESH_TOKEN);
    }
  });
});

describe("auth tokens", () => {
  it("stores only a hash and accepts the token once", async () => {
    const store = new MemoryAuthTokenStore();
    const token = newAuthToken();
    await store.save({ tokenHash: hashSecret(token), userId: "usr_1", purpose: "reset_password", expiresAt: 50 });
    expect(await store.take(token, "reset_password", 1)).toBeUndefined();
    expect((await store.take(hashSecret(token), "reset_password", 1))?.userId).toBe("usr_1");
    expect(await store.take(hashSecret(token), "reset_password", 1)).toBeUndefined();
  });
});
