import { describe, expect, it } from "vitest";

import { CreditQuota } from "../../src/quota/credit-quota.js";
import { JobRunner } from "../../src/jobs/job-runner.js";
import { MemoryJobStore } from "../../src/jobs/memory-job-store.js";
import { TranscriptionService } from "../../src/jobs/transcription-service.js";
import { UploadTokenStore } from "../../src/upload/tokens.js";
import { MediaWorkerError } from "../../src/worker/errors.js";
import { delay, FakeWorker } from "../helpers/fake-worker.js";
import { transcriptFixture } from "../helpers/fixtures.js";

const WINDOW_MS = 86_400_000;

function build(worker: FakeWorker, allowance = 5) {
  let clock = 1_000_000;
  const now = () => clock;
  const store = new MemoryJobStore({
    ttl: { activeMs: 3_600_000, succeededMs: 86_400_000, failedMs: 3_600_000 },
    now,
  });
  const quota = new CreditQuota({ allowance, windowMs: WINDOW_MS, now });
  const uploads = new UploadTokenStore({ ttlMs: 3_600_000, now });
  const runner = new JobRunner({
    store,
    worker,
    concurrency: 2,
    maxSeconds: 3600,
    creditsFor: () => 1,
    onSettled: (job, credits) => quota.settle(job.ownerKey, credits),
  });
  // The wait deadline uses real time; the store, quota and token clocks are the fake one above.
  const service = new TranscriptionService({
    store,
    runner,
    quota,
    uploads,
    now: Date.now,
    sleep: (ms) => delay(ms, undefined),
  });
  return { service, store, quota, uploads, advance: (ms: number) => (clock += ms) };
}

const URL_A = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const URL_B = "https://www.youtube.com/watch?v=bbbbbbbbbbb";

describe("TranscriptionService.request", () => {
  it("starts one job for concurrent identical requests and reserves quota once", async () => {
    const worker = new FakeWorker(() => delay(30, transcriptFixture()));
    const { service, quota } = build(worker);
    const outcomes = await Promise.all([
      service.request({ canonicalUrl: URL_A, language: "auto", ownerKey: "c1" }),
      service.request({ canonicalUrl: URL_A, language: "auto", ownerKey: "c1" }),
    ]);
    const ids = outcomes.map((o) => (o.kind === "job" ? o.job.id : "none"));
    expect(ids[0]).toBe(ids[1]);
    expect(quota.remaining("c1")).toBe(4);
    await delay(60, undefined);
    expect(worker.requests).toHaveLength(1);
  });

  it("returns a finished job for free: a repeat does not reserve or charge again", async () => {
    const worker = new FakeWorker();
    const { service, quota } = build(worker);
    const first = await service.request({ canonicalUrl: URL_A, language: "auto", ownerKey: "c1" });
    await delay(20, undefined);
    const again = await service.request({ canonicalUrl: URL_A, language: "auto", ownerKey: "c2" });
    expect(first.kind === "job" && again.kind === "job" && first.job.id === again.job.id).toBe(true);
    expect(quota.remaining("c1")).toBe(4);
    expect(quota.remaining("c2")).toBe(5);
  });

  it("refuses new work once the anonymous allowance is spent, with the reset time", async () => {
    const worker = new FakeWorker();
    const { service } = build(worker, 1);
    await service.request({ canonicalUrl: URL_A, language: "auto", ownerKey: "c1" });
    const outcome = await service.request({ canonicalUrl: URL_B, language: "auto", ownerKey: "c1" });
    expect(outcome.kind).toBe("quota_exceeded");
    if (outcome.kind === "quota_exceeded") expect(outcome.resetAt).toBeGreaterThan(1_000_000);
  });

  it("does not charge a failed job (quota comes back)", async () => {
    const worker = new FakeWorker(async () => {
      throw new MediaWorkerError("blocked_bot_check");
    });
    const { service, quota } = build(worker);
    const outcome = await service.request({ canonicalUrl: URL_A, language: "auto", ownerKey: "c1" });
    if (outcome.kind !== "job") throw new Error("expected a job");
    await service.waitForSettled(outcome.job.id, 2000, 5);
    expect(quota.remaining("c1")).toBe(5);
  });
});

describe("TranscriptionService.waitForSettled", () => {
  it("returns the settled job as soon as it finishes", async () => {
    const worker = new FakeWorker(() => delay(20, transcriptFixture()));
    const { service } = build(worker);
    const outcome = await service.request({ canonicalUrl: URL_A, language: "auto", ownerKey: "c1" });
    if (outcome.kind !== "job") throw new Error("expected a job");
    const settled = await service.waitForSettled(outcome.job.id, 2000, 5);
    expect(settled?.status).toBe("succeeded");
  });

  it("gives up after the timeout and returns the latest (still running) snapshot", async () => {
    const worker = new FakeWorker(() => delay(500, transcriptFixture()));
    const { service } = build(worker);
    const outcome = await service.request({ canonicalUrl: URL_A, language: "auto", ownerKey: "c1" });
    if (outcome.kind !== "job") throw new Error("expected a job");
    const snapshot = await service.waitForSettled(outcome.job.id, 30, 5);
    expect(snapshot?.status === "queued" || snapshot?.status === "running").toBe(true);
  });
});

describe("TranscriptionService upload continuation", () => {
  it("re-runs a failed job from an uploaded file under the same job id", async () => {
    const worker = new FakeWorker(async (_request, call) => {
      if (call === 0) throw new MediaWorkerError("retrieval_failed");
      return transcriptFixture();
    });
    const { service, store } = build(worker);
    const outcome = await service.request({ canonicalUrl: URL_A, language: "auto", ownerKey: "c1" });
    if (outcome.kind !== "job") throw new Error("expected a job");
    await service.waitForSettled(outcome.job.id, 2000, 5);

    let cleaned = false;
    const start = await service.startUpload(outcome.job.id, {
      path: "/tmp/upload.mp4",
      cleanup: async () => {
        cleaned = true;
      },
    });
    expect(start).toBe("accepted");
    const done = await service.waitForSettled(outcome.job.id, 2000, 5);
    expect(done?.status).toBe("succeeded");
    expect(worker.requests[1]?.target).toEqual({ kind: "file", path: "/tmp/upload.mp4" });
    expect(cleaned).toBe(true);
    expect((await store.get(outcome.job.id))?.failure).toBeNull();
  });

  it("reports not_found and not_failed without touching the job", async () => {
    const worker = new FakeWorker(() => delay(200, transcriptFixture()));
    const { service } = build(worker);
    const missing = await service.startUpload("job_missing", { path: "/tmp/x", cleanup: async () => undefined });
    expect(missing).toBe("not_found");
    const outcome = await service.request({ canonicalUrl: URL_A, language: "auto", ownerKey: "c1" });
    if (outcome.kind !== "job") throw new Error("expected a job");
    const running = await service.startUpload(outcome.job.id, { path: "/tmp/x", cleanup: async () => undefined });
    expect(running).toBe("not_failed");
  });

  it("revokes older upload links when a new one is issued for the same job", async () => {
    const worker = new FakeWorker();
    const { service, uploads } = build(worker);
    const first = service.issueUploadToken("job_1");
    const second = service.issueUploadToken("job_1");
    expect(uploads.acquire(first).ok).toBe(false);
    expect(uploads.acquire(second).ok).toBe(true);
  });
});
