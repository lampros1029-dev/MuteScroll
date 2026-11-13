import type { AttributionData, ConversionEventStore, UserAttributionStore } from "./types.js";

/**
 * Record first-touch and last-touch attribution for a new user.
 * Should be called immediately after account creation.
 */
export async function recordUserAttribution(
  store: UserAttributionStore,
  userId: string,
  firstTouch: AttributionData | null,
  lastTouch: AttributionData | null,
): Promise<void> {
  if (firstTouch !== null) {
    await store.setFirstTouch(userId, firstTouch);
  }
  if (lastTouch !== null) {
    await store.setLastTouch(userId, lastTouch);
  }
}

/**
 * Record a signup conversion event.
 * Uses the user's stored attribution (preferring last-touch, then first-touch).
 */
export async function recordSignupConversion(
  attributionStore: UserAttributionStore,
  conversionStore: ConversionEventStore,
  userId: string,
  now: number,
): Promise<void> {
  const userAttribution = await attributionStore.get(userId);
  const attribution = pickAttribution(userAttribution);
  await conversionStore.recordSignup(userId, attribution, now);
}

/**
 * Record a purchase conversion event.
 * Uses attribution from the Paddle custom_data if present, otherwise falls back to stored user attribution.
 */
export async function recordPurchaseConversion(
  attributionStore: UserAttributionStore,
  conversionStore: ConversionEventStore,
  userId: string,
  customDataAttribution: Omit<AttributionData, "capturedAt"> | null,
  amountCents: number | null,
  currency: string | null,
  now: number,
): Promise<void> {
  let attribution: Omit<AttributionData, "capturedAt">;
  if (customDataAttribution !== null && hasValidUtm(customDataAttribution)) {
    attribution = customDataAttribution;
  } else {
    const userAttribution = await attributionStore.get(userId);
    attribution = pickAttribution(userAttribution);
  }
  await conversionStore.recordPurchase(userId, attribution, amountCents, currency, now);
}

/**
 * Pick the best available attribution from a user's stored data.
 * Prefers last-touch, falls back to first-touch, or returns empty if none.
 */
function pickAttribution(userAttribution: { firstTouch: AttributionData; lastTouch: AttributionData } | undefined): Omit<
  AttributionData,
  "capturedAt"
> {
  if (userAttribution === undefined) return emptyAttribution();
  if (hasValidUtm(userAttribution.lastTouch)) {
    return omitCapturedAt(userAttribution.lastTouch);
  }
  if (hasValidUtm(userAttribution.firstTouch)) {
    return omitCapturedAt(userAttribution.firstTouch);
  }
  return emptyAttribution();
}

function hasValidUtm(data: AttributionData | Omit<AttributionData, "capturedAt">): boolean {
  return data.utmSource !== null || data.utmMedium !== null || data.utmCampaign !== null;
}

function omitCapturedAt(data: AttributionData): Omit<AttributionData, "capturedAt"> {
  return {
    utmSource: data.utmSource,
    utmMedium: data.utmMedium,
    utmCampaign: data.utmCampaign,
    utmContent: data.utmContent,
    utmTerm: data.utmTerm,
    referrerHost: data.referrerHost,
    landingPath: data.landingPath,
  };
}

function emptyAttribution(): Omit<AttributionData, "capturedAt"> {
  return {
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    referrerHost: null,
    landingPath: null,
  };
}
