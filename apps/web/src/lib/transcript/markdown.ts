import { formatDuration, formatTimestamp, languageName } from "../format";
import type { Transcription } from "../api/types";

import {
  durationSeconds,
  methodLabel,
  platformLabel,
  speakerLabel,
  speakerNumbers,
} from "./view-model";

export interface MarkdownOptions {
  readonly sourceUrl?: string | null;
}

/**
 * Markdown mirroring the API's `md` export (docs/rest-api.md): a title heading, a metadata line,
 * then one timestamped line per segment. Text is copied verbatim; only the labels are added.
 */
export function buildMarkdown(transcription: Transcription, options: MarkdownOptions = {}): string {
  const duration = durationSeconds(transcription);
  const title = transcription.metadata.title?.trim() || "Transcript";

  const facts: string[] = [`Platform: ${platformLabel(transcription.metadata.platform)}`];
  if (transcription.metadata.author) facts.push(`Author: ${transcription.metadata.author}`);
  facts.push(`Duration: ${formatDuration(duration)}`);
  const language = languageName(transcription.language);
  if (language !== null) facts.push(`Language: ${language}`);
  facts.push(`Method: ${methodLabel(transcription.method)}`);
  if (options.sourceUrl) facts.push(`Source: ${options.sourceUrl}`);

  const numbers = speakerNumbers(transcription.segments);
  const lines =
    transcription.segments.length > 0
      ? transcription.segments.map((segment) => {
          const speaker = speakerLabel(segment.speaker, numbers);
          const prefix = speaker === null ? "" : `${speaker}: `;
          return `${formatTimestamp(segment.start, duration)} ${prefix}${segment.text.trim()}`;
        })
      : transcription.transcript_text.split("\n").filter((line) => line.trim() !== "");

  return [`# ${title}`, "", facts.join(" · "), "", ...lines, ""].join("\n");
}

/** Plain text as the API returns it: the transcript text, or the segments joined if it is empty. */
export function buildPlainText(transcription: Transcription): string {
  if (transcription.transcript_text.trim() !== "") return transcription.transcript_text;
  const duration = durationSeconds(transcription);
  return transcription.segments
    .map((segment) => `${formatTimestamp(segment.start, duration)} ${segment.text.trim()}`)
    .join("\n");
}
