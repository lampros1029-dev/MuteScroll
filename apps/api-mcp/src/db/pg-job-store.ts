import type { Pool, PoolClient } from "pg";

import { LiveJobConflictError, type CreateOrReuseResult, type JobStore, type PageRequest } from "../jobs/job-store.js";
import { ttlMsFor } from "../jobs/ttl.js";
import type { Job, JobPatch, JobStatus, JobSummary, JobTtls, NewJob } from "../jobs/types.js";
import { isWorkerErrorCode } from "../worker/errors.js";
import type { WorkerTranscript } from "../worker/transcript-schema.js";
import { isUniqueViolation, withTransaction } from "./pool.js";

interface JobRow {
  readonly id: string;
  readonly dedupe_key: string;
  readonly owner_user_id: string | null;
  readonly status: string;
  readonly language: string;
  readonly platform: string | null;
  readonly failure: string | null;
  readonly result: WorkerTranscript | null;
  readonly credits_charged: number;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly expires_at: Date;
}

interface SummaryRow {
  readonly id: string;
  readonly status: string;
  readonly platform: string | null;
  readonly title: string | null;
  readonly created_at: Date;
}

export interface PgJobStoreOptions {
  readonly pool: Pool;
  readonly ttl: JobTtls;
  readonly now: () => number;
}

const CREATE_ATTEMPTS = 3;

/** Postgres job store. Dedupe relies on the partial unique index `jobs_live_dedupe_key_idx`. */
export class PgJobStore implements JobStore {
  constructor(private readonly options: PgJobStoreOptions) {}

  async createOrReuse(input: NewJob): Promise<CreateOrReuseResult> {
    const now = this.options.now();
    for (let attempt = 1; attempt <= CREATE_ATTEMPTS; attempt += 1) {
      const outcome = await withTransaction(this.options.pool, async (client) => {
        // An expired row must not block a fresh job for the same key.
        await client.query("DELETE FROM jobs WHERE dedupe_key = $1 AND expires_at <= $2", [input.key, at(now)]);
        const inserted = await client.query<JobRow>(
          `INSERT INTO jobs (id, dedupe_key, owner_user_id, status, language, platform, credits_charged, created_at, updated_at, expires_at)
           VALUES ($1, $2, $3, 'queued', $4, $5, 0, $6, $6, $7)
           ON CONFLICT (dedupe_key) WHERE status <> 'failed' DO NOTHING
           RETURNING *`,
          [
            input.id,
            input.key,
            input.ownerUserId,
            input.language,
            input.platform,
            at(now),
            at(now + ttlMsFor("queued", input.ownerUserId, this.options.ttl)),
          ],
        );
        const created = inserted.rows[0];
        if (created !== undefined) return { job: toJob(created), created: true };
        const live = await client.query<JobRow>(
          "SELECT * FROM jobs WHERE dedupe_key = $1 AND status <> 'failed' AND expires_at > $2 ORDER BY created_at DESC LIMIT 1",
          [input.key, at(now)],
        );
        const existing = live.rows[0];
        return existing === undefined ? undefined : { job: toJob(existing), created: false };
      });
      if (outcome !== undefined) return outcome;
    }
    throw new Error("createOrReuse could not settle on a job for the dedupe key");
  }

  async get(id: string): Promise<Job | undefined> {
    const result = await this.options.pool.query<JobRow>("SELECT * FROM jobs WHERE id = $1 AND expires_at > $2", [id, at(this.options.now())]);
    const row = result.rows[0];
    return row === undefined ? undefined : toJob(row);
  }

  async update(id: string, patch: JobPatch): Promise<Job | undefined> {
    const now = this.options.now();
    return withTransaction(this.options.pool, async (client) => {
      const current = await lockLive(client, id, now);
      return current === undefined ? undefined : writeJob(client, current, patch, now, this.options.ttl);
    });
  }

  async requeueFailed(id: string): Promise<Job | undefined> {
    const now = this.options.now();
    return withTransaction(this.options.pool, async (client) => {
      const current = await lockLive(client, id, now);
      if (current === undefined || current.status !== "failed") return undefined;
      try {
        return await writeJob(client, current, { status: "queued", failure: null }, now, this.options.ttl);
      } catch (error) {
        if (isUniqueViolation(error)) throw new LiveJobConflictError();
        throw error;
      }
    });
  }

  async findReusable(key: string): Promise<Job | undefined> {
    const result = await this.options.pool.query<JobRow>(
      "SELECT * FROM jobs WHERE dedupe_key = $1 AND status <> 'failed' AND expires_at > $2 ORDER BY created_at DESC LIMIT 1",
      [key, at(this.options.now())],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toJob(row);
  }

  async listForUser(userId: string, page: PageRequest): Promise<JobSummary[]> {
    const result = await this.options.pool.query<SummaryRow>(
      `SELECT id, status, platform, created_at, result -> 'source' ->> 'title' AS title
         FROM jobs
        WHERE owner_user_id = $1 AND expires_at > $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3 OFFSET $4`,
      [userId, at(this.options.now()), page.limit, page.offset],
    );
    return result.rows.map((row) => ({
      id: row.id,
      status: row.status as JobStatus,
      platform: row.platform,
      title: row.title,
      createdAt: row.created_at.getTime(),
    }));
  }

  async removeFinished(id: string): Promise<boolean> {
    const result = await this.options.pool.query("DELETE FROM jobs WHERE id = $1 AND status IN ('succeeded', 'failed')", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async removeForUser(userId: string): Promise<void> {
    await this.options.pool.query("DELETE FROM jobs WHERE owner_user_id = $1", [userId]);
  }

  async pruneExpired(): Promise<number> {
    const result = await this.options.pool.query("DELETE FROM jobs WHERE expires_at <= $1", [at(this.options.now())]);
    return result.rowCount ?? 0;
  }
}

function at(epochMs: number): Date {
  return new Date(epochMs);
}

async function lockLive(client: PoolClient, id: string, now: number): Promise<Job | undefined> {
  const result = await client.query<JobRow>("SELECT * FROM jobs WHERE id = $1 AND expires_at > $2 FOR UPDATE", [id, at(now)]);
  const row = result.rows[0];
  return row === undefined ? undefined : toJob(row);
}

async function writeJob(client: PoolClient, current: Job, patch: JobPatch, now: number, ttl: JobTtls): Promise<Job> {
  const status = patch.status ?? current.status;
  const resultJson = patch.result === undefined || patch.result === null ? null : JSON.stringify(patch.result);
  const result = await client.query<JobRow>(
    `UPDATE jobs
        SET status = $2,
            result = CASE WHEN $3::boolean THEN $4::jsonb ELSE result END,
            failure = CASE WHEN $5::boolean THEN $6::text ELSE failure END,
            credits_charged = $7,
            updated_at = $8,
            expires_at = $9
      WHERE id = $1
      RETURNING *`,
    [
      current.id,
      status,
      patch.result !== undefined,
      resultJson,
      patch.failure !== undefined,
      patch.failure ?? null,
      patch.creditsCharged ?? current.creditsCharged,
      at(now),
      at(now + ttlMsFor(status, current.ownerUserId, ttl)),
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("job vanished during update");
  return toJob(row);
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    key: row.dedupe_key,
    status: row.status as JobStatus,
    language: row.language,
    platform: row.platform,
    ownerUserId: row.owner_user_id,
    result: row.result,
    failure: row.failure !== null && isWorkerErrorCode(row.failure) ? row.failure : null,
    creditsCharged: row.credits_charged,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
    expiresAt: row.expires_at.getTime(),
  };
}
