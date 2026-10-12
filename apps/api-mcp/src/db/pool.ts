import { Pool, type PoolClient } from "pg";

import { logEvent } from "../log.js";

const SCHEMA_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export interface PoolOptions {
  readonly connectionString: string;
  /** Schema to use first on every connection. Tests use a throwaway schema per run. */
  readonly searchPath?: string;
  readonly maxConnections?: number;
}

export function createPool(options: PoolOptions): Pool {
  if (options.searchPath !== undefined && !SCHEMA_IDENTIFIER.test(options.searchPath)) {
    throw new RangeError("Invalid schema name");
  }
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    ...(options.searchPath === undefined ? {} : { options: `-c search_path=${options.searchPath}` }),
  });
  // An idle client that fails must not crash the process. The next query opens a fresh one.
  pool.on("error", () => logEvent("db.pool_error"));
  return pool;
}

/** Runs `work` in one transaction: COMMIT on success, ROLLBACK and rethrow on any error. */
export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

/** Postgres SQLSTATE 23505: a unique constraint rejected the write. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}
