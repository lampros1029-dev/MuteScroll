import type { Caller } from "../caller.js";
import type { AppContext } from "../context.js";
import type { Job } from "../jobs/types.js";
import { uploadUrlFor } from "../mcp/job-output.js";
import { offersUpload } from "../mcp/messages.js";
import { failureError, type ApiError, type FailureContext } from "./errors.js";

function contextFor(ctx: AppContext, caller: Caller): FailureContext {
  return { plansUrl: ctx.config.plansUrl, payer: caller.kind };
}

/** 402 for accounts out of credits, 429 for anonymous callers out of quota (PRD 13). */
export function quotaExceeded(ctx: AppContext, caller: Caller, resetAt: number): ApiError {
  return failureError("quota_exceeded", {
    ...contextFor(ctx, caller),
    resetsAt: new Date(resetAt),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - ctx.now()) / 1000)),
  });
}

export function rateLimited(ctx: AppContext, caller: Caller, retryAfterMs: number): ApiError {
  return failureError("rate_limited", {
    ...contextFor(ctx, caller),
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  });
}

/** The error for a failed job. Retrieval failures carry a single-use upload link; nothing else does. */
export function jobFailure(ctx: AppContext, caller: Caller, job: Job): ApiError {
  const code = job.failure ?? "worker_failed";
  const uploadUrl = offersUpload(code) ? uploadUrlFor(ctx, job.id) : undefined;
  return failureError(code, { ...contextFor(ctx, caller), uploadUrl });
}

export function invalidLanguage(ctx: AppContext): ApiError {
  return failureError("invalid_language", { plansUrl: ctx.config.plansUrl, payer: "anonymous" });
}
