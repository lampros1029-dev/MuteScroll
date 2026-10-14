import { z } from "zod";

/** Shape of `TranscriptResult.to_dict()` in workers/media (PRD 8.1). Validated at the process boundary. */
const segmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  speaker: z.string().nullish(),
  text: z.string(),
});

const uncertainSpanSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  reason: z.string(),
});

const onScreenReferenceSchema = z.object({
  at: z.number(),
  phrase: z.string(),
});

export const workerTranscriptSchema = z.object({
  status: z.literal("completed"),
  source: z.object({
    platform: z.string(),
    content_type: z.string().nullish(),
    title: z.string().nullish(),
    author: z.string().nullish(),
    duration_seconds: z.number().nullish(),
  }),
  language: z.string().nullish(),
  method: z.enum(["captions", "captions_auto", "captions_vendor", "asr"]),
  transcript_text: z.string(),
  segments: z.array(segmentSchema),
  uncertain_spans: z.array(uncertainSpanSchema),
  on_screen_references: z.array(onScreenReferenceSchema),
});

export type WorkerTranscript = z.infer<typeof workerTranscriptSchema>;
