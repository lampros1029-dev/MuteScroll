import { randomUUID } from "node:crypto";

import type { Caller } from "../caller.js";
import type { CreditQuota } from "../quota/credit-quota.js";
import type { CreditLedger } from "./credit-ledger.js";
import { nextPeriodStart, periodKey } from "./period.js";
import { planDefinition, type PlanId } from "./plans.js";

/**
 * Credits held when a run starts. The duration is unknown until retrieval, so a run holds the minimum
 * charge; the real cost is committed when the job settles (PRD 20.5).
 */
export const RUN_HOLD_CREDITS = 1;

export interface Hold {
  /** Ends the hold: releases it and charges `creditsCharged` (0 for a failed or unused run). Idempotent. */
  readonly settle: (creditsCharged: number) => Promise<void>;
}

export type HoldOutcome = { readonly ok: true; readonly hold: Hold } | { readonly ok: false; readonly resetAt: number };

/** Pack balance for one account. Missing users read as zero. */
export interface BonusBalance {
  get(userId: string): Promise<number>;
  consume(userId: string, credits: number): Promise<void>;
}

const NO_BONUS: BonusBalance = {
  get: async () => 0,
  consume: async () => undefined,
};

export interface BillingDeps {
  readonly quota: CreditQuota;
  readonly ledger: CreditLedger;
  readonly now: () => number;
  readonly bonus?: BonusBalance;
}

export interface AccountCreditSnapshot {
  readonly remaining: number;
  readonly allowance: number;
  readonly used: number;
  readonly bonus: number;
  readonly resetsAt: number;
}

/** Anonymous runs pay from the sliding-window quota; account runs pay from the plan's monthly credits. */
export class Billing {
  private readonly bonus: BonusBalance;

  constructor(private readonly deps: BillingDeps) {
    this.bonus = deps.bonus ?? NO_BONUS;
  }

  async hold(caller: Caller, jobId: string): Promise<HoldOutcome> {
    if (caller.kind === "anonymous") return this.holdAnonymous(caller.clientKey);
    return this.holdAccount(caller.userId, caller.plan, jobId);
  }

  async remaining(caller: Caller): Promise<number> {
    if (caller.kind === "anonymous") return this.deps.quota.remaining(caller.clientKey);
    return (await this.accountSnapshot(caller.userId, caller.plan)).remaining;
  }

  /** Monthly allowance, period usage, and pack credits for a signed-in account. */
  async accountSnapshot(userId: string, plan: PlanId): Promise<AccountCreditSnapshot> {
    const used = await this.deps.ledger.used(userId, periodKey(this.deps.now()));
    const allowance = planDefinition(plan).monthlyCredits;
    const bonus = Math.max(0, await this.bonus.get(userId));
    return {
      remaining: Math.max(0, allowance - used) + bonus,
      allowance,
      used,
      bonus,
      resetsAt: nextPeriodStart(this.deps.now()),
    };
  }

  resetAt(caller: Caller): number {
    if (caller.kind === "anonymous") return this.deps.quota.resetAt(caller.clientKey);
    return nextPeriodStart(this.deps.now());
  }

  private holdAnonymous(clientKey: string): HoldOutcome {
    if (!this.deps.quota.tryReserve(clientKey)) return { ok: false, resetAt: this.deps.quota.resetAt(clientKey) };
    const hold: Hold = { settle: async (creditsCharged) => this.deps.quota.settle(clientKey, creditsCharged) };
    return { ok: true, hold };
  }

  private async holdAccount(userId: string, plan: PlanId, jobId: string): Promise<HoldOutcome> {
    const now = this.deps.now();
    const period = periodKey(now);
    const runKey = randomUUID();
    const monthly = planDefinition(plan).monthlyCredits;
    const bonus = Math.max(0, await this.bonus.get(userId));
    const budget = monthly + bonus;
    const reserved = await this.deps.ledger.reserve({
      userId,
      jobId,
      runKey,
      period,
      credits: RUN_HOLD_CREDITS,
      allowance: budget,
      now,
    });
    if (!reserved.ok) return { ok: false, resetAt: nextPeriodStart(now) };
    const hold: Hold = {
      settle: async (creditsCharged) => {
        const usedBefore = await this.deps.ledger.used(userId, period);
        const committedBefore = Math.max(0, usedBefore - RUN_HOLD_CREDITS);
        const room = Math.max(0, budget - committedBefore);
        const charged = Math.max(0, Math.min(creditsCharged, room));
        await this.deps.ledger.settle({
          userId,
          jobId,
          runKey,
          period,
          reserved: RUN_HOLD_CREDITS,
          charged,
          now: this.deps.now(),
        });
        const monthlyRoom = Math.max(0, monthly - committedBefore);
        const fromBonus = Math.max(0, charged - monthlyRoom);
        if (fromBonus > 0) await this.bonus.consume(userId, fromBonus);
      },
    };
    return { ok: true, hold };
  }
}
