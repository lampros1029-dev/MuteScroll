import type {
  AttributionData,
  ConversionAggregation,
  ConversionEvent,
  ConversionEventStore,
  UserAttributionRecord,
  UserAttributionStore,
} from "./types.js";

export class MemoryUserAttributionStore implements UserAttributionStore {
  private readonly records = new Map<string, UserAttributionRecord>();

  async get(userId: string): Promise<UserAttributionRecord | undefined> {
    return this.records.get(userId);
  }

  async setFirstTouch(userId: string, data: AttributionData): Promise<void> {
    const existing = this.records.get(userId);
    if (existing !== undefined) return;
    this.records.set(userId, {
      userId,
      firstTouch: data,
      lastTouch: emptyAttribution(),
    });
  }

  async setLastTouch(userId: string, data: AttributionData): Promise<void> {
    const existing = this.records.get(userId);
    if (existing === undefined) {
      this.records.set(userId, {
        userId,
        firstTouch: emptyAttribution(),
        lastTouch: data,
      });
    } else {
      this.records.set(userId, { ...existing, lastTouch: data });
    }
  }
}

export class MemoryConversionEventStore implements ConversionEventStore {
  private readonly events: ConversionEvent[] = [];
  private nextId = 1;

  async recordSignup(userId: string, attribution: Omit<AttributionData, "capturedAt">, createdAt: number): Promise<void> {
    this.events.push({
      id: String(this.nextId++),
      userId,
      eventType: "signup",
      attribution,
      amountCents: null,
      currency: null,
      createdAt,
    });
  }

  async recordPurchase(
    userId: string,
    attribution: Omit<AttributionData, "capturedAt">,
    amountCents: number,
    currency: string,
    createdAt: number,
  ): Promise<void> {
    this.events.push({
      id: String(this.nextId++),
      userId,
      eventType: "purchase",
      attribution,
      amountCents,
      currency,
      createdAt,
    });
  }

  async aggregateByAttribution(startDate: number, endDate: number): Promise<ConversionAggregation[]> {
    const filtered = this.events.filter((e) => e.createdAt >= startDate && e.createdAt < endDate);
    const grouped = new Map<string, ConversionAggregation>();

    for (const event of filtered) {
      const key = `${event.attribution.utmSource ?? ""}|${event.attribution.utmMedium ?? ""}|${event.attribution.utmCampaign ?? ""}`;
      const existing = grouped.get(key);
      if (existing === undefined) {
        grouped.set(key, {
          utmSource: event.attribution.utmSource,
          utmMedium: event.attribution.utmMedium,
          utmCampaign: event.attribution.utmCampaign,
          signupCount: event.eventType === "signup" ? 1 : 0,
          purchaseCount: event.eventType === "purchase" ? 1 : 0,
          totalRevenueCents: event.eventType === "purchase" && event.amountCents !== null ? event.amountCents : 0,
          currency: event.currency,
        });
      } else {
        grouped.set(key, {
          ...existing,
          signupCount: existing.signupCount + (event.eventType === "signup" ? 1 : 0),
          purchaseCount: existing.purchaseCount + (event.eventType === "purchase" ? 1 : 0),
          totalRevenueCents:
            existing.totalRevenueCents + (event.eventType === "purchase" && event.amountCents !== null ? event.amountCents : 0),
        });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => b.purchaseCount - a.purchaseCount || b.signupCount - a.signupCount);
  }
}

function emptyAttribution(): AttributionData {
  return {
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    referrerHost: null,
    landingPath: null,
    capturedAt: null,
  };
}
