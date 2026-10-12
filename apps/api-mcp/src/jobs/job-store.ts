import type { Job, JobPatch, JobSummary, NewJob } from "./types.js";

export interface CreateOrReuseResult {
  readonly job: Job;
  /** False when a live job already existed for the dedupe key and was returned instead. */
  readonly created: boolean;
}

export interface PageRequest {
  readonly limit: number;
  readonly offset: number;
}

/** Thrown when a failed job cannot be re-queued because another live job already holds its dedupe key. */
export class LiveJobConflictError extends Error {
  constructor() {
    super("another live job holds this dedupe key");
    this.name = "LiveJobConflictError";
  }
}

/** Persistence for transcription jobs: in memory, or Postgres when DATABASE_URL is set. */
export interface JobStore {
  /** Atomic: at most one live (queued, running or succeeded) job per dedupe key. */
  createOrReuse(input: NewJob): Promise<CreateOrReuseResult>;
  get(id: string): Promise<Job | undefined>;
  update(id: string, patch: JobPatch): Promise<Job | undefined>;
  /** Moves a failed job back to queued for an upload continuation. Undefined when it is not failed. */
  requeueFailed(id: string): Promise<Job | undefined>;
  /** A live job for this dedupe key, if one exists. Failed jobs are never reused. */
  findReusable(key: string): Promise<Job | undefined>;
  /** An account's jobs, newest first. */
  listForUser(userId: string, page: PageRequest): Promise<JobSummary[]>;
  /** Deletes a succeeded or failed job. False when it is unknown or still queued or running. */
  removeFinished(id: string): Promise<boolean>;
  /** Removes expired jobs. Returns how many were removed. */
  pruneExpired(): Promise<number>;
}
