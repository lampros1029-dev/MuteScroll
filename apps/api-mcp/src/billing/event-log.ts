/** Processed Paddle notification ids, plus cancels that take effect at period end. */
export interface BillingEventLog {
  /** True the first time this event id is recorded. */
  claim(eventId: string, now: number): Promise<boolean>;
  /** Drops a claim so a failed apply can be retried. */
  forget(eventId: string): Promise<void>;
  scheduleFree(userId: string, effectiveAt: number): Promise<void>;
  clearSchedule(userId: string): Promise<void>;
  dueFree(now: number): Promise<readonly string[]>;
}

/** Process-local log used when DATABASE_URL is unset. Lost on restart. */
export class MemoryBillingEventLog implements BillingEventLog {
  private readonly seen = new Set<string>();
  private readonly downgrades = new Map<string, number>();

  async claim(eventId: string, _now: number): Promise<boolean> {
    if (this.seen.has(eventId)) return false;
    this.seen.add(eventId);
    return true;
  }

  async forget(eventId: string): Promise<void> {
    this.seen.delete(eventId);
  }

  async scheduleFree(userId: string, effectiveAt: number): Promise<void> {
    this.downgrades.set(userId, effectiveAt);
  }

  async clearSchedule(userId: string): Promise<void> {
    this.downgrades.delete(userId);
  }

  async dueFree(now: number): Promise<readonly string[]> {
    return [...this.downgrades.entries()].filter(([, at]) => at <= now).map(([userId]) => userId);
  }
}
