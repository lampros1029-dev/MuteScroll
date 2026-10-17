import { describe, expect, it } from "vitest";

import type { Caller } from "../../src/caller.js";
import { Billing, RUN_HOLD_CREDITS, type HoldOutcome } from "../../src/billing/billing.js";
import { MemoryCreditLedger } from "../../src/billing/memory-credit-ledger.js";
import { nextPeriodStart, periodKey } from "../../src/billing/period.js";
import { listPlans, parsePlanId, planDefinition } from "../../src/billing/plans.js";
import { CreditQuota } from "../../src/quota/credit-quota.js";

const OCT_15 = Date.UTC(2026, 9, 15, 12);
const DAY = 86_400_000;
const ACCOUNT: Caller = { kind: "account", userId: "usr_1", plan: "free" };

describe("plans (PRD 20.2)", () => {
  it("maps each plan to its monthly credits and longest video", () => {
    expect(planDefinition("free")).toMatchObject({ monthlyCredits: 20, maxVideoSeconds: 600, priceUsdMonthly: 0 });
    expect(planDefinition("creator")).toMatchObject({ monthlyCredits: 400, maxVideoSeconds: 3600, priceUsdMonthly: 7.99 });
    expect(planDefinition("pro")).toMatchObject({ monthlyCredits: 1500, maxVideoSeconds: 10_800, priceUsdMonthly: 16.99 });
    expect(planDefinition("team")).toMatchObject({ monthlyCredits: 6000, maxVideoSeconds: 10_800, priceUsdMonthly: 49 });
  });

  it("lists the four plans in order, with no checkout links", () => {
    const plans = listPlans();
    expect(plans.map((plan) => plan.id)).toEqual(["free", "creator", "pro", "team"]);
    expect(JSON.stringify(plans)).not.toMatch(/checkout|paddle|stripe/i);
  });

  it("treats an unknown stored plan as free", () => {
    expect(parsePlanId("creator")).toBe("creator");
    expect(parsePlanId("enterprise-legacy")).toBe("free");
  });
});

describe("calendar periods (UTC)", () => {
  it("names the month a timestamp falls in", () => {
    expect(periodKey(Date.UTC(2026, 9, 31, 23, 59, 59))).toBe("2026-10");
    expect(periodKey(Date.UTC(2026, 10, 1, 0, 0, 0))).toBe("2026-11");
  });

  it("finds the next month start, across a year end", () => {
    expect(nextPeriodStart(OCT_15)).toBe(Date.UTC(2026, 10, 1));
    expect(nextPeriodStart(Date.UTC(2026, 11, 31, 23, 0))).toBe(Date.UTC(2027, 0, 1));
  });
});

describe("MemoryCreditLedger", () => {
  function ledgerWith() {
    return new MemoryCreditLedger();
  }
  const base = { userId: "usr_1", jobId: "job_1", period: "2026-10", now: OCT_15 };

  it("holds credits while the period has room and refuses beyond the allowance", async () => {
    const ledger = ledgerWith();
    expect(await ledger.reserve({ ...base, runKey: "r1", credits: 1, allowance: 2 })).toEqual({ ok: true });
    expect(await ledger.reserve({ ...base, runKey: "r2", credits: 1, allowance: 2 })).toEqual({ ok: true });
    expect(await ledger.reserve({ ...base, runKey: "r3", credits: 1, allowance: 2 })).toEqual({ ok: false });
    expect(await ledger.used("usr_1", "2026-10")).toBe(2);
  });

  it("writes a reservation once per run, however often it is retried", async () => {
    const ledger = ledgerWith();
    await ledger.reserve({ ...base, runKey: "r1", credits: 1, allowance: 5 });
    await ledger.reserve({ ...base, runKey: "r1", credits: 1, allowance: 5 });
    expect(await ledger.used("usr_1", "2026-10")).toBe(1);
  });

  it("releases the hold and charges the real cost, once", async () => {
    const ledger = ledgerWith();
    await ledger.reserve({ ...base, runKey: "r1", credits: 1, allowance: 20 });
    await ledger.settle({ userId: "usr_1", jobId: "job_1", runKey: "r1", period: "2026-10", reserved: 1, charged: 3, now: OCT_15 });
    await ledger.settle({ userId: "usr_1", jobId: "job_1", runKey: "r1", period: "2026-10", reserved: 1, charged: 3, now: OCT_15 });
    expect(await ledger.used("usr_1", "2026-10")).toBe(3);
  });

  it("gives a failed run's hold back in full", async () => {
    const ledger = ledgerWith();
    await ledger.reserve({ ...base, runKey: "r1", credits: 1, allowance: 20 });
    await ledger.settle({ userId: "usr_1", jobId: "job_1", runKey: "r1", period: "2026-10", reserved: 1, charged: 0, now: OCT_15 });
    expect(await ledger.used("usr_1", "2026-10")).toBe(0);
  });

  it("releases a hold that never settled, once, and a late settle still charges correctly", async () => {
    const ledger = ledgerWith();
    await ledger.reserve({ ...base, runKey: "crashed", credits: 1, allowance: 20 });
    expect(await ledger.releaseStaleHolds(OCT_15 - 1, OCT_15 + 1)).toBe(0);
    expect(await ledger.used("usr_1", "2026-10")).toBe(1);
    expect(await ledger.releaseStaleHolds(OCT_15, OCT_15 + 2)).toBe(1);
    expect(await ledger.releaseStaleHolds(OCT_15, OCT_15 + 3)).toBe(0);
    expect(await ledger.used("usr_1", "2026-10")).toBe(0);
    await ledger.settle({ userId: "usr_1", jobId: "job_1", runKey: "crashed", period: "2026-10", reserved: 1, charged: 2, now: OCT_15 + 4 });
    expect(await ledger.used("usr_1", "2026-10")).toBe(2);
  });

  it("keeps each period and each user separate", async () => {
    const ledger = ledgerWith();
    await ledger.reserve({ ...base, runKey: "r1", credits: 1, allowance: 20 });
    await ledger.reserve({ ...base, userId: "usr_2", runKey: "r2", credits: 1, allowance: 20 });
    expect(await ledger.used("usr_1", "2026-11")).toBe(0);
    expect(await ledger.used("usr_1", "2026-10")).toBe(1);
    expect(await ledger.used("usr_2", "2026-10")).toBe(1);
  });
});

describe("Billing", () => {
  function setup(allowanceCredits = 20) {
    let clock = OCT_15;
    const now = () => clock;
    const quota = new CreditQuota({ allowance: 5, windowMs: DAY, now });
    const ledger = new MemoryCreditLedger();
    const billing = new Billing({ quota, ledger, now });
    return { billing, ledger, quota, advance: (ms: number) => (clock += ms), allowanceCredits };
  }

  it("holds the minimum charge for an account run and settles it to the real cost", async () => {
    const { billing } = setup();
    const outcome = await billing.hold(ACCOUNT, "job_1");
    if (!outcome.ok) throw new Error("expected a hold");
    expect(await billing.remaining(ACCOUNT)).toBe(20 - RUN_HOLD_CREDITS);
    await outcome.hold.settle(4);
    expect(await billing.remaining(ACCOUNT)).toBe(16);
  });

  it("returns the whole hold for a failed run", async () => {
    const { billing } = setup();
    const outcome = await billing.hold(ACCOUNT, "job_1");
    if (!outcome.ok) throw new Error("expected a hold");
    await outcome.hold.settle(0);
    expect(await billing.remaining(ACCOUNT)).toBe(20);
  });

  it("refuses an account with no credits left and reports the next reset", async () => {
    const { billing, ledger } = setup();
    await ledger.reserve({ userId: "usr_1", jobId: "job_x", runKey: "x", period: "2026-10", credits: 20, allowance: 20, now: OCT_15 });
    const outcome = await billing.hold(ACCOUNT, "job_1");
    expect(outcome).toEqual({ ok: false, resetAt: nextPeriodStart(OCT_15) });
    expect(billing.resetAt(ACCOUNT)).toBe(nextPeriodStart(OCT_15));
    expect(await billing.remaining(ACCOUNT)).toBe(0);
  });

  it("does not let one bonus credit reserve extra jobs once the monthly allowance is spent", async () => {
    let bonus = 1;
    const ledger = new MemoryCreditLedger();
    const billing = new Billing({
      quota: new CreditQuota({ allowance: 5, windowMs: DAY, now: () => OCT_15 }),
      ledger,
      now: () => OCT_15,
      bonus: {
        get: async () => bonus,
        consume: async (_userId, credits) => {
          bonus = Math.max(0, bonus - credits);
        },
      },
    });
    const monthly = planDefinition(ACCOUNT.plan).monthlyCredits;
    const period = periodKey(OCT_15);
    await ledger.reserve({ userId: ACCOUNT.userId, jobId: "spent", runKey: "spent", period, credits: monthly, allowance: monthly, now: OCT_15 });
    await ledger.settle({ userId: ACCOUNT.userId, jobId: "spent", runKey: "spent", period, reserved: monthly, charged: monthly, now: OCT_15 });

    const outcomes: HoldOutcome[] = [];
    for (let i = 0; i < 6; i += 1) outcomes.push(await billing.hold(ACCOUNT, `extra_${i}`));
    const accepted = outcomes.filter((outcome) => outcome.ok);
    expect(accepted).toHaveLength(1);
    expect(await ledger.used(ACCOUNT.userId, period)).toBe(monthly + 1);

    const hold = accepted[0];
    if (hold === undefined) throw new Error("expected one hold");
    await hold.hold.settle(monthly);
    expect(await ledger.used(ACCOUNT.userId, period)).toBe(monthly + 1);
    expect(bonus).toBe(0);
  });

  it("uses the IP quota for anonymous callers and returns the hold when settled with nothing", async () => {
    const { billing, quota } = setup();
    const anonymous: Caller = { kind: "anonymous", clientKey: "203.0.113.5" };
    const outcome = await billing.hold(anonymous, "job_1");
    if (!outcome.ok) throw new Error("expected a hold");
    expect(quota.remaining("203.0.113.5")).toBe(4);
    await outcome.hold.settle(0);
    expect(await billing.remaining(anonymous)).toBe(5);
  });

  it("refuses an anonymous caller once the window is spent, with its reset time", async () => {
    const { billing, quota, advance } = setup();
    const anonymous: Caller = { kind: "anonymous", clientKey: "203.0.113.5" };
    for (let i = 0; i < 5; i += 1) {
      const outcome = await billing.hold(anonymous, `job_${i}`);
      if (!outcome.ok) throw new Error("expected a hold");
      await outcome.hold.settle(1);
    }
    advance(1000);
    const refused = await billing.hold(anonymous, "job_refused");
    expect(refused.ok).toBe(false);
    expect(refused.ok ? 0 : refused.resetAt).toBe(quota.resetAt("203.0.113.5"));
  });
});
