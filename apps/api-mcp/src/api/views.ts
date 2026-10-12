import type { ApiKeyRecord, UserRecord } from "../accounts/types.js";
import type { PlanDefinition } from "../billing/plans.js";
import type { Transcription } from "../export/model.js";
import type { JobSummary } from "../jobs/types.js";
import type { WorkerTranscript } from "../worker/transcript-schema.js";

export function isoTime(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

export interface CreditsView {
  readonly remaining: number;
  readonly resetsAt: number;
}

/** GET /v1/me, also returned by sign-up and log-in. */
export function meView(user: UserRecord, credits: CreditsView) {
  return {
    email: user.email,
    email_verified: user.emailVerifiedAt !== null,
    plan: user.plan,
    credits: { remaining: credits.remaining, resets_at: isoTime(credits.resetsAt) },
    created_at: isoTime(user.createdAt),
  };
}

/** The REST Transcription object: the worker result, with its `source` block exposed as `metadata`. */
export function transcriptionView(result: WorkerTranscript, creditsCharged: number): Transcription {
  return {
    metadata: {
      platform: result.source.platform,
      content_type: result.source.content_type ?? null,
      title: result.source.title ?? null,
      author: result.source.author ?? null,
      duration_seconds: result.source.duration_seconds ?? null,
    },
    language: result.language ?? null,
    method: result.method,
    transcript_text: result.transcript_text,
    segments: result.segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      speaker: segment.speaker ?? null,
      text: segment.text,
    })),
    uncertain_spans: result.uncertain_spans,
    on_screen_references: result.on_screen_references,
    credits_charged: creditsCharged,
  };
}

export function libraryItemView(item: JobSummary) {
  return {
    id: item.id,
    title: item.title,
    platform: item.platform,
    created_at: isoTime(item.createdAt),
    status: item.status,
  };
}

export function apiKeyView(record: ApiKeyRecord) {
  return {
    id: record.id,
    prefix: record.prefix,
    created_at: isoTime(record.createdAt),
    last_used_at: record.lastUsedAt === null ? null : isoTime(record.lastUsedAt),
  };
}

export function planView(plan: PlanDefinition) {
  return {
    id: plan.id,
    name: plan.name,
    monthly_credits: plan.monthlyCredits,
    max_video_minutes: Math.round(plan.maxVideoSeconds / 60),
    price_usd_monthly: plan.priceUsdMonthly,
  };
}
