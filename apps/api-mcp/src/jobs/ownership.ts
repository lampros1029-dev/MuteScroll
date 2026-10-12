import type { Viewer } from "../caller.js";
import type { Job } from "./types.js";

/**
 * Account-owned jobs are visible only to their owner. Anonymous jobs are capability-by-job_id: anyone
 * holding the id can read them (PRD 12, the job_id is a random UUID).
 */
export function canView(job: Pick<Job, "ownerUserId">, viewer: Viewer): boolean {
  return job.ownerUserId === null || job.ownerUserId === viewer.userId;
}
