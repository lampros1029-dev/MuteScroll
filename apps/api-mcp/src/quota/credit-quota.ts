export interface CreditQuotaOptions {
  /** Credits an anonymous client may spend inside one window (ANON_CREDITS). */
  readonly allowance: number;
  readonly windowMs: number;
  readonly now: () => number;
}

interface Charge {
  readonly at: number;
  readonly credits: number;
}

interface Ledger {
  charges: Charge[];
  /** Reserved for jobs that are queued or running; released on settle. */
  pending: number;
}

/**
 * Sliding-window credit ledger (PRD 20.5: failed jobs never consume quota).
 * `tryReserve` holds one credit while a job runs; `settle` records the real cost, or 0 on failure.
 */
export class CreditQuota {
  private readonly ledgers = new Map<string, Ledger>();

  constructor(private readonly options: CreditQuotaOptions) {}

  remaining(key: string): number {
    const ledger = this.ledgerFor(key);
    const spent = this.spentInWindow(ledger);
    return Math.max(0, this.options.allowance - spent - ledger.pending);
  }

  tryReserve(key: string, credits = 1): boolean {
    if (this.remaining(key) < credits) return false;
    this.ledgerFor(key).pending += 1;
    return true;
  }

  /** Gives back a reservation that did not turn into work (job reused, or the request was rejected). */
  release(key: string): void {
    const ledger = this.ledgerFor(key);
    ledger.pending = Math.max(0, ledger.pending - 1);
  }

  /** Ends a reservation and records what the job actually cost (0 for a failed job). */
  settle(key: string, creditsCharged: number): void {
    this.release(key);
    if (creditsCharged > 0) this.ledgerFor(key).charges.push({ at: this.options.now(), credits: creditsCharged });
  }

  /** When the oldest charge leaves the window, i.e. when at least one credit comes back. */
  resetAt(key: string): number {
    const oldest = this.ledgerFor(key).charges[0];
    return (oldest?.at ?? this.options.now()) + this.options.windowMs;
  }

  prune(): void {
    for (const [key, ledger] of [...this.ledgers.entries()]) {
      ledger.charges = this.inWindow(ledger.charges);
      if (ledger.charges.length === 0 && ledger.pending === 0) this.ledgers.delete(key);
    }
  }

  private ledgerFor(key: string): Ledger {
    let ledger = this.ledgers.get(key);
    if (ledger === undefined) {
      ledger = { charges: [], pending: 0 };
      this.ledgers.set(key, ledger);
    }
    ledger.charges = this.inWindow(ledger.charges);
    return ledger;
  }

  private spentInWindow(ledger: Ledger): number {
    return ledger.charges.reduce((sum, charge) => sum + charge.credits, 0);
  }

  private inWindow(charges: Charge[]): Charge[] {
    const cutoff = this.options.now() - this.options.windowMs;
    return charges.filter((charge) => charge.at > cutoff);
  }
}
