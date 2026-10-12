import type { WorkerErrorCode } from "../worker/types.js";
import type { WorkerTranscript } from "../worker/transcript-schema.js";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

/** Internal job record. `id` is the only identifier exposed to MCP clients (PRD 8). */
export interface Job {
  readonly id: string;
  /** Dedupe key: canonical URL + language. */
  readonly key: string;
  readonly status: JobStatus;
  readonly language: string;
  /** Anonymous client key that pays for this job. Never returned to clients. */
  readonly ownerKey: string;
  readonly result: WorkerTranscript | null;
  readonly failure: WorkerErrorCode | null;
  readonly creditsCharged: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt: number;
}

export interface NewJob {
  readonly id: string;
  readonly key: string;
  readonly language: string;
  readonly ownerKey: string;
}

export interface JobPatch {
  readonly status?: JobStatus;
  readonly result?: WorkerTranscript | null;
  readonly failure?: WorkerErrorCode | null;
  readonly creditsCharged?: number;
}

export interface JobTtls {
  readonly activeMs: number;
  readonly succeededMs: number;
  readonly failedMs: number;
}
