import { describe, expect, it, vi } from "vitest";

import { JobRunner, type JobSource } from "../../src/jobs/job-runner.js";
import { MemoryJobStore } from "../../src/jobs/memory-job-store.js";
import type { Job, JobPatch } from "../../src/jobs/types.js";
import { MediaWorkerError } from "../../src/worker/errors.js";
import type { WorkerTranscript } from "../../src/worker/transcript-schema.js";
import type { MediaWorker, WorkerRequest } from "../../src/worker/types.js";
import { transcriptFixture } from "../helpers/fixtures.js";
import { delay } from "../helpers/fake-worker.js";

const TTL = { activeMs: 60_000, succeededMs: 60_000, accountSucceededMs: 60_000, failedMs: 60_000 };

interface Settlement {
  readonly id: string;
  readonly credits: number;
}

function setup(worker: MediaWorker, concurrency = 2, store = new MemoryJobStore({ ttl: TTL, now: () => Date.now() })) {
  const settled: Settlement[] = [];
  const runner = new JobRunner({
    store,
    worker,
    concurrency,
    creditsFor: (t: WorkerTranscript) => Math.max(1, Math.ceil((t.source.duration_seconds ?? 0) / 600)),
  });
  return { store, runner, settled };
}

function sourceFor(settled: Settlement[], id: string, extra: Partial<JobSource> = {}): JobSource {
  return {
    target: { kind: "url", url: "https://example.com/video/sample" },
    language: "auto",
    maxSeconds: 3600,
    settle: async (credits: number) => {
      settled.push({ id, credits });
    },
    ...extra,
  };
}

async function createJob(store: MemoryJobStore, id: string, key = id): Promise<Job> {
  return (await store.createOrReuse({ id, key, language: "auto", platform: null, ownerUserId: null })).job;
}

async function waitUntil(check: () => Promise<boolean> | boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await delay(5, undefined);
  }
}

describe("JobRunner outcomes", () => {
  it("stores the transcript, charges credits and settles the hold once on success", async () => {
    const worker: MediaWorker = { transcribe: async () => transcriptFixture(1500) };
    const { store, runner, settled } = setup(worker);
    const job = await createJob(store, "job_1");
    runner.submit(job, sourceFor(settled, "job_1"));
    await waitUntil(async () => (await store.get("job_1"))?.status === "succeeded");
    await waitUntil(() => settled.length > 0);
    const done = await store.get("job_1");
    expect(done?.creditsCharged).toBe(3);
    expect(done?.result?.transcript_text).toBe("[00:00] Hello there");
    expect(settled).toEqual([{ id: "job_1", credits: 3 }]);
  });

  it("records the typed failure code and settles with zero credits (PRD 20.5)", async () => {
    const worker: MediaWorker = { transcribe: async () => Promise.reject(new MediaWorkerError("blocked_bot_check")) };
    const { store, runner, settled } = setup(worker);
    const job = await createJob(store, "job_1");
    runner.submit(job, sourceFor(settled, "job_1"));
    await waitUntil(async () => (await store.get("job_1"))?.status === "failed");
    await waitUntil(() => settled.length > 0);
    expect((await store.get("job_1"))?.failure).toBe("blocked_bot_check");
    expect(settled).toEqual([{ id: "job_1", credits: 0 }]);
  });

  it("maps unexpected exceptions to worker_failed without leaking their message", async () => {
    const worker: MediaWorker = { transcribe: async () => Promise.reject(new Error("boom: secret path /etc")) };
    const { store, runner, settled } = setup(worker);
    const job = await createJob(store, "job_1");
    runner.submit(job, sourceFor(settled, "job_1"));
    await waitUntil(async () => (await store.get("job_1"))?.status === "failed");
    expect((await store.get("job_1"))?.failure).toBe("worker_failed");
  });

  it("passes the per-run maxSeconds to the worker", async () => {
    const seen: WorkerRequest[] = [];
    const worker: MediaWorker = {
      transcribe: async (request) => {
        seen.push(request);
        return transcriptFixture();
      },
    };
    const { store, runner, settled } = setup(worker);
    runner.submit(await createJob(store, "job_1"), sourceFor(settled, "job_1", { maxSeconds: 600 }));
    await waitUntil(() => settled.length > 0);
    expect(seen[0]?.maxSeconds).toBe(600);
  });

  it("runs the cleanup hook exactly once, whatever the outcome", async () => {
    const worker: MediaWorker = { transcribe: async () => Promise.reject(new MediaWorkerError("no_speech")) };
    const { store, runner, settled } = setup(worker);
    const cleanup = vi.fn(async () => undefined);
    const job = await createJob(store, "job_1");
    runner.submit(job, sourceFor(settled, "job_1", { cleanup }));
    await waitUntil(() => cleanup.mock.calls.length > 0);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not fail the job when the cleanup hook throws", async () => {
    const worker: MediaWorker = { transcribe: async () => transcriptFixture() };
    const { store, runner, settled } = setup(worker);
    const job = await createJob(store, "job_1");
    runner.submit(job, sourceFor(settled, "job_1", { cleanup: () => Promise.reject(new Error("EBUSY")) }));
    await waitUntil(async () => (await store.get("job_1"))?.status === "succeeded");
  });

  it("still settles the hold, with zero, when the store cannot record the result", async () => {
    const worker: MediaWorker = { transcribe: async () => transcriptFixture() };
    const inner = new MemoryJobStore({ ttl: TTL, now: () => Date.now() });
    const job = await createJob(inner, "job_1");
    // Every store call goes through to the real store, except recording a success.
    const store = new Proxy(inner, {
      get(target, property, receiver) {
        if (property !== "update") return Reflect.get(target, property, receiver);
        return (id: string, patch: JobPatch) => {
          if (patch.status === "succeeded") return Promise.reject(new Error("disk full"));
          return target.update(id, patch);
        };
      },
    });
    const runner = new JobRunner({ store, worker, concurrency: 1, creditsFor: () => 1 });
    const settled: Settlement[] = [];
    runner.submit(job, sourceFor(settled, "job_1"));
    await waitUntil(() => settled.length > 0);
    expect(settled).toEqual([{ id: "job_1", credits: 0 }]);
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
    const { store, runner, settled } = setup(worker, 2);
    const ids = ["job_a", "job_b", "job_c", "job_d", "job_e"];
    for (const id of ids) runner.submit(await createJob(store, id), sourceFor(settled, id));
    await waitUntil(async () => (await Promise.all(ids.map((id) => store.get(id)))).every((j) => j?.status === "succeeded"));
    expect(peak).toBe(2);
    expect(runner.runningCount).toBe(0);
    expect(runner.queuedCount).toBe(0);
  });

  it("rejects a concurrency limit below one", () => {
    expect(() => setup({ transcribe: async () => transcriptFixture() }, 0)).toThrow(RangeError);
  });
});
