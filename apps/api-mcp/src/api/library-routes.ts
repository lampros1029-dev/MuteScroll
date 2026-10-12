import type { IncomingMessage, ServerResponse } from "node:http";

import { listPlans } from "../billing/plans.js";
import type { AppContext } from "../context.js";
import { sendJson } from "../http/respond.js";
import { ApiError } from "./errors.js";
import { identify, requireAccount, requireOauthScope } from "./identity.js";
import { libraryItemView, planView } from "./views.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_OFFSET = 100_000;

/** GET /v1/library?limit=&offset=: the account's jobs, newest first. */
export async function listLibrary(req: IncomingMessage, res: ServerResponse, ctx: AppContext, query: URLSearchParams): Promise<void> {
  const account = requireAccount(await identify(req, res, ctx, { allowSession: true }));
  requireOauthScope(account, "library:read");
  const limit = integerParam(query, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = integerParam(query, "offset", 0, 0, MAX_OFFSET);
  const items = await ctx.service.listLibrary(account.user.id, { limit, offset });
  sendJson(res, 200, { items: items.map(libraryItemView), limit, offset });
}

/** GET /v1/plans: the public plan list. Informational only; checkout happens on the web app. */
export async function listPlansRoute(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, { plans: listPlans().map(planView) });
}

function integerParam(query: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const raw = query.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ApiError(400, "invalid_request", `${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}
