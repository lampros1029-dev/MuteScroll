import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool, PoolClient } from "pg";

/** `apps/api-mcp/migrations`, resolved from this file so it works from `src` (tests) and `dist` (runtime). */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

/** Session-level advisory lock: two runners (for example two deploys) never apply migrations at once. */
const MIGRATION_LOCK_KEY = 727_300_001;
const MIGRATION_FILE = /^\d{3}_[a-z0-9_]+\.sql$/;

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((name) => MIGRATION_FILE.test(name)).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(dir, name), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql, "utf8").digest("hex") };
    }),
  );
}

/**
 * Applies every migration not yet recorded in `schema_migrations`, in name order, each in its own
 * transaction. Re-running is a no-op. A recorded file whose contents changed is refused.
 * Returns the names applied by this call.
 */
export async function runMigrations(pool: Pool, files?: MigrationFile[]): Promise<string[]> {
  const migrations = files ?? (await loadMigrations());
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const recorded = await recordedChecksums(client);
      const applied: string[] = [];
      for (const migration of migrations) {
        const known = recorded.get(migration.name);
        if (known === undefined) {
          await applyOne(client, migration);
          applied.push(migration.name);
        } else if (known !== migration.checksum) {
          throw new MigrationError(`Migration ${migration.name} changed after it was applied`);
        }
      }
      return applied;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/** Names of migrations that have not been applied yet. Read-only: safe to call at server start. */
export async function pendingMigrations(pool: Pool, files?: MigrationFile[]): Promise<string[]> {
  const migrations = files ?? (await loadMigrations());
  const table = await pool.query<{ regclass: string | null }>("SELECT to_regclass('schema_migrations')::text AS regclass");
  const recorded = new Map<string, string>();
  if (table.rows[0]?.regclass != null) {
    const rows = await pool.query<{ name: string; checksum: string }>("SELECT name, checksum FROM schema_migrations");
    for (const row of rows.rows) recorded.set(row.name, row.checksum);
  }
  return migrations.filter((migration) => recorded.get(migration.name) !== migration.checksum).map((migration) => migration.name);
}

async function recordedChecksums(client: PoolClient): Promise<Map<string, string>> {
  const rows = await client.query<{ name: string; checksum: string }>("SELECT name, checksum FROM schema_migrations");
  return new Map(rows.rows.map((row) => [row.name, row.checksum]));
}

async function applyOne(client: PoolClient, migration: MigrationFile): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [migration.name, migration.checksum]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
