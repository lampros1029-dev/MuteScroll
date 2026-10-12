import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ToolOutput } from "../../src/mcp/schemas.js";
import { type RunningServer, startTestServer, testConfig } from "../helpers/harness.js";
import { FakeWorker } from "../helpers/fake-worker.js";
import type { Config } from "../../src/config.js";
import type { ContextOverrides } from "../../src/context.js";

export interface Session {
  readonly server: RunningServer;
  readonly client: Client;
  readonly worker: FakeWorker;
  close(): Promise<void>;
}

export async function openSession(env: Record<string, string> = {}, worker = new FakeWorker()): Promise<Session> {
  const config: Config = testConfig(env);
  const overrides: ContextOverrides = { worker };
  const server = await startTestServer(config, overrides);
  const client = new Client({ name: "mutescroll-test-client", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`)));
  return {
    server,
    client,
    worker,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export async function call(session: Session, name: string, args: Record<string, unknown>): Promise<CallToolResult & { output: ToolOutput }> {
  const result = await session.client.callTool({ name, arguments: args });
  return Object.assign(result as CallToolResult, { output: result.structuredContent as ToolOutput });
}

export async function waitForStatus(session: Session, jobId: string, status: ToolOutput["status"], timeoutMs = 3000): Promise<ToolOutput> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const latest = await call(session, "get_transcription", { job_id: jobId });
    if (latest.output.status === status || Date.now() > deadline) return latest.output;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
