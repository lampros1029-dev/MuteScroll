import type { UrlErrorCode } from "@mutescroll/shared";

import type { WorkerErrorCode } from "../worker/types.js";

/** Every code a tool can return in `error.code`. Upstream text is never part of this set. */
export type ToolErrorCode =
  | UrlErrorCode
  | "invalid_language"
  | "rate_limited"
  | "quota_exceeded"
  | "not_found"
  | WorkerErrorCode;

export interface CopyOptions {
  readonly plansUrl: string;
  readonly retryAfterSeconds?: number;
  readonly resetsAt?: Date;
}

export interface FailureCopy {
  readonly message: string;
  /** True when an upload link is useful. Only retrieval failures qualify (PRD 14). */
  readonly offerUpload: boolean;
}

const RETRIEVAL_FAILURES: ReadonlySet<ToolErrorCode> = new Set<ToolErrorCode>([
  "blocked_bot_check",
  "private_or_login_required",
  "retrieval_failed",
  "unavailable",
  "drm_protected",
  "live_stream",
  "too_long",
]);

export function offersUpload(code: ToolErrorCode): boolean {
  return RETRIEVAL_FAILURES.has(code);
}

const INTERNAL_RETRY = "Something went wrong on our side. Please try again in a few minutes. You weren't charged for this.";

/** PRD 13 wording (model-facing, rephrased naturally by the host), plus copy for codes PRD 13 does not cover. */
export function copyFor(code: ToolErrorCode, options: CopyOptions): FailureCopy {
  const message = messageFor(code, options);
  return { message, offerUpload: offersUpload(code) };
}

function messageFor(code: ToolErrorCode, options: CopyOptions): string {
  switch (code) {
    case "invalid_url":
      return "That doesn't look like a valid video link. Paste the full https:// link, or upload the file.";
    case "unsupported_url":
      return "MuteScroll reads a public video link when it can reach it. Other links get the one-time upload path.";
    case "unsafe_url":
      return "This link can't be processed. Only public http(s) video links are accepted.";
    case "invalid_language":
      return "Language must be 'auto' or a two-letter ISO 639-1 code such as 'en' or 'el'.";
    case "rate_limited":
      return `Too many requests in a short time. Try again in ${options.retryAfterSeconds ?? 60} seconds.`;
    case "quota_exceeded":
      return `You've used this period's transcriptions. They reset on ${formatReset(options.resetsAt)}. Plan details: ${options.plansUrl}`;
    case "not_found":
      return "No transcription was found for that job_id. It may have expired; ask for the video again.";
    case "blocked_bot_check":
    case "retrieval_failed":
      return "MuteScroll could not reach this video. Use the one-time upload path.";
    case "private_or_login_required":
      return "This video needs access MuteScroll does not have. MuteScroll does not sign in or bypass access controls. Use the one-time upload path.";
    case "unavailable":
      return "This video is unavailable or was removed. If you have a copy you can access, upload the file and I'll transcribe it.";
    case "drm_protected":
      return "This video is protected, so MuteScroll cannot read it. If you have a copy you are allowed to use, use the one-time upload path.";
    case "live_stream":
      return "Live streams can't be transcribed yet. Try again after the stream ends, or upload a recording.";
    case "too_long":
      return `This video is longer than the limit for one transcription. Plan details: ${options.plansUrl}. You can also upload a shorter file.`;
    case "no_audio_track":
      return "I processed the video but it has no audio track, so there is nothing to transcribe.";
    case "no_speech":
      return "I processed the video but found no meaningful speech (music or sound only).";
    case "blocked":
      return "This link can't be processed. Only public http(s) video links are accepted.";
    case "media_error":
      return "This media could not be processed. The file may be damaged or in an unsupported format. You weren't charged for this.";
    case "asr_error":
    case "worker_timeout":
    case "worker_unavailable":
    case "worker_misconfigured":
    case "worker_failed":
    case "invalid_output":
    case "file_not_found":
      return INTERNAL_RETRY;
    default: {
      const unreachable: never = code;
      throw new Error(`Unhandled tool error code: ${String(unreachable)}`);
    }
  }
}

function formatReset(resetsAt: Date | undefined): string {
  return resetsAt === undefined ? "later" : resetsAt.toUTCString();
}
