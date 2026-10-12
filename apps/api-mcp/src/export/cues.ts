import { secondsToMs } from "./timestamps.js";

/** Shortest cue. Zero-length or inverted segments are stretched to this. */
export const MIN_CUE_MS = 500;
/** Longest cue before it is split: subtitle guidance of about 7 seconds. */
export const MAX_CUE_MS = 7_000;
/** Longest cue text before it is split: two lines of about 42 characters. */
export const MAX_CUE_CHARS = 84;

export interface CueSource {
  readonly start: number;
  readonly end: number;
  readonly speaker?: string | null;
  readonly text: string;
}

export interface Cue {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

interface Timed {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly speaker: string | null;
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Transcript segments to subtitle cues. Whitespace is collapsed and empty segments dropped. Long
 * segments split at word boundaries, with time shared out by character count. The timeline never goes
 * backwards or overlaps. A speaker label is printed only when the worker supplied one (no invented names).
 */
export function buildCues(segments: readonly CueSource[]): Cue[] {
  const timed = segments.flatMap((segment) => toTimed(segment) ?? []).sort((a, b) => a.startMs - b.startMs);
  return keepTimelineForward(timed.flatMap(splitSegment));
}

function toTimed(segment: CueSource): Timed | null {
  const text = collapseWhitespace(segment.text);
  if (text === "") return null;
  const startMs = secondsToMs(segment.start);
  const endMs = Math.max(secondsToMs(segment.end), startMs + MIN_CUE_MS);
  const speaker = segment.speaker?.trim() ?? "";
  return { startMs, endMs, text, speaker: speaker === "" ? null : speaker };
}

function splitSegment(segment: Timed): Cue[] {
  const duration = segment.endMs - segment.startMs;
  const wanted = Math.max(1, Math.ceil(duration / MAX_CUE_MS), Math.ceil(segment.text.length / MAX_CUE_CHARS));
  const groups = groupWords(segment.text.split(" "), wanted);
  const label = segment.speaker === null ? "" : `${segment.speaker}: `;
  const total = groups.reduce((sum, group) => sum + weightOf(group), 0);
  let consumed = 0;
  return groups.map((group, index) => {
    const from = consumed;
    consumed += weightOf(group);
    const startMs = segment.startMs + Math.round((duration * from) / total);
    const endMs = index === groups.length - 1 ? segment.endMs : segment.startMs + Math.round((duration * consumed) / total);
    return { startMs, endMs, text: `${index === 0 ? label : ""}${group.join(" ")}` };
  });
}

/** Greedy split into at most `count` groups of roughly equal character weight. */
function groupWords(words: readonly string[], count: number): string[][] {
  const target = words.reduce((sum, word) => sum + weight(word), 0) / count;
  const groups: string[][] = [];
  let current: string[] = [];
  let filled = 0;
  for (const word of words) {
    if (current.length > 0 && groups.length < count - 1 && filled >= target * (groups.length + 1)) {
      groups.push(current);
      current = [];
    }
    current.push(word);
    filled += weight(word);
  }
  groups.push(current);
  return groups;
}

function weight(word: string): number {
  return word.length + 1;
}

function weightOf(group: readonly string[]): number {
  return group.reduce((sum, word) => sum + weight(word), 0);
}

function keepTimelineForward(cues: readonly Cue[]): Cue[] {
  let cursor = 0;
  return cues.map((cue) => {
    const startMs = Math.max(cue.startMs, cursor);
    const endMs = Math.max(cue.endMs, startMs + MIN_CUE_MS);
    cursor = endMs;
    return { startMs, endMs, text: cue.text };
  });
}
