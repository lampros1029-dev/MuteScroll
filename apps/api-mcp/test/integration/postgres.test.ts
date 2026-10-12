import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { EmailTakenError } from "../../src/accounts/types.js";
import { loadMigrations, MigrationError, pendingMigrations, runMigrations } from "../../src/db/migrate.js";
import { LiveJobConflictError } from "../../src/jobs/job-store.js";
import { transcriptFixture } from "../helpers/fixtures.js";
import { openPostgresFixture, POSTGRES_AVAILABLE } from "../helpers/postgres.js";

const TTL = { activeMs: 60_000, succeededMs: 60_000, accountSucceededMs: 120_000, failedMs: 60_000 };
const OCT_15 = Date.UTC(2026, 9, 15, 12);

/**
 * Runs only when TEST_DATABASE_URL is set (for example `postgres://postgres:pw@localhost:55432/ms`).
 * Every test gets its own schema, so the database is never shared between tests.
 */
describe.skipIf(!POSTGRES_AVAILABLE)("Postgres stores against a real database", () => {
  it("applies the schema once, records checksums, and a second run changes nothing", async () => {
    const fixture = await openPostgresFixture(TTL, () => OCT_15);
    try {
      const recorded = await fixture.pool.query<{ name: string; checksum: string }>("SELECT name, checksum FROM schema_migrations");
      const files = await loadMigrations();
      expect(recorded.rows).toEqual(files.map((file) => ({ name: file.name, checksum: file.checksum })));
      expect(await pendingMigrations(fixture.pool)).toEqual([]);
      expect(await runMigrations(fixture.pool)).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

  it("reports the schema as pending before it is applied, then applies it", async () => {
    const fixture = await openPostgresFixture(TTL, () => OCT_15, false);
    try {
      expect(await pendingMigrations(fixture.pool)).toEqual(["001_init.sql", "002_billing_events.sql", "003_oauth.sql", "004_billing_links.sql"]);
      expect(await runMigrations(fixture.pool)).toEqual(["001_init.sql", "002_billing_events.sql", "003_oauth.sql", "004_billing_links.sql"]);
      expect(await pendingMigrations(fixture.pool)).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

  it("refuses to run when an applied migration has been edited", async () => {
    const fixture = await openPostgresFixture(TTL, () => OCT_15);
    try {
      await fixture.pool.query("UPDATE schema_migrations SET checksum = 'edited-after-apply'");
      expect(await pendingMigrations(fixture.pool)).toEqual(["001_init.sql", "002_billing_events.sql", "003_oauth.sql", "004_billing_links.sql"]);
      await expect(runMigrations(fixture.pool)).rejects.toBeInstanceOf(MigrationError);
    } finally {
      await fixture.close();
    }
  });

  it("serialises concurrent reservations so the allowance is never exceeded", async () => {
    const fixture = await openPostgresFixture(TTL, () => OCT_15);
    try {
      const user = await fixture.stores.users.create({ id: "usr_race", email: "race@example.test", passwordHash: "x", plan: "free", createdAt: OCT_15 });
      const outcomes = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          fixture.stores.ledger.reserve({ userId: user.id, jobId: `job_${index}`, runKey: `run_${index}`, period: "2026-10", credits: 1, allowance: 5, now: OCT_15 }),
        ),
      );
      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(5);
      expect(await fixture.stores.ledger.used(user.id, "2026-10")).toBe(5);
    } finally {
      await fixture.close();
    }
  });

  it("settles a run once: a repeated settle neither releases nor charges twice", async () => {
    const fixture = await openPostgresFixture(TTL, () => OCT_15);
    try {
      await fixture.stores.users.create({ id: "usr_1", email: "ledger@example.test", passwordHash: "x", plan: "free", createdAt: OCT_15 });
      const ledger = fixture.stores.ledger;
      const run = { userId: "usr_1", jobId: "job_1", runKey: "run_1", period: "2026-10", now: OCT_15 };
      await ledger.reserve({ ...run, credits: 1, allowance: 20 });
      await ledger.settle({ ...run, reserved: 1, charged: 3 });
      await ledger.settle({ ...run, reserved: 1, charged: 3 });
      expect(await ledger.used("usr_1", "2026-10")).toBe(3);
      await ledger.reserve({ ...run, runKey: "run_2", jobId: "job_2", credits: 1, allowance: 20 });
      await ledger.settle({ ...run, runKey: "run_2", jobId: "job_2", reserved: 1, charged: 0 });
      expect(await ledger.used("usr_1", "2026-10")).toBe(3);
    } finally {
      await fixture.close();
    }
  });

  it("releases stale holds once in the database, and a late settle does not release them twice", async () => {
    const fixture = await openPostgresFixture(TTL, () => OCT_15);
    try {
      await fixture.stores.users.create({ id: "usr_stale", email: "stale@example.test", passwordHash: "x", plan: "free", createdAt: OCT_15 });
      const ledger = fixture.stores.ledger;
      await ledger.reserve({ userId: "usr_stale", jobId: "job_a", runKey: "run_a", period: "2026-10", credits: 1, allowance: 20, now: OCT_15 });
      await ledger.reserve({ userId: "usr_stale", jobId: "job_b", runKey: "run_b", period: "2026-10", credits: 1, allowance: 20, now: OCT_15 + 10_000 });
      expect(await ledger.releaseStaleHolds(OCT_15 + 5_000, OCT_15 + 20_000)).toBe(1);
      expect(await ledger.releaseStaleHolds(OCT_15 + 5_000, OCT_15 + 30_000)).toBe(0);
      expect(await ledger.used("usr_stale", "2026-10")).toBe(1);
      await ledger.settle({ userId: "usr_stale", jobId: "job_a", runKey: "run_a", period: "2026-10", reserved: 1, charged: 4, now: OCT_15 + 40_000 });
      expect(await ledger.used("usr_stale", "2026-10")).toBe(5);
    } finally {
      await fixture.close();
    }
  });

  it("keeps the ledger append-only in the database itself", async () => {
    const fixture = await openPostgresFixture(TTL, () => OCT_15);
    try {
      await fixture.stores.users.create({ id: "usr_1", email: "append@example.test", passwordHash: "x", plan: "free", createdAt: OCT_15 });
      await fixture.stores.ledger.reserve({ userId: "usr_1", jobId: "job_1", runKey: "run_1", period: "2026-10", credits: 1, allowance: 5, now: OCT_15 });
      await expect(fixture.pool.query("UPDATE credit_ledger SET credits = 99")).rejects.toThrow(/append-only/);
      await expect(fixture.pool.query("DELETE FROM credit_ledger")).rejects.toThrow(/append-only/);
    } finally {
      await fixture.close();
    }
  });

  it("creates exactly one live job for concurrent requests with the same key", async () => {
    const fixture = await openPostgresFixture(TTL, () => OCT_15);
    try {
      const jobs = fixture.stores.jobs;
      const outcomes = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          jobs.createOrReuse({ id: `job_${index}`, key: "anonymous|https://x|auto", language: "auto", platform: "youtube", ownerUserId: null }),
        ),
      );
      expect(outcomes.filter((outcome) => outcome.created)).toHaveLength(1);
      expect(new Set(outcomes.map((outcome) => outcome.job.id)).size).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  it("lets an expired job stop blocking its key", async () => {
    const fixture = await openPostgresFixture({ ...TTL, activeMs: 1 }, Date.now);
    try {
      await fixture.stores.jobs.createOrReuse({ id: "job_old", key: "k-expired", language: "auto", platform: null, ownerUserId: null });
      await new Promise((resolve) => setTimeout(resolve, 25));
      const fresh = await fixture.stores.jobs.createOrReuse({ id: "job_new", key: "k-expired", language: "auto", platform: null, ownerUserId: null });
      expect(fresh.created).toBe(true);
    } finally {
      await fixture.close();
    }
  });

  it("refuses to re-queue a failed job while another live job holds its key, and re-queues it otherwise", async () => {
    const fixture = await openPostgresFixture(TTL, () => OCT_15);
    try {
      const jobs = fixture.stores.jobs;
      await jobs.createOrReuse({ id: "job_a", key: "k-requeue", language: "auto", platform: null, ownerUserId: null });
      await jobs.update("job_a", { status: "failed", failure: "retrieval_failed" });
      await jobs.createOrReuse({ id: "job_b", key: "k-requeue", language: "auto", platform: null, ownerUserId: null });
      await expect(jobs.requeueFailed("job_a")).rejects.toBeInstanceOf(LiveJobConflictError);

      await jobs.update("job_b", { status: "failed", failure: "no_speech" });
      expect((await jobs.requeueFailed("job_a"))?.status).toBe("queued");
      expect((await jobs.findReusable("k-requeue"))?.id).toBe("job_a");
    } finally {
      await fixture.close();
    }
  });

  it("stores results as JSON and returns them intact, with the title for the library", async () => {
    const fixture = await openPostgresFixture(TTL, () => OCT_15);
    try {
      const jobs = fixture.stores.jobs;
      await fixture.stores.users.create({ id: "usr_owner", email: "owner@example.test", passwordHash: "x", plan: "free", createdAt: OCT_15 });
      await jobs.createOrReuse({ id: "job_done", key: "user:usr_owner|v|auto", language: "auto", platform: "youtube", ownerUserId: "usr_owner" });
      await jobs.update("job_done", { status: "succeeded", result: transcriptFixture(), creditsCharged: 1 });
      const stored = await jobs.get("job_done");
      expect(stored?.result).toEqual(transcriptFixture());
      expect(stored?.creditsCharged).toBe(1);
      const library = await jobs.listForUser("usr_owner", { limit: 10, offset: 0 });
      expect(library).toEqual([{ id: "job_done", status: "succeeded", platform: "youtube", title: "Demo", createdAt: OCT_15 }]);
    } finally {
      await fixture.close();
    }
  });

  it("lists only an owner's jobs and removes only finished ones", async () => {
    const fixture = await openPostgresFixture(TTL, () => OCT_15);
    try {
      const jobs = fixture.stores.jobs;
      await fixture.stores.users.create({ id: "usr_list", email: "list@example.test", passwordHash: "x", plan: "free", createdAt: OCT_15 });
      await jobs.createOrReuse({ id: "job_queued", key: "a", language: "auto", platform: null, ownerUserId: "usr_list" });
      await jobs.createOrReuse({ id: "job_anon", key: "b", language: "auto", platform: null, ownerUserId: null });
      expect((await jobs.listForUser("usr_list", { limit: 10, offset: 0 })).map((item) => item.id)).toEqual(["job_queued"]);
      expect(await jobs.removeFinished("job_queued")).toBe(false);
      await jobs.update("job_queued", { status: "succeeded", result: null, creditsCharged: 1 });
      expect(await jobs.removeFinished("job_queued")).toBe(true);
      expect(await jobs.get("job_queued")).toBeUndefined();
    } finally {
      await fixture.close();
    }
  });

  it("holds one account per address, case-insensitively, and rejects unknown plans in the database", async () => {
    const fixture = await openPostgresFixture(TTL, () => OCT_15);
    try {
      const users = fixture.stores.users;
      await users.create({ id: "usr_one", email: "same@example.test", passwordHash: "x", plan: "free", createdAt: OCT_15 });
      await expect(users.create({ id: "usr_two", email: "same@example.test", passwordHash: "x", plan: "free", createdAt: OCT_15 })).rejects.toBeInstanceOf(EmailTakenError);
      await expect(
        fixture.pool.query("INSERT INTO users (id, email, password_hash, plan, created_at) VALUES ('usr_bad', 'bad@example.test', 'x', 'enterprise', now())"),
      ).rejects.toThrow(/check constraint/);
    } finally {
      await fixture.close();
    }
  });

  it("round-trips sessions and removes expired ones", async () => {
    const fixture = await openPostgresFixture(TTL, () => OCT_15);
    try {
      await fixture.stores.users.create({ id: "usr_s", email: "s@example.test", passwordHash: "x", plan: "free", createdAt: OCT_15 });
      const sessions = fixture.stores.sessions;
      await sessions.create({ tokenHash: "hash-1", userId: "usr_s", createdAt: OCT_15, lastSeenAt: OCT_15, expiresAt: OCT_15 + 1000 });
      expect(await sessions.find("hash-1")).toEqual({ tokenHash: "hash-1", userId: "usr_s", createdAt: OCT_15, lastSeenAt: OCT_15, expiresAt: OCT_15 + 1000 });
      await sessions.extend("hash-1", OCT_15 + 5, OCT_15 + 9999);
      expect((await sessions.find("hash-1"))?.expiresAt).toBe(OCT_15 + 9999);
      expect(await sessions.removeExpired(OCT_15 + 10_000)).toBe(1);
      expect(await sessions.find("hash-1")).toBeUndefined();
    } finally {
      await fixture.close();
    }
  });

  it("round-trips API keys, records last use, and removes a key only for its owner", async () => {
    const fixture = await openPostgresFixture(TTL, () => OCT_15);
    try {
      await fixture.stores.users.create({ id: "usr_k", email: "k@example.test", passwordHash: "x", plan: "free", createdAt: OCT_15 });
      const keys = fixture.stores.apiKeys;
      const id = `key_${randomUUID()}`;
      await keys.create({ id, userId: "usr_k", prefix: "msk_abcdefgh", keyHash: "hash-key", createdAt: OCT_15, lastUsedAt: null });
      expect(await keys.findByHash("hash-key")).toMatchObject({ id, userId: "usr_k", prefix: "msk_abcdefgh", lastUsedAt: null });
      await keys.markUsed(id, OCT_15 + 1);
      expect((await keys.listForUser("usr_k"))[0]?.lastUsedAt).toBe(OCT_15 + 1);
      expect(await keys.remove("usr_other", id)).toBe(false);
      expect(await keys.remove("usr_k", id)).toBe(true);
      expect(await keys.findByHash("hash-key")).toBeUndefined();
    } finally {
      await fixture.close();
    }
  });
});
