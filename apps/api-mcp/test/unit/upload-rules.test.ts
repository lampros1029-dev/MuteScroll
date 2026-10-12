import { describe, expect, it } from "vitest";

import {
  containerMatchesExtension,
  extensionOf,
  isAllowedMimeType,
  sniffContainer,
} from "../../src/upload/media-types.js";
import { UploadTokenStore } from "../../src/upload/tokens.js";
import { mp4Bytes } from "../helpers/fixtures.js";

function tokens(ttlMs = 1000) {
  let clock = 0;
  let counter = 0;
  const store = new UploadTokenStore({
    ttlMs,
    now: () => clock,
    newToken: () => `tok-${(counter += 1)}`,
  });
  return { store, advance: (ms: number) => (clock += ms) };
}

describe("UploadTokenStore single-use rules", () => {
  it("lets one lease through, consumes it, and then reports used", () => {
    const { store } = tokens();
    const token = store.issue("job_1");
    expect(store.acquire(token)).toEqual({ ok: true, jobId: "job_1" });
    expect(store.acquire(token)).toEqual({ ok: false, reason: "busy" });
    store.complete(token);
    expect(store.acquire(token)).toEqual({ ok: false, reason: "used" });
    expect(store.peek(token)).toBe("used");
  });

  it("returns a leased token to open after a client-side rejection", () => {
    const { store } = tokens();
    const token = store.issue("job_1");
    store.acquire(token);
    store.release(token);
    expect(store.peek(token)).toBe("open");
    expect(store.acquire(token).ok).toBe(true);
  });

  it("expires tokens after the TTL", () => {
    const { store, advance } = tokens(1000);
    const token = store.issue("job_1");
    advance(999);
    expect(store.acquire(token).ok).toBe(true);
    store.release(token);
    advance(2);
    expect(store.acquire(token)).toEqual({ ok: false, reason: "unknown" });
  });

  it("treats an unknown token as unknown, never as valid", () => {
    const { store } = tokens();
    expect(store.acquire("nope")).toEqual({ ok: false, reason: "unknown" });
    expect(store.peek("nope")).toBe("unknown");
  });

  it("marks every link for a job as used when the job is re-queued or a new link replaces it", () => {
    const { store } = tokens();
    const token = store.issue("job_1");
    store.revokeForJob("job_1");
    expect(store.acquire(token)).toEqual({ ok: false, reason: "used" });
    const other = store.issue("job_2");
    expect(store.acquire(other).ok).toBe(true);
  });

  it("generates URL-safe tokens by default", () => {
    const store = new UploadTokenStore({ ttlMs: 1000, now: () => 0 });
    const token = store.issue("job_1");
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });
});

describe("upload file rules", () => {
  it("takes only the validated extension from a client file name", () => {
    expect(extensionOf("Holiday Clip.MP4")).toBe("mp4");
    expect(extensionOf("../../etc/passwd.mp3")).toBe("mp3");
    expect(extensionOf("script.exe")).toBeNull();
    expect(extensionOf("noextension")).toBeNull();
    expect(extensionOf("")).toBeNull();
  });

  it("accepts the PRD 6 MIME types and the empty / octet-stream fallback", () => {
    expect(isAllowedMimeType("video/mp4")).toBe(true);
    expect(isAllowedMimeType("Audio/MPEG; charset=binary")).toBe(true);
    expect(isAllowedMimeType("")).toBe(true);
    expect(isAllowedMimeType(undefined)).toBe(true);
    expect(isAllowedMimeType("text/html")).toBe(false);
    expect(isAllowedMimeType("application/x-msdownload")).toBe(false);
  });

  it("sniffs the container from magic bytes, not from the name", () => {
    expect(sniffContainer(mp4Bytes())).toBe("iso-bmff");
    expect(sniffContainer(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))).toBe("ebml-webm");
    expect(sniffContainer(Buffer.from("ID3\x04\x00"))).toBe("mpeg-audio");
    expect(sniffContainer(new Uint8Array([0xff, 0xfb, 0x90, 0x00]))).toBe("mpeg-audio");
    expect(sniffContainer(Buffer.from("RIFF\x00\x00\x00\x00WAVEfmt "))).toBe("riff-wave");
    expect(sniffContainer(Buffer.from("MZ\x90\x00 this is an executable"))).toBeNull();
    expect(sniffContainer(new Uint8Array([]))).toBeNull();
  });

  it("requires the sniffed container to match the extension", () => {
    expect(containerMatchesExtension("mp4", "iso-bmff")).toBe(true);
    expect(containerMatchesExtension("m4a", "iso-bmff")).toBe(true);
    expect(containerMatchesExtension("mp3", "iso-bmff")).toBe(false);
    expect(containerMatchesExtension("webm", "ebml-webm")).toBe(true);
    expect(containerMatchesExtension("wav", "mpeg-audio")).toBe(false);
  });
});
