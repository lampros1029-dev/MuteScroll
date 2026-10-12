export const PLAN_IDS = ["free", "creator", "pro", "team"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanDefinition {
  readonly id: PlanId;
  readonly name: string;
  /** Credits per calendar month (UTC). 1 credit = up to 10 minutes of audio (PRD 19, 20.2). */
  readonly monthlyCredits: number;
  /** Longest single video the plan may process (PRD 20.2). */
  readonly maxVideoSeconds: number;
  /** Informational list price (PRD 20.2). Checkout only happens on the web app (M3b). */
  readonly priceUsdMonthly: number;
}

/** Plan -> limits table (PRD 20.2). Only `free` is assigned until paid plans ship in M3b. */
const PLANS: Readonly<Record<PlanId, PlanDefinition>> = {
  free: { id: "free", name: "Free", monthlyCredits: 20, maxVideoSeconds: 10 * 60, priceUsdMonthly: 0 },
  creator: { id: "creator", name: "Creator", monthlyCredits: 400, maxVideoSeconds: 60 * 60, priceUsdMonthly: 7.99 },
  pro: { id: "pro", name: "Pro", monthlyCredits: 1500, maxVideoSeconds: 3 * 60 * 60, priceUsdMonthly: 16.99 },
  team: { id: "team", name: "Team / API", monthlyCredits: 6000, maxVideoSeconds: 3 * 60 * 60, priceUsdMonthly: 49 },
};

export function planDefinition(plan: PlanId): PlanDefinition {
  return PLANS[plan];
}

export function listPlans(): PlanDefinition[] {
  return PLAN_IDS.map((id) => PLANS[id]);
}

/** Maps a stored plan value back to a known plan; anything unknown is treated as free. */
export function parsePlanId(value: string): PlanId {
  return (PLAN_IDS as readonly string[]).includes(value) ? (value as PlanId) : "free";
}
