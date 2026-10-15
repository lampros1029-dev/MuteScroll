import { describe, expect, it } from "vitest";

import { LiveJobConflictError } from "../../src/jobs/job-store.js";
import { MemoryJobStore } from "../../src/jobs/memory-job-store.js";
import { transcriptFixture } from "../helpers/fixtures.js";

const TTL = { activeMs: 1000, succeededMs: 5000, accountSucceededMs: 50_000, failedMs: 2000 };

function makeStore() {
  let clock = 0;
  const store = new MemoryJobStore({ ttl: TTL, now: () => clock });
  return {
    store,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const input = (id: string, key = "k1", ownerUserId: string | null = null) => ({
  id,
  key,
  language: "auto",
  platform: "public",
  ownerUserId,
});

describe("MemoryJobStore dedupe", () => {
  it("returns the live job for the same key instead of creating another", async () => {
    const { store } = makeStore();
    const first = await store.createOrReuse(input("job_1"));
    const second = await store.createOrReuse(input("job_2"));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe("job_1");
  });

  it("reuses succeeded jobs but never failed ones", async () => {
    const { store } = makeStore();
    await store.createOrReuse(input("job_1"));
    await store.update("job_1", { status: "failed", failure: "blocked_bot_check" });
    expect(await store.findReusable("k1")).toBeUndefined();
    const retry = await store.createOrReuse(input("job_2"));
    expect(retry.created).toBe(true);
    await store.update("job_2", { status: "succeeded", result: null, creditsCharged: 1 });
    expect((await store.findReusable("k1"))?.id).toBe("job_2");
  });

  it("keeps different languages or URLs separate", async () => {
    const { store } = makeStore();
    const a = await store.createOrReuse(input("job_1", "https://x|en"));
    const b = await store.createOrReuse(input("job_2", "https://x|el"));
    expect(a.job.id).not.toBe(b.job.id);
  });

  it("re-indexes a job that is re-queued after failing (upload continuation)", async () => {
    const { store } = makeStore();
    await store.createOrReuse(input("job_1"));
    await store.update("job_1", { status: "failed", failure: "retrieval_failed" });
    const requeued = await store.requeueFailed("job_1");
    expect(requeued?.status).toBe("queued");
    expect((await store.findReusable("k1"))?.id).toBe("job_1");
  });

  it("refuses to re-queue a failed job while another live job holds its key", async () => {
    const { store } = makeStore();
    await store.createOrReuse(input("job_1"));
    await store.update("job_1", { status: "failed", failure: "retrieval_failed" });
    await store.createOrReuse(input("job_2"));
    await expect(store.requeueFailed("job_1")).rejects.toBeInstanceOf(LiveJobConflictError);
  });

  it("returns undefined from requeueFailed for jobs that are not failed", async () => {
    const { store } = makeStore();
    await store.createOrReuse(input("job_1"));
    expect(await store.requeueFailed("job_1")).toBeUndefined();
    expect(await store.requeueFailed("job_missing")).toBeUndefined();
  });

  it("lets an expired holder stop blocking its key", async () => {
    const { store, advance } = makeStore();
    await store.createOrReuse(input("job_1"));
    advance(1500);
    const fresh = await store.createOrReuse(input("job_2"));
    expect(fresh.created).toBe(true);
    expect((await store.findReusable("k1"))?.id).toBe("job_2");
  });
});

describe("MemoryJobStore TTL", () => {
  it("uses the active TTL while queued or running, then the terminal TTL", async () => {
    const { store, advance } = makeStore();
    await store.createOrReuse(input("job_1"));
    advance(999);
    expect(await store.get("job_1")).toBeDefined();
    advance(2);
    expect(await store.get("job_1")).toBeUndefined();
  });

  it("extends expiry when a job reaches a terminal state", async () => {
    const { store, advance } = makeStore();
    await store.createOrReuse(input("job_1"));
    advance(500);
    await store.update("job_1", { status: "failed", failure: "no_speech" });
    advance(1500);
    expect((await store.get("job_1"))?.status).toBe("failed");
    advance(600);
    expect(await store.get("job_1")).toBeUndefined();
  });

  it("keeps account-owned successes for the longer library retention", async () => {
    const { store, advance } = makeStore();
    await store.createOrReuse(input("job_anon", "anon-key"));
    await store.createOrReuse(input("job_user", "user-key", "usr_1"));
    await store.update("job_anon", { status: "succeeded", result: transcriptFixture(), creditsCharged: 1 });
    await store.update("job_user", { status: "succeeded", result: transcriptFixture(), creditsCharged: 1 });
    advance(6000);
    expect(await store.get("job_anon")).toBeUndefined();
    expect(await store.get("job_user")).toBeDefined();
  });

  it("drops expired jobs from the dedupe index too", async () => {
    const { store, advance } = makeStore();
    await store.createOrReuse(input("job_1"));
    advance(1500);
    expect(await store.findReusable("k1")).toBeUndefined();
    expect((await store.createOrReuse(input("job_2"))).created).toBe(true);
  });

  it("pruneExpired removes only expired jobs and reports the count", async () => {
    const { store, advance } = makeStore();
    await store.createOrReuse(input("job_1", "a"));
    advance(600);
    await store.createOrReuse(input("job_2", "b"));
    advance(500);
    expect(await store.pruneExpired()).toBe(1);
    expect(await store.get("job_2")).toBeDefined();
  });
});

describe("MemoryJobStore account views", () => {
  it("lists only the owner's jobs, newest first, with the title from the result", async () => {
    const { store, advance } = makeStore();
    await store.createOrReuse(input("job_old", "u-old", "usr_1"));
    advance(10);
    await store.createOrReuse(input("job_other", "o-1", "usr_2"));
    advance(10);
    await store.createOrReuse(input("job_new", "u-new", "usr_1"));
    await store.update("job_new", { status: "succeeded", result: transcriptFixture(), creditsCharged: 1 });
    const page = await store.listForUser("usr_1", { limit: 10, offset: 0 });
    expect(page.map((item) => item.id)).toEqual(["job_new", "job_old"]);
    expect(page[0]).toMatchObject({ status: "succeeded", platform: "public", title: "Demo" });
    expect(page[1]?.title).toBeNull();
  });

  it("pages the listing", async () => {
    const { store, advance } = makeStore();
    for (const id of ["job_a", "job_b", "job_c"]) {
      await store.createOrReuse(input(id, id, "usr_1"));
      advance(1);
    }
    const page = await store.listForUser("usr_1", { limit: 1, offset: 1 });
    expect(page.map((item) => item.id)).toEqual(["job_b"]);
  });

  it("removes only finished jobs", async () => {
    const { store } = makeStore();
    await store.createOrReuse(input("job_1"));
    expect(await store.removeFinished("job_1")).toBe(false);
    await store.update("job_1", { status: "succeeded", result: transcriptFixture(), creditsCharged: 1 });
    expect(await store.removeFinished("job_1")).toBe(true);
    expect(await store.get("job_1")).toBeUndefined();
    expect(await store.removeFinished("job_1")).toBe(false);
  });
});

describe("MemoryJobStore snapshots", () => {
  it("returns copies, so callers cannot mutate stored state", async () => {
    const { store } = makeStore();
    const { job } = await store.createOrReuse(input("job_1"));
    (job as { status: string }).status = "succeeded";
    expect((await store.get("job_1"))?.status).toBe("queued");
  });
});
