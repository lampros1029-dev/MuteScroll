import { describe, expect, it } from "vitest";

import { ApiError, errorBody, failureError, statusFor, type ApiErrorCode } from "../../src/api/errors.js";
import { copyFor, offersUpload, type ToolErrorCode } from "../../src/mcp/messages.js";
import { WORKER_ERROR_CODES } from "../../src/worker/types.js";

const PLANS = "https://mutescroll.xyz/plans";
const UPLOAD = "https://api.example.test/upload/abcdefghijklmnopqrstu";

describe("status codes (docs/rest-api.md)", () => {
  it.each([
    ["invalid_url", 400],
    ["unsupported_url", 400],
    ["unsafe_url", 400],
    ["invalid_language", 400],
    ["invalid_request", 400],
    ["unauthorized", 401],
    ["invalid_credentials", 401],
    ["forbidden", 403],
    ["csrf_failed", 403],
    ["not_found", 404],
    ["method_not_allowed", 405],
    ["email_taken", 409],
    ["not_ready", 409],
    ["job_failed", 409],
    ["too_large", 413],
    ["too_long", 413],
    ["unsupported_media_type", 415],
    ["unsupported_file_type", 415],
    ["no_speech", 422],
    ["media_error", 422],
    ["rate_limited", 429],
    ["retrieval_failed", 502],
    ["blocked_bot_check", 502],
    ["asr_error", 502],
    ["internal", 500],
  ] as Array<[ApiErrorCode, number]>)("%s is %i", (code, status) => {
    expect(statusFor(code)).toBe(status);
  });

  it("answers 402 for accounts out of credits and 429 for anonymous callers out of quota", () => {
    expect(statusFor("quota_exceeded", "account")).toBe(402);
    expect(statusFor("quota_exceeded", "anonymous")).toBe(429);
  });
});

describe("failureError", () => {
  it("collapses every worker-internal code to `internal` with no upload link", () => {
    const internal: ToolErrorCode[] = ["worker_timeout", "worker_failed", "worker_unavailable", "worker_misconfigured", "invalid_output", "file_not_found"];
    for (const code of internal) {
      const error = failureError(code, { plansUrl: PLANS, payer: "account", uploadUrl: UPLOAD });
      expect(error.code).toBe("internal");
      expect(error.status).toBe(500);
      expect(error.uploadUrl).toBeUndefined();
      expect(error.message).not.toContain(code);
    }
  });

  it("offers the upload link for retrieval failures only", () => {
    const retrieval = failureError("private_or_login_required", { plansUrl: PLANS, payer: "account", uploadUrl: UPLOAD });
    expect(retrieval.uploadUrl).toBe(UPLOAD);
    expect(retrieval.status).toBe(502);
    const content = failureError("no_speech", { plansUrl: PLANS, payer: "account", uploadUrl: UPLOAD });
    expect(content.uploadUrl).toBeUndefined();
    expect(content.status).toBe(422);
  });

  it("uses the shared PRD 13 copy and the plans link for quota errors", () => {
    const error = failureError("quota_exceeded", { plansUrl: PLANS, payer: "account", resetsAt: new Date("2026-11-01T00:00:00Z") });
    expect(error.status).toBe(402);
    expect(error.message).toContain(PLANS);
    expect(error.message).toContain("Sun, 01 Nov 2026 00:00:00 GMT");
    expect(error.message).toBe(copyFor("quota_exceeded", { plansUrl: PLANS, resetsAt: new Date("2026-11-01T00:00:00Z") }).message);
  });

  it("sends Retry-After with rate limits and quota refusals", () => {
    const limited = failureError("rate_limited", { plansUrl: PLANS, payer: "anonymous", retryAfterSeconds: 42 });
    expect(limited.status).toBe(429);
    expect(limited.headers).toEqual({ "retry-after": "42" });
    expect(limited.message).toContain("42 seconds");
  });

  it("gives every code a status and a message, with nothing that looks like a stack trace", () => {
    const codes: ToolErrorCode[] = [
      "invalid_url",
      "unsupported_url",
      "unsafe_url",
      "invalid_language",
      "rate_limited",
      "quota_exceeded",
      "not_found",
      ...WORKER_ERROR_CODES,
    ];
    for (const code of codes) {
      const error = failureError(code, { plansUrl: PLANS, payer: "anonymous" });
      expect(error.status).toBeGreaterThanOrEqual(400);
      expect(error.message.length).toBeGreaterThan(10);
      expect(error.message).not.toMatch(/stack|Traceback|Error:/i);
    }
  });

  it("only offers an upload for codes that the MCP tools also offer one for", () => {
    expect(offersUpload("blocked_bot_check")).toBe(true);
    expect(offersUpload("no_speech")).toBe(false);
  });
});

describe("errorBody and ApiError", () => {
  it("returns code and message, plus upload_url only when there is one", () => {
    expect(errorBody(new ApiError(400, "invalid_request", "Bad."))).toEqual({ code: "invalid_request", message: "Bad." });
    expect(errorBody(new ApiError(502, "retrieval_failed", "Retry.", UPLOAD))).toEqual({
      code: "retrieval_failed",
      message: "Retry.",
      upload_url: UPLOAD,
    });
  });

  it("names itself and never carries a stack in its body", () => {
    const error = new ApiError(500, "internal", "Something went wrong.");
    expect(error.name).toBe("ApiError");
    expect(JSON.stringify({ error: errorBody(error) })).not.toMatch(/at Object|\.ts:|\.js:/);
  });
});
