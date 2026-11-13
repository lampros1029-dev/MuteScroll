import { parseCookies } from "../http/cookies.js";
import { parseAttributionData } from "./sanitize.js";
import type { AttributionData } from "./types.js";

/** First-party cookie written by the website. SameSite=Lax so the Google callback still sends it. */
export const ATTRIBUTION_COOKIE = "ms_attr";

const MAX_COOKIE_CHARS = 3500;

export interface AttributionPair {
  readonly firstTouch: AttributionData | null;
  readonly lastTouch: AttributionData | null;
}

/** Reads first-touch and last-touch from the `ms_attr` cookie. Junk and expired values are dropped. */
export function attributionFromCookieHeader(header: string | undefined, now: number): AttributionPair {
  const raw = parseCookies(header).get(ATTRIBUTION_COOKIE);
  if (raw === undefined || raw.length === 0 || raw.length > MAX_COOKIE_CHARS) return emptyPair();
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return emptyPair();
  }
  if (decoded.length > MAX_COOKIE_CHARS) return emptyPair();
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded) as unknown;
  } catch {
    return emptyPair();
  }
  if (typeof parsed !== "object" || parsed === null) return emptyPair();
  const record = parsed as Record<string, unknown>;
  return {
    firstTouch: touchFrom(record["first"], now),
    lastTouch: touchFrom(record["last"], now),
  };
}

function touchFrom(value: unknown, now: number): AttributionData | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record["expiresAt"] === "number" && record["expiresAt"] < now) return null;
  const capturedAt = typeof record["capturedAt"] === "number" ? record["capturedAt"] : now;
  return parseAttributionData({
    utmSource: stringOrNull(record["utmSource"]),
    utmMedium: stringOrNull(record["utmMedium"]),
    utmCampaign: stringOrNull(record["utmCampaign"]),
    utmContent: stringOrNull(record["utmContent"]),
    utmTerm: stringOrNull(record["utmTerm"]),
    referrerHost: stringOrNull(record["referrerHost"]),
    landingPath: stringOrNull(record["landingPath"]),
    capturedAt,
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function emptyPair(): AttributionPair {
  return { firstTouch: null, lastTouch: null };
}
