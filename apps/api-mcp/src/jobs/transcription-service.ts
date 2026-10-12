import { randomUUID } from "node:crypto";

import type { CreditQuota } from "../quota/credit-quota.js";
import type { UploadTokenStore } from "../upload/tokens.js";
import type { JobStore } from "./job-store.js";
import type { JobRunner, JobSource } from "./job-runner.js";
import type { Job } from "./types.js";

export type RequestOutcome =
  | { readonly kind: "job"; readonly job: Job }
  | { readonly kind: "quota_exceeded"; readonly resetAt: number };

export type UploadStart = "accepted" | "not_found" | "not_failed" | "quota_exceeded";

export interface UploadFile {
  readonly path: string;
  readonly cleanup: () => Promise<void>;
}

export interface TranscriptionServiceDeps {
  readonly store: JobStore;
  readonly runner: JobRunner;
  readonly quota: CreditQuota;
  readonly uploads: UploadTokenStore;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export function dedupeKey(canonicalUrl: string, language: string): string {
  return `${canonicalUrl}|${language}`;
}

export function isTerminal(job: Job): boolean {
  return job.status === "succeeded" || job.status === "failed";
}

/**
 * Coordinates jobs for the MCP tools and the upload route. Dedupe, anonymous quota and
 * upload continuation live here; the runner only executes work.
 */
export class TranscriptionService {
  constructor(private readonly deps: TranscriptionServiceDeps) {}

  /** Starts a transcription, or joins an identical live one (dedupe). Only new work reserves quota. */
  async request(input: { canonicalUrl: string; language: string; ownerKey: string }): Promise<RequestOutcome> {
    const key = dedupeKey(input.canonicalUrl, input.language);
    const reused = await this.deps.store.findReusable(key);
    if (reused !== undefined) return { kind: "job", job: reused };

    if (!this.deps.quota.tryReserve(input.ownerKey)) {
      return { kind: "quota_exceeded", resetAt: this.deps.quota.resetAt(input.ownerKey) };
    }
    const { job, created } = await this.deps.store.createOrReuse({
      id: newJobId(),
      key,
      language: input.language,
      ownerKey: input.ownerKey,
    });
    if (!created) {
      // Another request created the job between our lookup and insert: give the reservation back.
      this.deps.quota.release(input.ownerKey);
      return { kind: "job", job };
    }
    this.deps.runner.submit(job, { target: { kind: "url", url: input.canonicalUrl }, language: input.language });
    return { kind: "job", job };
  }

  get(jobId: string): Promise<Job | undefined> {
    return this.deps.store.get(jobId);
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

  /** Continues an existing failed job with an uploaded file (same job_id, PRD 14). */
  async startUpload(jobId: string, file: UploadFile): Promise<UploadStart> {
    const job = await this.deps.store.get(jobId);
    if (job === undefined) return "not_found";
    if (job.status !== "failed") return "not_failed";
    if (!this.deps.quota.tryReserve(job.ownerKey)) return "quota_exceeded";

    this.deps.uploads.revokeForJob(jobId);
    await this.deps.store.update(jobId, { status: "queued", failure: null });
    const source: JobSource = {
      target: { kind: "file", path: file.path },
      language: job.language,
      cleanup: file.cleanup,
    };
    this.deps.runner.submit(job, source);
    return "accepted";
  }
}

function newJobId(): string {
  return `job_${randomUUID()}`;
}
