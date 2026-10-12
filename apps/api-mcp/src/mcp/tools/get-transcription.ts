import { viewerOf, type Caller } from "../../caller.js";
import type { AppContext } from "../../context.js";
import { jobOutput } from "../job-output.js";
import { failureOutput } from "../output.js";
import type { ToolOutput } from "../schemas.js";

/**
 * `get_transcription`: read-only status or result for a job_id. Account-owned jobs are visible only to
 * their owner; anonymous jobs to anyone holding the id (PRD 12). Other callers get the same not_found.
 */
export async function runGetTranscription(ctx: AppContext, caller: Caller, jobId: string): Promise<ToolOutput> {
  const job = await ctx.service.getVisible(jobId, viewerOf(caller));
  if (job === undefined) return failureOutput("not_found", { plansUrl: ctx.config.plansUrl });
  return jobOutput(ctx, job);
}
