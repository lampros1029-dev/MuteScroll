import { describe, expect, it } from "vitest";

import { MemoryJobStore } from "../../src/jobs/memory-job-store.js";

const TTL = { activeMs: 1000, succeededMs: 5000, failedMs: 2000 };

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

const input = (id: string, key = "k1") => ({ id, key, language: "auto", ownerKey: "client-a" });

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
    await store.update("job_1", { status: "queued", failure: null });
    expect((await store.findReusable("k1"))?.id).toBe("job_1");
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

describe("MemoryJobStore snapshots", () => {
  it("returns copies, so callers cannot mutate stored state", async () => {
    const { store } = makeStore();
    const { job } = await store.createOrReuse(input("job_1"));
    (job as { status: string }).status = "succeeded";
    expect((await store.get("job_1"))?.status).toBe("queued");
  });
});
