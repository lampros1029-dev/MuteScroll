import { MemoryAuthTokenStore, type AuthTokenStore } from "./accounts/auth-tokens.js";
import type { ApiKeyStore, SessionStore, UserStore } from "./accounts/types.js";
import { MemoryApiKeyStore, MemorySessionStore, MemoryUserStore } from "./accounts/memory-stores.js";
import type { Config } from "./config.js";
import { MemoryBillingLinkStore, type BillingLinkStore } from "./billing/billing-links.js";
import { MemoryBillingEventLog, type BillingEventLog } from "./billing/event-log.js";
import type { CreditLedger } from "./billing/credit-ledger.js";
import { MemoryCreditLedger } from "./billing/memory-credit-ledger.js";
import type { JobStore } from "./jobs/job-store.js";
import { MemoryJobStore } from "./jobs/memory-job-store.js";
import type { JobTtls } from "./jobs/types.js";
import { createPostgresStores } from "./db/pg-stores.js";
import type { OAuthStore } from "./oauth/types.js";
import { MemoryOAuthStore } from "./oauth/memory-store.js";

/** Everything the server persists. Either all in memory, or all in Postgres (DATABASE_URL). */
export interface Stores {
  readonly jobs: JobStore;
  readonly users: UserStore;
  readonly sessions: SessionStore;
  readonly apiKeys: ApiKeyStore;
  readonly oauth: OAuthStore;
  readonly authTokens: AuthTokenStore;
  readonly ledger: CreditLedger;
  readonly billingEvents: BillingEventLog;
  /** Paddle ids this server created, each tied to the user who started checkout. */
  readonly billingLinks: BillingLinkStore;
  /** Names of migrations not yet applied. Always empty for memory stores. */
  pendingMigrations(): Promise<string[]>;
  close(): Promise<void>;
}

export interface MemoryStoresOptions {
  readonly ttl: JobTtls;
  readonly now: () => number;
}

export function createMemoryStores(options: MemoryStoresOptions): Stores {
  return {
    jobs: new MemoryJobStore({ ttl: options.ttl, now: options.now }),
    users: new MemoryUserStore(),
    sessions: new MemorySessionStore(),
    apiKeys: new MemoryApiKeyStore(),
    oauth: new MemoryOAuthStore(),
    authTokens: new MemoryAuthTokenStore(),
    ledger: new MemoryCreditLedger(),
    billingEvents: new MemoryBillingEventLog(),
    billingLinks: new MemoryBillingLinkStore(),
    pendingMigrations: async () => [],
    close: async () => undefined,
  };
}

export function createStores(config: Config, now: () => number): Stores {
  if (config.databaseUrl === undefined) return createMemoryStores({ ttl: config.jobTtl, now });
  return createPostgresStores({ connectionString: config.databaseUrl, ttl: config.jobTtl, now });
}
