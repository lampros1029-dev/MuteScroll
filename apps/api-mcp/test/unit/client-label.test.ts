import { describe, expect, it } from "vitest";

import { deriveClientLabel, jobClientFrom, truncateUserAgent } from "../../src/jobs/client.js";
import { MemoryJobStore } from "../../src/jobs/memory-job-store.js";
import { restJobSource } from "../../src/api/job-client.js";
import { clientIdentityFromBody, mcpSessionKey, MemoryMcpClientSessionStore } from "../../src/mcp/client-session.js";

const TTL = { activeMs: 1000, succeededMs: 5000, accountSucceededMs: 50_000, failedMs: 2000 };

describe("deriveClientLabel", () => {
  it("calls the site web even when the user agent names another client", () => {
    expect(
      deriveClientLabel({
        source: "web",
        clientName: "ChatGPT",
        oauthClientName: "Claude",
        redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
        userAgent: "Cursor/1.0",
      }),
    ).toBe("web");
  });

  it("uses the OAuth redirect host before the registered name, clientInfo, and user agent", () => {
    expect(
      deriveClientLabel({
        source: "mcp",
        clientName: "Cursor",
        oauthClientName: "ChatGPT",
        redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
        userAgent: "ChatGPT-User",
      }),
    ).toBe("claude");
    expect(
      deriveClientLabel({
        source: "mcp",
        clientName: null,
        oauthClientName: "My Connector",
        redirectUris: ["https://claude.com/oauth/callback"],
        userAgent: null,
      }),
    ).toBe("claude");
    expect(
      deriveClientLabel({
        source: "mcp",
        clientName: "Cursor",
        oauthClientName: "Claude",
        redirectUris: ["https://chatgpt.com/connector/oauth/callback"],
        userAgent: null,
      }),
    ).toBe("chatgpt");
    expect(
      deriveClientLabel({
        source: "rest",
        clientName: null,
        oauthClientName: null,
        redirectUris: ["https://auth.openai.com/callback"],
        userAgent: "curl/8.0",
      }),
    ).toBe("chatgpt");
    expect(
      deriveClientLabel({
        source: "mcp",
        clientName: "other-host",
        oauthClientName: "Desktop",
        redirectUris: ["https://cursor.com/oauth/callback"],
        userAgent: null,
      }),
    ).toBe("cursor");
  });

  it("uses the OAuth client name when the redirect host is not one of the known apps", () => {
    expect(
      deriveClientLabel({
        source: "mcp",
        clientName: "Cursor",
        oauthClientName: "Anthropic Claude",
        redirectUris: ["https://example.com/callback"],
        userAgent: "ChatGPT-User",
      }),
    ).toBe("claude");
    expect(
      deriveClientLabel({
        source: "mcp",
        clientName: null,
        oauthClientName: "OpenAI",
        redirectUris: [],
        userAgent: null,
      }),
    ).toBe("chatgpt");
  });

  it("falls back to MCP clientInfo, then the user agent, then other", () => {
    expect(
      deriveClientLabel({
        source: "mcp",
        clientName: "Cursor",
        oauthClientName: null,
        redirectUris: [],
        userAgent: "ChatGPT-User",
      }),
    ).toBe("cursor");
    expect(
      deriveClientLabel({
        source: "mcp",
        clientName: null,
        oauthClientName: null,
        redirectUris: [],
        userAgent: "Claude-User/1.0",
      }),
    ).toBe("claude");
    expect(
      deriveClientLabel({
        source: "rest",
        clientName: null,
        oauthClientName: null,
        redirectUris: [],
        userAgent: "curl/8.0",
      }),
    ).toBe("other");
    expect(
      deriveClientLabel({
        source: null,
        clientName: null,
        oauthClientName: null,
        redirectUris: [],
        userAgent: null,
      }),
    ).toBe("other");
  });
});

describe("client text limits", () => {
  it("truncates the user agent to 200 characters and drops blanks", () => {
    expect(truncateUserAgent(undefined)).toBeNull();
    expect(truncateUserAgent("  ")).toBeNull();
    expect(truncateUserAgent("a".repeat(200))).toHaveLength(200);
    expect(truncateUserAgent("b".repeat(250))).toBe("b".repeat(200));
  });

  it("stores bounded client fields on a new job", async () => {
    const store = new MemoryJobStore({ ttl: TTL, now: () => 1_700_000_000_000 });
    const created = await store.createOrReuse({
      id: "job_1",
      key: "k1",
      language: "auto",
      platform: "public",
      ownerUserId: null,
      client: jobClientFrom({
        source: "mcp",
        clientName: "n".repeat(250),
        clientVersion: "1.0.0",
        oauthClientId: "oac_claudeclient0001",
        userAgent: "u".repeat(250),
      }),
    });
    expect(created.created).toBe(true);
    expect(created.job.client).toEqual({
      source: "mcp",
      clientName: "n".repeat(200),
      clientVersion: "1.0.0",
      oauthClientId: "oac_claudeclient0001",
      userAgent: "u".repeat(200),
    });
    const facts = await store.listClientFacts();
    expect(facts).toEqual([{ day: new Date(1_700_000_000_000).toISOString().slice(0, 10), client: created.job.client, count: 1 }]);
    expect(JSON.stringify(facts)).not.toContain("203.0.113.5");
  });
});

describe("rest job source", () => {
  it("counts a session as the site and a bearer credential as rest", () => {
    expect(restJobSource({ cookieAuth: true, hasAuthorization: false, sourceHeader: undefined })).toBe("web");
    expect(restJobSource({ cookieAuth: true, hasAuthorization: false, sourceHeader: "rest" })).toBe("web");
    expect(restJobSource({ cookieAuth: false, hasAuthorization: false, sourceHeader: "web" })).toBe("web");
    expect(restJobSource({ cookieAuth: false, hasAuthorization: true, sourceHeader: "web" })).toBe("rest");
    expect(restJobSource({ cookieAuth: false, hasAuthorization: false, sourceHeader: undefined })).toBe("rest");
  });
});

describe("MCP client session", () => {
  it("reads clientInfo from initialize and ignores other methods", () => {
    expect(
      clientIdentityFromBody({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "ChatGPT", version: " 2.0 " } },
      }),
    ).toEqual({ clientName: "ChatGPT", clientVersion: "2.0" });
    expect(clientIdentityFromBody({ method: "tools/call", params: { name: "transcribe_video" } })).toBeUndefined();
  });

  it("keys a session by the bearer hash or a session id, never the token or an address", async () => {
    const token = "mso_example-token-value";
    const byToken = mcpSessionKey({ sessionId: undefined, authorization: `Bearer ${token}` });
    const again = mcpSessionKey({ sessionId: undefined, authorization: `Bearer ${token}` });
    expect(byToken).toBe(again);
    expect(byToken).not.toContain(token);
    expect(mcpSessionKey({ sessionId: "203.0.113.5", authorization: `Bearer ${token}` })).toBe(byToken);
    expect(mcpSessionKey({ sessionId: "session-abc", authorization: `Bearer ${token}` })).toBe("sid:session-abc");
    expect(mcpSessionKey({ sessionId: undefined, authorization: undefined })).toBeUndefined();

    const store = new MemoryMcpClientSessionStore();
    await store.remember(byToken ?? "", { clientName: "Claude", clientVersion: "1" }, 0);
    expect(await store.recall(byToken ?? "", 1)).toEqual({ clientName: "Claude", clientVersion: "1" });
    expect(await store.recall(byToken ?? "", 24 * 60 * 60 * 1000)).toBeUndefined();
  });
});
