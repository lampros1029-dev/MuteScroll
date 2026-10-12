import type { WorkerTranscript } from "./transcript-schema.js";

/** Stable error codes emitted by the media worker (PRD 9.3, 13). Never carries upstream text. */
export const WORKER_ERROR_CODES = [
  "blocked_bot_check",
  "private_or_login_required",
  "retrieval_failed",
  "unavailable",
  "drm_protected",
  "live_stream",
  "too_long",
  "no_audio_track",
  "no_speech",
  "blocked",
  "media_error",
  "asr_error",
  "file_not_found",
  "worker_misconfigured",
  "worker_timeout",
  "worker_unavailable",
  "worker_failed",
  "invalid_output",
] as const;

export type WorkerErrorCode = (typeof WORKER_ERROR_CODES)[number];

export type WorkerTarget =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "file"; readonly path: string };

export interface WorkerRequest {
  readonly target: WorkerTarget;
  /** ISO 639-1 code or "auto". */
  readonly language: string;
  readonly maxSeconds: number;
}

/** Runs one transcription. Implementations must throw `MediaWorkerError` for every failure. */
export interface MediaWorker {
  transcribe(request: WorkerRequest): Promise<WorkerTranscript>;
}
