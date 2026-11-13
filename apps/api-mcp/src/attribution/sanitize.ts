import type { AttributionData } from "./types.js";

const MAX_FIELD_LENGTH = 100;
const MAX_PATH_LENGTH = 500;

/**
 * Sanitize a single UTM parameter: lowercase, trim, limit length, reject suspicious values.
 * Returns null for empty or invalid values.
 */
function sanitizeUtmField(value: string | null | undefined): string | null {
  if (value === null || value === undefined || typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > MAX_FIELD_LENGTH) return null;
  if (trimmed === "null" || trimmed === "undefined" || trimmed === "none") return null;
  return trimmed;
}

/**
 * Sanitize a path: trim, limit length.
 * Returns null for empty or invalid values.
 */
function sanitizePath(value: string | null | undefined): string | null {
  if (value === null || value === undefined || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PATH_LENGTH) return null;
  return trimmed;
}

/**
 * Sanitize a referrer host: lowercase, trim, limit length.
 * Returns null for empty or invalid values.
 */
function sanitizeHost(value: string | null | undefined): string | null {
  if (value === null || value === undefined || typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > MAX_FIELD_LENGTH) return null;
  return trimmed;
}

/**
 * Parse and sanitize attribution data from query parameters and referrer.
 * Returns null if no valid UTM parameters are present.
 */
export function parseAttributionData(input: {
  readonly utmSource?: string | null;
  readonly utmMedium?: string | null;
  readonly utmCampaign?: string | null;
  readonly utmContent?: string | null;
  readonly utmTerm?: string | null;
  readonly referrerHost?: string | null;
  readonly landingPath?: string | null;
  readonly capturedAt: number;
}): AttributionData | null {
  const utmSource = sanitizeUtmField(input.utmSource);
  const utmMedium = sanitizeUtmField(input.utmMedium);
  const utmCampaign = sanitizeUtmField(input.utmCampaign);
  const utmContent = sanitizeUtmField(input.utmContent);
  const utmTerm = sanitizeUtmField(input.utmTerm);

  if (utmSource === null && utmMedium === null && utmCampaign === null) {
    return null;
  }

  return {
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    referrerHost: sanitizeHost(input.referrerHost),
    landingPath: sanitizePath(input.landingPath),
    capturedAt: input.capturedAt,
  };
}

/**
 * Parse attribution data from Paddle custom_data JSON.
 * Returns null if no valid UTM parameters are present.
 */
export function parseAttributionFromCustomData(customData: unknown): Omit<AttributionData, "capturedAt"> | null {
  if (typeof customData !== "object" || customData === null) return null;
  const data = customData as Record<string, unknown>;

  const utmSource = sanitizeUtmField(typeof data["utm_source"] === "string" ? data["utm_source"] : null);
  const utmMedium = sanitizeUtmField(typeof data["utm_medium"] === "string" ? data["utm_medium"] : null);
  const utmCampaign = sanitizeUtmField(typeof data["utm_campaign"] === "string" ? data["utm_campaign"] : null);
  const utmContent = sanitizeUtmField(typeof data["utm_content"] === "string" ? data["utm_content"] : null);
  const utmTerm = sanitizeUtmField(typeof data["utm_term"] === "string" ? data["utm_term"] : null);
  const referrerHost = sanitizeHost(typeof data["referrer_host"] === "string" ? data["referrer_host"] : null);
  const landingPath = sanitizePath(typeof data["landing_path"] === "string" ? data["landing_path"] : null);

  if (utmSource === null && utmMedium === null && utmCampaign === null) {
    return null;
  }

  return {
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    referrerHost,
    landingPath,
  };
}
