import type { JobStatus, JobTtls } from "./types.js";

/** How long a job record lives in a given state. Account-owned successes are kept longer (the library). */
export function ttlMsFor(status: JobStatus, ownerUserId: string | null, ttl: JobTtls): number {
  switch (status) {
    case "queued":
    case "running":
      return ttl.activeMs;
    case "succeeded":
      return ownerUserId === null ? ttl.succeededMs : ttl.accountSucceededMs;
    case "failed":
      return ttl.failedMs;
    default: {
      const unreachable: never = status;
      throw new Error(`Unhandled job status: ${String(unreachable)}`);
    }
  }
}
