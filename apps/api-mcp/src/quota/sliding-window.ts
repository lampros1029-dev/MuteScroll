export interface SlidingWindowOptions {
  /** Maximum hits per key inside one window. */
  readonly limit: number;
  readonly windowMs: number;
  readonly now: () => number;
}

export type HitResult = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterMs: number };

/** In-memory sliding-window rate limiter. Single-process only; swap for Redis (Upstash) in M3/M4. */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly options: SlidingWindowOptions) {}

  /** Records a hit when allowed. A rejected hit is not recorded, so retries do not extend the penalty. */
  hit(key: string): HitResult {
    const now = this.options.now();
    const recent = this.recentHits(key, now);
    if (recent.length >= this.options.limit) {
      const oldest = recent[0] ?? now;
      this.hits.set(key, recent);
      return { allowed: false, retryAfterMs: Math.max(0, oldest + this.options.windowMs - now) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true };
  }

  prune(): void {
    const now = this.options.now();
    for (const key of [...this.hits.keys()]) {
      if (this.recentHits(key, now).length === 0) this.hits.delete(key);
    }
  }

  private recentHits(key: string, now: number): number[] {
    const cutoff = now - this.options.windowMs;
    return (this.hits.get(key) ?? []).filter((at) => at > cutoff);
  }
}
