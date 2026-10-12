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

export interface BillingDeps {
  readonly quota: CreditQuota;
  readonly ledger: CreditLedger;
  readonly now: () => number;
}

/** Anonymous runs pay from the sliding-window quota; account runs pay from the plan's monthly credits. */
export class Billing {
  constructor(private readonly deps: BillingDeps) {}

  async hold(caller: Caller, jobId: string): Promise<HoldOutcome> {
    if (caller.kind === "anonymous") return this.holdAnonymous(caller.clientKey);
    return this.holdAccount(caller.userId, caller.plan, jobId);
  }

  async remaining(caller: Caller): Promise<number> {
    if (caller.kind === "anonymous") return this.deps.quota.remaining(caller.clientKey);
    const used = await this.deps.ledger.used(caller.userId, periodKey(this.deps.now()));
    return Math.max(0, planDefinition(caller.plan).monthlyCredits - used);
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
    const reserved = await this.deps.ledger.reserve({
      userId,
      jobId,
      runKey,
      period,
      credits: RUN_HOLD_CREDITS,
      allowance: planDefinition(plan).monthlyCredits,
      now,
    });
    if (!reserved.ok) return { ok: false, resetAt: nextPeriodStart(now) };
    const hold: Hold = {
      settle: (creditsCharged) =>
        this.deps.ledger.settle({
          userId,
          jobId,
          runKey,
          period,
          reserved: RUN_HOLD_CREDITS,
          charged: creditsCharged,
          now: this.deps.now(),
        }),
    };
    return { ok: true, hold };
  }
}
