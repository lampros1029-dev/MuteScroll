import { describe, expect, it } from "vitest";

import type { Caller } from "../../src/caller.js";
import { Billing } from "../../src/billing/billing.js";
import { nextPeriodStart, periodKey } from "../../src/billing/period.js";
import { CreditQuota } from "../../src/quota/credit-quota.js";
import { JobRunner } from "../../src/jobs/job-runner.js";
import { dedupeKeyFor, TranscriptionService } from "../../src/jobs/transcription-service.js";
import { createMemoryStores, type Stores } from "../../src/stores.js";
import { UploadTokenStore } from "../../src/upload/tokens.js";
import { MediaWorkerError } from "../../src/worker/errors.js";
import { delay, FakeWorker } from "../helpers/fake-worker.js";
import { transcriptFixture } from "../helpers/fixtures.js";

const WINDOW_MS = 86_400_000;
const OCT_15_2026 = Date.UTC(2026, 9, 15, 12);
const URL_A = "https://example.com/video/aaaaaaaaaaa";
const URL_B = "https://example.com/video/bbbbbbbbbbb";
const ANON = (clientKey: string): Caller => ({ kind: "anonymous", clientKey });

function build(worker: FakeWorker, allowance = 5) {
  let clock = OCT_15_2026;
  const now = () => clock;
  const stores: Stores = createMemoryStores({
    ttl: { activeMs: 3_600_000, succeededMs: 86_400_000, accountSucceededMs: 604_800_000, failedMs: 3_600_000 },
    now,
  });
  const quota = new CreditQuota({ allowance, windowMs: WINDOW_MS, now });
  const billing = new Billing({ quota, ledger: stores.ledger, now });
  const uploads = new UploadTokenStore({ ttlMs: 3_600_000, now });
  const runner = new JobRunner({ store: stores.jobs, worker, concurrency: 2, creditsFor: () => 1 });
  // The wait deadline uses real time; the store, quota, ledger and token clocks are the fake one above.
  const service = new TranscriptionService({
    store: stores.jobs,
    runner,
    billing,
    users: stores.users,
    uploads,
    now: Date.now,
    sleep: (ms) => delay(ms, undefined),
    mediaMaxSeconds: 3600,
  });
  return { service, runner, stores, quota, billing, uploads, advance: (ms: number) => (clock += ms) };
}

type Fixture = ReturnType<typeof build>;

type AccountCaller = Extract<Caller, { kind: "account" }>;

let accountCounter = 0;
async function accountCaller(fixture: Fixture): Promise<AccountCaller> {
  accountCounter += 1;
  const user = await fixture.stores.users.create({
    id: `usr_${accountCounter}`,
    email: `user${accountCounter}@example.test`,
    passwordHash: "scrypt$unused",
    plan: "free",
    createdAt: OCT_15_2026,
  });
  return { kind: "account", userId: user.id, plan: user.plan };
}

/** Waits until the runner has finished every run, including the credit settlement. */
async function settleRuns(fixture: Fixture): Promise<void> {
  for (let i = 0; i < 200 && (fixture.runner.runningCount > 0 || fixture.runner.queuedCount > 0); i += 1) {
    await delay(5, undefined);
  }
}

describe("TranscriptionService.request (anonymous)", () => {
  it("starts one job for concurrent identical requests and reserves quota once", async () => {
    const worker = new FakeWorker(() => delay(30, transcriptFixture()));
    const fixture = build(worker);
    const outcomes = await Promise.all([
      fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller: ANON("c1") }),
      fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller: ANON("c1") }),
    ]);
    const ids = outcomes.map((o) => (o.kind === "job" ? o.job.id : "none"));
    expect(ids[0]).toBe(ids[1]);
    expect(fixture.quota.remaining("c1")).toBe(4);
    await settleRuns(fixture);
    expect(worker.requests).toHaveLength(1);
  });

  it("returns a finished job for free: a repeat does not reserve or charge again", async () => {
    const worker = new FakeWorker();
    const fixture = build(worker);
    const first = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller: ANON("c1") });
    await settleRuns(fixture);
    const again = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller: ANON("c2") });
    expect(first.kind === "job" && again.kind === "job" && first.job.id === again.job.id).toBe(true);
    expect(fixture.quota.remaining("c1")).toBe(4);
    expect(fixture.quota.remaining("c2")).toBe(5);
  });

  it("refuses new work once the anonymous allowance is spent, with the reset time", async () => {
    const worker = new FakeWorker();
    const fixture = build(worker, 1);
    await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller: ANON("c1") });
    await settleRuns(fixture);
    const outcome = await fixture.service.request({ canonicalUrl: URL_B, platform: "public", language: "auto", caller: ANON("c1") });
    expect(outcome.kind).toBe("quota_exceeded");
    if (outcome.kind === "quota_exceeded") expect(outcome.resetAt).toBeGreaterThan(OCT_15_2026);
  });

  it("does not charge a failed job (quota comes back)", async () => {
    const worker = new FakeWorker(async () => {
      throw new MediaWorkerError("blocked_bot_check");
    });
    const fixture = build(worker);
    const outcome = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller: ANON("c1") });
    if (outcome.kind !== "job") throw new Error("expected a job");
    await fixture.service.waitForSettled(outcome.job.id, 2000, 5);
    await settleRuns(fixture);
    expect(fixture.quota.remaining("c1")).toBe(5);
  });

  it("gives an anonymous job no owner, so anyone holding the job_id can read it", async () => {
    const fixture = build(new FakeWorker());
    const outcome = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller: ANON("c1") });
    if (outcome.kind !== "job") throw new Error("expected a job");
    expect(outcome.job.ownerUserId).toBeNull();
    expect(await fixture.service.getVisible(outcome.job.id, { userId: null })).toBeDefined();
    expect(await fixture.service.getVisible(outcome.job.id, { userId: "usr_someone" })).toBeDefined();
  });
});

describe("TranscriptionService.request (accounts)", () => {
  it("holds one credit while the job runs and charges the real cost on success", async () => {
    const worker = new FakeWorker(() => delay(20, transcriptFixture()));
    const fixture = build(worker);
    const caller = await accountCaller(fixture);
    const outcome = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller });
    if (outcome.kind !== "job") throw new Error("expected a job");
    expect(await fixture.billing.remaining(caller)).toBe(19);
    await fixture.service.waitForSettled(outcome.job.id, 2000, 5);
    await settleRuns(fixture);
    expect(await fixture.stores.ledger.used(caller.userId, periodKey(OCT_15_2026))).toBe(1);
    expect((await fixture.service.get(outcome.job.id))?.ownerUserId).toBe(caller.userId);
  });

  it("charges nothing for a failed job and gives the held credit back", async () => {
    const worker = new FakeWorker(async () => {
      throw new MediaWorkerError("private_or_login_required");
    });
    const fixture = build(worker);
    const caller = await accountCaller(fixture);
    const outcome = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller });
    if (outcome.kind !== "job") throw new Error("expected a job");
    await fixture.service.waitForSettled(outcome.job.id, 2000, 5);
    await settleRuns(fixture);
    expect(await fixture.billing.remaining(caller)).toBe(20);
  });

  it("refuses with the next month's reset once the plan's credits are spent", async () => {
    const fixture = build(new FakeWorker());
    const caller = await accountCaller(fixture);
    const ok = await fixture.stores.ledger.reserve({ userId: caller.userId, jobId: "job_x", runKey: "run_x", period: periodKey(OCT_15_2026), credits: 20, allowance: 20, now: OCT_15_2026 });
    expect(ok.ok).toBe(true);
    const outcome = await fixture.service.request({ canonicalUrl: URL_B, platform: "public", language: "auto", caller });
    expect(outcome).toEqual({ kind: "quota_exceeded", resetAt: nextPeriodStart(OCT_15_2026) });
  });

  it("caps the media length at the plan's limit", async () => {
    const worker = new FakeWorker();
    const fixture = build(worker);
    const caller = await accountCaller(fixture);
    await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller });
    await settleRuns(fixture);
    expect(worker.requests[0]?.maxSeconds).toBe(600);
  });

  it("dedupes per account: one account's repeat joins its own job, another account gets its own", async () => {
    const fixture = build(new FakeWorker());
    const alice = await accountCaller(fixture);
    const bob = await accountCaller(fixture);
    const first = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller: alice });
    const repeat = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller: alice });
    const other = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller: bob });
    const ids = [first, repeat, other].map((o) => (o.kind === "job" ? o.job.id : "none"));
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    await settleRuns(fixture);
  });

  it("never lets an anonymous request join an account's job", async () => {
    const fixture = build(new FakeWorker());
    const caller = await accountCaller(fixture);
    const owned = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller });
    const anonymous = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller: ANON("c9") });
    if (owned.kind !== "job" || anonymous.kind !== "job") throw new Error("expected jobs");
    expect(anonymous.job.id).not.toBe(owned.job.id);
    expect(anonymous.job.ownerUserId).toBeNull();
    await settleRuns(fixture);
  });

  it("shows an account's job only to that account", async () => {
    const fixture = build(new FakeWorker());
    const caller = await accountCaller(fixture);
    const outcome = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller });
    if (outcome.kind !== "job") throw new Error("expected a job");
    expect(await fixture.service.getVisible(outcome.job.id, { userId: caller.userId })).toBeDefined();
    expect(await fixture.service.getVisible(outcome.job.id, { userId: "usr_intruder" })).toBeUndefined();
    expect(await fixture.service.getVisible(outcome.job.id, { userId: null })).toBeUndefined();
    await settleRuns(fixture);
  });

  it("lets only the owner delete a finished job, and refuses to delete a running one", async () => {
    const worker = new FakeWorker(() => delay(60, transcriptFixture()));
    const fixture = build(worker);
    const caller = await accountCaller(fixture);
    const outcome = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller });
    if (outcome.kind !== "job") throw new Error("expected a job");
    expect(await fixture.service.deleteJob(outcome.job.id, { userId: caller.userId })).toBe("in_progress");
    expect(await fixture.service.deleteJob(outcome.job.id, { userId: "usr_intruder" })).toBe("not_found");
    await fixture.service.waitForSettled(outcome.job.id, 2000, 5);
    expect(await fixture.service.deleteJob(outcome.job.id, { userId: caller.userId })).toBe("deleted");
    expect(await fixture.service.deleteJob(outcome.job.id, { userId: caller.userId })).toBe("not_found");
    await settleRuns(fixture);
  });

  it("charges the owner, not the uploader, when a failed account job is continued by upload", async () => {
    const worker = new FakeWorker(async (_request, call) => {
      if (call === 0) throw new MediaWorkerError("retrieval_failed");
      return transcriptFixture();
    });
    const fixture = build(worker);
    const owner = await accountCaller(fixture);
    const outcome = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller: owner });
    if (outcome.kind !== "job") throw new Error("expected a job");
    await fixture.service.waitForSettled(outcome.job.id, 2000, 5);
    await settleRuns(fixture);
    const result = await fixture.service.continueFailedJob(outcome.job.id, { path: "/tmp/upload.mp4", cleanup: async () => undefined }, "uploader");
    expect(result).toBe("accepted");
    await fixture.service.waitForSettled(outcome.job.id, 2000, 5);
    await settleRuns(fixture);
    expect(await fixture.billing.remaining(owner)).toBe(19);
    expect(fixture.quota.remaining("uploader")).toBe(5);
  });
});

describe("TranscriptionService upload continuation", () => {
  it("re-runs a failed job from an uploaded file under the same job id", async () => {
    const worker = new FakeWorker(async (_request, call) => {
      if (call === 0) throw new MediaWorkerError("retrieval_failed");
      return transcriptFixture();
    });
    const fixture = build(worker);
    const outcome = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller: ANON("c1") });
    if (outcome.kind !== "job") throw new Error("expected a job");
    await fixture.service.waitForSettled(outcome.job.id, 2000, 5);
    await settleRuns(fixture);

    let cleaned = false;
    const start = await fixture.service.continueFailedJob(
      outcome.job.id,
      {
        path: "/tmp/upload.mp4",
        cleanup: async () => {
          cleaned = true;
        },
      },
      "c1",
    );
    expect(start).toBe("accepted");
    const done = await fixture.service.waitForSettled(outcome.job.id, 2000, 5);
    expect(done?.status).toBe("succeeded");
    expect(worker.requests[1]?.target).toEqual({ kind: "file", path: "/tmp/upload.mp4" });
    await settleRuns(fixture);
    expect(cleaned).toBe(true);
    expect((await fixture.stores.jobs.get(outcome.job.id))?.failure).toBeNull();
  });

  it("reports not_found and not_failed without touching the job", async () => {
    const worker = new FakeWorker(() => delay(200, transcriptFixture()));
    const fixture = build(worker);
    const missing = await fixture.service.continueFailedJob("job_missing", { path: "/tmp/x", cleanup: async () => undefined }, "c1");
    expect(missing).toBe("not_found");
    const outcome = await fixture.service.request({ canonicalUrl: URL_A, platform: "public", language: "auto", caller: ANON("c1") });
    if (outcome.kind !== "job") throw new Error("expected a job");
    const running = await fixture.service.continueFailedJob(outcome.job.id, { path: "/tmp/x", cleanup: async () => undefined }, "c1");
    expect(running).toBe("not_failed");
    await settleRuns(fixture);
  });

  it("starts a new upload job per file, charged to the caller", async () => {
    const worker = new FakeWorker();
    const fixture = build(worker);
    const caller = await accountCaller(fixture);
    const first = await fixture.service.startFileJob(caller, { path: "/tmp/a.mp4", cleanup: async () => undefined });
    const second = await fixture.service.startFileJob(caller, { path: "/tmp/b.mp4", cleanup: async () => undefined });
    if (first.kind !== "job" || second.kind !== "job") throw new Error("expected jobs");
    expect(first.job.id).not.toBe(second.job.id);
    expect(first.job.platform).toBe("upload");
    await settleRuns(fixture);
    expect(await fixture.billing.remaining(caller)).toBe(18);
  });

  it("revokes older upload links when a new one is issued for the same job", async () => {
    const worker = new FakeWorker();
    const fixture = build(worker);
    const first = fixture.service.issueUploadToken("job_1");
    const second = fixture.service.issueUploadToken("job_1");
    expect(fixture.uploads.acquire(first).ok).toBe(false);
    expect(fixture.uploads.acquire(second).ok).toBe(true);
  });
});

describe("dedupeKeyFor", () => {
  it("scopes account keys per user and keeps anonymous requests in one shared scope", () => {
    expect(dedupeKeyFor(ANON("1.2.3.4"), URL_A, "auto")).toBe(dedupeKeyFor(ANON("9.9.9.9"), URL_A, "auto"));
    expect(dedupeKeyFor({ kind: "account", userId: "usr_1", plan: "free" }, URL_A, "auto")).not.toBe(
      dedupeKeyFor({ kind: "account", userId: "usr_2", plan: "free" }, URL_A, "auto"),
    );
    expect(dedupeKeyFor({ kind: "account", userId: "usr_1", plan: "free" }, URL_A, "auto")).not.toBe(dedupeKeyFor(ANON("x"), URL_A, "auto"));
  });
});
