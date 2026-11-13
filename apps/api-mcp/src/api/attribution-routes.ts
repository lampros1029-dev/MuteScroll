import type { IncomingMessage, ServerResponse } from "node:http";

import type { AppContext } from "../context.js";
import { sendJson } from "../http/respond.js";
import { ApiError } from "./errors.js";

/**
 * GET /v1/admin/attribution/conversions?start_date=...&end_date=...&format=json|csv
 * Admin-only endpoint (protected by ATTRIBUTION_ADMIN_TOKEN) that returns conversion data
 * grouped by utm_source, utm_medium, utm_campaign.
 */
export async function getConversions(req: IncomingMessage, res: ServerResponse, ctx: AppContext, query: URLSearchParams): Promise<void> {
  const adminToken = ctx.config.attributionAdminToken;
  if (adminToken === undefined || adminToken.trim() === "") {
    throw new ApiError(503, "unavailable", "Attribution admin endpoint is not configured.");
  }

  const authHeader = req.headers.authorization;
  if (authHeader === undefined || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "unauthorized", "Missing or invalid authorization header.");
  }

  const token = authHeader.slice(7).trim();
  if (token !== adminToken) {
    throw new ApiError(403, "forbidden", "Invalid admin token.");
  }

  const startDateStr = query.get("start_date");
  const endDateStr = query.get("end_date");
  const format = query.get("format") || "json";

  if (startDateStr === null || endDateStr === null) {
    throw new ApiError(400, "invalid_request", "start_date and end_date are required (YYYY-MM-DD format).");
  }

  const startDate = parseDate(startDateStr);
  const endDate = parseDate(endDateStr);

  if (startDate === null || endDate === null) {
    throw new ApiError(400, "invalid_request", "start_date and end_date must be in YYYY-MM-DD format.");
  }

  if (startDate >= endDate) {
    throw new ApiError(400, "invalid_request", "start_date must be before end_date.");
  }

  const aggregations = await ctx.stores.conversionEvents.aggregateByAttribution(startDate, endDate);

  if (format === "csv") {
    const csv = generateCsv(aggregations);
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="conversions-${startDateStr}-to-${endDateStr}.csv"`,
    });
    res.end(csv);
  } else {
    sendJson(res, 200, {
      start_date: startDateStr,
      end_date: endDateStr,
      conversions: aggregations.map((agg) => ({
        utm_source: agg.utmSource,
        utm_medium: agg.utmMedium,
        utm_campaign: agg.utmCampaign,
        signup_count: agg.signupCount,
        purchase_count: agg.purchaseCount,
        total_revenue_cents: agg.totalRevenueCents,
        currency: agg.currency,
      })),
    });
  }
}

function parseDate(dateStr: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (match === null) return null;
  const [, year, month, day] = match;
  if (year === undefined || month === undefined || day === undefined) return null;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function generateCsv(aggregations: ReadonlyArray<{
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  signupCount: number;
  purchaseCount: number;
  totalRevenueCents: number;
  currency: string | null;
}>): string {
  const rows: string[] = ["utm_source,utm_medium,utm_campaign,signup_count,purchase_count,total_revenue_cents,currency"];
  for (const agg of aggregations) {
    rows.push(
      [
        escapeCsv(agg.utmSource),
        escapeCsv(agg.utmMedium),
        escapeCsv(agg.utmCampaign),
        agg.signupCount.toString(),
        agg.purchaseCount.toString(),
        agg.totalRevenueCents.toString(),
        escapeCsv(agg.currency),
      ].join(","),
    );
  }
  return rows.join("\n") + "\n";
}

function escapeCsv(value: string | null): string {
  if (value === null) return "";
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
