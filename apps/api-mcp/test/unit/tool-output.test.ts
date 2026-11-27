import { describe, expect, it } from "vitest";

import { failureOutput, toCallToolResult } from "../../src/mcp/output.js";
import { toolOutputSchema } from "../../src/mcp/schemas.js";

const PLANS = "https://mutescroll.xyz/plans";
const UPLOAD = "https://api.example.test/upload/abcdefghijklmnopqrstu";
const JOB_ID = "job_11111111-1111-1111-1111-111111111111";

describe("upload fallback text", () => {
  it("includes the job_id the upload completes, at the top level of structured content", () => {
    const output = failureOutput("blocked_bot_check", { jobId: JOB_ID, plansUrl: PLANS, uploadUrl: UPLOAD });
    const result = toCallToolResult(output);

    expect(toolOutputSchema.parse(result.structuredContent)).toEqual(output);
    expect(output.job_id).toBe(JOB_ID);
    expect(output.error?.upload_url).toBe(UPLOAD);
    expect(output.error).not.toHaveProperty("job_id");
    expect(result.content[0]).toEqual({
      type: "text",
      text: `MuteScroll could not reach this video. Use the one-time upload path. Upload link: ${UPLOAD} After the file is uploaded, call get_transcription with job_id "${JOB_ID}".`,
    });
  });

  it("leaves failures without an upload link as the message alone", () => {
    const output = failureOutput("worker_failed", { jobId: JOB_ID, plansUrl: PLANS });
    const result = toCallToolResult(output);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Something went wrong on our side. Please try again in a few minutes. You weren't charged for this.",
    });
  });
});
