import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";

import { handleApi } from "./api/router.js";
import type { AppContext } from "./context.js";
import { clientKeyFor } from "./http/client-key.js";
import { sendJson, sendNotFound, sendText } from "./http/respond.js";
import { handleMcpRequest } from "./mcp/http.js";
import { logEvent } from "./log.js";
import { reportErrorClass } from "./observe/sentry.js";
import { handleOAuth } from "./oauth/http.js";
import { handleUploadRoute } from "./upload/routes.js";

const UPLOAD_PATH = /^\/upload\/([A-Za-z0-9_-]{16,128})$/;
const OPENAI_APPS_CHALLENGE_PATH = "/.well-known/openai-apps-challenge";

export function createRequestHandler(ctx: AppContext): RequestListener {
  return (req, res) => {
    route(req, res, ctx).catch((error: unknown) => {
      // Never send the error itself: it may carry internal detail.
      reportErrorClass(error);
      logEvent("http.error", { error: error instanceof Error ? error.name : "unknown" });
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(res, 500, { error: "internal_error" });
    });
  };
}

function sendOpenAiAppsChallenge(req: IncomingMessage, res: ServerResponse, token: string | undefined): void {
  if (token === undefined) {
    sendNotFound(res);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "method_not_allowed" }, { allow: "GET, HEAD" });
    return;
  }
  sendText(res, 200, req.method === "HEAD" ? "" : token);
}

async function route(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  if (path === OPENAI_APPS_CHALLENGE_PATH) return sendOpenAiAppsChallenge(req, res, ctx.config.openaiAppsChallenge);
  if (path === "/healthz") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "method_not_allowed" }, { allow: "GET, HEAD" });
    }
    // Node builds HEAD responses with _hasBody false, which drops the payload.
    if (req.method === "HEAD") (res as ServerResponse & { _hasBody: boolean })._hasBody = true;
    return sendJson(res, 200, { status: "ok" });
  }
  if (await handleOAuth(req, res, ctx)) return;
  if (path === "/mcp") return handleMcpRequest(req, res, ctx);
  if (path === "/v1" || path.startsWith("/v1/")) return handleApi(req, res, ctx);

  const upload = UPLOAD_PATH.exec(path);
  const token = upload?.[1];
  if (token !== undefined) {
    const clientKey = clientKeyFor(req, ctx.config.trustProxy, ctx.config.clientIpHeader);
    return handleUploadRoute(req, res, token, clientKey, ctx);
  }
  return sendNotFound(res);
}
