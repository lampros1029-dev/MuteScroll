import { logEvent } from "../log.js";
import { MediaWorkerError } from "../worker/errors.js";
import type { WorkerTranscript } from "../worker/transcript-schema.js";
import type { MediaWorker, WorkerErrorCode, WorkerTarget } from "../worker/types.js";
import type { JobStore } from "./job-store.js";
import type { Job } from "./types.js";

export interface JobSource {
  readonly target: WorkerTarget;
  readonly language: string;
  /** Runs once when the job leaves the runner, whatever the outcome (deletes upload temp dirs). */
  readonly cleanup?: () => Promise<void>;
}

export interface JobRunnerOptions {
  readonly store: JobStore;
  readonly worker: MediaWorker;
  readonly concurrency: number;
  readonly maxSeconds: number;
  /** Credits a finished transcript costs. */
  readonly creditsFor: (transcript: WorkerTranscript) => number;
  /** Called exactly once per run: with the credits charged, or 0 when the job failed (PRD 20.5). */
  readonly onSettled: (job: Job, creditsCharged: number) => void;
}

interface QueuedRun {
  readonly job: Job;
  readonly source: JobSource;
}

type Outcome =
  | { readonly ok: true; readonly transcript: WorkerTranscript; readonly credits: number }
  | { readonly ok: false; readonly code: WorkerErrorCode };

/** Runs transcription jobs with at most `concurrency` worker processes at once. FIFO. */
export class JobRunner {
  private readonly queue: QueuedRun[] = [];
  private running = 0;

  constructor(private readonly options: JobRunnerOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new RangeError(`Job concurrency must be a positive integer, got ${options.concurrency}`);
    }
  }

  get runningCount(): number {
    return this.running;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  submit(job: Job, source: JobSource): void {
    this.queue.push({ job, source });
    this.drain();
  }

  private drain(): void {
    while (this.running < this.options.concurrency && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next === undefined) return;
      this.running += 1;
      void this.execute(next).finally(() => {
        this.running -= 1;
        this.drain();
      });
    }
  }

  private async execute({ job, source }: QueuedRun): Promise<void> {
    try {
      await this.options.store.update(job.id, { status: "running", failure: null });
      const outcome = await this.attempt(source);
      await this.finish(job, outcome);
    } catch {
      // Store failure: the job stays "running" until it expires. Logged without details.
      logEvent("job.store_error", { job_id: job.id });
    } finally {
      await this.cleanup(job, source);
    }
  }

  private async attempt(source: JobSource): Promise<Outcome> {
    try {
      const transcript = await this.options.worker.transcribe({
        target: source.target,
        language: source.language,
        maxSeconds: this.options.maxSeconds,
      });
      return { ok: true, transcript, credits: this.options.creditsFor(transcript) };
    } catch (error) {
      return { ok: false, code: error instanceof MediaWorkerError ? error.code : "worker_failed" };
    }
  }

  private async finish(job: Job, outcome: Outcome): Promise<void> {
    if (outcome.ok) {
      await this.options.store.update(job.id, {
        status: "succeeded",
        result: outcome.transcript,
        creditsCharged: outcome.credits,
      });
      this.options.onSettled(job, outcome.credits);
      logEvent("job.succeeded", { job_id: job.id, method: outcome.transcript.method });
      return;
    }
    await this.options.store.update(job.id, { status: "failed", failure: outcome.code });
    this.options.onSettled(job, 0);
    logEvent("job.failed", { job_id: job.id, code: outcome.code });
  }

  private async cleanup(job: Job, source: JobSource): Promise<void> {
    if (source.cleanup === undefined) return;
    await source.cleanup().catch(() => logEvent("job.cleanup_failed", { job_id: job.id }));
  }
}
