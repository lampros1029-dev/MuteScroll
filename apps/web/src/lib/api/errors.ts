import { PLANS_PATH } from "../site";

import type { Failure } from "./types";

/** Every error code the UI has copy for. Unknown codes fall back to the HTTP status. */
export const KNOWN_ERROR_CODES = [
  "invalid_url",
  "unsupported_url",
  "unsafe_url",
  "invalid_language",
  "unavailable",
  "private_or_login_required",
  "blocked_bot_check",
  "retrieval_failed",
  "drm_protected",
  "live_stream",
  "too_long",
  "no_speech",
  "no_audio_track",
  "media_error",
  "quota_exceeded",
  "rate_limited",
  "not_found",
  "asr_error",
  "internal",
  "payment_required",
  "conflict",
  "file_too_large",
  "unsupported_file",
  "upstream_error",
  "server_error",
  "bad_request",
  "network_error",
  "invalid_response",
] as const;

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

/** Codes where retrieving from the platform failed, so an upload is the way forward (PRD 13, 14). */
const UPLOAD_CODES: ReadonlySet<string> = new Set<KnownErrorCode>([
  "unavailable",
  "private_or_login_required",
  "blocked_bot_check",
  "retrieval_failed",
  "drm_protected",
  "live_stream",
  "too_long",
]);

const RETRYABLE_CODES: ReadonlySet<string> = new Set<KnownErrorCode>([
  "blocked_bot_check",
  "retrieval_failed",
  "rate_limited",
  "asr_error",
  "internal",
  "upstream_error",
  "server_error",
  "network_error",
]);

export interface FailureView {
  readonly title: string;
  readonly message: string;
  readonly nextStep: string;
  readonly offerUpload: boolean;
  readonly retryable: boolean;
  readonly link: { readonly href: string; readonly label: string } | null;
}

interface Copy {
  readonly title: string;
  readonly fallbackMessage: string;
  readonly nextStep: string;
  readonly link?: { readonly href: string; readonly label: string };
}

const PLANS_LINK = { href: PLANS_PATH, label: "See plans and limits" } as const;

export function isKnownErrorCode(code: string): code is KnownErrorCode {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(code);
}

/** Maps an HTTP status (or 0 for "no response") to a known code, for responses without one. */
export function codeFromStatus(status: number): KnownErrorCode {
  if (status === 0) return "network_error";
  if (status === 400) return "bad_request";
  if (status === 402) return "payment_required";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 413) return "file_too_large";
  if (status === 415) return "unsupported_file";
  if (status === 429) return "rate_limited";
  if (status === 502) return "upstream_error";
  if (status >= 500) return "server_error";
  return "internal";
}

function copyFor(code: KnownErrorCode): Copy {
  switch (code) {
    case "invalid_url":
      return {
        title: "That link isn't valid",
        fallbackMessage: "That doesn't look like a valid video link.",
        nextStep: "Paste the full link, starting with https://.",
      };
    case "unsupported_url":
      return {
        title: "This link isn't supported",
        fallbackMessage: "This isn't a supported video link.",
        nextStep: "Paste a public video link, or upload the file.",
      };
    case "unsafe_url":
      return {
        title: "This link can't be processed",
        fallbackMessage: "Only public http(s) video links are accepted.",
        nextStep: "Use a public video link without login details in it.",
      };
    case "invalid_language":
      return {
        title: "Language not recognised",
        fallbackMessage: "Choose a language from the list, or leave it on automatic.",
        nextStep: "Pick a language from the list, or leave it on automatic.",
      };
    case "unavailable":
      return {
        title: "This video isn't available",
        fallbackMessage: "This video is unavailable or was removed.",
        nextStep: "It may have been removed or made private. If you have a copy you can use, upload it.",
      };
    case "private_or_login_required":
      return {
        title: "This video needs a login",
        fallbackMessage: "This video needs access we don't have, so we can't retrieve it.",
        nextStep: "We never bypass logins or private settings. Upload a copy you're allowed to process.",
      };
    case "blocked_bot_check":
      return {
        title: "The host blocked our request",
        fallbackMessage: "The host blocked the retrieval request.",
        nextStep: "Other links get the one-time upload path. Upload the file: it runs through the same pipeline.",
      };
    case "retrieval_failed":
      return {
        title: "We couldn't retrieve this video",
        fallbackMessage: "I couldn't retrieve this video right now.",
        nextStep: "Upload the file instead. You get the same output, and a failed retrieval uses no credits.",
      };
    case "drm_protected":
      return {
        title: "This video is protected",
        fallbackMessage: "This video is DRM-protected, so it can't be retrieved.",
        nextStep: "Protected videos can't be processed. Upload a copy you're allowed to use.",
      };
    case "live_stream":
      return {
        title: "Live streams aren't supported yet",
        fallbackMessage: "Live streams can't be transcribed yet.",
        nextStep: "Try again after the stream ends, or upload the recording.",
      };
    case "too_long":
      return {
        title: "This video is longer than your limit",
        fallbackMessage: "This video is longer than the limit for one transcription.",
        nextStep: "Upload a shorter file, or check the limits for each plan.",
        link: PLANS_LINK,
      };
    case "no_speech":
      return {
        title: "No speech found",
        fallbackMessage: "The video has no meaningful speech (music or sound only).",
        nextStep: "Try a clip with spoken words.",
      };
    case "no_audio_track":
      return {
        title: "No audio in this video",
        fallbackMessage: "The video has no audio track, so there is nothing to transcribe.",
        nextStep: "Try a version of the video that has sound.",
      };
    case "media_error":
      return {
        title: "This media couldn't be processed",
        fallbackMessage: "This media could not be processed.",
        nextStep: "The file may be damaged or in an unsupported format. Export it again as MP4 or MP3.",
      };
    case "quota_exceeded":
      return {
        title: "Your limit is reached",
        fallbackMessage: "You've used this period's transcriptions.",
        nextStep: "Limits reset on the date in the message. Allowances are on the plans page.",
        link: PLANS_LINK,
      };
    case "rate_limited":
      return {
        title: "Too many requests",
        fallbackMessage: "Too many requests in a short time.",
        nextStep: "Wait a minute, then try again.",
      };
    case "not_found":
      return {
        title: "Transcript not found",
        fallbackMessage: "No transcription was found for that job. It may have expired.",
        nextStep: "Submit the video again to get a fresh transcript.",
      };
    case "asr_error":
      return {
        title: "Transcription failed",
        fallbackMessage: "The speech recognition step failed.",
        nextStep: "Failed jobs never use credits. Try again in a few minutes.",
      };
    case "internal":
      return {
        title: "Something went wrong on our side",
        fallbackMessage: "Something went wrong on our side.",
        nextStep: "Failed jobs never use credits. Try again in a few minutes.",
      };
    case "payment_required":
      return {
        title: "Not enough credits",
        fallbackMessage: "This account doesn't have enough credits for this transcript.",
        nextStep: "Check your plan and credits.",
        link: PLANS_LINK,
      };
    case "conflict":
      return {
        title: "This job is already in another state",
        fallbackMessage: "That job already has a result or is still running.",
        nextStep: "Refresh the page, or start a new transcript.",
      };
    case "file_too_large":
      return {
        title: "That file is too large",
        fallbackMessage: "This file is larger than the upload limit.",
        nextStep: "Upload a shorter or lower-bitrate copy of the file.",
      };
    case "unsupported_file":
      return {
        title: "This file type isn't supported",
        fallbackMessage: "This file type isn't supported.",
        nextStep: "Export the video as MP4, MOV, WebM, M4A, MP3 or WAV.",
      };
    case "upstream_error":
      return {
        title: "A service we rely on is unavailable",
        fallbackMessage: "A service we rely on didn't respond.",
        nextStep: "Failed jobs never use credits. Try again in a few minutes.",
      };
    case "server_error":
      return {
        title: "Something went wrong on our side",
        fallbackMessage: "Something went wrong on our side.",
        nextStep: "Failed jobs never use credits. Try again in a few minutes.",
      };
    case "bad_request":
      return {
        title: "We couldn't use that request",
        fallbackMessage: "The request was missing something we need.",
        nextStep: "Check the link or file, then try again.",
      };
    case "network_error":
      return {
        title: "We couldn't reach the server",
        fallbackMessage: "The request didn't reach MuteScroll.",
        nextStep: "Check your connection, then try again.",
      };
    case "invalid_response":
      return {
        title: "Unexpected response",
        fallbackMessage: "We got a response we couldn't read.",
        nextStep: "Try again. If it keeps happening, email us.",
      };
    default: {
      const unreachable: never = code;
      throw new Error(`Unhandled error code: ${String(unreachable)}`);
    }
  }
}

function cleanMessage(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 400);
}

/**
 * Turns an API failure into user-facing copy. The API's own message wins when it is present:
 * the contract guarantees it is safe to show. Our copy supplies the title, next step and links.
 */
export function describeFailure(failure: Failure): FailureView {
  const code: KnownErrorCode = isKnownErrorCode(failure.code) ? failure.code : codeFromStatus(failure.status);
  const copy = copyFor(code);
  const serverMessage = cleanMessage(failure.message);
  const offerUpload = UPLOAD_CODES.has(code) || (failure.uploadUrl !== undefined && failure.uploadUrl !== "");
  return {
    title: copy.title,
    message: serverMessage === "" ? copy.fallbackMessage : serverMessage,
    nextStep: copy.nextStep,
    offerUpload,
    retryable: RETRYABLE_CODES.has(code),
    link: copy.link ?? null,
  };
}
