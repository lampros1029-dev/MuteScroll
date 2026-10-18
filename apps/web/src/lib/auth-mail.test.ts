import { describe, expect, it } from "vitest";

import {
  INBOX_MESSAGE,
  MAIL_NOT_SENT_MESSAGE,
  confirmResult,
  forgotResult,
  resetResult,
  verificationRequestResult,
} from "./auth-mail";

const configured = { error: { code: "email_not_configured", message: "Email is not configured." } };
const invalid = { error: { code: "invalid_request", message: "This link is not valid or has expired." } };

describe("auth mail responses", () => {
  it("treats every forgot-password 202 as the same inbox reply", () => {
    expect(forgotResult(202, { status: "accepted" })).toEqual({ ok: true, kind: "inbox" });
    expect(forgotResult(202, undefined)).toEqual({ ok: true, kind: "inbox" });
    expect(INBOX_MESSAGE).toBe("Check your inbox.");
    expect(INBOX_MESSAGE).not.toMatch(/sent|exist|not found/i);
  });

  it("does not claim mail was sent when the mailer is not configured", () => {
    expect(forgotResult(503, configured)).toEqual({ ok: false, message: MAIL_NOT_SENT_MESSAGE });
    expect(verificationRequestResult(503, configured)).toEqual({ ok: false, message: MAIL_NOT_SENT_MESSAGE });
    expect(MAIL_NOT_SENT_MESSAGE).toBe("Mail could not be sent.");
  });

  it("keeps other API failures and does not turn them into an inbox reply", () => {
    expect(forgotResult(400, { error: { code: "invalid_request", message: "Enter a valid email address." } })).toEqual({
      ok: false,
      message: "Enter a valid email address.",
    });
    expect(forgotResult(502, { error: { code: "unavailable", message: "Email could not be sent. Try again in a few minutes." } })).toEqual({
      ok: false,
      message: "Email could not be sent. Try again in a few minutes.",
    });
    expect(forgotResult(500, {})).toEqual({ ok: false, message: "That did not work. Try again." });
  });

  it("accepts a reset only on 204 and a confirmation only when the address is verified", () => {
    expect(resetResult(204, undefined)).toEqual({ ok: true, kind: "reset" });
    expect(resetResult(400, invalid)).toEqual({ ok: false, message: "This link is not valid or has expired." });
    expect(confirmResult(200, { email_verified: true })).toEqual({ ok: true, kind: "verified" });
    expect(confirmResult(200, { status: "accepted" }).ok).toBe(false);
    expect(verificationRequestResult(202, { status: "accepted" })).toEqual({ ok: true, kind: "inbox" });
    expect(verificationRequestResult(200, { email_verified: true })).toEqual({ ok: true, kind: "already_verified" });
  });
});
