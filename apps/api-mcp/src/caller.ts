import type { PlanId } from "./billing/plans.js";

/**
 * Who is making a request. Anonymous callers pay from the IP quota (PRD D5); accounts pay from
 * their plan's monthly credits and own the jobs they create.
 */
export type Caller =
  | { readonly kind: "anonymous"; readonly clientKey: string }
  | { readonly kind: "account"; readonly userId: string; readonly plan: PlanId };

/** Who may read a job. `userId: null` is an anonymous viewer. */
export interface Viewer {
  readonly userId: string | null;
}

export function viewerOf(caller: Caller): Viewer {
  return { userId: caller.kind === "account" ? caller.userId : null };
}

/** Key for per-caller rate limits. Accounts share one bucket across MCP and REST. */
export function rateKeyFor(caller: Caller): string {
  return caller.kind === "account" ? `user:${caller.userId}` : caller.clientKey;
}
