import { randomBytes } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";

import { hashSecret } from "../../src/accounts/secrets.js";
import { mp4Bytes, sampleUrl } from "../helpers/fixtures.js";
import { FakeWorker } from "../helpers/fake-worker.js";
import { api, bearer, createKey, sessionHeaders, signUp, type AccountSession } from "../helpers/rest.js";
import { startTestServer, testConfig, type RunningServer } from "../helpers/harness.js";

const ADMIN_TOKEN = "admin-stats-token-1";
const VISITOR = "203.0.113.50";

describe("job client attribution", () => {
  let server: RunningServer;

  afterEach(async () => {
    await server.close();
  });

  it("stores source on the site, REST, upload, and MCP creation paths", async () => {
    server = await startTestServer(testConfig({ ADMIN_STATS_TOKEN: ADMIN_TOKEN, TRUST_PROXY: "true" }), { worker: new FakeWorker() });
    const account = await signUp(server);

    const site = await transcribe(server, account, sampleUrl("clientsite01"), { "x-mutescroll-source": "web", "user-agent": "Mozilla/5.0" });
    expect(site.status).toBeLessThan(300);

    const anonymousSite = await api(server, "/v1/transcriptions", {
      method: "POST",
      json: { url: sampleUrl("clientanon01") },
      headers: { "x-mutescroll-source": "web", "user-agent": "Mozilla/5.0", "x-forwarded-for": VISITOR },
    });
    expect(anonymousSite.status).toBeLessThan(300);

    const { key } = await createKey(server, account);
    const rest = await api(server, "/v1/transcriptions", {
      method: "POST",
      json: { url: sampleUrl("clientrest01") },
      headers: { ...bearer(key), "x-mutescroll-source": "web", "user-agent": "curl/8.0", "x-forwarded-for": VISITOR },
    });
    expect(rest.status).toBeLessThan(300);

    const upload = await api(server, "/v1/uploads", {
      method: "POST",
      body: new Uint8Array(mp4Bytes()),
      headers: {
        ...sessionHeaders(account),
        "content-type": "video/mp4",
        "x-filename": "clip.mp4",
        "x-mutescroll-source": "web",
        "user-agent": "Mozilla/5.0",
      },
    });
    expect(upload.status).toBe(202);

    const oauthClientId = "oac_claudeclient0001";
    const token = `mso_${randomBytes(32).toString("base64url")}`;
    const user = await server.ctx.stores.users.findByEmail(account.email);
    if (user === undefined) throw new Error("account missing");
    const now = server.ctx.now();
    await server.ctx.stores.oauth.saveClient({
      id: oauthClientId,
      name: "Some Connector",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      secretHash: null,
      createdAt: now,
    });
    await server.ctx.stores.oauth.saveGrant({
      tokenHash: hashSecret(token),
      userId: user.id,
      clientId: oauthClientId,
      kind: "access",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: null,
      scope: "transcribe",
      createdAt: now,
      expiresAt: now + 60 * 60 * 1000,
    });

    const mcp = new Client({ name: "mcp-host", version: "9.9.9" });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}`, "user-agent": "Claude-User/1.0" } },
      }),
    );
    try {
      await mcp.callTool({ name: "transcribe_video", arguments: { url: sampleUrl("clientmcp001") } });
    } finally {
      await mcp.close();
    }

    const facts = await server.ctx.stores.jobs.listClientFacts();
    const bySource = new Map<string, number>();
    for (const fact of facts) {
      const key = fact.client.source ?? "";
      bySource.set(key, (bySource.get(key) ?? 0) + fact.count);
    }
    expect(bySource.get("web")).toBe(3);
    expect(bySource.get("rest")).toBe(1);
    expect(bySource.get("mcp")).toBe(1);

    const mcpFact = facts.find((fact) => fact.client.source === "mcp");
    expect(mcpFact?.client).toMatchObject({
      source: "mcp",
      clientName: "mcp-host",
      clientVersion: "9.9.9",
      oauthClientId,
    });
    expect(mcpFact?.client.userAgent).toBe("Claude-User/1.0");

    const restFact = facts.find((fact) => fact.client.source === "rest");
    expect(restFact?.client.userAgent).toBe("curl/8.0");
    expect(restFact?.client.oauthClientId).toBeNull();

    const serialized = JSON.stringify(facts);
    expect(serialized).not.toContain(VISITOR);
    expect(serialized).not.toContain(token);

    const report = await api(server, "/v1/admin/job-clients", { headers: bearer(ADMIN_TOKEN) });
    expect(report.status).toBe(200);
    const labels = new Map<string, number>(report.body.clients.map((row: { label: string; count: number }) => [row.label, row.count]));
    expect(labels.get("web")).toBe(3);
    expect(labels.get("claude")).toBe(1);
    expect(labels.get("other")).toBe(1);

    const refused = await api(server, "/v1/admin/job-clients", { headers: bearer("not-the-real-token") });
    expect(refused.status).toBe(401);
    expect(refused.text).not.toContain(ADMIN_TOKEN);
  });

  it("hides the admin report when the token is unset", async () => {
    server = await startTestServer(testConfig());
    const hidden = await api(server, "/v1/admin/job-clients");
    expect(hidden.status).toBe(404);
  });
});

function transcribe(server: RunningServer, account: AccountSession, url: string, extra: Record<string, string>) {
  return api(server, "/v1/transcriptions", {
    method: "POST",
    json: { url },
    headers: { ...sessionHeaders(account), ...extra },
  });
}
