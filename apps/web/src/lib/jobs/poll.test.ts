import { describe, expect, it } from "vitest";

import { DEFAULT_POLL_INTERVAL_MS, DEFAULT_POLL_TIMEOUT_MS, pollUntilSettled, type PollResult } from "./poll";

/** A fake clock: `sleep` advances time instead of waiting, so the 10-minute window runs instantly. */
function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}

describe("pollUntilSettled", () => {
  it("keeps polling at the interval until the job is done", async () => {
    const clock = fakeClock();
    const script: PollResult<string, string>[] = [
      { status: "pending" },
      { status: "pending" },
      { status: "done", value: "transcript" },
    ];
    let calls = 0;
    const outcome = await pollUntilSettled<string, string>({
      signal: new AbortController().signal,
      intervalMs: DEFAULT_POLL_INTERVAL_MS,
      timeoutMs: DEFAULT_POLL_TIMEOUT_MS,
      now: clock.now,
      sleep: clock.sleep,
      check: async () => script[calls++] ?? { status: "pending" },
    });
    expect(outcome).toEqual({ kind: "done", value: "transcript" });
    expect(calls).toBe(3);
  });

  it("stops on a terminal failure without retrying", async () => {
    const clock = fakeClock();
    let calls = 0;
    const outcome = await pollUntilSettled<string, string>({
      signal: new AbortController().signal,
      intervalMs: 3000,
      timeoutMs: 60_000,
      now: clock.now,
      sleep: clock.sleep,
      check: async () => {
        calls += 1;
        return { status: "failed", error: "retrieval_failed" };
      },
    });
    expect(outcome).toEqual({ kind: "failed", error: "retrieval_failed" });
    expect(calls).toBe(1);
  });

  it("gives up politely after ten minutes of pending results", async () => {
    const clock = fakeClock();
    let calls = 0;
    const outcome = await pollUntilSettled<string, string>({
      signal: new AbortController().signal,
      intervalMs: DEFAULT_POLL_INTERVAL_MS,
      timeoutMs: DEFAULT_POLL_TIMEOUT_MS,
      now: clock.now,
      sleep: clock.sleep,
      check: async () => {
        calls += 1;
        return { status: "pending" };
      },
    });
    expect(outcome).toEqual({ kind: "timeout" });
    // One check at t=0, then one every 3 s until the 600 s window has passed.
    expect(calls).toBe(DEFAULT_POLL_TIMEOUT_MS / DEFAULT_POLL_INTERVAL_MS + 1);
    expect(clock.now()).toBe(DEFAULT_POLL_TIMEOUT_MS);
  });

  it("retries transient failures and resets the count after a good answer", async () => {
    const clock = fakeClock();
    const script: PollResult<string, string>[] = [
      { status: "failed", error: "network", transient: true },
      { status: "failed", error: "network", transient: true },
      { status: "pending" },
      { status: "failed", error: "network", transient: true },
      { status: "failed", error: "network", transient: true },
      { status: "done", value: "ok" },
    ];
    let calls = 0;
    const outcome = await pollUntilSettled<string, string>({
      signal: new AbortController().signal,
      intervalMs: 1000,
      timeoutMs: 60_000,
      now: clock.now,
      sleep: clock.sleep,
      check: async () => script[calls++] ?? { status: "pending" },
    });
    expect(outcome).toEqual({ kind: "done", value: "ok" });
  });

  it("reports unreachable after repeated transient failures", async () => {
    const clock = fakeClock();
    const outcome = await pollUntilSettled<string, string>({
      signal: new AbortController().signal,
      intervalMs: 1000,
      timeoutMs: 60_000,
      now: clock.now,
      sleep: clock.sleep,
      check: async () => ({ status: "failed", error: "network", transient: true }),
    });
    expect(outcome).toEqual({ kind: "unreachable" });
  });

  it("stops when the caller aborts, without another request", async () => {
    const controller = new AbortController();
    let calls = 0;
    const outcome = await pollUntilSettled<string, string>({
      signal: controller.signal,
      intervalMs: 1,
      timeoutMs: 60_000,
      check: async () => {
        calls += 1;
        controller.abort();
        return { status: "pending" };
      },
    });
    expect(outcome).toEqual({ kind: "aborted" });
    expect(calls).toBe(1);
  });

  it("uses the real timer by default and still honours abort", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    const outcome = await pollUntilSettled<string, string>({
      signal: controller.signal,
      intervalMs: 1,
      timeoutMs: 60_000,
      check: async () => ({ status: "pending" }),
    });
    expect(outcome).toEqual({ kind: "aborted" });
  });
});
