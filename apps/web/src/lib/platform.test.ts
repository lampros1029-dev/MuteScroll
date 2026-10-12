import { describe, expect, it } from "vitest";

import { detectPlatform, normalizeLink } from "./platform";

describe("normalizeLink", () => {
  it("adds https to bare hosts and keeps full links", () => {
    expect(normalizeLink("youtube.com/watch?v=abcdefghijk")).toBe("https://youtube.com/watch?v=abcdefghijk");
    expect(normalizeLink("  https://www.tiktok.com/@a/video/123456789  ")).toBe("https://www.tiktok.com/@a/video/123456789");
  });

  it("rejects empty input, spaces, non-web schemes and hosts without a dot", () => {
    expect(normalizeLink("")).toBeNull();
    expect(normalizeLink("not a link")).toBeNull();
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("localhost")).toBeNull();
  });
});

describe("detectPlatform", () => {
  it("names the supported platforms, including short links", () => {
    expect(detectPlatform("https://youtu.be/abcdefghijk")).toMatchObject({ kind: "link", platform: "youtube", label: "YouTube" });
    expect(detectPlatform("https://m.youtube.com/shorts/abcdefghijk")).toMatchObject({ platform: "youtube" });
    expect(detectPlatform("https://vm.tiktok.com/ZMabc123/")).toMatchObject({ platform: "tiktok" });
    expect(detectPlatform("https://www.instagram.com/reel/Cabc123/")).toMatchObject({ platform: "instagram" });
    expect(detectPlatform("https://fb.watch/abc123/")).toMatchObject({ platform: "facebook" });
  });

  it("does not confuse look-alike hosts with supported ones", () => {
    expect(detectPlatform("https://notyoutube.com/watch?v=1")).toMatchObject({ platform: "other" });
    expect(detectPlatform("https://example.com/video")).toMatchObject({ platform: "other", label: "Unrecognised platform" });
  });

  it("reports empty and invalid input without an error message", () => {
    expect(detectPlatform("   ")).toEqual({ kind: "empty" });
    expect(detectPlatform("hello world")).toEqual({ kind: "invalid" });
  });
});
