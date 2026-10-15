import { formatTimestamp } from "@mutescroll/shared";

import { buildCues, collapseWhitespace, type Cue } from "./cues.js";
import { renderDocx } from "./docx.js";
import type { Transcription, TranscriptionSegment } from "./model.js";
import { clockFromSeconds, srtTimestamp, vttTimestamp } from "./timestamps.js";

export const EXPORT_FORMATS = ["txt", "md", "srt", "vtt", "json", "docx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface RenderedExport {
  readonly body: string;
  readonly contentType: string;
  /**
   * Set when `body` is raw file bytes, one character per byte (`Buffer.from(body, encoding)`).
   * Text formats omit this and are UTF-8 strings.
   */
  readonly encoding?: "latin1";
}

/** Returns the format, or null when it is not one we export. Missing means plain text. */
export function parseExportFormat(raw: string | undefined): ExportFormat | null {
  if (raw === undefined) return "txt";
  return (EXPORT_FORMATS as readonly string[]).includes(raw) ? (raw as ExportFormat) : null;
}

/** Pure rendering of a transcript into a downloadable file body (docs/rest-api.md). */
export function renderExport(format: ExportFormat, transcription: Transcription): RenderedExport {
  switch (format) {
    case "txt":
      return { body: withTrailingNewline(transcription.transcript_text), contentType: "text/plain; charset=utf-8" };
    case "md":
      return { body: markdownOf(transcription), contentType: "text/markdown; charset=utf-8" };
    case "srt":
      return { body: formatSrt(buildCues(transcription.segments)), contentType: "application/x-subrip; charset=utf-8" };
    case "vtt":
      return { body: formatVtt(buildCues(transcription.segments)), contentType: "text/vtt; charset=utf-8" };
    case "json":
      return { body: `${JSON.stringify(transcription, null, 2)}\n`, contentType: "application/json; charset=utf-8" };
    case "docx": {
      const docx = renderDocx(transcription);
      return { body: docx.body, contentType: docx.contentType, encoding: "latin1" };
    }
    default: {
      const unreachable: never = format;
      throw new Error(`Unhandled export format: ${String(unreachable)}`);
    }
  }
}

/** SubRip: numbered cues, comma milliseconds, blank line between cues. */
export function formatSrt(cues: readonly Cue[]): string {
  return cues
    .map((cue, index) => `${index + 1}\n${srtTimestamp(cue.startMs)} --> ${srtTimestamp(cue.endMs)}\n${cue.text}\n`)
    .join("\n");
}

/** WebVTT: header, then dot-millisecond cues. Cue text is escaped so markup cannot break the file. */
export function formatVtt(cues: readonly Cue[]): string {
  const blocks = cues.map(
    (cue) => `${vttTimestamp(cue.startMs)} --> ${vttTimestamp(cue.endMs)}\n${escapeVtt(cue.text)}\n`,
  );
  return `WEBVTT\n\n${blocks.join("\n")}`;
}

export function escapeVtt(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Host ids stay in the JSON object. A person reading Markdown sees a general source label. */
function sourceLabel(platform: string): string {
  if (platform === "upload") return "uploaded file";
  if (platform === "unknown") return "unknown source";
  return "public video";
}

/** Title heading, a metadata line, then one timestamped paragraph per segment. */
function markdownOf(transcription: Transcription): string {
  const title = escapeMarkdown(collapseWhitespace(transcription.metadata.title ?? "") || "Transcript");
  const duration = transcription.metadata.duration_seconds ?? lastEnd(transcription.segments);
  const facts = [
    sourceLabel(transcription.metadata.platform),
    transcription.metadata.author ? `by ${transcription.metadata.author}` : null,
    transcription.language ? `language ${transcription.language}` : null,
    `method ${transcription.method}`,
    duration > 0 ? `duration ${clockFromSeconds(duration)}` : null,
  ].filter((fact): fact is string => fact !== null);
  const body =
    transcription.segments.length > 0
      ? transcription.segments.map((segment) => timedParagraph(segment, duration)).join("\n\n")
      : transcription.transcript_text.trim();
  return `# ${title}\n\n${escapeMarkdown(facts.join(" · "))}\n\n${body}\n`;
}

function timedParagraph(segment: TranscriptionSegment, totalSeconds: number): string {
  const start = Number.isFinite(segment.start) ? Math.max(0, segment.start) : 0;
  const label = formatTimestamp(start, Math.max(0, totalSeconds));
  const speaker = segment.speaker ? `${segment.speaker}: ` : "";
  return `${label} ${speaker}${collapseWhitespace(segment.text)}`;
}

function lastEnd(segments: readonly TranscriptionSegment[]): number {
  return segments.reduce((latest, segment) => Math.max(latest, Number.isFinite(segment.end) ? segment.end : 0), 0);
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>]/g, "\\$&");
}

function withTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}
