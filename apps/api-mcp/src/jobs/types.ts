import type { WorkerErrorCode } from "../worker/types.js";
import type { WorkerTranscript } from "../worker/transcript-schema.js";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

/** Where the job was created. `web` is the site, `rest` is /v1, `mcp` is the MCP server. */
export type JobSource = "web" | "rest" | "mcp";

/** Client identity stored on a job. Every field is null when the caller did not provide it. */
export interface JobClient {
  readonly source: JobSource | null;
  readonly clientName: string | null;
  readonly clientVersion: string | null;
  readonly oauthClientId: string | null;
  readonly userAgent: string | null;
}

/** Internal job record. `id` is the only identifier exposed to clients (PRD 8). */
export interface Job {
  readonly id: string;
  /** Dedupe key: owner scope + canonical URL + language, or a unique key for uploads. */
  readonly key: string;
  readonly status: JobStatus;
  readonly language: string;
  /** "public" for a link, "upload" for a file, or null when unknown. */
  readonly platform: string | null;
  /** Account that created the job. Null = anonymous: capability by job_id only. */
  readonly ownerUserId: string | null;
  readonly result: WorkerTranscript | null;
  readonly failure: WorkerErrorCode | null;
  readonly creditsCharged: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt: number;
  readonly client: JobClient;
}

export interface NewJob {
  readonly id: string;
  readonly key: string;
  readonly language: string;
  readonly platform: string | null;
  readonly ownerUserId: string | null;
  /** Omitted by older callers and tests. The store writes nulls. */
  readonly client?: JobClient;
}

export interface JobPatch {
  readonly status?: JobStatus;
  readonly result?: WorkerTranscript | null;
  readonly failure?: WorkerErrorCode | null;
  readonly creditsCharged?: number;
}

/** One row of the library listing (GET /v1/library). */
export interface JobSummary {
  readonly id: string;
  readonly status: JobStatus;
  readonly platform: string | null;
  readonly title: string | null;
  readonly createdAt: number;
}

export interface JobTtls {
  readonly activeMs: number;
  readonly succeededMs: number;
  /** Retention for succeeded jobs owned by an account (the library), PRD 12. */
  readonly accountSucceededMs: number;
  readonly failedMs: number;
}
