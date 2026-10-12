import type { Pool } from "pg";

import type { JobTtls } from "../jobs/types.js";
import type { Stores } from "../stores.js";
import { PgAuthTokenStore } from "./pg-auth-tokens.js";
import { PgBillingEventLog } from "./pg-billing-events.js";
import { PgBillingLinkStore } from "./pg-billing-links.js";
import { PgCreditLedger } from "./pg-credit-ledger.js";
import { PgJobStore } from "./pg-job-store.js";
import { PgApiKeyStore, PgSessionStore, PgUserStore } from "./pg-accounts.js";
import { PgOAuthStore } from "./pg-oauth.js";
import { createPool } from "./pool.js";
import { pendingMigrations } from "./migrate.js";

export interface PostgresStoresOptions {
  readonly connectionString: string;
  readonly ttl: JobTtls;
  readonly now: () => number;
  /** Test isolation: every connection uses this schema first. */
  readonly searchPath?: string;
  readonly maxConnections?: number;
}

export interface PostgresStores extends Stores {
  readonly pool: Pool;
}

export function createPostgresStores(options: PostgresStoresOptions): PostgresStores {
  const pool = createPool({
    connectionString: options.connectionString,
    ...(options.searchPath === undefined ? {} : { searchPath: options.searchPath }),
    ...(options.maxConnections === undefined ? {} : { maxConnections: options.maxConnections }),
  });
  return {
    pool,
    jobs: new PgJobStore({ pool, ttl: options.ttl, now: options.now }),
    users: new PgUserStore(pool),
    sessions: new PgSessionStore(pool),
    apiKeys: new PgApiKeyStore(pool),
    oauth: new PgOAuthStore(pool),
    authTokens: new PgAuthTokenStore(pool),
    ledger: new PgCreditLedger(pool),
    billingEvents: new PgBillingEventLog(pool),
    billingLinks: new PgBillingLinkStore(pool),
    pendingMigrations: () => pendingMigrations(pool),
    close: () => pool.end(),
  };
}
