import { CONTACT_EMAIL, SITE_NAME } from "./site";
import { formatUsd } from "./format";

/**
 * Plans exactly as written in PRD section 20.2. Amounts are USD catalog prices before VAT
 * and sales tax. Paddle checkout adds the buyer's country tax (`tax_mode: external`).
 * Do not raise a price to clear $10: Paddle's under-$10 note is a fee quote, and the
 * Billing API already accepts these amounts. Signed-in checkout starts from the pricing page.
 * `waitlistMailto` remains for notes that are not a purchase.
 */

export type Cadence = "monthly" | "annual";

export interface PlanFeatures {
  readonly credits: string;
  readonly maxLength: string;
  readonly surfaces: string;
  readonly frameChecks: string;
  readonly speakerLabels: string;
  readonly library: string;
  readonly exports: string;
  readonly bulk: string;
  readonly seats: string;
  readonly priority: string;
}

export interface Plan {
  readonly id: "free" | "creator" | "pro" | "team";
  readonly name: string;
  readonly summary: string;
  readonly monthlyUsd: number;
  /** Yearly total, or null when there is no annual option (Free). */
  readonly annualUsd: number | null;
  readonly recommended: boolean;
  readonly features: PlanFeatures;
}

export const PLANS: readonly Plan[] = [
  {
    id: "free",
    name: "Free",
    summary: "Try it on your own links.",
    monthlyUsd: 0,
    annualUsd: null,
    recommended: false,
    features: {
      credits: "20 per month",
      maxLength: "10 min per video",
      surfaces: "ChatGPT, Claude, web",
      frameChecks: "3 per month",
      speakerLabels: "Not included",
      library: "7-day history",
      exports: "TXT",
      bulk: "Not included",
      seats: "1",
      priority: "Not included",
    },
  },
  {
    id: "creator",
    name: "Creator",
    summary: "For creators who study a few videos a day.",
    monthlyUsd: 7.99,
    annualUsd: 59,
    recommended: false,
    features: {
      credits: "400 per month",
      maxLength: "60 min per video",
      surfaces: "All",
      frameChecks: "100 per month",
      speakerLabels: "Not included",
      library: "Included",
      exports: "TXT, SRT, VTT, DOCX, MD",
      bulk: "25 per batch",
      seats: "1",
      priority: "Not included",
    },
  },
  {
    id: "pro",
    name: "Pro",
    summary: "For daily research, hooks and scripts.",
    monthlyUsd: 16.99,
    annualUsd: 119,
    recommended: true,
    features: {
      credits: "1,500 per month",
      maxLength: "3 h per video",
      surfaces: "All",
      frameChecks: "1,000 per month",
      speakerLabels: "Included",
      library: "Included",
      exports: "TXT, SRT, VTT, DOCX, MD",
      bulk: "200 per batch",
      seats: "1",
      priority: "Included",
    },
  },
  {
    id: "team",
    name: "Team / API",
    summary: "For agencies and teams that run batches or build on the API.",
    monthlyUsd: 49,
    annualUsd: 468,
    recommended: false,
    features: {
      credits: "6,000 pooled per month",
      maxLength: "3 h per video",
      surfaces: "All, plus REST API keys",
      frameChecks: "5,000 per month",
      speakerLabels: "Included",
      library: "Shared",
      exports: "TXT, SRT, VTT, DOCX, MD",
      bulk: "1,000 per batch",
      seats: "3 included, +$12 per extra seat",
      priority: "Included",
    },
  },
];

export const FOUNDING_PASS = {
  priceUsd: 79,
  seatLimit: 500,
  termMonths: 12,
} as const;

/** One-time packs. A purchase adds credits and does not change the subscription plan. */
export const CREDIT_PACKS = [
  { id: "pack_500" as const, credits: 500, priceUsd: 5 },
  { id: "pack_2000" as const, credits: 2000, priceUsd: 15 },
] as const;

/** One extra Team seat, billed monthly. It does not replace the Team plan. */
export const EXTRA_SEAT = { priceUsd: 12, period: "month" as const };

export interface PriceView {
  /** Amount charged for one period: a month, or a year. */
  readonly amountUsd: number;
  readonly period: "month" | "year";
  /** Average per month when billed yearly, rounded to cents. Null for monthly or free plans. */
  readonly perMonthUsd: number | null;
  readonly amountLabel: string;
}

export function priceFor(plan: Plan, cadence: Cadence): PriceView {
  if (cadence === "annual" && plan.annualUsd !== null) {
    const perMonth = Math.round((plan.annualUsd / 12) * 100) / 100;
    return {
      amountUsd: plan.annualUsd,
      period: "year",
      perMonthUsd: perMonth,
      amountLabel: formatUsd(plan.annualUsd),
    };
  }
  return {
    amountUsd: plan.monthlyUsd,
    period: "month",
    perMonthUsd: null,
    amountLabel: formatUsd(plan.monthlyUsd),
  };
}

/** Whole-percent saving of annual billing against twelve monthly payments. Null when not applicable. */
export function annualSavingsPercent(plan: Plan): number | null {
  if (plan.annualUsd === null || plan.monthlyUsd === 0) return null;
  const yearlyAtMonthly = plan.monthlyUsd * 12;
  const saving = Math.round(((yearlyAtMonthly - plan.annualUsd) / yearlyAtMonthly) * 100);
  return saving > 0 ? saving : null;
}

export function waitlistMailto(subjectDetail: string, body?: string): string {
  const subject = `${SITE_NAME} waitlist: ${subjectDetail}`;
  const parts = [`subject=${encodeURIComponent(subject)}`];
  if (body !== undefined) parts.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${CONTACT_EMAIL}?${parts.join("&")}`;
}
