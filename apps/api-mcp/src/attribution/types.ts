/** UTM parameters and referrer data for attribution tracking. */
export interface AttributionData {
  readonly utmSource: string | null;
  readonly utmMedium: string | null;
  readonly utmCampaign: string | null;
  readonly utmContent: string | null;
  readonly utmTerm: string | null;
  readonly referrerHost: string | null;
  readonly landingPath: string | null;
  readonly capturedAt: number | null;
}

/** User attribution record with first-touch and last-touch data. */
export interface UserAttributionRecord {
  readonly userId: string;
  readonly firstTouch: AttributionData;
  readonly lastTouch: AttributionData;
}

/** Conversion event types. */
export type ConversionEventType = "signup" | "purchase";

/** A recorded conversion event (signup or purchase). */
export interface ConversionEvent {
  readonly id: string;
  readonly userId: string;
  readonly eventType: ConversionEventType;
  readonly attribution: Omit<AttributionData, "capturedAt">;
  readonly amountCents: number | null;
  readonly currency: string | null;
  readonly createdAt: number;
}

/** Store interface for user attribution. */
export interface UserAttributionStore {
  /** Get attribution for a user, or undefined if none stored. */
  get(userId: string): Promise<UserAttributionRecord | undefined>;

  /** Set first-touch attribution for a user (only if not already set). */
  setFirstTouch(userId: string, data: AttributionData): Promise<void>;

  /** Set last-touch attribution for a user (always overwrites). */
  setLastTouch(userId: string, data: AttributionData): Promise<void>;
}

/** Store interface for conversion events. */
export interface ConversionEventStore {
  /** Record a signup event. */
  recordSignup(userId: string, attribution: Omit<AttributionData, "capturedAt">, createdAt: number): Promise<void>;

  /** Record a purchase event. */
  recordPurchase(
    userId: string,
    attribution: Omit<AttributionData, "capturedAt">,
    amountCents: number | null,
    currency: string | null,
    createdAt: number,
  ): Promise<void>;

  /** Query conversion events grouped by attribution fields with date range. */
  aggregateByAttribution(startDate: number, endDate: number): Promise<ConversionAggregation[]>;
}

/** Aggregated conversion data grouped by attribution. */
export interface ConversionAggregation {
  readonly utmSource: string | null;
  readonly utmMedium: string | null;
  readonly utmCampaign: string | null;
  readonly signupCount: number;
  readonly purchaseCount: number;
  readonly totalRevenueCents: number;
  readonly currency: string | null;
}
