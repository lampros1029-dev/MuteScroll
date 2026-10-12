import type { UncertainSpan } from "../api/types";

export interface TextPiece {
  readonly text: string;
  /** The uncertain span this piece belongs to, or null for ordinary text. */
  readonly flag: UncertainSpan | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Splits one segment's text so each uncertain span can be highlighted in place.
 * Only spans that overlap the segment in time are considered, and each span claims the next
 * case-insensitive occurrence of its text. The text itself is never changed, only split.
 * Spans whose words do not appear in the segment are left to the review list.
 */
export function splitByUncertainty(
  text: string,
  segment: { readonly start: number; readonly end: number },
  spans: readonly UncertainSpan[],
): TextPiece[] {
  if (text === "") return [];

  const candidates = spans
    .filter((span) => span.text.trim() !== "" && span.start < segment.end && span.end > segment.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const pieces: TextPiece[] = [];
  let cursor = 0;
  for (const span of candidates) {
    const match = findFrom(text, span.text.trim(), cursor);
    if (match === null) continue;
    if (match.index > cursor) pieces.push({ text: text.slice(cursor, match.index), flag: null });
    pieces.push({ text: text.slice(match.index, match.index + match.length), flag: span });
    cursor = match.index + match.length;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), flag: null });
  return pieces;
}

function findFrom(text: string, needle: string, from: number): { index: number; length: number } | null {
  const pattern = new RegExp(escapeRegExp(needle), "iu");
  const match = pattern.exec(text.slice(from));
  if (match === null) return null;
  return { index: from + match.index, length: match[0].length };
}
