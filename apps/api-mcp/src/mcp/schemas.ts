import { z } from "zod";

/** Minimal inputs (PRD 8, 8.4). Validation details (URL, language) happen in the handlers so they return PRD 13 copy. */
export const transcribeInputShape = {
  url: z
    .string()
    .min(1)
    .max(2048)
    .describe("A public video link. MuteScroll reads it when it can reach it. Other links get the one-time upload path."),
  language: z
    .string()
    .max(16)
    .optional()
    .describe("Spoken language as an ISO 639-1 code such as 'en' or 'el', or 'auto' (default)."),
};

export const getTranscriptionInputShape = {
  job_id: z.string().min(1).max(80).describe("The job_id returned by transcribe_video."),
};

const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  upload_url: z.string().optional(),
  resets_at: z.string().optional(),
  retry_after_seconds: z.number().optional(),
});

const sourceSchema = z.object({
  platform: z.string(),
  content_type: z.string().nullish(),
  title: z.string().nullish(),
  author: z.string().nullish(),
  duration_seconds: z.number().nullish(),
});

const segmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  speaker: z.string().nullish(),
  text: z.string(),
});

/** One output shape for all statuses (PRD 8.1). Optional fields depend on `status`. */
export const toolOutputShape = {
  status: z.enum(["completed", "processing", "failed"]),
  job_id: z.string().optional(),
  error: errorSchema.optional(),
  source: sourceSchema.optional(),
  language: z.string().nullish(),
  method: z
    .enum(["captions", "captions_auto", "asr"])
    .optional()
    .describe("How the words were read. captions_auto means automatic captions from the public page."),
  transcript_text: z.string().optional(),
  segments: z.array(segmentSchema).optional(),
  uncertain_spans: z
    .array(z.object({ start: z.number(), end: z.number(), text: z.string(), reason: z.string() }))
    .optional(),
  on_screen_references: z.array(z.object({ at: z.number(), phrase: z.string() })).optional(),
  credits_charged: z.number().optional(),
  quota: z.object({ remaining_this_period: z.number() }).optional(),
};

export const toolOutputSchema = z.object(toolOutputShape);
export type ToolOutput = z.infer<typeof toolOutputSchema>;
