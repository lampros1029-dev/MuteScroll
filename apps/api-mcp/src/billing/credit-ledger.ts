/**
 * Append-only credit ledger for accounts (PRD 20.5). Each job run writes at most three rows, keyed by
 * `reserve:<runKey>`, `release:<runKey>` and `charge:<runKey>`, so retries never double-count.
 * Usage in a period = reserves + charges - releases.
 */

export interface ReserveInput {
  readonly userId: string;
  readonly jobId: string;
  /** One key per job run (a continued upload is a new run). */
  readonly runKey: string;
  readonly period: string;
  readonly credits: number;
  readonly allowance: number;
  readonly now: number;
}

export interface SettleInput {
  readonly userId: string;
  readonly jobId: string;
  readonly runKey: string;
  readonly period: string;
  /** Credits the reservation held; released in full. */
  readonly reserved: number;
  /** Credits the finished job cost (0 when the job failed). */
  readonly charged: number;
  readonly now: number;
}

export interface CreditLedger {
  /** Holds credits while the period has room. `ok: false` writes nothing. Idempotent per run. */
  reserve(input: ReserveInput): Promise<{ readonly ok: boolean }>;
  /** Releases the hold and records the charge. Idempotent per run. */
  settle(input: SettleInput): Promise<void>;
  /**
   * Releases holds created at or before `cutoff` that were never settled, e.g. after a crash.
   * It writes the same `release:<runKey>` row that settle would, so a late settle still charges
   * correctly and never releases twice. Returns how many holds were released.
   */
  releaseStaleHolds(cutoff: number, now: number): Promise<number>;
  /** Credits in use for a user in a period (charges plus holds that are still open). */
  used(userId: string, period: string): Promise<number>;
}

export function reserveKey(runKey: string): string {
  return `reserve:${runKey}`;
}

export function releaseKey(runKey: string): string {
  return `release:${runKey}`;
}

export function chargeKey(runKey: string): string {
  return `charge:${runKey}`;
}
