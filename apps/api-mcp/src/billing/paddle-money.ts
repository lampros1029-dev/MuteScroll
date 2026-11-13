/**
 * Paddle Billing money fields are strings of the smallest currency unit.
 * "2499" with USD is $24.99. This does not multiply by 100.
 */
export interface PaddlePurchaseMoney {
  readonly amountCents: number | null;
  readonly currency: string | null;
  readonly customData: unknown;
}

export function parsePaddlePurchase(rawBody: Uint8Array): PaddlePurchaseMoney {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(rawBody).toString("utf8")) as unknown;
  } catch {
    return { amountCents: null, currency: null, customData: undefined };
  }
  const root = asRecord(payload);
  const data = asRecord(root?.["data"]);
  if (data === undefined) return { amountCents: null, currency: null, customData: undefined };
  const totals = asRecord(asRecord(data["details"])?.["totals"]);
  const currency = currencyCode(data["currency_code"]) ?? currencyCode(totals?.["currency_code"]);
  return {
    amountCents: minorUnits(totals?.["total"]),
    currency,
    customData: data["custom_data"],
  };
}

function minorUnits(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return value;
  }
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed;
}

function currencyCode(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value)) return null;
  return value.toUpperCase();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
