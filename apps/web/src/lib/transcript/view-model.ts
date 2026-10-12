import type { Transcription, TranscriptSegment, UncertainSpan } from "../api/types";

export function durationSeconds(transcription: Transcription): number {
  const declared = transcription.metadata.duration_seconds;
  if (declared !== null && declared > 0) return declared;
  const lastSegment = transcription.segments.at(-1);
  return lastSegment === undefined ? 0 : lastSegment.end;
}

/**
 * Speakers are shown only as "Speaker N", numbered by first appearance (PRD 11.1).
 * Raw diarization labels such as SPEAKER_00 are never displayed.
 */
export function speakerNumbers(segments: readonly TranscriptSegment[]): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>();
  for (const segment of segments) {
    const speaker = segment.speaker;
    if (speaker !== null && !numbers.has(speaker)) numbers.set(speaker, numbers.size + 1);
  }
  return numbers;
}

export function speakerLabel(speaker: string | null, numbers: ReadonlyMap<string, number>): string | null {
  if (speaker === null) return null;
  const number = numbers.get(speaker);
  return number === undefined ? null : `Speaker ${number}`;
}

export function platformLabel(platform: string): string {
  switch (platform) {
    case "youtube":
      return "YouTube";
    case "tiktok":
      return "TikTok";
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    case "upload":
      return "Uploaded file";
    case "unknown":
      return "Unknown source";
    default:
      return platform.charAt(0).toUpperCase() + platform.slice(1);
  }
}

export function contentTypeLabel(contentType: string | null): string | null {
  switch (contentType) {
    case "reel":
      return "Reel";
    case "short":
      return "Short";
    case "video":
      return "Video";
    case "file":
      return "File";
    default:
      return null;
  }
}

export function methodLabel(method: string): string {
  switch (method) {
    case "captions":
      return "Platform captions";
    case "captions_auto":
      return "Auto-generated captions";
    case "asr":
      return "Speech recognition";
    default:
      return "Transcribed from audio";
  }
}

/** Explains a worker flag in plain language. Unknown reasons get the generic wording. */
export function reasonExplanation(reason: string): string {
  switch (reason) {
    case "low_confidence":
      return "The speech model was unsure of these words. Check them against the audio before you quote them.";
    case "low_confidence_segment":
      return "The speech model was unsure of this whole sentence. Check it against the audio before you quote it.";
    default:
      return "The speech model flagged this as uncertain. Check it against the audio before you quote it.";
  }
}

export function reasonLabel(reason: string): string {
  switch (reason) {
    case "low_confidence":
      return "Low confidence";
    case "low_confidence_segment":
      return "Unsure about this sentence";
    default:
      return "Flagged";
  }
}

/** Index of the segment that covers `seconds`, or the closest one by start time. */
export function nearestSegmentIndex(segments: readonly TranscriptSegment[], seconds: number): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  segments.forEach((segment, index) => {
    if (seconds >= segment.start && seconds < segment.end) {
      best = index;
      bestDistance = 0;
      return;
    }
    const distance = Math.abs(segment.start - seconds);
    if (bestDistance > 0 && distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** Uncertain spans sorted by time, for the review list. */
export function sortedSpans(spans: readonly UncertainSpan[]): UncertainSpan[] {
  return [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
}
