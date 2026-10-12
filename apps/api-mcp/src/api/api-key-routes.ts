import type { IncomingMessage, ServerResponse } from "node:http";

import { issueApiKey } from "../accounts/api-keys.js";
import type { AppContext } from "../context.js";
import { sendJson } from "../http/respond.js";
import { ApiError } from "./errors.js";
import { identify, requireAccount, requireCsrf, type AccountRequester } from "./identity.js";
import { sendNoContent } from "./send.js";
import { apiKeyView } from "./views.js";

/** GET /v1/api-keys: id, prefix and usage times. The keys themselves are never shown again. */
export async function listApiKeys(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const account = requireAccount(await identify(req, res, ctx, { allowSession: true }));
  const records = await ctx.stores.apiKeys.listForUser(account.user.id);
  sendJson(res, 200, { items: records.map(apiKeyView) });
}

/**
 * POST /v1/api-keys: returns the full key once. Only the signed-in web session may create or delete keys,
 * so a leaked key cannot mint more keys.
 */
export async function createApiKey(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const account = await sessionAccount(req, res, ctx);
  const issued = await issueApiKey({ store: ctx.stores.apiKeys, now: ctx.now }, account.user.id);
  sendJson(res, 201, { id: issued.id, key: issued.key });
}

/** DELETE /v1/api-keys/:id. Revokes the key at once. */
export async function deleteApiKey(req: IncomingMessage, res: ServerResponse, ctx: AppContext, id: string): Promise<void> {
  const account = await sessionAccount(req, res, ctx);
  if (!(await ctx.stores.apiKeys.remove(account.user.id, id))) {
    throw new ApiError(404, "not_found", "No API key with that id exists for this account.");
  }
  sendNoContent(res);
}

async function sessionAccount(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<AccountRequester> {
  const account = requireAccount(await identify(req, res, ctx, { allowSession: true }));
  if (!account.cookieAuth) throw new ApiError(403, "forbidden", "API keys are managed from the signed-in web app.");
  requireCsrf(req, account);
  return account;
}
