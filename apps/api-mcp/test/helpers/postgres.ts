import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { runMigrations } from "../../src/db/migrate.js";
import { createPool } from "../../src/db/pool.js";
import { createPostgresStores, type PostgresStores } from "../../src/db/pg-stores.js";
import type { JobTtls } from "../../src/jobs/types.js";
import { createMemoryStores, type Stores } from "../../src/stores.js";

/** Postgres runs only when TEST_DATABASE_URL is set (for example the local Docker container). */
export const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"]?.trim() ?? "";
export const POSTGRES_AVAILABLE = TEST_DATABASE_URL !== "";

export interface StoreFixture {
  readonly stores: Stores;
  /** Closes the stores and drops the test schema. Safe to call after the server already closed the stores. */
  close(): Promise<void>;
}

export interface PostgresFixture extends StoreFixture {
  readonly stores: PostgresStores;
  readonly pool: Pool;
  readonly schema: string;
}

export interface StoreMode {
  readonly name: "memory" | "postgres";
  open(ttl: JobTtls, now: () => number): Promise<StoreFixture>;
}

/** A fresh schema per fixture, migrated and dropped again on close. */
export async function openPostgresFixture(ttl: JobTtls, now: () => number, migrate = true): Promise<PostgresFixture> {
  const schema = `ms_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const admin = createPool({ connectionString: TEST_DATABASE_URL, maxConnections: 1 });
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await admin.end();
  }
  const stores = createPostgresStores({ connectionString: TEST_DATABASE_URL, ttl, now, searchPath: schema, maxConnections: 4 });
  if (migrate) await runMigrations(stores.pool);
  let closed = false;
  return {
    stores,
    pool: stores.pool,
    schema,
    close: async () => {
      if (closed) return;
      closed = true;
      await stores.close().catch(() => undefined);
      const cleanup = createPool({ connectionString: TEST_DATABASE_URL, maxConnections: 1 });
      try {
        await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

export const MEMORY_MODE: StoreMode = {
  name: "memory",
  open: async (ttl, now) => {
    const stores = createMemoryStores({ ttl, now });
    return { stores, close: async () => undefined };
  },
};

export const POSTGRES_MODE: StoreMode = {
  name: "postgres",
  open: (ttl, now) => openPostgresFixture(ttl, now),
};

/** Store modes to run the same suite against: memory always, Postgres when configured. */
export const STORE_MODES: readonly StoreMode[] = POSTGRES_AVAILABLE ? [MEMORY_MODE, POSTGRES_MODE] : [MEMORY_MODE];
