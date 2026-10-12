import type { Config } from "../config.js";

/** Gmail send scope. The refresh request asks for this and nothing else. */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const SENDER = "mutescroll.xyz@gmail.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export interface OutboundMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface Mailer {
  readonly configured: boolean;
  send(mail: OutboundMail): Promise<void>;
}

/** Missing Gmail env, or the refresh call did not return an access token. */
export class MailNotConfiguredError extends Error {
  constructor() {
    super("email_not_configured");
    this.name = "MailNotConfiguredError";
  }
}

/** Gmail accepted the refresh but rejected the send. The message never includes a body or token. */
export class MailDeliveryError extends Error {
  constructor() {
    super("email delivery failed");
    this.name = "MailDeliveryError";
  }
}

export function createMailer(config: Config, fetchImpl: typeof fetch = fetch): Mailer {
  const { clientId, clientSecret, refreshToken } = config.gmail;
  if (clientId === undefined || clientSecret === undefined || refreshToken === undefined) {
    return unconfiguredMailer();
  }
  return new GmailMailer(clientId, clientSecret, refreshToken, fetchImpl);
}

function unconfiguredMailer(): Mailer {
  return {
    configured: false,
    async send() {
      throw new MailNotConfiguredError();
    },
  };
}

class GmailMailer implements Mailer {
  readonly configured = true;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshToken: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async send(mail: OutboundMail): Promise<void> {
    const accessToken = await this.refreshAccessToken();
    const response = await this.fetchImpl(SEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw: Buffer.from(rfc822(mail), "utf8").toString("base64url") }),
    });
    await response.arrayBuffer().catch(() => undefined);
    if (!response.ok) throw new MailDeliveryError();
  }

  private async refreshAccessToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
      scope: GMAIL_SEND_SCOPE,
    });
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      throw new MailNotConfiguredError();
    }
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      throw new MailNotConfiguredError();
    }
    const accessToken = asRecord(payload)?.["access_token"];
    if (typeof accessToken !== "string" || accessToken === "") throw new MailNotConfiguredError();
    return accessToken;
  }
}

function rfc822(mail: OutboundMail): string {
  const subject = mail.subject.replace(/[\r\n]/g, "");
  return [`From: ${SENDER}`, `To: ${mail.to}`, `Subject: ${subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", mail.text].join(
    "\r\n",
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
