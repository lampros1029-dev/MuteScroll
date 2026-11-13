import { describe, expect, it } from "vitest";

import { attributionFromCookieHeader } from "../../src/attribution/cookie.js";
import { parsePaddlePurchase } from "../../src/billing/paddle-money.js";

describe("Paddle purchase amounts", () => {
  it("reads the smallest currency unit and does not scale a decimal", () => {
    const raw = Buffer.from(
      JSON.stringify({
        data: {
          currency_code: "usd",
          custom_data: { utm_campaign: "Launch" },
          details: { totals: { total: "2499" } },
        },
      }),
    );
    expect(parsePaddlePurchase(raw)).toEqual({
      amountCents: 2499,
      currency: "USD",
      customData: { utm_campaign: "Launch" },
    });
    const decimal = Buffer.from(JSON.stringify({ data: { currency_code: "USD", details: { totals: { total: "24.99" } } } }));
    expect(parsePaddlePurchase(decimal).amountCents).toBeNull();
  });
});

describe("attribution cookie", () => {
  it("keeps an unexpired touch and drops junk", () => {
    const now = 1_700_000_000_000;
    const touch = {
      utmSource: " Twitter ",
      utmMedium: "social",
      utmCampaign: "launch",
      utmContent: "null",
      utmTerm: null,
      referrerHost: "Twitter.com",
      landingPath: "/try",
      capturedAt: now,
      expiresAt: now + 1000,
    };
    const header = `ms_attr=${encodeURIComponent(JSON.stringify({ first: touch, last: { ...touch, expiresAt: now - 1 } }))}`;
    const pair = attributionFromCookieHeader(header, now);
    expect(pair.firstTouch).toMatchObject({
      utmSource: "twitter",
      utmMedium: "social",
      utmCampaign: "launch",
      utmContent: null,
      referrerHost: "twitter.com",
    });
    expect(pair.lastTouch).toBeNull();
    expect(attributionFromCookieHeader("ms_attr=not-json", now)).toEqual({ firstTouch: null, lastTouch: null });
  });
});
