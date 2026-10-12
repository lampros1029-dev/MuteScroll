import type { Job, JobPatch, NewJob } from "./types.js";

/**
 * Persistence for transcription jobs. The in-memory store serves M2; the Postgres store lands in M3.
 * All methods are async so the swap does not change callers.
 */
export interface CreateOrReuseResult {
  readonly job: Job;
  /** False when a live job already existed for the dedupe key and was returned instead. */
  readonly created: boolean;
}

export interface JobStore {
  /** Atomic: at most one live (queued, running or succeeded) job per dedupe key. */
  createOrReuse(input: NewJob): Promise<CreateOrReuseResult>;
  get(id: string): Promise<Job | undefined>;
  update(id: string, patch: JobPatch): Promise<Job | undefined>;
  /** A live job for this dedupe key, if one exists. Failed jobs are never reused. */
  findReusable(key: string): Promise<Job | undefined>;
  /** Removes expired jobs. Returns how many were removed. */
  pruneExpired(): Promise<number>;
}
