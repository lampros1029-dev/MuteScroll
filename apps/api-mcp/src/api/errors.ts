import type { OutgoingHttpHeaders, ServerResponse } from "node:http";

import { sendJson } from "../http/respond.js";
import { copyFor, type ToolErrorCode } from "../mcp/messages.js";

/** Account and request problems. Failure codes are reused from the MCP tool set (PRD 13). */
export type AuthErrorCode = "unauthorized" | "invalid_credentials" | "forbidden" | "csrf_failed" | "email_taken";

export type RequestErrorCode =
  | "invalid_request"
  | "unsupported_media_type"
  | "unsupported_file_type"
  | "too_large"
  | "method_not_allowed"
  | "not_found"
  | "not_ready"
  | "job_failed"
  | "internal";

export type FailureErrorCode =
  | "invalid_url"
  | "unsupported_url"
  | "unsafe_url"
  | "invalid_language"
  | "blocked"
  | "too_long"
  | "rate_limited"
  | "quota_exceeded"
  | "retrieval_failed"
  | "private_or_login_required"
  | "blocked_bot_check"
  | "unavailable"
  | "drm_protected"
  | "live_stream"
  | "no_audio_track"
  | "no_speech"
  | "media_error"
  | "asr_error";

export type ApiErrorCode = AuthErrorCode | RequestErrorCode | FailureErrorCode;

/** Worker-internal codes are never shown: they collapse to `internal` (PRD 13). */
const CODE_FOR_TOOL_ERROR: Record<ToolErrorCode, ApiErrorCode> = {
  invalid_url: "invalid_url",
  unsupported_url: "unsupported_url",
  unsafe_url: "unsafe_url",
  invalid_language: "invalid_language",
  rate_limited: "rate_limited",
  quota_exceeded: "quota_exceeded",
  not_found: "not_found",
  blocked_bot_check: "blocked_bot_check",
  private_or_login_required: "private_or_login_required",
  retrieval_failed: "retrieval_failed",
  unavailable: "unavailable",
  drm_protected: "drm_protected",
  live_stream: "live_stream",
  too_long: "too_long",
  no_audio_track: "no_audio_track",
  no_speech: "no_speech",
  blocked: "blocked",
  media_error: "media_error",
  asr_error: "asr_error",
  file_not_found: "internal",
  worker_misconfigured: "internal",
  worker_timeout: "internal",
  worker_unavailable: "internal",
  worker_failed: "internal",
  invalid_output: "internal",
};

/** Status per code. Quota is special-cased in `statusFor`: 402 for accounts, 429 for anonymous callers. */
const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  invalid_credentials: 401,
  forbidden: 403,
  csrf_failed: 403,
  email_taken: 409,
  invalid_request: 400,
  unsupported_media_type: 415,
  unsupported_file_type: 415,
  too_large: 413,
  method_not_allowed: 405,
  not_found: 404,
  not_ready: 409,
  job_failed: 409,
  internal: 500,
  invalid_url: 400,
  unsupported_url: 400,
  unsafe_url: 400,
  invalid_language: 400,
  blocked: 400,
  too_long: 413,
  rate_limited: 429,
  quota_exceeded: 402,
  retrieval_failed: 502,
  private_or_login_required: 502,
  blocked_bot_check: 502,
  unavailable: 502,
  asr_error: 502,
  drm_protected: 422,
  live_stream: 422,
  no_audio_track: 422,
  no_speech: 422,
  media_error: 422,
};

export type Payer = "account" | "anonymous";

export function statusFor(code: ApiErrorCode, payer: Payer = "account"): number {
  if (code === "quota_exceeded") return payer === "account" ? 402 : 429;
  return STATUS[code];
}

/** A failure the REST API returns as `{ error: { code, message, upload_url? } }`. Messages are safe to show. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly uploadUrl?: string,
    readonly headers: OutgoingHttpHeaders = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface FailureContext {
  readonly plansUrl: string;
  readonly payer: Payer;
  /** Single-use link to continue a retrieval failure with an upload (PRD 14). */
  readonly uploadUrl?: string;
  readonly resetsAt?: Date;
  readonly retryAfterSeconds?: number;
}

/** Maps a transcription or URL failure to its API error, using the shared PRD 13 copy. */
export function failureError(code: ToolErrorCode, context: FailureContext): ApiError {
  const copy = copyFor(code, {
    plansUrl: context.plansUrl,
    ...(context.resetsAt === undefined ? {} : { resetsAt: context.resetsAt }),
    ...(context.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: context.retryAfterSeconds }),
  });
  const apiCode = CODE_FOR_TOOL_ERROR[code];
  const headers: OutgoingHttpHeaders = context.retryAfterSeconds === undefined ? {} : { "retry-after": String(context.retryAfterSeconds) };
  return new ApiError(
    statusFor(apiCode, context.payer),
    apiCode,
    copy.message,
    copy.offerUpload ? context.uploadUrl : undefined,
    headers,
  );
}

export function internalError(): ApiError {
  return new ApiError(500, "internal", "Something went wrong on our side. Please try again in a few minutes.");
}

/** The `error` member of every REST error body. */
export function errorBody(error: ApiError): { code: ApiErrorCode; message: string; upload_url?: string } {
  return {
    code: error.code,
    message: error.message,
    ...(error.uploadUrl === undefined ? {} : { upload_url: error.uploadUrl }),
  };
}

export function sendApiError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, { error: errorBody(error) }, error.headers);
}
