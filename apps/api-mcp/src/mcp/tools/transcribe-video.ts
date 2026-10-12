import { parseVideoUrl } from "@mutescroll/shared";

import type { AppContext } from "../../context.js";
import { jobOutput } from "../job-output.js";
import { failureOutput } from "../output.js";
import type { ToolOutput } from "../schemas.js";

export interface TranscribeArgs {
  readonly url: string;
  readonly language?: string | undefined;
}

const POLL_INTERVAL_MS = 250;
const LANGUAGE_PATTERN = /^(auto|[a-z]{2})$/;

export function normalizeLanguage(raw: string | undefined): string | null {
  const value = (raw ?? "auto").trim().toLowerCase();
  return LANGUAGE_PATTERN.test(value) ? value : null;
}

/**
 * `transcribe_video`: validate first (no work for bad input), then rate-limit, then dedupe or start a job.
 * Waits up to `toolWaitMs` for a result; otherwise returns `processing` with a job_id.
 */
export async function runTranscribeVideo(ctx: AppContext, clientKey: string, args: TranscribeArgs): Promise<ToolOutput> {
  const plansUrl = ctx.config.plansUrl;

  const parsed = parseVideoUrl(args.url);
  if (!parsed.ok) return failureOutput(parsed.code, { plansUrl });

  const language = normalizeLanguage(args.language);
  if (language === null) return failureOutput("invalid_language", { plansUrl });

  const limit = ctx.rateLimiter.hit(clientKey);
  if (!limit.allowed) {
    return failureOutput("rate_limited", { plansUrl, retryAfterSeconds: Math.ceil(limit.retryAfterMs / 1000) });
  }

  const outcome = await ctx.service.request({ canonicalUrl: parsed.canonicalUrl, language, ownerKey: clientKey });
  if (outcome.kind === "quota_exceeded") {
    return failureOutput("quota_exceeded", { plansUrl, resetsAt: new Date(outcome.resetAt) });
  }

  const latest = await ctx.service.waitForSettled(outcome.job.id, ctx.config.toolWaitMs, POLL_INTERVAL_MS);
  return jobOutput(ctx, latest ?? outcome.job, ctx.quota.remaining(clientKey));
}
