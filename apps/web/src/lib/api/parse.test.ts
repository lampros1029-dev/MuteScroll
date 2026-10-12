import { describe, expect, it } from "vitest";

import { parseOutcome, parseTranscription } from "./parse";

const transcript = {
  source: { platform: "instagram", content_type: "reel", title: "Reel", author: "a", duration_seconds: 58 },
  language: "en",
  method: "asr",
  transcript_text: "[00:00] Hello $10",
  segments: [{ start: 0, end: 4, speaker: null, text: "Hello $10" }, { start: "bad" }],
  uncertain_spans: [{ start: 1, end: 2, text: "Hello", reason: "low_confidence" }, { start: 1 }],
  on_screen_references: [{ at: 3, phrase: "link in my bio" }],
};

describe("parseOutcome", () => {
  it("reads a completed job and accepts the worker's `source` field name", () => {
    const outcome = parseOutcome(200, { status: "completed", job_id: "job-1", transcription: transcript });
    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") return;
    expect(outcome.jobId).toBe("job-1");
    expect(outcome.transcription.metadata.platform).toBe("instagram");
    expect(outcome.transcription.metadata.duration_seconds).toBe(58);
    expect(outcome.transcription.segments).toHaveLength(1);
    expect(outcome.transcription.uncertain_spans).toHaveLength(1);
    expect(outcome.transcription.credits_charged).toBe(0);
  });

  it("prefers `metadata` when the API sends it, as docs/rest-api.md describes", () => {
    const parsed = parseTranscription({ ...transcript, metadata: { platform: "tiktok", title: "T" }, source: undefined });
    expect(parsed?.metadata.platform).toBe("tiktok");
    expect(parsed?.metadata.title).toBe("T");
  });

  it("reads a processing job from 202 using the job id from the body", () => {
    expect(parseOutcome(202, { status: "processing", job_id: "job-2" })).toEqual({ kind: "processing", jobId: "job-2" });
  });

  it("uses the id hint when a GET body does not repeat it", () => {
    expect(parseOutcome(202, { status: "processing" }, "hinted")).toEqual({ kind: "processing", jobId: "hinted" });
  });

  it("reads a failed job (HTTP 200) as an error that keeps the job id", () => {
    const outcome = parseOutcome(200, {
      status: "failed",
      job_id: "job-3",
      error: { code: "retrieval_failed", message: "Nope", upload_url: "https://api/upload/x" },
    });
    expect(outcome).toEqual({
      kind: "error",
      jobId: "job-3",
      failure: { status: 200, code: "retrieval_failed", message: "Nope", uploadUrl: "https://api/upload/x" },
    });
  });

  it("reads contract errors, including upload_url", () => {
    const outcome = parseOutcome(502, { error: { code: "retrieval_failed", message: "Try upload", upload_url: "/u" } });
    expect(outcome).toEqual({
      kind: "error",
      failure: { status: 502, code: "retrieval_failed", message: "Try upload", uploadUrl: "/u" },
    });
  });

  it("falls back to status codes when the body is not JSON", () => {
    expect(parseOutcome(413, undefined)).toEqual({
      kind: "error",
      failure: { status: 413, code: "file_too_large", message: "" },
    });
  });

  it("reports unreadable successful responses as invalid", () => {
    const outcome = parseOutcome(200, { status: "completed", job_id: "j", transcription: { segments: [] } });
    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") return;
    expect(outcome.failure.code).toBe("invalid_response");
  });
});

describe("parseTranscription", () => {
  it("drops malformed segments and spans instead of rendering them", () => {
    const parsed = parseTranscription(transcript);
    expect(parsed?.segments.map((segment) => segment.text)).toEqual(["Hello $10"]);
    expect(parsed?.uncertain_spans.map((span) => span.text)).toEqual(["Hello"]);
    expect(parsed?.on_screen_references).toEqual([{ at: 3, phrase: "link in my bio" }]);
  });

  it("returns null when there is neither text nor segments", () => {
    expect(parseTranscription({ segments: [], transcript_text: "  " })).toBeNull();
    expect(parseTranscription("nope")).toBeNull();
  });
});
