import { describe, expect, it } from "vitest";

import { creditsForDuration, formatTimestamp } from "./credits.js";
import { parseVideoUrl, platformLabel, PLATFORMS } from "./platform.js";

function ok(input: string) {
  const result = parseVideoUrl(input);
  if (!result.ok) throw new Error(`Expected ok for ${input}, got ${result.code}: ${result.message}`);
  return result;
}

function errorCode(input: string) {
  const result = parseVideoUrl(input);
  if (result.ok) throw new Error(`Expected error for ${input}, got ${result.canonicalUrl}`);
  return result.code;
}

describe("public links", () => {
  it("accepts any public http(s) link and keeps the query", () => {
    const result = ok("https://www.example.com/video/abc?id=1&utm_source=x#t=10");
    expect(result.platform).toBe("public");
    expect(result.contentType).toBe("video");
    expect(result.canonicalUrl).toBe("https://www.example.com/video/abc?id=1&utm_source=x");
    expect(result.needsRedirectResolve).toBe(false);
  });

  it("accepts http and a host that is not on a fixed list", () => {
    expect(ok("http://videos.example.org/clip").canonicalUrl).toBe("http://videos.example.org/clip");
    expect(ok("https://cdn.example.net/a/b").platform).toBe("public");
  });

  it("lowercases the host and drops a trailing dot", () => {
    expect(ok("https://WWW.Example.COM./watch").canonicalUrl).toBe("https://www.example.com/watch");
  });
});

describe("URL safety (SSRF and abuse)", () => {
  it.each([
    "http://127.0.0.1/video.mp4",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://2130706433/",
    "http://localhost/",
    "http://foo.internal/",
    "http://printer.local/",
    "http://intranet/",
    "https://user:pass@example.com/video",
    "https://example.com:8443/video",
    "ftp://example.com/video",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ])("rejects unsafe %s", (input) => {
    expect(errorCode(input)).toBe("unsafe_url");
  });

  it.each(["", "   ", "not a url", "https://", "a".repeat(3000)])("rejects invalid input %j", (input) => {
    expect(errorCode(input)).toBe("invalid_url");
  });
});

describe("platformLabel", () => {
  it("labels every platform without a host name", () => {
    for (const platform of PLATFORMS) expect(platformLabel(platform)).toBe("Public video");
  });
});

describe("credits", () => {
  it.each([
    [1, 1],
    [58, 1],
    [600, 1],
    [601, 2],
    [2700, 5],
    [7200, 12],
  ])("%is costs %i credits", (seconds, credits) => {
    expect(creditsForDuration(seconds)).toBe(credits);
  });

  it("never charges zero and rejects invalid durations", () => {
    expect(creditsForDuration(0)).toBe(1);
    expect(() => creditsForDuration(-1)).toThrow(RangeError);
    expect(() => creditsForDuration(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatTimestamp", () => {
  it("uses MM:SS under an hour and HH:MM:SS otherwise", () => {
    expect(formatTimestamp(7, 120)).toBe("[00:07]");
    expect(formatTimestamp(754, 3000)).toBe("[12:34]");
    expect(formatTimestamp(3725, 7200)).toBe("[01:02:05]");
  });
});
