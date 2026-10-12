import { logEvent } from "../log.js";
import { MigrationError, runMigrations } from "./migrate.js";
import { createPool } from "./pool.js";

/** `npm run migrate -w @mutescroll/api-mcp`. Reads DATABASE_URL from the environment; never prints it. */
async function main(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"]?.trim();
  if (connectionString === undefined || connectionString === "") {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const pool = createPool({ connectionString, maxConnections: 1 });
  try {
    const applied = await runMigrations(pool);
    logEvent("db.migrated", { applied: applied.length });
    for (const name of applied) logEvent("db.migration_applied", { name });
  } catch (error) {
    // Driver errors can echo connection details, so only the class name is logged.
    const detail = error instanceof MigrationError ? error.message : error instanceof Error ? error.name : "unknown";
    logEvent("db.migration_failed", { error: detail });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
