import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { loadConfig, type Config } from "../../src/config.js";
import { createContext, type AppContext, type ContextOverrides } from "../../src/context.js";
import { createRequestHandler } from "../../src/routes.js";

/** Short waits and generous quotas by default; each test overrides what it exercises. */
export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig(
    {
      TOOL_WAIT_MS: "300",
      ANON_CREDITS: "5",
      ANON_REQUESTS_PER_MINUTE: "100",
      ACCOUNT_REQUESTS_PER_MINUTE: "1000",
      AUTH_SIGNUPS_PER_IP_PER_HOUR: "1000",
      AUTH_LOGINS_PER_IP_PER_MINUTE: "1000",
      ...env,
    },
    "linux",
  );
}

export interface RunningServer {
  readonly baseUrl: string;
  readonly ctx: AppContext;
  close(): Promise<void>;
}

/**
 * Starts the real request handler on an ephemeral port. PUBLIC_BASE_URL is set to the bound address
 * so `upload_url` values are real and can be posted to.
 */
export async function startTestServer(config: Config, overrides: ContextOverrides = {}): Promise<RunningServer> {
  let handler: RequestListener | undefined;
  const server: Server = createServer((req, res) => {
    if (handler === undefined) {
      res.writeHead(503).end();
      return;
    }
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const ctx = createContext({ ...config, publicBaseUrl: baseUrl }, overrides);
  handler = createRequestHandler(ctx);
  return {
    baseUrl,
    ctx,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await ctx.close();
    },
  };
}
