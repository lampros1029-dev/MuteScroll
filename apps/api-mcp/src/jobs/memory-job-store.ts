import { LiveJobConflictError, type CreateOrReuseResult, type JobStore, type PageRequest } from "./job-store.js";
import { ttlMsFor } from "./ttl.js";
import type { Job, JobPatch, JobSummary, JobTtls, NewJob } from "./types.js";

export interface MemoryJobStoreOptions {
  readonly ttl: JobTtls;
  readonly now: () => number;
}

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, Job>();
  /** One live job per dedupe key (queued, running or succeeded). */
  private readonly keyIndex = new Map<string, string>();

  constructor(private readonly options: MemoryJobStoreOptions) {}

  async createOrReuse(input: NewJob): Promise<CreateOrReuseResult> {
    // No await between the lookup and the insert: the check and the write are one step.
    const existingId = this.keyIndex.get(input.key);
    const existing = existingId === undefined ? undefined : this.live(existingId);
    if (existing !== undefined && existing.status !== "failed") return { job: { ...existing }, created: false };
    const now = this.options.now();
    const job: Job = {
      id: input.id,
      key: input.key,
      status: "queued",
      language: input.language,
      platform: input.platform,
      ownerUserId: input.ownerUserId,
      result: null,
      failure: null,
      creditsCharged: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.options.ttl.activeMs,
    };
    this.jobs.set(job.id, job);
    this.indexIfFree(job);
    return { job: { ...job }, created: true };
  }

  async get(id: string): Promise<Job | undefined> {
    const job = this.live(id);
    return job === undefined ? undefined : { ...job };
  }

  async update(id: string, patch: JobPatch): Promise<Job | undefined> {
    const current = this.live(id);
    return current === undefined ? undefined : this.write(current, patch);
  }

  async requeueFailed(id: string): Promise<Job | undefined> {
    const current = this.live(id);
    if (current === undefined || current.status !== "failed") return undefined;
    const holder = this.keyIndex.get(current.key);
    if (holder !== undefined && holder !== id && this.live(holder) !== undefined) throw new LiveJobConflictError();
    return this.write(current, { status: "queued", failure: null });
  }

  async findReusable(key: string): Promise<Job | undefined> {
    const id = this.keyIndex.get(key);
    if (id === undefined) return undefined;
    const job = this.live(id);
    if (job === undefined || job.status === "failed") {
      this.keyIndex.delete(key);
      return undefined;
    }
    return { ...job };
  }

  async listForUser(userId: string, page: PageRequest): Promise<JobSummary[]> {
    const now = this.options.now();
    return [...this.jobs.values()]
      .filter((job) => job.ownerUserId === userId && job.expiresAt > now)
      // Newest first; equal times fall back to id, as the Postgres ORDER BY does.
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(page.offset, page.offset + page.limit)
      .map((job) => ({
        id: job.id,
        status: job.status,
        platform: job.platform,
        title: job.result?.source.title ?? null,
        createdAt: job.createdAt,
      }));
  }

  async removeFinished(id: string): Promise<boolean> {
    const job = this.live(id);
    if (job === undefined || job.status === "queued" || job.status === "running") return false;
    this.remove(job);
    return true;
  }

  async pruneExpired(): Promise<number> {
    const now = this.options.now();
    let removed = 0;
    for (const job of [...this.jobs.values()]) {
      if (job.expiresAt <= now) {
        this.remove(job);
        removed += 1;
      }
    }
    return removed;
  }

  private write(current: Job, patch: JobPatch): Job {
    const now = this.options.now();
    const status = patch.status ?? current.status;
    const next: Job = {
      ...current,
      status,
      result: patch.result !== undefined ? patch.result : current.result,
      failure: patch.failure !== undefined ? patch.failure : current.failure,
      creditsCharged: patch.creditsCharged ?? current.creditsCharged,
      updatedAt: now,
      expiresAt: now + ttlMsFor(status, current.ownerUserId, this.options.ttl),
    };
    this.jobs.set(next.id, next);
    this.syncIndex(next);
    return { ...next };
  }

  private live(id: string): Job | undefined {
    const job = this.jobs.get(id);
    if (job === undefined) return undefined;
    if (job.expiresAt <= this.options.now()) {
      this.remove(job);
      return undefined;
    }
    return job;
  }

  private indexIfFree(job: Job): void {
    if (job.status === "failed") return;
    const holder = this.keyIndex.get(job.key);
    // A holder that has expired no longer blocks the key.
    if (holder !== undefined && holder !== job.id && this.live(holder) !== undefined) return;
    this.keyIndex.set(job.key, job.id);
  }

  private syncIndex(job: Job): void {
    if (job.status === "failed") {
      if (this.keyIndex.get(job.key) === job.id) this.keyIndex.delete(job.key);
      return;
    }
    this.indexIfFree(job);
  }

  private remove(job: Job): void {
    this.jobs.delete(job.id);
    if (this.keyIndex.get(job.key) === job.id) this.keyIndex.delete(job.key);
  }
}
