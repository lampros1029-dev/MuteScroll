/** The REST `Transcription` object (docs/rest-api.md). It is the worker result, with `source` named `metadata`. */
export interface TranscriptionMetadata {
  readonly platform: string;
  readonly content_type: string | null;
  readonly title: string | null;
  readonly author: string | null;
  readonly duration_seconds: number | null;
}

export interface TranscriptionSegment {
  readonly start: number;
  readonly end: number;
  readonly speaker: string | null;
  readonly text: string;
}

export interface UncertainSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly reason: string;
}

export interface OnScreenReference {
  readonly at: number;
  readonly phrase: string;
}

export interface Transcription {
  readonly metadata: TranscriptionMetadata;
  readonly language: string | null;
  readonly method: "captions" | "captions_auto" | "asr";
  readonly transcript_text: string;
  readonly segments: readonly TranscriptionSegment[];
  readonly uncertain_spans: readonly UncertainSpan[];
  readonly on_screen_references: readonly OnScreenReference[];
  readonly credits_charged: number;
}
