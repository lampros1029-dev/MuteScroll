import { randomUUID } from "node:crypto";

import type { Caller, Viewer } from "../caller.js";
import type { Billing } from "../billing/billing.js";
import { planDefinition } from "../billing/plans.js";
import type { UserStore } from "../accounts/types.js";
import type { UploadTokenStore } from "../upload/tokens.js";
import type { WorkerTarget } from "../worker/types.js";
import { canView } from "./ownership.js";
import { LiveJobConflictError, type CreateOrReuseResult, type JobStore, type PageRequest } from "./job-store.js";
import type { JobRunner } from "./job-runner.js";
import type { Job, JobSummary } from "./types.js";

export type RequestOutcome =
  | { readonly kind: "job"; readonly job: Job }
  | { readonly kind: "quota_exceeded"; readonly resetAt: number };

export type UploadStart = "accepted" | "not_found" | "not_failed" | "quota_exceeded";

export type DeleteOutcome = "deleted" | "in_progress" | "not_found";

/** A staged upload. `cleanup` removes its temp directory. */
export interface UploadFile {
  readonly path: string;
  readonly cleanup: () => Promise<void>;
}

export interface UrlRequest {
  readonly canonicalUrl: string;
  readonly platform: string;
  readonly language: string;
  readonly caller: Caller;
}

export interface TranscriptionServiceDeps {
  readonly store: JobStore;
  readonly runner: JobRunner;
  readonly billing: Billing;
  readonly users: UserStore;
  readonly uploads: UploadTokenStore;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Server-wide cap on media length (MEDIA_MAX_SECONDS). Plans can only lower it. */
  readonly mediaMaxSeconds: number;
}

interface StartInput {
  readonly jobId: string;
  readonly key: string;
  readonly platform: string;
  readonly language: string;
  readonly caller: Caller;
  readonly target: WorkerTarget;
  readonly cleanup?: () => Promise<void>;
}

/**
 * Coordinates jobs for MCP tools and REST routes: dedupe, billing holds, upload continuation and
 * ownership lookups. The runner only executes work.
 */
export class TranscriptionService {
  constructor(private readonly deps: TranscriptionServiceDeps) {}

  /** Starts a transcription of a URL, or joins an identical live one. Only new work holds credits. */
  async request(input: UrlRequest): Promise<RequestOutcome> {
    const key = dedupeKeyFor(input.caller, input.canonicalUrl, input.language);
    const reused = await this.deps.store.findReusable(key);
    if (reused !== undefined) return { kind: "job", job: reused };
    return this.start({
      jobId: newJobId(),
      key,
      platform: input.platform,
      language: input.language,
      caller: input.caller,
      target: { kind: "url", url: input.canonicalUrl },
    });
  }

  /** Starts a transcription of an uploaded file as a new job. Uploads are never deduped. */
  async startFileJob(caller: Caller, file: UploadFile): Promise<RequestOutcome> {
    const jobId = newJobId();
    return this.start({
      jobId,
      key: `upload|${jobId}`,
      platform: "upload",
      language: "auto",
      caller,
      target: { kind: "file", path: file.path },
      cleanup: file.cleanup,
    });
  }

  /** Continues a failed job with an uploaded file under the same job_id (PRD 14). The owner pays. */
  async continueFailedJob(jobId: string, file: UploadFile, clientKey: string): Promise<UploadStart> {
    const job = await this.deps.store.get(jobId);
    if (job === undefined) return "not_found";
    if (job.status !== "failed") return "not_failed";
    const payer = await this.payerFor(job, clientKey);
    if (payer === undefined) return "not_found";
    const outcome = await this.deps.billing.hold(payer, jobId);
    if (!outcome.ok) return "quota_exceeded";
    const requeued = await this.requeue(jobId);
    if (requeued === undefined) {
      await outcome.hold.settle(0);
      return "not_failed";
    }
    this.deps.uploads.revokeForJob(jobId);
    this.deps.runner.submit(requeued, {
      target: { kind: "file", path: file.path },
      language: requeued.language,
      maxSeconds: this.maxSecondsFor(payer),
      settle: outcome.hold.settle,
      cleanup: file.cleanup,
    });
    return "accepted";
  }

  get(jobId: string): Promise<Job | undefined> {
    return this.deps.store.get(jobId);
  }

  /** The job when the viewer may read it. Unknown and someone else's jobs look the same (404, never 403). */
  async getVisible(jobId: string, viewer: Viewer): Promise<Job | undefined> {
    const job = await this.deps.store.get(jobId);
    return job !== undefined && canView(job, viewer) ? job : undefined;
  }

  /** Polls until the job is terminal or `timeoutMs` passes. Returns the latest snapshot. */
  async waitForSettled(jobId: string, timeoutMs: number, pollMs: number): Promise<Job | undefined> {
    const deadline = this.deps.now() + timeoutMs;
    for (;;) {
      const job = await this.deps.store.get(jobId);
      const remaining = deadline - this.deps.now();
      if (job === undefined || isTerminal(job) || remaining <= 0) return job;
      await this.deps.sleep(Math.min(pollMs, remaining));
    }
  }

  /** Issues a fresh one-time upload link for a failed job. Older links for that job are revoked. */
  issueUploadToken(jobId: string): string {
    this.deps.uploads.revokeForJob(jobId);
    return this.deps.uploads.issue(jobId);
  }

  listLibrary(userId: string, page: PageRequest): Promise<JobSummary[]> {
    return this.deps.store.listForUser(userId, page);
  }

  /** Deletes a finished job the viewer owns (or an anonymous job they hold the id of). Running jobs cannot be deleted. */
  async deleteJob(jobId: string, viewer: Viewer): Promise<DeleteOutcome> {
    if ((await this.getVisible(jobId, viewer)) === undefined) return "not_found";
    if (await this.deps.store.removeFinished(jobId)) return "deleted";
    return (await this.deps.store.get(jobId)) === undefined ? "not_found" : "in_progress";
  }

  private async start(input: StartInput): Promise<RequestOutcome> {
    const outcome = await this.deps.billing.hold(input.caller, input.jobId);
    if (!outcome.ok) return { kind: "quota_exceeded", resetAt: outcome.resetAt };
    let created: CreateOrReuseResult;
    try {
      created = await this.deps.store.createOrReuse({
        id: input.jobId,
        key: input.key,
        language: input.language,
        platform: input.platform,
        ownerUserId: input.caller.kind === "account" ? input.caller.userId : null,
      });
    } catch (error) {
      await outcome.hold.settle(0).catch(() => undefined);
      throw error;
    }
    if (!created.created) {
      // Another request created the job between our lookup and insert: give the hold back.
      await outcome.hold.settle(0);
      return { kind: "job", job: created.job };
    }
    this.deps.runner.submit(created.job, {
      target: input.target,
      language: input.language,
      maxSeconds: this.maxSecondsFor(input.caller),
      settle: outcome.hold.settle,
      cleanup: input.cleanup,
    });
    return { kind: "job", job: created.job };
  }

  private async requeue(jobId: string): Promise<Job | undefined> {
    try {
      return await this.deps.store.requeueFailed(jobId);
    } catch (error) {
      if (error instanceof LiveJobConflictError) return undefined;
      throw error;
    }
  }

  private maxSecondsFor(caller: Caller): number {
    if (caller.kind === "anonymous") return this.deps.mediaMaxSeconds;
    return Math.min(this.deps.mediaMaxSeconds, planDefinition(caller.plan).maxVideoSeconds);
  }

  /** Anonymous jobs are paid by whoever continues them; account jobs by their owner. */
  private async payerFor(job: Job, clientKey: string): Promise<Caller | undefined> {
    if (job.ownerUserId === null) return { kind: "anonymous", clientKey };
    const owner = await this.deps.users.findById(job.ownerUserId);
    return owner === undefined ? undefined : { kind: "account", userId: owner.id, plan: owner.plan };
  }
}

/** Anonymous requests share one dedupe scope; each account has its own, so jobs never cross owners. */
export function dedupeKeyFor(caller: Caller, canonicalUrl: string, language: string): string {
  const scope = caller.kind === "account" ? `user:${caller.userId}` : "anonymous";
  return `${scope}|${canonicalUrl}|${language}`;
}

export function isTerminal(job: Job): boolean {
  return job.status === "succeeded" || job.status === "failed";
}

function newJobId(): string {
  return `job_${randomUUID()}`;
}
