import { describe, expect, it } from "vitest";

import { CreditQuota } from "../../src/quota/credit-quota.js";
import { SlidingWindowLimiter } from "../../src/quota/sliding-window.js";

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("SlidingWindowLimiter", () => {
  it("allows up to the limit inside the window, then blocks with the time to retry", () => {
    const c = clock();
    const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 60_000, now: c.now });
    expect(limiter.hit("ip").allowed).toBe(true);
    c.advance(10_000);
    expect(limiter.hit("ip").allowed).toBe(true);
    const blocked = limiter.hit("ip");
    expect(blocked).toEqual({ allowed: false, retryAfterMs: 50_000 });
  });

  it("frees capacity as old hits slide out of the window", () => {
    const c = clock();
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 60_000, now: c.now });
    expect(limiter.hit("ip").allowed).toBe(true);
    c.advance(59_999);
    expect(limiter.hit("ip").allowed).toBe(false);
    c.advance(1);
    expect(limiter.hit("ip").allowed).toBe(true);
  });

  it("keeps clients independent", () => {
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 60_000, now: clock().now });
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("b").allowed).toBe(true);
  });

  it("does not record rejected hits, so a client is not punished for retrying", () => {
    const c = clock();
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 1000, now: c.now });
    limiter.hit("ip");
    for (let i = 0; i < 5; i += 1) limiter.hit("ip");
    c.advance(1000);
    expect(limiter.hit("ip").allowed).toBe(true);
  });
});

describe("CreditQuota", () => {
  const DAY = 86_400_000;

  it("reserves while work is pending and charges the real cost on settle", () => {
    const quota = new CreditQuota({ allowance: 3, windowMs: DAY, now: clock().now });
    expect(quota.tryReserve("c")).toBe(true);
    expect(quota.remaining("c")).toBe(2);
    quota.settle("c", 2);
    expect(quota.remaining("c")).toBe(1);
  });

  it("returns the reservation without a charge when a job fails", () => {
    const quota = new CreditQuota({ allowance: 1, windowMs: DAY, now: clock().now });
    expect(quota.tryReserve("c")).toBe(true);
    expect(quota.tryReserve("c")).toBe(false);
    quota.settle("c", 0);
    expect(quota.remaining("c")).toBe(1);
  });

  it("blocks new work when the allowance is spent and reports the reset time", () => {
    const c = clock(1000);
    const quota = new CreditQuota({ allowance: 1, windowMs: DAY, now: c.now });
    quota.tryReserve("c");
    quota.settle("c", 1);
    expect(quota.tryReserve("c")).toBe(false);
    expect(quota.resetAt("c")).toBe(1000 + DAY);
  });

  it("gives credits back when charges age out of the window", () => {
    const c = clock();
    const quota = new CreditQuota({ allowance: 1, windowMs: DAY, now: c.now });
    quota.tryReserve("c");
    quota.settle("c", 1);
    c.advance(DAY);
    expect(quota.remaining("c")).toBe(1);
  });

  it("releases a reservation that was never used", () => {
    const quota = new CreditQuota({ allowance: 1, windowMs: DAY, now: clock().now });
    quota.tryReserve("c");
    quota.release("c");
    expect(quota.remaining("c")).toBe(1);
  });
});
