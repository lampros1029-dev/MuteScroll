import { afterEach, describe, expect, it } from "vitest";

import { MediaWorkerError } from "../../src/worker/errors.js";
import { FakeWorker, delay } from "../helpers/fake-worker.js";
import { sampleUrl, transcriptFixture } from "../helpers/fixtures.js";
import { call, openSession, type Session, waitForStatus } from "./helpers.js";

let session: Session | undefined;

afterEach(async () => {
  await session?.close();
  session = undefined;
});

async function start(env: Record<string, string> = {}, worker?: FakeWorker): Promise<Session> {
  session = await openSession(env, worker);
  return session;
}

const PLATFORM_NAME = /youtube|tiktok|instagram|facebook|reels|shorts|fb\.watch|developer mode/i;
const SALES_COPY = /checkout|\/pricing|\/checkout|upgrade|discount|trial|\bprices?\b|\bplans?\b|\bsave\b/i;

describe("tool registration", () => {
  it("exposes both tools with explicit annotations and minimal inputs", async () => {
    const s = await start();
    const instructions = s.client.getInstructions() ?? "";
    expect(instructions.slice(0, 512)).toContain("Read a public video link.");
    expect(instructions.slice(0, 512)).toContain("Call transcribe_video once.");
    expect(instructions.slice(0, 512)).toContain("poll get_transcription");
    expect(instructions.slice(0, 512)).toContain("summarize, translate, or check claims");
    expect(instructions.slice(0, 512)).toContain("Do not change numbers.");
    expect(instructions.slice(0, 512)).toContain("Flag uncertain spans.");
    expect(instructions.slice(0, 512)).toContain('Speakers are "Speaker N".');
    expect(instructions.slice(0, 512)).toContain("captions_auto means automatic captions from the public page");
    expect(instructions.slice(0, 512)).toContain("return the upload link");
    expect(instructions.slice(0, 512)).toContain("Do not sign in or bypass access controls.");
    expect(instructions.slice(0, 512)).toContain("Do not mention prices, plans, or upgrades.");
    expect(instructions).not.toMatch(/any public video link/i);
    expect(instructions).not.toMatch(PLATFORM_NAME);

    const { tools } = await s.client.listTools();
    const transcribe = tools.find((t) => t.name === "transcribe_video");
    const get = tools.find((t) => t.name === "get_transcription");
    expect(transcribe?.title).toBe("Transcribe a public video link");
    expect(transcribe?.description).toContain("public video link");
    expect(transcribe?.description).toContain("one-time upload path");
    expect(transcribe?.description).not.toMatch(/any public video link/i);
    expect(transcribe?.description).not.toMatch(SALES_COPY);
    expect(transcribe?.description).not.toMatch(PLATFORM_NAME);
    expect(get?.description).toContain("transcribe_video");
    expect(get?.description).toContain("one-time upload");
    expect(get?.description).not.toMatch(SALES_COPY);
    expect(get?.description).not.toMatch(PLATFORM_NAME);
    const urlField = transcribe?.inputSchema.properties?.["url"] as { description?: string } | undefined;
    expect(urlField?.description).toContain("public video link");
    expect(urlField?.description).not.toMatch(/any public video link/i);
    expect(urlField?.description).not.toMatch(PLATFORM_NAME);
    expect(transcribe?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(get?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(Object.keys(transcribe?.inputSchema.properties ?? {}).sort()).toEqual(["language", "url"]);
    expect(Object.keys(get?.inputSchema.properties ?? {})).toEqual(["job_id"]);
    expect(JSON.stringify(transcribe?.outputSchema)).not.toContain("captions_vendor");

    const raw = await listToolsRaw(s.server.baseUrl);
    const rawTools = raw.result?.tools ?? [];
    for (const tool of rawTools) {
      expect(tool.securitySchemes).toEqual([
        { type: "noauth" },
        { type: "oauth2", scopes: ["transcribe"] },
      ]);
    }
  });
});

describe("transcribe_video", () => {
  it("returns the completed transcript inline with job_id and no internal ids", async () => {
    const s = await start();
    const result = await call(s, "transcribe_video", { url: sampleUrl() });
    expect(result.isError).toBeFalsy();
    expect(result.output).toMatchObject({
      status: "completed",
      method: "asr",
      language: "en",
      transcript_text: "[00:00] Hello there",
      credits_charged: 1,
      quota: { remaining_this_period: 4 },
    });
    expect(result.output.job_id).toMatch(/^job_/);
    expect(result.output).not.toHaveProperty("transcription_id");
    expect(result.content[0]).toMatchObject({ type: "text", text: "[00:00] Hello there" });
    expect(s.worker.requests[0]?.target).toEqual({ kind: "url", url: sampleUrl() });
  });

  it("returns processing with a job_id when the job outlasts the wait, then get_transcription completes it", async () => {
    const worker = new FakeWorker(() => delay(150, transcriptFixture()));
    const s = await start({ TOOL_WAIT_MS: "20" }, worker);
    const started = await call(s, "transcribe_video", { url: sampleUrl() });
    expect(started.output.status).toBe("processing");
    expect(started.output.job_id).toBeDefined();
    expect(started.isError).toBeFalsy();

    const finished = await waitForStatus(s, started.output.job_id ?? "", "completed");
    expect(finished.status).toBe("completed");
  });

  it("shares one job between identical concurrent requests (dedupe)", async () => {
    const worker = new FakeWorker(() => delay(80, transcriptFixture()));
    const s = await start({}, worker);
    const [a, b] = await Promise.all([
      call(s, "transcribe_video", { url: sampleUrl() }),
      call(s, "transcribe_video", { url: sampleUrl() }),
    ]);
    expect(a.output.job_id).toBe(b.output.job_id);
    expect(worker.requests).toHaveLength(1);
  });

  it("does not charge a second transcribe_video for the same url", async () => {
    const s = await start();
    const first = await call(s, "transcribe_video", { url: sampleUrl() });
    const second = await call(s, "transcribe_video", { url: sampleUrl() });
    expect(second.output.job_id).toBe(first.output.job_id);
    expect(second.output.quota?.remaining_this_period).toBe(first.output.quota?.remaining_this_period);
    expect(s.worker.requests).toHaveLength(1);
  });

  it.each([
    ["not a link", "invalid_url"],
    ["ftp://example.com/video.mp4", "unsafe_url"],
    ["http://127.0.0.1/video.mp4", "unsafe_url"],
  ])("rejects %j before doing any work (%s)", async (url, code) => {
    const s = await start();
    const result = await call(s, "transcribe_video", { url });
    expect(result.isError).toBe(true);
    expect(result.output).toMatchObject({ status: "failed", error: { code } });
    expect(result.output.error?.message.length).toBeGreaterThan(10);
    expect(s.worker.requests).toHaveLength(0);
  });

  it("rejects a malformed language without starting work", async () => {
    const s = await start();
    const result = await call(s, "transcribe_video", { url: sampleUrl(), language: "english" });
    expect(result.output.error?.code).toBe("invalid_language");
    expect(s.worker.requests).toHaveLength(0);
  });

  it("returns a neutral quota message with a plans link once the allowance is spent", async () => {
    const s = await start({ ANON_CREDITS: "1" });
    expect((await call(s, "transcribe_video", { url: sampleUrl("aaaaaaaaaaa") })).output.status).toBe("completed");
    const blocked = await call(s, "transcribe_video", { url: sampleUrl("bbbbbbbbbbb") });
    expect(blocked.isError).toBe(true);
    expect(blocked.output.error?.code).toBe("quota_exceeded");
    expect(blocked.output.error?.message).toContain("https://mutescroll.xyz/plans");
    expect(blocked.output.error?.message).not.toMatch(/checkout|\/pricing|upgrade/i);
    expect(blocked._meta).toMatchObject({
      "mcp/www_authenticate": {
        error: "invalid_token",
        error_description: blocked.output.error?.message,
      },
    });
    expect(blocked.output.error?.resets_at).toBeDefined();
    expect(blocked.output.error?.upload_url).toBeUndefined();
    expect(s.worker.requests).toHaveLength(1);
  });

  it("rate-limits bursts per client and says when to retry", async () => {
    const s = await start({ ANON_REQUESTS_PER_MINUTE: "2" });
    await call(s, "transcribe_video", { url: sampleUrl("aaaaaaaaaaa") });
    await call(s, "transcribe_video", { url: sampleUrl("bbbbbbbbbbb") });
    const limited = await call(s, "transcribe_video", { url: sampleUrl("ccccccccccc") });
    expect(limited.output.error?.code).toBe("rate_limited");
    expect(limited.output.error?.retry_after_seconds).toBeGreaterThan(0);
  });

  it("offers an upload link on a retrieval failure and charges nothing", async () => {
    const worker = new FakeWorker(async () => {
      throw new MediaWorkerError("blocked_bot_check");
    });
    const s = await start({}, worker);
    const result = await call(s, "transcribe_video", { url: sampleUrl() });
    expect(result.isError).toBe(true);
    expect(result.output.error?.code).toBe("blocked_bot_check");
    expect(result.output.error?.upload_url).toMatch(new RegExp(`^${s.server.baseUrl}/upload/[A-Za-z0-9_-]{16,}$`));
    expect(result.output.job_id).toMatch(/^job_/);
    expect((result.content[0] as { text: string }).text).toContain("/upload/");
    expect(s.server.ctx.quota.remaining("127.0.0.1")).toBe(5);
  });

  it("gives no upload link and no detail for internal failures", async () => {
    const worker = new FakeWorker(async () => {
      throw new Error("ENOENT: /srv/secret/python3 leaked");
    });
    const s = await start({}, worker);
    const result = await call(s, "transcribe_video", { url: sampleUrl() });
    expect(result.output.error?.code).toBe("worker_failed");
    expect(result.output.error?.upload_url).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("explains a video without speech and does not offer upload", async () => {
    const worker = new FakeWorker(async () => {
      throw new MediaWorkerError("no_speech");
    });
    const s = await start({}, worker);
    const result = await call(s, "transcribe_video", { url: sampleUrl() });
    expect(result.output.error?.message).toContain("no meaningful speech");
    expect(result.output.error?.upload_url).toBeUndefined();
  });
});

describe("get_transcription", () => {
  it("reports not_found for an unknown job_id without echoing it", async () => {
    const s = await start();
    const result = await call(s, "get_transcription", { job_id: "job_does_not_exist" });
    expect(result.isError).toBe(true);
    expect(result.output.error?.code).toBe("not_found");
    expect(JSON.stringify(result)).not.toContain("job_does_not_exist");
  });
});

describe("HTTP surface", () => {
  it("keeps /healthz and returns 404 for unknown paths", async () => {
    const s = await start();
    const health = await fetch(`${s.server.baseUrl}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect((await fetch(`${s.server.baseUrl}/nope`)).status).toBe(404);
  });

  it("rejects oversized MCP request bodies before parsing them", async () => {
    const s = await start({ MCP_MAX_BODY_BYTES: "1024" });
    const response = await fetch(`${s.server.baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(4096) } }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: -32600 } });
  });

  it("answers malformed JSON with a JSON-RPC parse error", async () => {
    const s = await start();
    const response = await fetch(`${s.server.baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32700 } });
  });
});

async function listToolsRaw(baseUrl: string): Promise<{ result?: { tools?: Array<{ securitySchemes?: unknown }> } }> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const text = await response.text();
  const json = text.trimStart().startsWith("{")
    ? text
    : (text.split("\n").find((line) => line.startsWith("data:"))?.slice("data:".length) ?? text);
  return JSON.parse(json) as { result?: { tools?: Array<{ securitySchemes?: unknown }> } };
}
