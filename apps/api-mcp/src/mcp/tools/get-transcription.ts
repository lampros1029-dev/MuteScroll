import type { AppContext } from "../../context.js";
import { jobOutput } from "../job-output.js";
import { failureOutput } from "../output.js";
import type { ToolOutput } from "../schemas.js";

/** `get_transcription`: read-only status or result for a job_id. */
export async function runGetTranscription(ctx: AppContext, jobId: string): Promise<ToolOutput> {
  const job = await ctx.service.get(jobId);
  if (job === undefined) return failureOutput("not_found", { plansUrl: ctx.config.plansUrl });
  return jobOutput(ctx, job);
}
