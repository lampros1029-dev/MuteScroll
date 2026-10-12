import type { IncomingMessage } from "node:http";

import { describe, expect, it } from "vitest";

import { assertJsonContentType, objectBody, requiredString } from "../../src/api/body.js";
import { ApiError } from "../../src/api/errors.js";
import { canView } from "../../src/jobs/ownership.js";
import { clearedSessionCookies, csrfCookie, parseCookies, sessionCookie, sessionCookies } from "../../src/http/cookies.js";
import { fileNameFromHeader } from "../../src/upload/accept.js";
import { normalizeLanguage } from "../../src/jobs/language.js";

function requestWith(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function errorOf(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected an ApiError");
}

describe("cookies", () => {
  it("parses a Cookie header, keeping the first value of a repeated name", () => {
    const jar = parseCookies("ms_session=abc; ms_csrf = xyz ; ms_session=other; broken; =novalue");
    expect(jar.get("ms_session")).toBe("abc");
    expect(jar.get("ms_csrf")).toBe("xyz");
    expect(jar.has("broken")).toBe(false);
    expect(parseCookies(undefined).size).toBe(0);
  });

  it("sets the session cookie HttpOnly, SameSite=Lax and Secure only on https", () => {
    const plain = sessionCookie("tok", { secure: false, maxAgeSeconds: 60 });
    expect(plain).toBe("ms_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=60");
    expect(sessionCookie("tok", { secure: true, maxAgeSeconds: 60 })).toContain("; Secure");
  });

  it("leaves the CSRF cookie readable by scripts", () => {
    const csrf = csrfCookie("c", { secure: true, maxAgeSeconds: 60 });
    expect(csrf).not.toContain("HttpOnly");
    expect(csrf).toContain("SameSite=Lax");
    const pair = sessionCookies("t", "c", { secure: false, maxAgeSeconds: 5 });
    expect(pair).toHaveLength(2);
    expect(pair[0]).toContain("HttpOnly");
    expect(pair[1]).not.toContain("HttpOnly");
  });

  it("clears both cookies with Max-Age=0", () => {
    const cleared = clearedSessionCookies(true);
    expect(cleared).toHaveLength(2);
    for (const line of cleared) {
      expect(line).toContain("Max-Age=0");
      expect(line).toContain("Secure");
    }
  });
});

describe("request body validation", () => {
  it("requires application/json, with or without parameters", () => {
    expect(() => assertJsonContentType(requestWith({ "content-type": "application/json" }))).not.toThrow();
    expect(() => assertJsonContentType(requestWith({ "content-type": "Application/JSON; charset=utf-8" }))).not.toThrow();
    expect(errorOf(() => assertJsonContentType(requestWith({ "content-type": "text/plain" }))).status).toBe(415);
    expect(errorOf(() => assertJsonContentType(requestWith({ "content-type": "application/x-www-form-urlencoded" }))).code).toBe(
      "unsupported_media_type",
    );
    expect(errorOf(() => assertJsonContentType(requestWith({}))).status).toBe(415);
  });

  it("accepts only the documented fields of a JSON object", () => {
    expect(objectBody({ url: "x", language: "en" }, ["url", "language"])).toEqual({ url: "x", language: "en" });
    expect(errorOf(() => objectBody([], ["url"])).status).toBe(400);
    expect(errorOf(() => objectBody("text", ["url"])).status).toBe(400);
    expect(errorOf(() => objectBody({ url: "x", langauge: "en" }, ["url", "language"])).status).toBe(400);
  });

  it("requires a non-empty string within the length limit", () => {
    expect(requiredString({ url: "https://example.com" }, "url", 100)).toBe("https://example.com");
    expect(errorOf(() => requiredString({}, "url", 100)).message).toContain('"url"');
    expect(errorOf(() => requiredString({ url: "" }, "url", 100)).status).toBe(400);
    expect(errorOf(() => requiredString({ url: "x".repeat(101) }, "url", 100)).status).toBe(400);
    expect(errorOf(() => requiredString({ url: 42 }, "url", 100)).status).toBe(400);
  });
});

describe("upload file names", () => {
  it("decodes the percent-encoded X-Filename, and keeps undecodable names as they are", () => {
    expect(fileNameFromHeader("Holiday%20clip.MP4")).toBe("Holiday clip.MP4");
    expect(fileNameFromHeader("bad%E0%A4%A.mp4")).toBe("bad%E0%A4%A.mp4");
    expect(fileNameFromHeader(undefined)).toBe("");
    expect(fileNameFromHeader(["a.mp4", "b.mp4"])).toBe("a.mp4");
  });
});

describe("account job visibility", () => {
  it("shows account jobs only to their owner and anonymous jobs to everyone", () => {
    expect(canView({ ownerUserId: "usr_1" }, { userId: "usr_1" })).toBe(true);
    expect(canView({ ownerUserId: "usr_1" }, { userId: "usr_2" })).toBe(false);
    expect(canView({ ownerUserId: "usr_1" }, { userId: null })).toBe(false);
    expect(canView({ ownerUserId: null }, { userId: null })).toBe(true);
    expect(canView({ ownerUserId: null }, { userId: "usr_2" })).toBe(true);
  });
});

describe("language field", () => {
  it.each([
    [undefined, "auto"],
    ["EN", "en"],
    ["auto", "auto"],
    ["english", null],
    ["", null],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeLanguage(input)).toBe(expected);
  });
});
