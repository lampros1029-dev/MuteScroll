import type { IncomingMessage, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { Caller } from "../caller.js";
import type { AppContext } from "../context.js";
import { identify, callerOf } from "../api/identity.js";
import { ApiError } from "../api/errors.js";
import { BodyError, readJsonBody } from "../http/body.js";
import { sendJson } from "../http/respond.js";
import { createMcpServer } from "./server.js";

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_UNAUTHORIZED = -32001;

/**
 * Streamable HTTP at `/mcp`, stateless: a fresh server and transport per request, so no session state
 * survives between calls. A Bearer API key or a ChatGPT OAuth token makes the caller an account. Without
 * either, the caller is anonymous.
 * The body is read here so the size limit applies before the SDK sees it.
 */
export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  let caller: Caller;
  let oauthScope: string | undefined;
  try {
    const requester = await identify(req, res, ctx, { allowSession: false });
    caller = callerOf(requester);
    oauthScope = requester.kind === "account" ? requester.oauthScope : undefined;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    sendJson(
      res,
      401,
      { jsonrpc: "2.0", error: { code: JSON_RPC_UNAUTHORIZED, message: "Unauthorized" }, id: null },
      { "www-authenticate": `Bearer resource_metadata="${ctx.config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp"` },
    );
    return;
  }

  let parsedBody: unknown = undefined;
  if (req.method === "POST") {
    try {
      parsedBody = await readJsonBody(req, ctx.config.mcpMaxBodyBytes);
    } catch (error) {
      if (!(error instanceof BodyError)) throw error;
      const tooLarge = error.reason === "too_large";
      sendJson(res, error.status, {
        jsonrpc: "2.0",
        error: {
          code: tooLarge ? JSON_RPC_INVALID_REQUEST : JSON_RPC_PARSE_ERROR,
          message: tooLarge ? "Request too large" : "Parse error",
        },
        id: null,
      });
      return;
    }
  }

  const server = createMcpServer(ctx, caller, oauthScope);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}
