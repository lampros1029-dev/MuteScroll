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

describe("YouTube", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=x&t=10s"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ"],
    ["http://youtube.com/watch?v=dQw4w9WgXcQ"],
  ])("normalizes %s", (input) => {
    const r = ok(input);
    expect(r.platform).toBe("youtube");
    expect(r.contentType).toBe("video");
    expect(r.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(r.needsRedirectResolve).toBe(false);
  });

  it("detects Shorts", () => {
    const r = ok("https://www.youtube.com/shorts/abcdefghijk?feature=share");
    expect(r.contentType).toBe("short");
    expect(r.canonicalUrl).toBe("https://www.youtube.com/shorts/abcdefghijk");
  });

  it("rejects malformed ids and non-video pages", () => {
    expect(errorCode("https://www.youtube.com/watch?v=short")).toBe("unsupported_url");
    expect(errorCode("https://www.youtube.com/@somechannel")).toBe("unsupported_url");
  });
});

describe("TikTok", () => {
  it("normalizes full video URLs and strips tracking", () => {
    const r = ok("https://www.tiktok.com/@some.user/video/7234567890123456789?is_from_webapp=1&sender_device=pc");
    expect(r.platform).toBe("tiktok");
    expect(r.canonicalUrl).toBe("https://www.tiktok.com/@some.user/video/7234567890123456789");
    expect(r.needsRedirectResolve).toBe(false);
  });

  it.each(["https://vm.tiktok.com/ZMabc123/", "https://vt.tiktok.com/ZSabc123/", "https://www.tiktok.com/t/ZTabc123/"])(
    "flags short link %s for redirect resolution",
    (input) => {
      const r = ok(input);
      expect(r.platform).toBe("tiktok");
      expect(r.needsRedirectResolve).toBe(true);
    },
  );

  it("rejects profile pages", () => {
    expect(errorCode("https://www.tiktok.com/@some.user")).toBe("unsupported_url");
  });
});

describe("Instagram", () => {
  it.each([
    ["https://www.instagram.com/reel/Cabc_123-x/?igsh=abc", "reel", "https://www.instagram.com/reel/Cabc_123-x/"],
    ["https://instagram.com/reels/Cabc_123-x", "reel", "https://www.instagram.com/reel/Cabc_123-x/"],
    ["https://www.instagram.com/someuser/reel/Cabc_123-x/", "reel", "https://www.instagram.com/reel/Cabc_123-x/"],
    ["https://www.instagram.com/p/Cabc_123-x/", "video", "https://www.instagram.com/p/Cabc_123-x/"],
  ])("normalizes %s", (input, contentType, canonical) => {
    const r = ok(input);
    expect(r.platform).toBe("instagram");
    expect(r.contentType).toBe(contentType);
    expect(r.canonicalUrl).toBe(canonical);
  });

  it("rejects profile and story URLs", () => {
    expect(errorCode("https://www.instagram.com/someuser/")).toBe("unsupported_url");
    expect(errorCode("https://www.instagram.com/stories/someuser/123/")).toBe("unsupported_url");
  });
});

describe("Facebook", () => {
  it.each([
    ["https://www.facebook.com/reel/1234567890123", "reel", "https://www.facebook.com/reel/1234567890123"],
    ["https://www.facebook.com/watch/?v=1234567890123&ref=x", "video", "https://www.facebook.com/watch/?v=1234567890123"],
    ["https://www.facebook.com/somepage/videos/1234567890123/", "video", "https://www.facebook.com/watch/?v=1234567890123"],
  ])("normalizes %s", (input, contentType, canonical) => {
    const r = ok(input);
    expect(r.platform).toBe("facebook");
    expect(r.contentType).toBe(contentType);
    expect(r.canonicalUrl).toBe(canonical);
    expect(r.needsRedirectResolve).toBe(false);
  });

  it.each(["https://fb.watch/abcd1234/", "https://www.facebook.com/share/r/AbCd1234/", "https://www.facebook.com/share/v/AbCd1234/"])(
    "flags short link %s for redirect resolution",
    (input) => {
      expect(ok(input).needsRedirectResolve).toBe(true);
    },
  );
});

describe("URL safety (SSRF and abuse)", () => {
  it.each([
    "http://127.0.0.1/watch?v=dQw4w9WgXcQ",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://2130706433/",
    "http://localhost/",
    "http://foo.internal/",
    "http://printer.local/",
    "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "ftp://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ])("rejects unsafe %s", (input) => {
    expect(errorCode(input)).toBe("unsafe_url");
  });

  it.each([
    "https://evilyoutube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://example.com/",
    "https://notinstagram.com/reel/Cabc_123-x/",
  ])("rejects lookalike or foreign host %s", (input) => {
    expect(errorCode(input)).toBe("unsupported_url");
  });

  it.each(["", "   ", "not a url", "https://", "a".repeat(3000)])("rejects invalid input %j", (input) => {
    expect(errorCode(input)).toBe("invalid_url");
  });

  it("tolerates a trailing dot and uppercase host", () => {
    expect(ok("https://WWW.YouTube.com./watch?v=dQw4w9WgXcQ").platform).toBe("youtube");
  });
});

describe("platformLabel", () => {
  it("labels every platform", () => {
    for (const p of PLATFORMS) expect(platformLabel(p).length).toBeGreaterThan(0);
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
