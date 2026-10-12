import { describe, expect, it, vi } from "vitest";

import { JobRunner, type JobSource } from "../../src/jobs/job-runner.js";
import { MemoryJobStore } from "../../src/jobs/memory-job-store.js";
import type { Job } from "../../src/jobs/types.js";
import { MediaWorkerError } from "../../src/worker/errors.js";
import type { WorkerTranscript } from "../../src/worker/transcript-schema.js";
import type { MediaWorker, WorkerRequest } from "../../src/worker/types.js";
import { transcriptFixture } from "../helpers/fixtures.js";
import { delay } from "../helpers/fake-worker.js";

const TTL = { activeMs: 60_000, succeededMs: 60_000, failedMs: 60_000 };

function setup(worker: MediaWorker, concurrency = 2) {
  const store = new MemoryJobStore({ ttl: TTL, now: () => Date.now() });
  const settled: Array<{ id: string; credits: number }> = [];
  const runner = new JobRunner({
    store,
    worker,
    concurrency,
    maxSeconds: 3600,
    creditsFor: (t: WorkerTranscript) => Math.max(1, Math.ceil((t.source.duration_seconds ?? 0) / 600)),
    onSettled: (job: Job, credits: number) => settled.push({ id: job.id, credits }),
  });
  return { store, runner, settled };
}

async function createJob(store: MemoryJobStore, id: string, key = id): Promise<Job> {
  return (await store.createOrReuse({ id, key, language: "auto", ownerKey: "owner" })).job;
}

async function waitUntil(check: () => Promise<boolean> | boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await delay(5, undefined);
  }
}

const urlSource: JobSource = { target: { kind: "url", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, language: "auto" };

describe("JobRunner outcomes", () => {
  it("stores the transcript, charges credits and settles the reservation on success", async () => {
    const worker: MediaWorker = { transcribe: async () => transcriptFixture(1500) };
    const { store, runner, settled } = setup(worker);
    const job = await createJob(store, "job_1");
    runner.submit(job, urlSource);
    await waitUntil(async () => (await store.get("job_1"))?.status === "succeeded");
    const done = await store.get("job_1");
    expect(done?.creditsCharged).toBe(3);
    expect(done?.result?.transcript_text).toBe("[00:00] Hello there");
    expect(settled).toEqual([{ id: "job_1", credits: 3 }]);
  });

  it("records the typed failure code and settles with zero credits (PRD 20.5)", async () => {
    const worker: MediaWorker = { transcribe: async () => Promise.reject(new MediaWorkerError("blocked_bot_check")) };
    const { store, runner, settled } = setup(worker);
    const job = await createJob(store, "job_1");
    runner.submit(job, urlSource);
    await waitUntil(async () => (await store.get("job_1"))?.status === "failed");
    expect((await store.get("job_1"))?.failure).toBe("blocked_bot_check");
    expect(settled).toEqual([{ id: "job_1", credits: 0 }]);
  });

  it("maps unexpected exceptions to worker_failed without leaking their message", async () => {
    const worker: MediaWorker = { transcribe: async () => Promise.reject(new Error("boom: secret path /etc")) };
    const { store, runner } = setup(worker);
    const job = await createJob(store, "job_1");
    runner.submit(job, urlSource);
    await waitUntil(async () => (await store.get("job_1"))?.status === "failed");
    expect((await store.get("job_1"))?.failure).toBe("worker_failed");
  });

  it("runs the cleanup hook exactly once, whatever the outcome", async () => {
    const worker: MediaWorker = { transcribe: async () => Promise.reject(new MediaWorkerError("no_speech")) };
    const { store, runner } = setup(worker);
    const cleanup = vi.fn(async () => undefined);
    const job = await createJob(store, "job_1");
    runner.submit(job, { ...urlSource, cleanup });
    await waitUntil(() => cleanup.mock.calls.length > 0);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not fail the job when the cleanup hook throws", async () => {
    const worker: MediaWorker = { transcribe: async () => transcriptFixture() };
    const { store, runner } = setup(worker);
    const job = await createJob(store, "job_1");
    runner.submit(job, { ...urlSource, cleanup: () => Promise.reject(new Error("EBUSY")) });
    await waitUntil(async () => (await store.get("job_1"))?.status === "succeeded");
  });
});

describe("JobRunner concurrency", () => {
  it("never runs more than the configured number of worker calls at once", async () => {
    let active = 0;
    let peak = 0;
    const worker: MediaWorker = {
      transcribe: async (_request: WorkerRequest) => {
        active += 1;
        peak = Math.max(peak, active);
        await delay(20, undefined);
        active -= 1;
        return transcriptFixture();
      },
    };
    const { store, runner } = setup(worker, 2);
    const ids = ["job_a", "job_b", "job_c", "job_d", "job_e"];
    for (const id of ids) runner.submit(await createJob(store, id), urlSource);
    await waitUntil(async () => (await Promise.all(ids.map((id) => store.get(id)))).every((j) => j?.status === "succeeded"));
    expect(peak).toBe(2);
    expect(runner.runningCount).toBe(0);
    expect(runner.queuedCount).toBe(0);
  });

  it("rejects a concurrency limit below one", () => {
    expect(() => setup({ transcribe: async () => transcriptFixture() }, 0)).toThrow(RangeError);
  });
});
