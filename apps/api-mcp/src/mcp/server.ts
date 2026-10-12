import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Caller } from "../caller.js";
import type { AppContext } from "../context.js";
import { getTranscriptionInputShape, toolOutputShape, transcribeInputShape } from "./schemas.js";
import { toCallToolResult } from "./output.js";
import type { ToolOutput } from "./schemas.js";
import { runGetTranscription } from "./tools/get-transcription.js";
import { runTranscribeVideo } from "./tools/transcribe-video.js";

const SERVER_NAME = "mutescroll";
const SERVER_VERSION = "0.1.0";

const TRANSCRIBE_DESCRIPTION =
  "Transcribe the spoken words of a public video (YouTube, Shorts, TikTok, Instagram Reel or post, Facebook video) " +
  "into timestamped text. Use when the user asks to transcribe a video link, get its subtitles, convert a video to " +
  "text, or asks what a video says. Only public videos work; private or blocked videos return an upload link. " +
  "Returns the transcript when it is ready within about 25 seconds; otherwise returns a job_id for get_transcription. " +
  "Do not call this again to summarize or translate a transcript you already have; work on the returned text instead.";

const GET_DESCRIPTION =
  "Check or fetch the transcript of a job started by transcribe_video, using its job_id. Read-only. Use after " +
  "transcribe_video returned status processing, or after the user uploaded a file for a failed job.";

/** One MCP server per HTTP request (stateless transport). The caller is bound into the tool handlers. */
export function createMcpServer(ctx: AppContext, caller: Caller, oauthScope?: string): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "transcribe_video",
    {
      title: "Transcribe video",
      description: TRANSCRIBE_DESCRIPTION,
      inputSchema: transcribeInputShape,
      outputSchema: toolOutputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      const denied = transcribeScopeDenied(oauthScope);
      if (denied !== undefined) return toCallToolResult(denied);
      return toCallToolResult(await runTranscribeVideo(ctx, caller, args));
    },
  );

  server.registerTool(
    "get_transcription",
    {
      title: "Get transcription",
      description: GET_DESCRIPTION,
      inputSchema: getTranscriptionInputShape,
      outputSchema: toolOutputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const denied = transcribeScopeDenied(oauthScope);
      if (denied !== undefined) return toCallToolResult(denied);
      return toCallToolResult(await runGetTranscription(ctx, caller, args.job_id));
    },
  );

  return server;
}

function transcribeScopeDenied(scope: string | undefined): ToolOutput | undefined {
  if (scope === undefined || scope.split(" ").includes("transcribe")) return undefined;
  return {
    status: "failed",
    error: { code: "insufficient_scope", message: "This connection does not include the transcribe permission." },
  };
}
