import type { IncomingMessage, ServerResponse } from "node:http";

import { safeEqual } from "../accounts/secrets.js";
import type { AppContext } from "../context.js";
import { headerString } from "../http/headers.js";
import { sendJson } from "../http/respond.js";
import { deriveClientLabel, type ClientLabel } from "../jobs/client.js";
import { ApiError } from "./errors.js";

const BEARER = /^Bearer\s+(\S+)$/i;

interface ClientTotal {
  readonly day: string;
  readonly label: ClientLabel;
  readonly count: number;
}

/** GET /v1/admin/job-clients. 404 when ADMIN_STATS_TOKEN is unset. */
export async function jobClientStats(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const configured = ctx.config.adminStatsToken;
  if (configured === undefined) throw new ApiError(404, "not_found", "No such endpoint.");
  const presented = BEARER.exec(headerString(req.headers.authorization) ?? "")?.[1];
  if (presented === undefined || !safeEqual(presented, configured)) {
    throw new ApiError(401, "unauthorized", "The admin token is not valid.");
  }

  const facts = await ctx.stores.jobs.listClientFacts();
  const oauthClients = new Map<string, { readonly name: string; readonly redirectUris: readonly string[] }>();
  for (const fact of facts) {
    const id = fact.client.oauthClientId;
    if (id === null || oauthClients.has(id)) continue;
    const client = await ctx.stores.oauth.findClient(id);
    if (client !== undefined) oauthClients.set(id, { name: client.name, redirectUris: client.redirectUris });
  }

  const totals = new Map<string, ClientTotal>();
  for (const fact of facts) {
    const oauth = fact.client.oauthClientId === null ? undefined : oauthClients.get(fact.client.oauthClientId);
    const label = deriveClientLabel({
      source: fact.client.source,
      clientName: fact.client.clientName,
      oauthClientName: oauth?.name ?? null,
      redirectUris: oauth?.redirectUris ?? [],
      userAgent: fact.client.userAgent,
    });
    const key = `${fact.day}|${label}`;
    const existing = totals.get(key);
    if (existing === undefined) totals.set(key, { day: fact.day, label, count: fact.count });
    else totals.set(key, { day: fact.day, label, count: existing.count + fact.count });
  }

  const clients = [...totals.values()].sort((a, b) => a.day.localeCompare(b.day) || a.label.localeCompare(b.label));
  sendJson(res, 200, { clients });
}
