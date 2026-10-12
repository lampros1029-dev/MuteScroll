import { createServer } from "node:http";

import { loadConfig } from "./config.js";
import { createContext, runMaintenance } from "./context.js";
import { logEvent } from "./log.js";
import { createRequestHandler } from "./routes.js";

const MAINTENANCE_INTERVAL_MS = 60_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const ctx = createContext(config);
  const store = config.databaseUrl === undefined ? "memory" : "postgres";

  // Refuse to serve against an out-of-date schema. Migrations run as a release step (`npm run migrate`).
  const pending = await ctx.stores.pendingMigrations().catch(() => null);
  if (pending === null) {
    logEvent("db.unreachable", { store });
    process.exitCode = 1;
    await ctx.close();
    return;
  }
  if (pending.length > 0) {
    logEvent("db.pending_migrations", { count: pending.length });
    process.exitCode = 1;
    await ctx.close();
    return;
  }

  const server = createServer(createRequestHandler(ctx));
  setInterval(() => {
    runMaintenance(ctx).catch(() => logEvent("maintenance.error"));
  }, MAINTENANCE_INTERVAL_MS).unref();

  const shutdown = (): void => {
    server.close(() => {
      void ctx.close().finally(() => process.exit(0));
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  server.listen(config.port, () => {
    logEvent("server.listening", { port: config.port, store });
  });
}

void main();
