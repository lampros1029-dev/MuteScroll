import { codeFromStatus } from "./errors";
import type {
  Failure,
  OnScreenReference,
  Outcome,
  TranscriptMetadata,
  TranscriptSegment,
  Transcription,
  UncertainSpan,
} from "./types";

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseMetadata(raw: unknown): TranscriptMetadata {
  const record = isRecord(raw) ? raw : {};
  return {
    platform: optionalString(record["platform"]) ?? "unknown",
    content_type: optionalString(record["content_type"]),
    title: optionalString(record["title"]),
    author: optionalString(record["author"]),
    duration_seconds: finiteNumber(record["duration_seconds"]),
  };
}

function parseSegment(raw: unknown): TranscriptSegment | null {
  if (!isRecord(raw)) return null;
  const start = finiteNumber(raw["start"]);
  const end = finiteNumber(raw["end"]);
  const text = typeof raw["text"] === "string" ? raw["text"] : null;
  if (start === null || end === null || text === null) return null;
  return { start, end: Math.max(start, end), speaker: optionalString(raw["speaker"]), text };
}

function parseSpan(raw: unknown): UncertainSpan | null {
  if (!isRecord(raw)) return null;
  const start = finiteNumber(raw["start"]);
  const end = finiteNumber(raw["end"]);
  const text = typeof raw["text"] === "string" ? raw["text"] : null;
  if (start === null || end === null || text === null || text.trim() === "") return null;
  const reason = typeof raw["reason"] === "string" ? raw["reason"] : "low_confidence";
  return { start, end: Math.max(start, end), text, reason };
}

function parseReference(raw: unknown): OnScreenReference | null {
  if (!isRecord(raw)) return null;
  const at = finiteNumber(raw["at"]);
  const phrase = typeof raw["phrase"] === "string" ? raw["phrase"] : null;
  if (at === null || phrase === null || phrase.trim() === "") return null;
  return { at, phrase };
}

/** Accepts the transcript object from the API, normalising field names. Returns null if unusable. */
export function parseTranscription(raw: unknown): Transcription | null {
  if (!isRecord(raw)) return null;
  const transcriptText = typeof raw["transcript_text"] === "string" ? raw["transcript_text"] : "";
  const segments = asArray(raw["segments"])
    .map(parseSegment)
    .filter((segment): segment is TranscriptSegment => segment !== null);
  if (segments.length === 0 && transcriptText.trim() === "") return null;
  return {
    metadata: parseMetadata(raw["metadata"] ?? raw["source"]),
    language: optionalString(raw["language"]),
    method: typeof raw["method"] === "string" ? raw["method"] : "unknown",
    transcript_text: transcriptText,
    segments,
    uncertain_spans: asArray(raw["uncertain_spans"])
      .map(parseSpan)
      .filter((span): span is UncertainSpan => span !== null),
    on_screen_references: asArray(raw["on_screen_references"])
      .map(parseReference)
      .filter((ref): ref is OnScreenReference => ref !== null),
    credits_charged: finiteNumber(raw["credits_charged"]) ?? 0,
  };
}

function parseFailure(status: number, raw: unknown): Failure {
  if (!isRecord(raw)) {
    return { status, code: codeFromStatus(status), message: "" };
  }
  const code = typeof raw["code"] === "string" && raw["code"] !== "" ? raw["code"] : codeFromStatus(status);
  const message = typeof raw["message"] === "string" ? raw["message"] : "";
  const uploadUrl = typeof raw["upload_url"] === "string" ? raw["upload_url"] : undefined;
  return uploadUrl === undefined ? { status, code, message } : { status, code, message, uploadUrl };
}

/**
 * Interprets an API response body. `jobIdHint` is used when the body does not repeat the job id
 * (for example on a GET, where the id is already known from the request).
 */
export function parseOutcome(status: number, body: unknown, jobIdHint?: string): Outcome {
  const invalid = (): Outcome => ({
    kind: "error",
    ...(jobIdHint === undefined ? {} : { jobId: jobIdHint }),
    failure: { status, code: "invalid_response", message: "" },
  });

  if (!isRecord(body)) return status >= 400 ? errorOutcome(status, undefined, jobIdHint) : invalid();

  const jobId = typeof body["job_id"] === "string" && body["job_id"] !== "" ? body["job_id"] : jobIdHint;

  if (body["error"] !== undefined) {
    return errorOutcome(status, body["error"], jobId, true);
  }
  if (status >= 400) return errorOutcome(status, undefined, jobId);

  switch (body["status"]) {
    case "completed": {
      const transcription = parseTranscription(body["transcription"]);
      if (transcription === null || jobId === undefined) return invalid();
      return { kind: "completed", jobId, transcription };
    }
    case "processing":
      return jobId === undefined ? invalid() : { kind: "processing", jobId };
    case "failed":
      return errorOutcome(status, body["error"], jobId, true);
    default:
      return invalid();
  }
}

function errorOutcome(status: number, rawError: unknown, jobId: string | undefined, hasBody = false): Outcome {
  const failure = hasBody
    ? parseFailure(status, rawError)
    : { status, code: codeFromStatus(status), message: "" };
  return jobId === undefined ? { kind: "error", failure } : { kind: "error", jobId, failure };
}
