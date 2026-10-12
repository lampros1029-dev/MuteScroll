import { afterEach } from "vitest";

import type { ContextOverrides } from "../../src/context.js";
import type { MediaWorker } from "../../src/worker/types.js";
import { FakeWorker } from "./fake-worker.js";
import { startTestServer, testConfig, type RunningServer } from "./harness.js";
import type { StoreFixture, StoreMode } from "./postgres.js";

/**
 * Registers cleanup for the enclosing suite and returns a starter. Each call opens fresh stores in the
 * given mode (memory or Postgres) and a real HTTP server on them. Everything is closed after each test.
 * Tests never reach the Python worker: a FakeWorker answers unless the test supplies its own.
 */
export function serverStarter(mode: StoreMode): (env?: Record<string, string>, worker?: MediaWorker) => Promise<RunningServer> {
  const opened: Array<{ server: RunningServer; fixture: StoreFixture }> = [];
  afterEach(async () => {
    for (const { server, fixture } of opened.splice(0)) {
      await server.close();
      await fixture.close();
    }
  });
  return async (env = {}, worker: MediaWorker = new FakeWorker()) => {
    const config = testConfig(env);
    const fixture = await mode.open(config.jobTtl, Date.now);
    const overrides: ContextOverrides = { stores: fixture.stores, worker };
    const server = await startTestServer(config, overrides);
    opened.push({ server, fixture });
    return server;
  };
}
