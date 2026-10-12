import type { IncomingMessage, ServerResponse } from "node:http";

import { parseVideoUrl } from "@mutescroll/shared";

import { rateKeyFor, viewerOf } from "../caller.js";
import { transcribeLimiterFor, type AppContext } from "../context.js";
import type { PlanId } from "../billing/plans.js";
import { EXPORT_FORMATS, parseExportFormat, renderExport, type ExportFormat } from "../export/formatters.js";
import { normalizeLanguage } from "../jobs/language.js";
import type { Job } from "../jobs/types.js";
import { sendJson } from "../http/respond.js";
import { objectBody, readJsonRequest, requiredString } from "./body.js";
import { ApiError, errorBody, failureError } from "./errors.js";
import { invalidLanguage, jobFailure, quotaExceeded, rateLimited } from "./failures.js";
import { callerOf, identify, requireCsrf, requireOauthScope, type Requester } from "./identity.js";
import { sendDownload, sendNoContent } from "./send.js";
import { transcriptionView } from "./views.js";

const POLL_INTERVAL_MS = 250;
const NOT_FOUND = "No transcription was found for that job_id. It may have expired.";

/** POST /v1/transcriptions: starts (or joins) a transcription and waits up to TOOL_WAIT_MS for it. */
export async function createTranscription(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const requester = await identify(req, res, ctx, { allowSession: true });
  requireCsrf(req, requester);
  requireOauthScope(requester, "transcribe");
  const body = objectBody(await readJsonRequest(req, ctx.config.jsonMaxBodyBytes), ["url", "language"]);
  const caller = callerOf(requester);

  const parsed = parseVideoUrl(requiredString(body, "url", 2048));
  if (!parsed.ok) throw failureError(parsed.code, { plansUrl: ctx.config.plansUrl, payer: caller.kind });
  const language = languageField(body.language);
  if (language === null) throw invalidLanguage(ctx);

  const limit = transcribeLimiterFor(ctx, caller).hit(rateKeyFor(caller));
  if (!limit.allowed) throw rateLimited(ctx, caller, limit.retryAfterMs);

  const outcome = await ctx.service.request({ canonicalUrl: parsed.canonicalUrl, platform: parsed.platform, language, caller });
  if (outcome.kind === "quota_exceeded") throw quotaExceeded(ctx, caller, outcome.resetAt);
  const job = (await ctx.service.waitForSettled(outcome.job.id, ctx.config.toolWaitMs, POLL_INTERVAL_MS)) ?? outcome.job;
  if (job.status === "failed") throw jobFailure(ctx, caller, job);
  sendJobState(res, job);
}

/** GET /v1/transcriptions/:job_id. A failed job answers 200 with a `failed` status, as documented. */
export async function getTranscription(req: IncomingMessage, res: ServerResponse, ctx: AppContext, jobId: string): Promise<void> {
  const requester = await identify(req, res, ctx, { allowSession: true });
  const job = await visibleJob(ctx, requester, jobId);
  if (job.status === "failed") {
    const error = jobFailure(ctx, callerOf(requester), job);
    return sendJson(res, 200, { status: "failed", error: errorBody(error) });
  }
  sendJobState(res, job);
}

/** DELETE /v1/transcriptions/:job_id. Running jobs cannot be deleted yet. */
export async function deleteTranscription(req: IncomingMessage, res: ServerResponse, ctx: AppContext, jobId: string): Promise<void> {
  const requester = await identify(req, res, ctx, { allowSession: true });
  requireCsrf(req, requester);
  const outcome = await ctx.service.deleteJob(jobId, viewerOf(callerOf(requester)));
  switch (outcome) {
    case "deleted":
      return sendNoContent(res);
    case "not_found":
      throw new ApiError(404, "not_found", NOT_FOUND);
    case "in_progress":
      throw new ApiError(409, "not_ready", "This transcription is still running. Delete it when it has finished.");
    default: {
      const unreachable: never = outcome;
      throw new Error(`Unhandled delete outcome: ${String(unreachable)}`);
    }
  }
}

/** GET /v1/transcriptions/:job_id/export?format=txt|md|srt|vtt|json|docx (txt when omitted). */
export async function exportTranscription(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  jobId: string,
  query: URLSearchParams,
): Promise<void> {
  const requester = await identify(req, res, ctx, { allowSession: true });
  const job = await visibleJob(ctx, requester, jobId);
  const format = parseExportFormat(query.get("format") ?? undefined);
  if (format === null) throw new ApiError(400, "invalid_request", `format must be one of ${EXPORT_FORMATS.join(", ")}.`);
  if (job.status === "failed") throw new ApiError(409, "job_failed", "This transcription failed, so there is nothing to export.");
  if (job.status !== "succeeded" || job.result === null) throw new ApiError(409, "not_ready", "This transcription is not ready yet.");
  if (requester.kind === "account" && !exportAllowed(requester.user.plan, format)) {
    throw new ApiError(403, "plan_required", "The Free plan can export plain text only.");
  }
  const rendered = renderExport(format, transcriptionView(job.result, job.creditsCharged));
  sendDownload(res, rendered.body, rendered.contentType, `transcript-${job.id}.${format}`, rendered.encoding);
}

async function visibleJob(ctx: AppContext, requester: Requester, jobId: string): Promise<Job> {
  const job = await ctx.service.getVisible(jobId, viewerOf(callerOf(requester)));
  if (job === undefined) throw new ApiError(404, "not_found", NOT_FOUND);
  return job;
}

function exportAllowed(plan: PlanId, format: ExportFormat): boolean {
  if (format === "txt") return true;
  switch (plan) {
    case "free":
      return false;
    case "creator":
    case "pro":
    case "team":
      return true;
    default: {
      const unreachable: never = plan;
      return unreachable;
    }
  }
}

/** The `language` field: absent means auto. Returns null for anything that is not `auto` or an ISO 639-1 code. */
function languageField(value: unknown): string | null {
  if (value === undefined) return normalizeLanguage(undefined);
  return typeof value === "string" ? normalizeLanguage(value) : null;
}

/** 200 with the transcription when done, 202 while it runs. */
function sendJobState(res: ServerResponse, job: Job): void {
  if (job.status === "succeeded" && job.result !== null) {
    sendJson(res, 200, { status: "completed", job_id: job.id, transcription: transcriptionView(job.result, job.creditsCharged) });
    return;
  }
  sendJson(res, 202, { status: "processing", job_id: job.id });
}
