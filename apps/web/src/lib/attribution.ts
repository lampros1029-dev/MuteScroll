/** Client-side UTM parameter and referrer tracking with first-touch and last-touch attribution. */

const STORAGE_KEY_FIRST = "ms_attr_first";
const STORAGE_KEY_LAST = "ms_attr_last";
const EXPIRY_DAYS = 90;

export interface AttributionParams {
  readonly utmSource: string | null;
  readonly utmMedium: string | null;
  readonly utmCampaign: string | null;
  readonly utmContent: string | null;
  readonly utmTerm: string | null;
  readonly referrerHost: string | null;
  readonly landingPath: string | null;
  readonly capturedAt: number;
}

interface StoredAttribution extends AttributionParams {
  readonly expiresAt: number;
}

/**
 * Capture attribution parameters from the current page URL and referrer.
 * Stores first-touch (never overwritten) and last-touch (updated each visit with UTM params).
 */
export function captureAttribution(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const params = parseAttributionFromUrl(window.location.search, document.referrer, window.location.pathname);
  if (params === null) return;

  const now = Date.now();
  const expiresAt = now + EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  const stored: StoredAttribution = { ...params, expiresAt };

  try {
    const firstTouchRaw = localStorage.getItem(STORAGE_KEY_FIRST);
    if (firstTouchRaw === null) {
      localStorage.setItem(STORAGE_KEY_FIRST, JSON.stringify(stored));
    } else {
      const firstTouch = parseStoredAttribution(firstTouchRaw);
      if (firstTouch === null || firstTouch.expiresAt < now) {
        localStorage.setItem(STORAGE_KEY_FIRST, JSON.stringify(stored));
      }
    }

    localStorage.setItem(STORAGE_KEY_LAST, JSON.stringify(stored));
  } catch {
    // LocalStorage unavailable or full; silent fail
  }
}

/**
 * Retrieve stored first-touch and last-touch attribution.
 * Returns null if expired or not present.
 */
export function getStoredAttribution(): { firstTouch: AttributionParams | null; lastTouch: AttributionParams | null } {
  if (typeof window === "undefined") return { firstTouch: null, lastTouch: null };

  const now = Date.now();
  let firstTouch: AttributionParams | null = null;
  let lastTouch: AttributionParams | null = null;

  try {
    const firstRaw = localStorage.getItem(STORAGE_KEY_FIRST);
    if (firstRaw !== null) {
      const parsed = parseStoredAttribution(firstRaw);
      if (parsed !== null && parsed.expiresAt >= now) {
        firstTouch = parsed;
      } else {
        localStorage.removeItem(STORAGE_KEY_FIRST);
      }
    }

    const lastRaw = localStorage.getItem(STORAGE_KEY_LAST);
    if (lastRaw !== null) {
      const parsed = parseStoredAttribution(lastRaw);
      if (parsed !== null && parsed.expiresAt >= now) {
        lastTouch = parsed;
      } else {
        localStorage.removeItem(STORAGE_KEY_LAST);
      }
    }
  } catch {
    // LocalStorage unavailable
  }

  return { firstTouch, lastTouch };
}

/**
 * Clear stored attribution (e.g. on logout or account deletion).
 */
export function clearStoredAttribution(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY_FIRST);
    localStorage.removeItem(STORAGE_KEY_LAST);
  } catch {
    // Silent fail
  }
}

function parseAttributionFromUrl(search: string, referrer: string, pathname: string): AttributionParams | null {
  const params = new URLSearchParams(search);
  const utmSource = sanitizeParam(params.get("utm_source"));
  const utmMedium = sanitizeParam(params.get("utm_medium"));
  const utmCampaign = sanitizeParam(params.get("utm_campaign"));
  const utmContent = sanitizeParam(params.get("utm_content"));
  const utmTerm = sanitizeParam(params.get("utm_term"));

  if (utmSource === null && utmMedium === null && utmCampaign === null) {
    return null;
  }

  const referrerHost = extractHost(referrer);
  const landingPath = sanitizePath(pathname);

  return {
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    referrerHost,
    landingPath,
    capturedAt: Date.now(),
  };
}

function parseStoredAttribution(json: string): StoredAttribution | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.expiresAt !== "number") return null;
    return parsed as StoredAttribution;
  } catch {
    return null;
  }
}

function sanitizeParam(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length > 100) return null;
  if (trimmed === "null" || trimmed === "undefined" || trimmed === "none") return null;
  return trimmed;
}

function sanitizePath(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 500) return null;
  return trimmed;
}

function extractHost(url: string): string | null {
  if (url.trim() === "") return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.length > 100) return null;
    return host;
  } catch {
    return null;
  }
}
