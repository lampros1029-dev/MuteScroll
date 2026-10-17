import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../../src/config.js";
import { loadMigrations, MIGRATIONS_DIR } from "../../src/db/migrate.js";

describe("M3 configuration", () => {
  it("has no database by default, so the in-memory stores run", () => {
    expect(loadConfig({}, "linux").databaseUrl).toBeUndefined();
  });

  it("accepts postgres:// and postgresql:// URLs", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://u:p@localhost:5432/ms" }, "linux").databaseUrl).toBe("postgres://u:p@localhost:5432/ms");
    expect(loadConfig({ DATABASE_URL: "postgresql://u:p@localhost/ms" }, "linux").databaseUrl).toBe("postgresql://u:p@localhost/ms");
  });

  it("rejects other schemes and never echoes the connection string", () => {
    const secret = "mysql://admin:hunter2-secret@db.internal/ms";
    try {
      loadConfig({ DATABASE_URL: secret }, "linux");
      throw new Error("expected a ConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain("DATABASE_URL");
      expect((error as Error).message).not.toContain("hunter2");
    }
  });

  it("adds the Secure flag to cookies only for an https public URL", () => {
    expect(loadConfig({ PUBLIC_BASE_URL: "https://api.mutescroll.xyz" }, "linux").secureCookies).toBe(true);
    expect(loadConfig({ PUBLIC_BASE_URL: "http://localhost:8080" }, "linux").secureCookies).toBe(false);
  });

  it("sets the account defaults from the PRD: 30-day sessions, 7-day library, per-IP auth limits", () => {
    const config = loadConfig({}, "linux");
    expect(config.sessionTtlMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(config.jobTtl.accountSucceededMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(config.signupsPerIpPerHour).toBe(5);
    expect(config.loginsPerIpPerMinute).toBe(10);
    expect(config.accountRequestsPerMinute).toBe(30);
    expect(config.jsonMaxBodyBytes).toBe(16 * 1024);
  });

  it.each([
    [{ SESSION_TTL_DAYS: "0" }, "SESSION_TTL_DAYS"],
    [{ AUTH_SIGNUPS_PER_IP_PER_HOUR: "x" }, "AUTH_SIGNUPS_PER_IP_PER_HOUR"],
    [{ ACCOUNT_JOB_TTL_DAYS: "9999" }, "ACCOUNT_JOB_TTL_DAYS"],
  ])("rejects out-of-range %j and names the key", (env, key) => {
    expect(() => loadConfig(env, "linux")).toThrow(key);
  });
});

describe("migration files", () => {
  it("finds the schema in apps/api-mcp/migrations, sorted and checksummed", async () => {
    const migrations = await loadMigrations();
    expect(migrations.map((migration) => migration.name)).toEqual([
      "001_init.sql",
      "002_billing_events.sql",
      "003_oauth.sql",
      "004_billing_links.sql",
      "005_auth_mail.sql",
      "006_oauth_grant_created.sql",
      "007_external_identities.sql",
      "008_account_addons.sql",
    ]);
    const [first] = migrations;
    const onDisk = await readFile(join(MIGRATIONS_DIR, "001_init.sql"), "utf8");
    expect(first?.sql).toBe(onDisk);
    expect(first?.checksum).toBe(createHash("sha256").update(onDisk, "utf8").digest("hex"));
    expect(first?.sql).toContain("CREATE TABLE credit_ledger");
    expect(migrations[1]?.sql).toContain("CREATE TABLE billing_events");
    expect(migrations[2]?.sql).toContain("CREATE TABLE oauth_clients");
    expect(migrations[3]?.sql).toContain("CREATE TABLE billing_links");
    expect(migrations[4]?.sql).toContain("CREATE TABLE auth_tokens");
    expect(migrations[5]?.sql).toContain("oauth_grants");
    expect(migrations[6]?.sql).toContain("CREATE TABLE external_identities");
    expect(migrations[7]?.sql).toContain("bonus_credits");
  });

  describe("with a scratch directory", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "ms-migrations-"));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("ignores files that do not match NNN_name.sql and sorts the rest by name", async () => {
      await writeFile(join(dir, "010_later.sql"), "SELECT 1;");
      await writeFile(join(dir, "002_second.sql"), "SELECT 2;");
      await writeFile(join(dir, "notes.txt"), "not a migration");
      await writeFile(join(dir, "Bad-Name.sql"), "SELECT 0;");
      const migrations = await loadMigrations(dir);
      expect(migrations.map((migration) => migration.name)).toEqual(["002_second.sql", "010_later.sql"]);
    });
  });
});
