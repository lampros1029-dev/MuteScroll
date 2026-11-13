import type { Pool } from "pg";

import type {
  AttributionData,
  ConversionAggregation,
  ConversionEventStore,
  UserAttributionRecord,
  UserAttributionStore,
} from "./types.js";

interface UserAttributionRow {
  readonly user_id: string;
  readonly first_utm_source: string | null;
  readonly first_utm_medium: string | null;
  readonly first_utm_campaign: string | null;
  readonly first_utm_content: string | null;
  readonly first_utm_term: string | null;
  readonly first_referrer_host: string | null;
  readonly first_landing_path: string | null;
  readonly first_captured_at: Date | null;
  readonly last_utm_source: string | null;
  readonly last_utm_medium: string | null;
  readonly last_utm_campaign: string | null;
  readonly last_utm_content: string | null;
  readonly last_utm_term: string | null;
  readonly last_referrer_host: string | null;
  readonly last_landing_path: string | null;
  readonly last_captured_at: Date | null;
}

export class PgUserAttributionStore implements UserAttributionStore {
  constructor(private readonly pool: Pool) {}

  async get(userId: string): Promise<UserAttributionRecord | undefined> {
    const result = await this.pool.query<UserAttributionRow>("SELECT * FROM user_attribution WHERE user_id = $1", [userId]);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return toUserAttributionRecord(row);
  }

  async setFirstTouch(userId: string, data: AttributionData): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_attribution (
        user_id, first_utm_source, first_utm_medium, first_utm_campaign, first_utm_content, first_utm_term,
        first_referrer_host, first_landing_path, first_captured_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (user_id) DO NOTHING`,
      [
        userId,
        data.utmSource,
        data.utmMedium,
        data.utmCampaign,
        data.utmContent,
        data.utmTerm,
        data.referrerHost,
        data.landingPath,
        data.capturedAt === null ? null : new Date(data.capturedAt),
      ],
    );
  }

  async setLastTouch(userId: string, data: AttributionData): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_attribution (
        user_id, last_utm_source, last_utm_medium, last_utm_campaign, last_utm_content, last_utm_term,
        last_referrer_host, last_landing_path, last_captured_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (user_id) DO UPDATE SET
        last_utm_source = EXCLUDED.last_utm_source,
        last_utm_medium = EXCLUDED.last_utm_medium,
        last_utm_campaign = EXCLUDED.last_utm_campaign,
        last_utm_content = EXCLUDED.last_utm_content,
        last_utm_term = EXCLUDED.last_utm_term,
        last_referrer_host = EXCLUDED.last_referrer_host,
        last_landing_path = EXCLUDED.last_landing_path,
        last_captured_at = EXCLUDED.last_captured_at`,
      [
        userId,
        data.utmSource,
        data.utmMedium,
        data.utmCampaign,
        data.utmContent,
        data.utmTerm,
        data.referrerHost,
        data.landingPath,
        data.capturedAt === null ? null : new Date(data.capturedAt),
      ],
    );
  }
}

export class PgConversionEventStore implements ConversionEventStore {
  constructor(private readonly pool: Pool) {}

  async recordSignup(userId: string, attribution: Omit<AttributionData, "capturedAt">, createdAt: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO conversion_events (
        user_id, event_type, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        referrer_host, landing_path, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userId,
        "signup",
        attribution.utmSource,
        attribution.utmMedium,
        attribution.utmCampaign,
        attribution.utmContent,
        attribution.utmTerm,
        attribution.referrerHost,
        attribution.landingPath,
        new Date(createdAt),
      ],
    );
  }

  async recordPurchase(
    userId: string,
    attribution: Omit<AttributionData, "capturedAt">,
    amountCents: number | null,
    currency: string | null,
    createdAt: number,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO conversion_events (
        user_id, event_type, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        referrer_host, landing_path, amount_cents, currency, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        userId,
        "purchase",
        attribution.utmSource,
        attribution.utmMedium,
        attribution.utmCampaign,
        attribution.utmContent,
        attribution.utmTerm,
        attribution.referrerHost,
        attribution.landingPath,
        amountCents,
        currency,
        new Date(createdAt),
      ],
    );
  }

  async aggregateByAttribution(startDate: number, endDate: number): Promise<ConversionAggregation[]> {
    const result = await this.pool.query<{
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      signup_count: string;
      purchase_count: string;
      total_revenue_cents: string;
      currency: string | null;
    }>(
      `SELECT
        utm_source,
        utm_medium,
        utm_campaign,
        COUNT(*) FILTER (WHERE event_type = 'signup') AS signup_count,
        COUNT(*) FILTER (WHERE event_type = 'purchase') AS purchase_count,
        COALESCE(SUM(amount_cents) FILTER (WHERE event_type = 'purchase'), 0) AS total_revenue_cents,
        MAX(currency) FILTER (WHERE event_type = 'purchase') AS currency
      FROM conversion_events
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY utm_source, utm_medium, utm_campaign
      ORDER BY purchase_count DESC, signup_count DESC`,
      [new Date(startDate), new Date(endDate)],
    );

    return result.rows.map((row) => ({
      utmSource: row.utm_source,
      utmMedium: row.utm_medium,
      utmCampaign: row.utm_campaign,
      signupCount: Number.parseInt(row.signup_count, 10),
      purchaseCount: Number.parseInt(row.purchase_count, 10),
      totalRevenueCents: Number.parseInt(row.total_revenue_cents, 10),
      currency: row.currency,
    }));
  }
}

function toUserAttributionRecord(row: UserAttributionRow): UserAttributionRecord {
  return {
    userId: row.user_id,
    firstTouch: {
      utmSource: row.first_utm_source,
      utmMedium: row.first_utm_medium,
      utmCampaign: row.first_utm_campaign,
      utmContent: row.first_utm_content,
      utmTerm: row.first_utm_term,
      referrerHost: row.first_referrer_host,
      landingPath: row.first_landing_path,
      capturedAt: row.first_captured_at === null ? null : row.first_captured_at.getTime(),
    },
    lastTouch: {
      utmSource: row.last_utm_source,
      utmMedium: row.last_utm_medium,
      utmCampaign: row.last_utm_campaign,
      utmContent: row.last_utm_content,
      utmTerm: row.last_utm_term,
      referrerHost: row.last_referrer_host,
      landingPath: row.last_landing_path,
      capturedAt: row.last_captured_at === null ? null : row.last_captured_at.getTime(),
    },
  };
}
