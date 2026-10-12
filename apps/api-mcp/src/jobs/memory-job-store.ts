import type { CreateOrReuseResult, JobStore } from "./job-store.js";
import type { Job, JobPatch, JobTtls, NewJob } from "./types.js";

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
      ownerKey: input.ownerKey,
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
    if (current === undefined) return undefined;
    const now = this.options.now();
    const next: Job = {
      ...current,
      status: patch.status ?? current.status,
      result: patch.result !== undefined ? patch.result : current.result,
      failure: patch.failure !== undefined ? patch.failure : current.failure,
      creditsCharged: patch.creditsCharged ?? current.creditsCharged,
      updatedAt: now,
      expiresAt: now + this.ttlFor(patch.status ?? current.status),
    };
    this.jobs.set(id, next);
    this.syncIndex(next);
    return { ...next };
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

  private live(id: string): Job | undefined {
    const job = this.jobs.get(id);
    if (job === undefined) return undefined;
    if (job.expiresAt <= this.options.now()) {
      this.remove(job);
      return undefined;
    }
    return job;
  }

  private ttlFor(status: Job["status"]): number {
    switch (status) {
      case "queued":
      case "running":
        return this.options.ttl.activeMs;
      case "succeeded":
        return this.options.ttl.succeededMs;
      case "failed":
        return this.options.ttl.failedMs;
      default: {
        const unreachable: never = status;
        throw new Error(`Unhandled job status: ${String(unreachable)}`);
      }
    }
  }

  private indexIfFree(job: Job): void {
    if (job.status !== "failed" && !this.keyIndex.has(job.key)) this.keyIndex.set(job.key, job.id);
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
