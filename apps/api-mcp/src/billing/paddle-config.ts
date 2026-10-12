import type { PlanId } from "./plans.js";
import { type BillingInterval, type CatalogPlan } from "./provider.js";

/** Sandbox keys contain `sdbx` (Paddle). Anything else is the live API, which this process must not call by accident. */
export const PADDLE_SANDBOX_API = "https://sandbox-api.paddle.com";
export const PADDLE_LIVE_API = "https://api.paddle.com";

export type PaddleApiBase = typeof PADDLE_SANDBOX_API | typeof PADDLE_LIVE_API;

/**
 * Catalog keys accepted in PADDLE_PRICE_IDS. Interval suffixes override the bare plan key.
 * Each Paddle price uses tax_mode `external`: the unit amount is the catalog price, and
 * VAT or sales tax is added for the buyer's country. Do not switch a live price to
 * `internal` or `location`, which can fold tax into the sticker.
 */
export const PRICE_KEYS = [
  "creator",
  "creator_month",
  "creator_year",
  "pro",
  "pro_month",
  "pro_year",
  "team",
  "team_month",
  "team_year",
  "founding",
] as const;
export type PriceKey = (typeof PRICE_KEYS)[number];

export interface PaddleConfig {
  readonly apiKey: string | undefined;
  readonly webhookSecret: string | undefined;
  /** Undefined when no API key is set, so startup does not pick an API host. */
  readonly apiBaseUrl: PaddleApiBase | undefined;
  /** Price-catalog key (`pro`, `pro_year`, `founding`, ...) -> Paddle price id. */
  readonly prices: Readonly<Record<string, string>>;
}

export function paddleApiBaseUrl(apiKey: string): PaddleApiBase {
  return apiKey.includes("sdbx") ? PADDLE_SANDBOX_API : PADDLE_LIVE_API;
}

export function planForPriceKey(key: PriceKey): PlanId {
  switch (key) {
    case "creator":
    case "creator_month":
    case "creator_year":
      return "creator";
    case "pro":
    case "pro_month":
    case "pro_year":
    case "founding":
      return "pro";
    case "team":
    case "team_month":
    case "team_year":
      return "team";
    default: {
      const neverKey: never = key;
      return neverKey;
    }
  }
}

export function priceIdForCheckout(prices: Readonly<Record<string, string>>, plan: CatalogPlan, interval: BillingInterval): string | undefined {
  switch (plan) {
    case "founding":
      return prices["founding"];
    case "creator":
    case "pro":
    case "team":
      return prices[`${plan}_${interval}`] ?? prices[plan];
    default: {
      const neverPlan: never = plan;
      return neverPlan;
    }
  }
}

export function readPaddleConfig(env: NodeJS.ProcessEnv): { ok: true; config: PaddleConfig } | { ok: false; message: string } {
  const parsed = parsePriceIds(nonEmpty(env["PADDLE_PRICE_IDS"]));
  if (!parsed.ok) return parsed;
  const apiKey = nonEmpty(env["PADDLE_API_KEY"]);
  return {
    ok: true,
    config: {
      apiKey,
      webhookSecret: nonEmpty(env["PADDLE_WEBHOOK_SECRET"]),
      apiBaseUrl: apiKey === undefined ? undefined : paddleApiBaseUrl(apiKey),
      prices: parsed.prices,
    },
  };
}

function parsePriceIds(raw: string | undefined): { ok: true; prices: Record<string, string> } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, prices: {} };
  const prices: Record<string, string> = {};
  const planById = new Map<string, PlanId>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const eq = trimmed.indexOf("=");
    const key = eq <= 0 ? "" : trimmed.slice(0, eq).trim();
    const priceId = eq <= 0 ? "" : trimmed.slice(eq + 1).trim();
    if (!isPriceKey(key) || !/^pri_[A-Za-z0-9]+$/.test(priceId)) {
      return { ok: false, message: "PADDLE_PRICE_IDS must be comma-separated plan=price_id pairs" };
    }
    const plan = planForPriceKey(key);
    const previous = planById.get(priceId);
    if (previous !== undefined && previous !== plan) {
      return { ok: false, message: "PADDLE_PRICE_IDS maps one price id onto two plans" };
    }
    planById.set(priceId, plan);
    prices[key] = priceId;
  }
  return { ok: true, prices };
}

function isPriceKey(value: string): value is PriceKey {
  return (PRICE_KEYS as readonly string[]).includes(value);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
