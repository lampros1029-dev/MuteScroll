import { randomBytes } from "node:crypto";

/**
 * One-time upload links (PRD 14). Lifecycle:
 *   open --acquire--> leased --complete--> used
 *                       |--release--> open   (client error: wrong type, too big; the link can be retried)
 * A token is bound to one failed job and is revoked when that job is re-queued.
 */

interface TokenEntry {
  readonly jobId: string;
  readonly expiresAt: number;
  state: "open" | "leased" | "used";
}

export type AcquireResult =
  | { readonly ok: true; readonly jobId: string }
  | { readonly ok: false; readonly reason: "unknown" | "used" | "busy" };

export interface UploadTokenOptions {
  readonly ttlMs: number;
  readonly now: () => number;
  readonly newToken?: () => string;
}

export class UploadTokenStore {
  private readonly tokens = new Map<string, TokenEntry>();
  private readonly newToken: () => string;

  constructor(private readonly options: UploadTokenOptions) {
    this.newToken = options.newToken ?? (() => randomBytes(24).toString("base64url"));
  }

  issue(jobId: string): string {
    const token = this.newToken();
    this.tokens.set(token, { jobId, expiresAt: this.options.now() + this.options.ttlMs, state: "open" });
    return token;
  }

  acquire(token: string): AcquireResult {
    const entry = this.live(token);
    if (entry === undefined) return { ok: false, reason: "unknown" };
    if (entry.state === "used") return { ok: false, reason: "used" };
    if (entry.state === "leased") return { ok: false, reason: "busy" };
    entry.state = "leased";
    return { ok: true, jobId: entry.jobId };
  }

  /** Read-only state check for the upload page. Does not lease or consume the token. */
  peek(token: string): TokenEntry["state"] | "unknown" {
    return this.live(token)?.state ?? "unknown";
  }

  release(token: string): void {
    const entry = this.live(token);
    if (entry !== undefined && entry.state === "leased") entry.state = "open";
  }

  complete(token: string): void {
    const entry = this.live(token);
    if (entry !== undefined) entry.state = "used";
  }

  /** Marks every link for the job as used. Kept (not deleted) so a replay reports "used", not "unknown". */
  revokeForJob(jobId: string): void {
    for (const entry of this.tokens.values()) {
      if (entry.jobId === jobId) entry.state = "used";
    }
  }

  /** Used-token rows stay until expiry so a replayed link reports "used" rather than "unknown". */
  prune(): void {
    const now = this.options.now();
    for (const [token, entry] of [...this.tokens.entries()]) {
      if (entry.expiresAt <= now) this.tokens.delete(token);
    }
  }

  private live(token: string): TokenEntry | undefined {
    const entry = this.tokens.get(token);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.options.now()) {
      this.tokens.delete(token);
      return undefined;
    }
    return entry;
  }
}
