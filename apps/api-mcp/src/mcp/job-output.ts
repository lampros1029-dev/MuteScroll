import type { AppContext } from "../context.js";
import type { Job } from "../jobs/types.js";
import { offersUpload, type ToolErrorCode } from "./messages.js";
import { completedOutput, failureOutput, processingOutput } from "./output.js";
import type { ToolOutput } from "./schemas.js";

/** Maps a stored job to the tool response for its current state. */
export function jobOutput(ctx: AppContext, job: Job, quotaRemaining?: number): ToolOutput {
  const plansUrl = ctx.config.plansUrl;
  switch (job.status) {
    case "queued":
    case "running":
      return processingOutput(job.id);
    case "succeeded":
      return (
        completedOutput(job, quotaRemaining) ?? failureOutput("worker_failed", { jobId: job.id, plansUrl })
      );
    case "failed": {
      const code: ToolErrorCode = job.failure ?? "worker_failed";
      const uploadUrl = offersUpload(code) ? uploadUrlFor(ctx, job.id) : undefined;
      return failureOutput(code, { jobId: job.id, plansUrl, uploadUrl });
    }
    default: {
      const unreachable: never = job.status;
      throw new Error(`Unhandled job status: ${String(unreachable)}`);
    }
  }
}

export function uploadUrlFor(ctx: AppContext, jobId: string): string {
  return `${ctx.config.publicBaseUrl}/upload/${ctx.service.issueUploadToken(jobId)}`;
}
