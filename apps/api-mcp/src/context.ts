import { creditsForDuration } from "@mutescroll/shared";

import type { Config } from "./config.js";
import { JobRunner } from "./jobs/job-runner.js";
import type { JobStore } from "./jobs/job-store.js";
import { MemoryJobStore } from "./jobs/memory-job-store.js";
import { TranscriptionService } from "./jobs/transcription-service.js";
import { CreditQuota } from "./quota/credit-quota.js";
import { SlidingWindowLimiter } from "./quota/sliding-window.js";
import { UploadTokenStore } from "./upload/tokens.js";
import { buildWorkerEnv, SubprocessMediaWorker } from "./worker/subprocess-worker.js";
import type { MediaWorker } from "./worker/types.js";

/** Everything the HTTP routes and MCP tools need. Built once per process. */
export interface AppContext {
  readonly config: Config;
  readonly store: JobStore;
  readonly service: TranscriptionService;
  readonly quota: CreditQuota;
  readonly rateLimiter: SlidingWindowLimiter;
  readonly uploads: UploadTokenStore;
  readonly now: () => number;
}

export interface ContextOverrides {
  /** Defaults to the subprocess worker. Tests inject a fake. */
  readonly worker?: MediaWorker;
  readonly now?: () => number;
}

const RATE_WINDOW_MS = 60_000;

export function createContext(config: Config, overrides: ContextOverrides = {}): AppContext {
  const now = overrides.now ?? Date.now;
  const worker =
    overrides.worker ??
    new SubprocessMediaWorker({
      python: config.worker.python,
      cwd: config.worker.cwd,
      timeoutMs: config.worker.timeoutMs,
      env: buildWorkerEnv(process.env),
    });

  const store = new MemoryJobStore({ ttl: config.jobTtl, now });
  const quota = new CreditQuota({ allowance: config.anonCredits, windowMs: config.anonQuotaWindowMs, now });
  const uploads = new UploadTokenStore({ ttlMs: config.uploadTokenTtlMs, now });
  const runner = new JobRunner({
    store,
    worker,
    concurrency: config.jobConcurrency,
    maxSeconds: config.mediaMaxSeconds,
    creditsFor: (transcript) => creditsForDuration(Math.max(0, transcript.source.duration_seconds ?? 0)),
    onSettled: (job, creditsCharged) => quota.settle(job.ownerKey, creditsCharged),
  });
  const service = new TranscriptionService({
    store,
    runner,
    quota,
    uploads,
    now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  const rateLimiter = new SlidingWindowLimiter({
    limit: config.anonRequestsPerMinute,
    windowMs: RATE_WINDOW_MS,
    now,
  });
  return { config, store, service, quota, rateLimiter, uploads, now };
}

/** Periodic cleanup of expired jobs, tokens, quota ledgers and rate-limit buckets. */
export async function runMaintenance(ctx: AppContext): Promise<void> {
  await ctx.store.pruneExpired();
  ctx.uploads.prune();
  ctx.quota.prune();
  ctx.rateLimiter.prune();
}
