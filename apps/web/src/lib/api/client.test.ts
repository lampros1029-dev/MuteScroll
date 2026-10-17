// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTranscription, uploadFile } from "./client";

const TOKEN = "csrf_token-value";

function processingResponse(): Response {
  return new Response(JSON.stringify({ status: "processing", job_id: "job-abcdef12" }), {
    status: 202,
    headers: { "content-type": "application/json" },
  });
}

describe("signed-in transcription writes", () => {
  afterEach(() => {
    document.cookie = "ms_csrf=; Max-Age=0; Path=/";
    vi.unstubAllGlobals();
  });

  it("echoes the CSRF cookie on POST /transcriptions", async () => {
    document.cookie = `ms_csrf=${TOKEN}`;
    const seen: { url: string; init: RequestInit | undefined } = { url: "", init: undefined };
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.url = String(input);
      seen.init = init;
      return processingResponse();
    };

    await createTranscription({ url: "https://example.com/video/abcdefghijk", language: "auto" }, { fetchImpl });

    const headers = new Headers(seen.init?.headers);
    expect(seen.url).toBe("/api/v1/transcriptions");
    expect(headers.get("x-csrf-token")).toBe(TOKEN);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(seen.init?.body))).toEqual({
      url: "https://example.com/video/abcdefghijk",
      language: "auto",
    });
  });

  it("echoes the CSRF cookie on a file upload", async () => {
    document.cookie = `ms_csrf=${TOKEN}`;
    const sent = new Map<string, string>();

    class FakeXHR {
      upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
      responseType = "";
      responseText = JSON.stringify({ status: "processing", job_id: "job-upload12" });
      status = 202;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;

      open(): void {}

      setRequestHeader(name: string, value: string): void {
        sent.set(name.toLowerCase(), value);
      }

      send(): void {
        this.onload?.();
      }

      abort(): void {}
    }

    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const file = new File(["clip"], "clip.mp4", { type: "video/mp4" });

    await uploadFile(file);

    expect(sent.get("x-csrf-token")).toBe(TOKEN);
    expect(sent.get("content-type")).toBe("video/mp4");
    expect(sent.get("x-filename")).toBe("clip.mp4");
  });
});
