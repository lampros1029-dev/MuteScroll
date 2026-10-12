import { chargeKey, releaseKey, reserveKey, type CreditLedger, type ReserveInput, type SettleInput } from "./credit-ledger.js";

type EntryKind = "reserve" | "release" | "charge";

interface Entry {
  readonly key: string;
  readonly runKey: string;
  readonly userId: string;
  readonly jobId: string;
  readonly period: string;
  readonly kind: EntryKind;
  readonly credits: number;
  readonly createdAt: number;
}

/** Single-process ledger with the same rules as the Postgres one. Methods do no I/O, so each check and write is atomic. */
export class MemoryCreditLedger implements CreditLedger {
  private readonly entries: Entry[] = [];
  private readonly keys = new Set<string>();

  async reserve(input: ReserveInput): Promise<{ readonly ok: boolean }> {
    if (this.keys.has(reserveKey(input.runKey))) return { ok: true };
    if (this.usage(input.userId, input.period) + input.credits > input.allowance) return { ok: false };
    this.append({
      key: reserveKey(input.runKey),
      runKey: input.runKey,
      userId: input.userId,
      jobId: input.jobId,
      period: input.period,
      kind: "reserve",
      credits: input.credits,
      createdAt: input.now,
    });
    return { ok: true };
  }

  async settle(input: SettleInput): Promise<void> {
    const run = { runKey: input.runKey, userId: input.userId, jobId: input.jobId, period: input.period, createdAt: input.now };
    this.appendOnce({ ...run, key: releaseKey(input.runKey), kind: "release", credits: input.reserved });
    if (input.charged > 0) this.appendOnce({ ...run, key: chargeKey(input.runKey), kind: "charge", credits: input.charged });
  }

  async releaseStaleHolds(cutoff: number, now: number): Promise<number> {
    const stale = this.entries.filter((entry) => entry.kind === "reserve" && entry.createdAt <= cutoff);
    let released = 0;
    for (const hold of stale) {
      if (this.keys.has(releaseKey(hold.runKey))) continue;
      this.append({ ...hold, key: releaseKey(hold.runKey), kind: "release", createdAt: now });
      released += 1;
    }
    return released;
  }

  async used(userId: string, period: string): Promise<number> {
    return this.usage(userId, period);
  }

  private usage(userId: string, period: string): number {
    let total = 0;
    for (const entry of this.entries) {
      if (entry.userId !== userId || entry.period !== period) continue;
      total += entry.kind === "release" ? -entry.credits : entry.credits;
    }
    return total;
  }

  private append(entry: Entry): void {
    this.entries.push(entry);
    this.keys.add(entry.key);
  }

  private appendOnce(entry: Entry): void {
    if (!this.keys.has(entry.key)) this.append(entry);
  }
}
