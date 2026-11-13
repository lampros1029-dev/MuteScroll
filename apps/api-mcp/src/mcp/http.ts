import type { IncomingMessage, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { Caller } from "../caller.js";
import type { AppContext } from "../context.js";
import { identify, callerOf } from "../api/identity.js";
import { ApiError } from "../api/errors.js";
import { BodyError, readJsonBody } from "../http/body.js";
import { headerString } from "../http/headers.js";
import { sendJson } from "../http/respond.js";
import { truncateUserAgent } from "../jobs/client.js";
import type { JobClient } from "../jobs/types.js";
import { clientIdentityFromBody, mcpSessionKey } from "./client-session.js";
import { createMcpServer } from "./server.js";

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_UNAUTHORIZED = -32001;

/**
 * Streamable HTTP at `/mcp`. The transport is stateless: a fresh server per request.
 * `initialize` clientInfo is remembered for the bearer credential, or for a client-supplied
 * session id, so a later tools/call from that same credential is attributed. The raw token is not stored.
 * A Bearer API key or an OAuth access token makes the caller an account. Without either, the caller is anonymous.
 * The body is read here so the size limit applies before the SDK sees it.
 */
export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  let caller: Caller;
  let oauthScope: string | undefined;
  let oauthClientId: string | null = null;
  try {
    const requester = await identify(req, res, ctx, { allowSession: false });
    caller = callerOf(requester);
    oauthScope = requester.kind === "account" ? requester.oauthScope : undefined;
    oauthClientId = requester.kind === "account" ? (requester.oauthClientId ?? null) : null;
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

  const client = await mcpJobClient(req, ctx, parsedBody, oauthClientId);
  const server = createMcpServer(ctx, caller, client, oauthScope);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}

async function mcpJobClient(req: IncomingMessage, ctx: AppContext, body: unknown, oauthClientId: string | null): Promise<JobClient> {
  const sessionKey = mcpSessionKey({
    sessionId: headerString(req.headers["mcp-session-id"]),
    authorization: headerString(req.headers.authorization),
  });
  const presented = clientIdentityFromBody(body);
  let identity = presented;
  if (identity === undefined && sessionKey !== undefined) {
    identity = await ctx.stores.mcpSessions.recall(sessionKey, ctx.now());
  }
  if (presented !== undefined && sessionKey !== undefined) {
    await ctx.stores.mcpSessions.remember(sessionKey, presented, ctx.now());
  }
  return {
    source: "mcp",
    clientName: identity?.clientName ?? null,
    clientVersion: identity?.clientVersion ?? null,
    oauthClientId,
    userAgent: truncateUserAgent(headerString(req.headers["user-agent"])),
  };
}
