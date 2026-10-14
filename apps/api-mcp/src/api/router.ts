import type { IncomingMessage, ServerResponse } from "node:http";

import type { AppContext } from "../context.js";
import { logEvent } from "../log.js";
import { ApiError, internalError, sendApiError } from "./errors.js";
import { login, logout, me, signup } from "./auth-routes.js";
import { approveChatgpt, finishGoogle, startChatgpt, startGoogle } from "./provider-auth.js";
import { billingPortal, checkout, deleteAccount } from "./billing-routes.js";
import { confirmEmailVerification, forgotPassword, requestEmailVerification, resetPassword } from "./mail-routes.js";
import { createApiKey, deleteApiKey, listApiKeys } from "./api-key-routes.js";
import { listLibrary, listPlansRoute } from "./library-routes.js";
import { listOAuthGrants } from "../oauth/http.js";
import { paddleWebhook } from "./paddle-webhook.js";
import { createUpload } from "./upload-routes.js";
import {
  createTranscription,
  deleteTranscription,
  exportTranscription,
  getTranscription,
} from "./transcription-routes.js";

/** The REST handler receives the route's regex match (capture 1 is the job or key id) and the query string. */
type Handler = (req: IncomingMessage, res: ServerResponse, ctx: AppContext, match: RegExpExecArray, query: URLSearchParams) => Promise<void>;

interface Route {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: RegExp;
  readonly handler: Handler;
}

const ID = "([A-Za-z0-9_-]{1,80})";

const ROUTES: readonly Route[] = [
  { method: "POST", path: /^\/v1\/auth\/signup$/, handler: (req, res, ctx) => signup(req, res, ctx) },
  { method: "POST", path: /^\/v1\/auth\/login$/, handler: (req, res, ctx) => login(req, res, ctx) },
  { method: "GET", path: /^\/v1\/auth\/google$/, handler: (req, res, ctx, _match, query) => startGoogle(req, res, ctx, query) },
  { method: "GET", path: /^\/v1\/auth\/google\/callback$/, handler: (req, res, ctx, _match, query) => finishGoogle(req, res, ctx, query) },
  { method: "GET", path: /^\/v1\/auth\/chatgpt$/, handler: (req, res, ctx, _match, query) => startChatgpt(req, res, ctx, query) },
  { method: "POST", path: /^\/v1\/auth\/chatgpt$/, handler: (req, res, ctx) => approveChatgpt(req, res, ctx) },
  { method: "POST", path: /^\/v1\/auth\/logout$/, handler: (req, res, ctx) => logout(req, res, ctx) },
  { method: "GET", path: /^\/v1\/me$/, handler: (req, res, ctx) => me(req, res, ctx) },
  { method: "DELETE", path: /^\/v1\/me$/, handler: (req, res, ctx) => deleteAccount(req, res, ctx) },
  { method: "POST", path: /^\/v1\/auth\/email\/verification$/, handler: (req, res, ctx) => requestEmailVerification(req, res, ctx) },
  { method: "POST", path: /^\/v1\/auth\/email\/verification\/confirm$/, handler: (req, res, ctx) => confirmEmailVerification(req, res, ctx) },
  { method: "POST", path: /^\/v1\/auth\/forgot-password$/, handler: (req, res, ctx) => forgotPassword(req, res, ctx) },
  { method: "POST", path: /^\/v1\/auth\/reset-password$/, handler: (req, res, ctx) => resetPassword(req, res, ctx) },
  { method: "POST", path: /^\/v1\/checkout$/, handler: (req, res, ctx) => checkout(req, res, ctx) },
  { method: "POST", path: /^\/v1\/billing\/portal$/, handler: (req, res, ctx) => billingPortal(req, res, ctx) },
  { method: "GET", path: /^\/v1\/oauth\/grants$/, handler: (req, res, ctx) => listOAuthGrants(req, res, ctx) },
  { method: "GET", path: /^\/v1\/api-keys$/, handler: (req, res, ctx) => listApiKeys(req, res, ctx) },
  { method: "POST", path: /^\/v1\/api-keys$/, handler: (req, res, ctx) => createApiKey(req, res, ctx) },
  { method: "DELETE", path: new RegExp(`^/v1/api-keys/${ID}$`), handler: (req, res, ctx, m) => deleteApiKey(req, res, ctx, m[1] ?? "") },
  { method: "POST", path: /^\/v1\/transcriptions$/, handler: (req, res, ctx) => createTranscription(req, res, ctx) },
  { method: "GET", path: new RegExp(`^/v1/transcriptions/${ID}$`), handler: (req, res, ctx, m) => getTranscription(req, res, ctx, m[1] ?? "") },
  { method: "DELETE", path: new RegExp(`^/v1/transcriptions/${ID}$`), handler: (req, res, ctx, m) => deleteTranscription(req, res, ctx, m[1] ?? "") },
  {
    method: "GET",
    path: new RegExp(`^/v1/transcriptions/${ID}/export$`),
    handler: (req, res, ctx, m, query) => exportTranscription(req, res, ctx, m[1] ?? "", query),
  },
  { method: "POST", path: /^\/v1\/uploads$/, handler: (req, res, ctx) => createUpload(req, res, ctx) },
  { method: "GET", path: /^\/v1\/library$/, handler: (req, res, ctx, _m, query) => listLibrary(req, res, ctx, query) },
  { method: "GET", path: /^\/v1\/plans$/, handler: (req, res) => listPlansRoute(req, res) },
  // Paddle notifications. Signature only: this handler does not call requireCsrf.
  { method: "POST", path: /^\/v1\/paddle\/webhook$/, handler: (req, res, ctx) => paddleWebhook(req, res, ctx) },
];

/** Dispatches /v1 requests. Every failure, expected or not, leaves as the documented error JSON. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    const matches = ROUTES.flatMap((route) => {
      const match = route.path.exec(url.pathname);
      return match === null ? [] : [{ route, match }];
    });
    if (matches.length === 0) throw new ApiError(404, "not_found", "No such endpoint.");
    const hit = matches.find(({ route }) => route.method === method);
    if (hit === undefined) {
      const allow = [...new Set(matches.map(({ route }) => route.method))].join(", ");
      throw new ApiError(405, "method_not_allowed", "This method is not allowed for this endpoint.", undefined, { allow });
    }
    await hit.route.handler(req, res, ctx, hit.match, url.searchParams);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ApiError) return sendApiError(res, error);
    // The error text can carry internal detail: only its class name is logged.
    logEvent("api.error", { error: error instanceof Error ? error.name : "unknown" });
    return sendApiError(res, internalError());
  }
}
