export type PollResult<T, E> =
  | { readonly status: "pending" }
  | { readonly status: "done"; readonly value: T }
  | { readonly status: "failed"; readonly error: E; readonly transient?: boolean };

export type PollOutcome<T, E> =
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "failed"; readonly error: E }
  | { readonly kind: "timeout" }
  | { readonly kind: "aborted" }
  | { readonly kind: "unreachable" };

export interface PollOptions<T, E> {
  readonly check: (signal: AbortSignal) => Promise<PollResult<T, E>>;
  readonly signal: AbortSignal;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  /** Consecutive transient failures tolerated before giving up. */
  readonly maxTransientFailures?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export const DEFAULT_POLL_INTERVAL_MS = 3_000;
export const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Calls `check` every `intervalMs` until it reports done or failed, the timeout passes, or the
 * signal aborts. Transient failures (for example a dropped connection) are retried a few times.
 */
export async function pollUntilSettled<T, E>(options: PollOptions<T, E>): Promise<PollOutcome<T, E>> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const maxTransient = options.maxTransientFailures ?? 3;
  const startedAt = now();
  let transientFailures = 0;

  for (;;) {
    if (options.signal.aborted) return { kind: "aborted" };

    const result = await options.check(options.signal);
    if (options.signal.aborted) return { kind: "aborted" };

    if (result.status === "done") return { kind: "done", value: result.value };
    if (result.status === "failed") {
      if (result.transient === true) {
        transientFailures += 1;
        if (transientFailures >= maxTransient) return { kind: "unreachable" };
      } else {
        return { kind: "failed", error: result.error };
      }
    } else {
      transientFailures = 0;
    }

    if (now() - startedAt >= options.timeoutMs) return { kind: "timeout" };
    await sleep(options.intervalMs, options.signal);
  }
}
