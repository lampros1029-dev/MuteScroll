import { creditsForDuration } from "@mutescroll/shared";

import type { Caller } from "./caller.js";
import type { Config } from "./config.js";
import { applyDueDowngrades } from "./billing/apply-subscription.js";
import { Billing } from "./billing/billing.js";
import { createBillingProvider } from "./billing/create-provider.js";
import type { BillingProvider } from "./billing/provider.js";
import { JobRunner } from "./jobs/job-runner.js";
import type { JobStore } from "./jobs/job-store.js";
import { TranscriptionService } from "./jobs/transcription-service.js";
import { CreditQuota } from "./quota/credit-quota.js";
import { SlidingWindowLimiter } from "./quota/sliding-window.js";
import { createMailer, type Mailer } from "./mail/gmail.js";
import { createStores, type Stores } from "./stores.js";
import { UploadTokenStore } from "./upload/tokens.js";
import { buildWorkerEnv, SubprocessMediaWorker } from "./worker/subprocess-worker.js";
import type { MediaWorker } from "./worker/types.js";

/** Everything the HTTP routes and MCP tools need. Built once per process. */
export interface AppContext {
  readonly config: Config;
  readonly stores: Stores;
  readonly store: JobStore;
  readonly service: TranscriptionService;
  readonly quota: CreditQuota;
  readonly billing: Billing;
  readonly billingProvider: BillingProvider;
  /** Transcribe calls per anonymous client per minute. */
  readonly rateLimiter: SlidingWindowLimiter;
  /** Transcribe calls per account per minute. */
  readonly accountRateLimiter: SlidingWindowLimiter;
  readonly signupLimiter: SlidingWindowLimiter;
  readonly loginLimiter: SlidingWindowLimiter;
  readonly mailLimiter: SlidingWindowLimiter;
  readonly mailer: Mailer;
  readonly uploads: UploadTokenStore;
  readonly now: () => number;
  close(): Promise<void>;
}

export interface ContextOverrides {
  /** Defaults to the subprocess worker. Tests inject a fake. */
  readonly worker?: MediaWorker;
  readonly now?: () => number;
  /** Defaults to stores chosen by DATABASE_URL. Tests inject memory or throwaway-schema Postgres stores. */
  readonly stores?: Stores;
  /** Defaults to Paddle when PADDLE_API_KEY is set, otherwise the in-memory fake. */
  readonly billingProvider?: BillingProvider;
  /** Defaults to Gmail when all three GMAIL_OAUTH_* names are set. */
  readonly mailer?: Mailer;
}

const RATE_WINDOW_MS = 60_000;
const HOUR_MS = 60 * 60 * 1000;

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

  const stores = overrides.stores ?? createStores(config, now);
  const quota = new CreditQuota({ allowance: config.anonCredits, windowMs: config.anonQuotaWindowMs, now });
  const billing = new Billing({ quota, ledger: stores.ledger, now });
  const billingProvider = overrides.billingProvider ?? createBillingProvider(config, fetch, stores.billingLinks);
  const uploads = new UploadTokenStore({ ttlMs: config.uploadTokenTtlMs, now });
  const runner = new JobRunner({
    store: stores.jobs,
    worker,
    concurrency: config.jobConcurrency,
    creditsFor: (transcript) => creditsForDuration(Math.max(0, transcript.source.duration_seconds ?? 0)),
  });
  const service = new TranscriptionService({
    store: stores.jobs,
    runner,
    billing,
    users: stores.users,
    uploads,
    now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    mediaMaxSeconds: config.mediaMaxSeconds,
  });
  return {
    config,
    stores,
    store: stores.jobs,
    service,
    quota,
    billing,
    billingProvider,
    rateLimiter: new SlidingWindowLimiter({ limit: config.anonRequestsPerMinute, windowMs: RATE_WINDOW_MS, now }),
    accountRateLimiter: new SlidingWindowLimiter({ limit: config.accountRequestsPerMinute, windowMs: RATE_WINDOW_MS, now }),
    signupLimiter: new SlidingWindowLimiter({ limit: config.signupsPerIpPerHour, windowMs: HOUR_MS, now }),
    loginLimiter: new SlidingWindowLimiter({ limit: config.loginsPerIpPerMinute, windowMs: RATE_WINDOW_MS, now }),
    mailLimiter: new SlidingWindowLimiter({ limit: config.authMailPerIpPerHour, windowMs: HOUR_MS, now }),
    mailer: overrides.mailer ?? createMailer(config, fetch),
    uploads,
    now,
    close: () => stores.close(),
  };
}

/** The transcribe-call limiter for this caller: accounts and anonymous clients are counted separately. */
export function transcribeLimiterFor(ctx: AppContext, caller: Caller): SlidingWindowLimiter {
  return caller.kind === "account" ? ctx.accountRateLimiter : ctx.rateLimiter;
}

/** Periodic cleanup of expired jobs, sessions, tokens, quota ledgers and rate-limit buckets. */
export async function runMaintenance(ctx: AppContext): Promise<void> {
  await ctx.store.pruneExpired();
  await ctx.stores.sessions.removeExpired(ctx.now());
  await ctx.stores.oauth.pruneExpired(ctx.now());
  // A run that never settled (the process died mid-job) would hold its credit for the rest of the month.
  // Live runs settle well inside the active-job TTL, so holds older than that are released. A late
  // settle still charges correctly, because it shares the release row.
  await ctx.stores.ledger.releaseStaleHolds(ctx.now() - ctx.config.jobTtl.activeMs, ctx.now());
  await applyDueDowngrades(ctx.stores.users, ctx.stores.billingEvents, ctx.now());
  ctx.uploads.prune();
  ctx.quota.prune();
  ctx.rateLimiter.prune();
  ctx.accountRateLimiter.prune();
  ctx.signupLimiter.prune();
  ctx.loginLimiter.prune();
  ctx.mailLimiter.prune();
}
