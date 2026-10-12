/** Calendar month in UTC, e.g. "2026-10". Monthly credits are counted per period (PRD 20.2). */
export function periodKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

/** Epoch ms of the next UTC month start: when the current period's credits reset. */
export function nextPeriodStart(nowMs: number): number {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}
