import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { describe, expect, it } from "vitest";

import type { ToolOutput } from "../../src/mcp/schemas.js";
import { delay } from "../helpers/fake-worker.js";
import { sampleUrl } from "../helpers/fixtures.js";
import type { RunningServer } from "../helpers/harness.js";
import { api, createKey, signUp } from "../helpers/rest.js";
import { STORE_MODES } from "../helpers/postgres.js";
import { serverStarter } from "../helpers/suite.js";

async function mcpClient(server: RunningServer, key?: string): Promise<Client> {
  const client = new Client({ name: "mutescroll-account-test", version: "0.0.0" });
  const requestInit = key === undefined ? {} : { headers: { authorization: `Bearer ${key}` } };
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`), { requestInit }));
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult & { output: ToolOutput }> {
  const result = await client.callTool({ name, arguments: args });
  return Object.assign(result as CallToolResult, { output: result.structuredContent as ToolOutput });
}

describe.each(STORE_MODES)("MCP with Bearer keys on $name stores", (mode) => {
  const start = serverStarter(mode);

  it("makes transcribe_video account-owned: charged to the account and hidden from anonymous MCP", async () => {
    const server = await start();
    const account = await signUp(server);
    const key = await createKey(server, account);
    const owner = await mcpClient(server, key.key);
    const done = await callTool(owner, "transcribe_video", { url: sampleUrl("nnnnnnnnnn1") });
    expect(done.output).toMatchObject({ status: "completed", credits_charged: 1, quota: { remaining_this_period: 5999 } });
    const jobId = done.output.job_id ?? "";

    const anonymous = await mcpClient(server);
    const hidden = await callTool(anonymous, "get_transcription", { job_id: jobId });
    expect(hidden.output.error?.code).toBe("not_found");

    const visible = await callTool(owner, "get_transcription", { job_id: jobId });
    expect(visible.output.status).toBe("completed");

    for (let i = 0; i < 100; i += 1) {
      const me = await api(server, "/v1/me", { headers: { cookie: account.cookie } });
      if (me.body.credits.remaining === 5999) break;
      await delay(10, undefined);
    }
    const me = await api(server, "/v1/me", { headers: { cookie: account.cookie } });
    expect(me.body.credits.remaining).toBe(5999);

    const otherAccount = await signUp(server);
    const otherKey = await createKey(server, otherAccount);
    const other = await mcpClient(server, otherKey.key);
    expect((await callTool(other, "get_transcription", { job_id: jobId })).output.error?.code).toBe("not_found");
    await owner.close();
    await anonymous.close();
    await other.close();
  });

  it("refuses an unknown Bearer key on /mcp with a 401 JSON-RPC error", async () => {
    const server = await start();
    const response = await fetch(`${server.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer msk_unknown",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: -32001 } });
  });
});
