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

/**
 * Model rules. Every rule the host must see first fits in the opening 512 characters.
 * The SDK passes this string on initialize.
 */
const SERVER_INSTRUCTIONS =
  'Read a public video link. Call transcribe_video once. If processing, poll get_transcription. Do not call again to summarize, translate, or check claims. Do not change numbers. Flag uncertain spans. Speakers are "Speaker N". captions_auto means automatic captions from the public page. If retrieval fails, return the upload link. Do not sign in or bypass access controls. Do not mention prices, plans, or upgrades. MuteScroll reads a public video link it can reach. Other links get the one-time upload path.';

const TRANSCRIBE_DESCRIPTION =
  'Read a public video link into timestamped text. MuteScroll reads a public video link when it can reach it. Other links get the one-time upload path. Call this once. If it is still processing, poll get_transcription. Do not call this again to summarize, translate, or check claims. Do not change numbers. Flag uncertain spans. Speakers are "Speaker N". captions_auto means automatic captions from the public page. If retrieval fails, return the upload link. Do not sign in or bypass access controls.';

const GET_DESCRIPTION =
  "Poll or read the transcript for a job_id from transcribe_video. Use this after transcribe_video returns processing, and after a one-time upload finishes. Read-only. Do not use it to summarize, translate, or check claims.";

/** ChatGPT reads this on each tool. The installed SDK does not copy it into tools/list. */
const TOOL_SECURITY = [
  { type: "noauth" },
  { type: "oauth2", scopes: ["transcribe"] },
] as const;

/** One MCP server per HTTP request (stateless transport). The caller is bound into the tool handlers. */
export function createMcpServer(ctx: AppContext, caller: Caller, oauthScope?: string): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    "transcribe_video",
    {
      title: "Transcribe a public video link",
      description: TRANSCRIBE_DESCRIPTION,
      inputSchema: transcribeInputShape,
      outputSchema: toolOutputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      const denied = transcribeScopeDenied(oauthScope);
      if (denied !== undefined) return toCallToolResult(denied);
      const output = await runTranscribeVideo(ctx, caller, args);
      return toCallToolResult(output, wwwAuthenticateFor(caller, output));
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

  declareToolSecurity(server);
  return server;
}

function transcribeScopeDenied(scope: string | undefined): ToolOutput | undefined {
  if (scope === undefined || scope.split(" ").includes("transcribe")) return undefined;
  return {
    status: "failed",
    error: { code: "insufficient_scope", message: "This connection does not include the transcribe permission." },
  };
}

/** Anonymous callers who are out of credits can link an existing account. Signed-in callers already have one. */
function wwwAuthenticateFor(
  caller: Caller,
  output: ToolOutput,
): { readonly error: string; readonly error_description: string } | undefined {
  if (caller.kind !== "anonymous" || output.error?.code !== "quota_exceeded" || output.error.message === "") return undefined;
  return { error: "invalid_token", error_description: output.error.message };
}

interface ToolListResult {
  tools?: unknown;
}

interface ListHandler {
  (request: unknown, extra: unknown): Promise<unknown> | unknown;
}

/**
 * Adds mixed noauth and oauth2 to the tools/list payload. The SDK builds that payload from a fixed
 * field list, so the schemes are attached after its handler runs.
 */
function declareToolSecurity(server: McpServer): void {
  const protocol = server.server as unknown as { _requestHandlers: Map<string, ListHandler> };
  const current = protocol._requestHandlers.get("tools/list");
  if (current === undefined) return;
  protocol._requestHandlers.set("tools/list", async (request, extra) => {
    const result = await current(request, extra);
    if (!isToolList(result)) return result;
    for (const tool of result.tools) {
      if (tool !== null && typeof tool === "object") {
        (tool as { securitySchemes?: unknown }).securitySchemes = TOOL_SECURITY;
      }
    }
    return result;
  });
}

function isToolList(result: unknown): result is { tools: unknown[] } {
  if (result === null || typeof result !== "object" || !("tools" in result)) return false;
  return Array.isArray((result as ToolListResult).tools);
}
