/**
 * Copy and status mapping for the mail routes that already exist on the API.
 * Forgot-password answers 202 whether or not the address has an account.
 * 503 `email_not_configured` is a failure: the page must not say to check an inbox.
 */

export const FORGOT_PASSWORD_PATH = "/api/v1/auth/forgot-password";
export const RESET_PASSWORD_PATH = "/api/v1/auth/reset-password";
export const VERIFY_EMAIL_PATH = "/api/v1/auth/email/verification";
export const CONFIRM_EMAIL_PATH = "/api/v1/auth/email/verification/confirm";

export const INBOX_MESSAGE = "Check your inbox.";
export const MAIL_NOT_SENT_MESSAGE = "Mail could not be sent.";
export const CONNECTION_MESSAGE = "The connection failed. Try again.";
export const INVALID_LINK_MESSAGE = "This link is not valid or has expired.";
export const PASSWORD_MISMATCH_MESSAGE = "Enter the same password in both fields.";
export const PASSWORD_UPDATED_MESSAGE = "Your password is updated.";
export const EMAIL_CONFIRMED_MESSAGE = "Your email is confirmed.";

const GENERIC_FAILURE = "That did not work. Try again.";

export interface AuthPost {
  readonly status: number;
  readonly body: unknown;
}

export type MailSuccess = "inbox" | "reset" | "verified" | "already_verified";

export type MailResult = { readonly ok: true; readonly kind: MailSuccess } | { readonly ok: false; readonly message: string };

export function readMailError(body: unknown): { readonly code: string; readonly message: string } {
  const record = body !== null && typeof body === "object" ? (body as { error?: { code?: unknown; message?: unknown } }) : {};
  return {
    code: typeof record.error?.code === "string" ? record.error.code : "",
    message: typeof record.error?.message === "string" ? record.error.message : "",
  };
}

/** User-facing failure. Never an inbox line. */
export function mailFailureMessage(status: number, body: unknown): string {
  const error = readMailError(body);
  if (status === 503 && error.code === "email_not_configured") return MAIL_NOT_SENT_MESSAGE;
  if (error.message !== "") return error.message;
  return GENERIC_FAILURE;
}

export function forgotResult(status: number, body: unknown): MailResult {
  if (status === 202) return { ok: true, kind: "inbox" };
  return { ok: false, message: mailFailureMessage(status, body) };
}

export function resetResult(status: number, body: unknown): MailResult {
  if (status === 204) return { ok: true, kind: "reset" };
  return { ok: false, message: mailFailureMessage(status, body) };
}

export function confirmResult(status: number, body: unknown): MailResult {
  if (status === 200 && emailVerifiedBody(body)) return { ok: true, kind: "verified" };
  return { ok: false, message: mailFailureMessage(status, body) };
}

export function verificationRequestResult(status: number, body: unknown): MailResult {
  if (status === 200 && emailVerifiedBody(body)) return { ok: true, kind: "already_verified" };
  if (status === 202) return { ok: true, kind: "inbox" };
  return { ok: false, message: mailFailureMessage(status, body) };
}

export function emailVerifiedBody(body: unknown): boolean {
  return body !== null && typeof body === "object" && (body as { email_verified?: unknown }).email_verified === true;
}

export async function postAuthJson(path: string, payload: unknown): Promise<AuthPost> {
  const response = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  return { status: response.status, body: await readResponseBody(response) };
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
