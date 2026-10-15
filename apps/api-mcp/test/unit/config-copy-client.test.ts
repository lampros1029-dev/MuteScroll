import type { IncomingMessage } from "node:http";
import { Socket } from "node:net";

import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../../src/config.js";
import { clientKeyFor } from "../../src/http/client-key.js";
import { copyFor, offersUpload, type ToolErrorCode } from "../../src/mcp/messages.js";
import { normalizeLanguage } from "../../src/mcp/tools/transcribe-video.js";
import { WORKER_ERROR_CODES } from "../../src/worker/types.js";

const PLANS = "https://mutescroll.xyz/plans";

describe("loadConfig", () => {
  it("uses safe defaults when nothing is set", () => {
    const config = loadConfig({}, "linux");
    expect(config.port).toBe(8080);
    expect(config.publicBaseUrl).toBe("http://localhost:8080");
    expect(config.trustProxy).toBe(false);
    expect(config.anonCredits).toBe(5);
    expect(config.anonRequestsPerMinute).toBe(10);
    expect(config.worker.python).toBe("python3");
  });

  it("picks the Windows interpreter name on win32", () => {
    expect(loadConfig({}, "win32").worker.python).toBe("python");
  });

  it("reads overrides and strips trailing slashes from the public URL", () => {
    const config = loadConfig({ PUBLIC_BASE_URL: "https://api.mutescroll.xyz/", ANON_CREDITS: "3" }, "linux");
    expect(config.publicBaseUrl).toBe("https://api.mutescroll.xyz");
    expect(config.anonCredits).toBe(3);
  });

  it.each([
    [{ PORT: "abc" }, "PORT"],
    [{ ANON_REQUESTS_PER_MINUTE: "0" }, "ANON_REQUESTS_PER_MINUTE"],
    [{ TRUST_PROXY: "maybe" }, "TRUST_PROXY"],
    [{ PUBLIC_BASE_URL: "not a url" }, "PUBLIC_BASE_URL"],
  ])("rejects invalid %j and names the key", (env, key) => {
    expect(() => loadConfig(env, "linux")).toThrow(ConfigError);
    expect(() => loadConfig(env, "linux")).toThrow(key);
  });
});

describe("normalizeLanguage", () => {
  it.each([
    [undefined, "auto"],
    ["", null],
    ["EN", "en"],
    [" el ", "el"],
    ["auto", "auto"],
    ["english", null],
    ["en-US", null],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeLanguage(input)).toBe(expected);
  });
});

describe("tool failure copy (PRD 13)", () => {
  const allCodes: ToolErrorCode[] = [
    "invalid_url",
    "unsupported_url",
    "unsafe_url",
    "invalid_language",
    "rate_limited",
    "quota_exceeded",
    "not_found",
    ...WORKER_ERROR_CODES,
  ];

  it("has copy for every code, with no raw upstream text or stack traces", () => {
    for (const code of allCodes) {
      const copy = copyFor(code, { plansUrl: PLANS, retryAfterSeconds: 5, resetsAt: new Date(0) });
      expect(copy.message.length).toBeGreaterThan(10);
      expect(copy.message).not.toMatch(/stack|Traceback|Error:|cookie/i);
    }
  });

  it("offers an upload only for retrieval failures", () => {
    const retrieval = ["blocked_bot_check", "private_or_login_required", "retrieval_failed", "unavailable", "drm_protected", "live_stream", "too_long"];
    for (const code of retrieval) expect(offersUpload(code as ToolErrorCode)).toBe(true);
    for (const code of ["no_speech", "no_audio_track", "asr_error", "worker_timeout", "quota_exceeded", "invalid_url"]) {
      expect(offersUpload(code as ToolErrorCode)).toBe(false);
    }
  });

  it("sends unreachable links to the one-time upload path without naming a video platform", () => {
    const platformName = /youtube|tiktok|instagram|facebook|reels|shorts|fb\.watch|developer mode/i;
    for (const code of ["unsupported_url", "private_or_login_required", "drm_protected", "blocked_bot_check"] as const) {
      const message = copyFor(code, { plansUrl: PLANS }).message;
      expect(message).toContain("one-time upload path");
      expect(message).not.toMatch(/any public video link/i);
      expect(message).not.toMatch(platformName);
    }
  });

  it("links to the plans page on quota and length messages, never a checkout link", () => {
    const quota = copyFor("quota_exceeded", { plansUrl: PLANS, resetsAt: new Date("2026-10-13T10:00:00Z") });
    expect(quota.message).toContain(PLANS);
    expect(quota.message).toContain("Tue, 13 Oct 2026 10:00:00 GMT");
    expect(quota.message).not.toMatch(/checkout|paddle|stripe/i);
    expect(copyFor("too_long", { plansUrl: PLANS }).message).toContain(PLANS);
  });
});

describe("clientKeyFor", () => {
  function requestWith(headers: Record<string, string>, remote: string): IncomingMessage {
    const socket = new Socket();
    Object.defineProperty(socket, "remoteAddress", { value: remote });
    return { headers, socket } as unknown as IncomingMessage;
  }

  it("ignores forwarding headers unless the proxy is trusted", () => {
    const req = requestWith({ "x-forwarded-for": "198.51.100.7" }, "10.0.0.2");
    expect(clientKeyFor(req, false, "x-forwarded-for")).toBe("10.0.0.2");
  });

  it("uses the right-most entry (appended by our proxy) when trusted", () => {
    const req = requestWith({ "x-forwarded-for": "6.6.6.6, 198.51.100.7" }, "10.0.0.2");
    expect(clientKeyFor(req, true, "x-forwarded-for")).toBe("198.51.100.7");
  });

  it("falls back to the socket address when the trusted header is absent", () => {
    expect(clientKeyFor(requestWith({}, "10.0.0.2"), true, "x-forwarded-for")).toBe("10.0.0.2");
  });
});
