import { describe, expect, it } from "vitest";

import { detectPlatform, normalizeLink } from "./platform";

describe("normalizeLink", () => {
  it("adds https to bare hosts and keeps full links", () => {
    expect(normalizeLink("example.com/video/abcdefghijk")).toBe("https://example.com/video/abcdefghijk");
    expect(normalizeLink("  https://www.example.com/video/123456789  ")).toBe("https://www.example.com/video/123456789");
  });

  it("rejects empty input, spaces, non-web schemes and hosts without a dot", () => {
    expect(normalizeLink("")).toBeNull();
    expect(normalizeLink("not a link")).toBeNull();
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("localhost")).toBeNull();
  });
});

describe("detectPlatform", () => {
  it("labels a public http(s) link as a public video", () => {
    expect(detectPlatform("https://example.com/video/abcdefghijk")).toMatchObject({
      kind: "link",
      platform: "public",
      label: "Public video",
    });
    expect(detectPlatform("videos.example.org/clip")).toMatchObject({ platform: "public", label: "Public video" });
  });

  it("reports empty and invalid input without an error message", () => {
    expect(detectPlatform("   ")).toEqual({ kind: "empty" });
    expect(detectPlatform("hello world")).toEqual({ kind: "invalid" });
  });
});
