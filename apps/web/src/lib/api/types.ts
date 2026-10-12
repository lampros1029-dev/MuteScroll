/**
 * Client-side view of the REST contract in docs/rest-api.md. The API returns the worker result
 * (PRD 8.1) as `metadata`; the worker's own JSON calls it `source`, so parsing accepts both.
 */

export interface TranscriptMetadata {
  platform: string;
  content_type: string | null;
  title: string | null;
  author: string | null;
  duration_seconds: number | null;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  speaker: string | null;
  text: string;
}

export interface UncertainSpan {
  start: number;
  end: number;
  text: string;
  /** Machine reason from the worker, e.g. `low_confidence` or `low_confidence_segment`. Open-ended. */
  reason: string;
}

export interface OnScreenReference {
  at: number;
  phrase: string;
}

export interface Transcription {
  metadata: TranscriptMetadata;
  language: string | null;
  method: string;
  transcript_text: string;
  segments: TranscriptSegment[];
  uncertain_spans: UncertainSpan[];
  on_screen_references: OnScreenReference[];
  credits_charged: number;
}

/** An error the API (or the network) reported. `status` is 0 when no HTTP response arrived. */
export interface Failure {
  status: number;
  code: string;
  message: string;
  uploadUrl?: string;
}

/** Result of one job request: POST /transcriptions, GET /transcriptions/:id or POST /uploads. */
export type Outcome =
  | { kind: "completed"; jobId: string; transcription: Transcription }
  | { kind: "processing"; jobId: string }
  | { kind: "error"; jobId?: string; failure: Failure };

export const EXPORT_FORMATS = ["txt", "md", "srt", "vtt", "json", "docx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
