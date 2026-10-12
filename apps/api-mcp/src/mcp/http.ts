import type { IncomingMessage, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { AppContext } from "../context.js";
import { BodyError, readJsonBody } from "../http/body.js";
import { clientKeyFor } from "../http/client-key.js";
import { sendJson } from "../http/respond.js";
import { createMcpServer } from "./server.js";

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;

/**
 * Streamable HTTP at `/mcp`, stateless: a fresh server and transport per request, so no session state
 * survives between calls. The body is read here so the size limit applies before the SDK sees it.
 */
export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
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

  const clientKey = clientKeyFor(req, ctx.config.trustProxy, ctx.config.clientIpHeader);
  const server = createMcpServer(ctx, clientKey);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}
