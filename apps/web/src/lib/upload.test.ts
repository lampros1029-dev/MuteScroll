import { describe, expect, it } from "vitest";

import { asciiFileName, checkUploadFile, uploadContentType } from "./upload";

describe("uploadContentType", () => {
  it("maps accepted extensions to MIME types the API accepts", () => {
    expect(uploadContentType("clip.MP4")).toBe("video/mp4");
    expect(uploadContentType("voice.m4a")).toBe("audio/mp4");
    expect(uploadContentType("song.mp3")).toBe("audio/mpeg");
    expect(uploadContentType("take.webm")).toBe("video/webm");
  });

  it("returns null for anything else", () => {
    expect(uploadContentType("notes.pdf")).toBeNull();
    expect(uploadContentType("noextension")).toBeNull();
  });
});

describe("checkUploadFile", () => {
  it("rejects empty files and unsupported types with the accepted list", () => {
    expect(checkUploadFile({ name: "a.mp4", size: 0 })).toEqual({
      ok: false,
      message: "This file is empty. Choose a file with audio or video in it.",
    });
    const bad = checkUploadFile({ name: "a.mkv", size: 10 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain("MP4, MOV, WebM, M4A, MP3, WAV");
  });

  it("accepts supported files without a size limit of its own", () => {
    expect(checkUploadFile({ name: "a.wav", size: 5 * 1024 ** 3 })).toEqual({ ok: true });
  });
});

describe("asciiFileName", () => {
  it("keeps the extension and replaces characters that cannot travel in a header", () => {
    expect(asciiFileName("Σήμερα video.MP4")).toBe("_ video.mp4");
    expect(asciiFileName("Café talk (final).mov")).toBe("Cafe talk (final).mov");
    expect(asciiFileName('bad"name;\r\n.mp3')).toBe("bad_name_.mp3");
  });

  it("falls back to a generic name when nothing usable is left", () => {
    expect(asciiFileName("ΑΒΓ.wav")).toBe("_.wav");
    expect(asciiFileName("")).toBe("upload");
  });
});
