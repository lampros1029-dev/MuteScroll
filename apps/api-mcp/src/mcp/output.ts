import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { Job } from "../jobs/types.js";
import { copyFor, type ToolErrorCode } from "./messages.js";
import type { ToolOutput } from "./schemas.js";

export interface FailureDetails {
  readonly jobId?: string;
  readonly uploadUrl?: string;
  readonly resetsAt?: Date;
  readonly retryAfterSeconds?: number;
  readonly plansUrl: string;
}

export function processingOutput(jobId: string): ToolOutput {
  return { status: "processing", job_id: jobId };
}

/** Completed result. `quotaRemaining` is only set on transcribe calls, for the requesting client. */
export function completedOutput(job: Job, quotaRemaining?: number): ToolOutput | null {
  const result = job.result;
  if (result === null) return null;
  return {
    status: "completed",
    job_id: job.id,
    source: result.source,
    language: result.language ?? null,
    method: result.method,
    transcript_text: result.transcript_text,
    segments: result.segments,
    uncertain_spans: result.uncertain_spans,
    on_screen_references: result.on_screen_references,
    credits_charged: job.creditsCharged,
    ...(quotaRemaining === undefined ? {} : { quota: { remaining_this_period: quotaRemaining } }),
  };
}

export function failureOutput(code: ToolErrorCode, details: FailureDetails): ToolOutput {
  const copy = copyFor(code, {
    plansUrl: details.plansUrl,
    ...(details.resetsAt === undefined ? {} : { resetsAt: details.resetsAt }),
    ...(details.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: details.retryAfterSeconds }),
  });
  return {
    status: "failed",
    ...(details.jobId === undefined ? {} : { job_id: details.jobId }),
    error: {
      code,
      message: copy.message,
      ...(details.uploadUrl !== undefined && copy.offerUpload ? { upload_url: details.uploadUrl } : {}),
      ...(details.resetsAt === undefined ? {} : { resets_at: details.resetsAt.toISOString() }),
      ...(details.retryAfterSeconds === undefined ? {} : { retry_after_seconds: details.retryAfterSeconds }),
    },
  };
}

/** Text for hosts that only read `content`; `structuredContent` carries the full PRD 8.1 shape. */
export function toCallToolResult(output: ToolOutput): CallToolResult {
  return {
    content: [{ type: "text", text: textFor(output) }],
    structuredContent: output,
    isError: output.status === "failed",
  };
}

function textFor(output: ToolOutput): string {
  switch (output.status) {
    case "completed":
      return output.transcript_text ?? "";
    case "processing":
      return `The transcription is still running. Call get_transcription with job_id "${output.job_id ?? ""}" in a moment.`;
    case "failed": {
      const error = output.error;
      if (error === undefined) return "The transcription failed.";
      return error.upload_url === undefined ? error.message : `${error.message} Upload link: ${error.upload_url}`;
    }
    default: {
      const unreachable: never = output.status;
      throw new Error(`Unhandled status: ${String(unreachable)}`);
    }
  }
}
