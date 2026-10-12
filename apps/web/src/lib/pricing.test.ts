import { describe, expect, it } from "vitest";

import { annualSavingsPercent, CREDIT_PACKS, FOUNDING_PASS, PLANS, priceFor, waitlistMailto } from "./pricing";

const plan = (id: (typeof PLANS)[number]["id"]) => {
  const found = PLANS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing plan ${id}`);
  return found;
};

describe("plans (PRD 20.2)", () => {
  it("lists the four plans with the PRD prices", () => {
    expect(PLANS.map((p) => [p.name, p.monthlyUsd, p.annualUsd])).toEqual([
      ["Free", 0, null],
      ["Creator", 7.99, 59],
      ["Pro", 16.99, 119],
      ["Team / API", 49, 468],
    ]);
  });

  it("marks Pro as the recommended plan", () => {
    expect(PLANS.filter((p) => p.recommended).map((p) => p.id)).toEqual(["pro"]);
  });

  it("keeps the Founding Pass offer from PRD 20.3", () => {
    expect(FOUNDING_PASS).toEqual({ priceUsd: 79, seatLimit: 500, termMonths: 12 });
    expect(CREDIT_PACKS.map((pack) => [pack.credits, pack.priceUsd])).toEqual([
      [500, 5],
      [2000, 15],
    ]);
  });
});

describe("priceFor", () => {
  it("shows the yearly total and the per-month equivalent", () => {
    expect(priceFor(plan("creator"), "annual")).toMatchObject({
      amountUsd: 59,
      period: "year",
      perMonthUsd: 4.92,
      amountLabel: "$59",
    });
    expect(priceFor(plan("pro"), "annual").perMonthUsd).toBe(9.92);
  });

  it("falls back to the monthly price when there is no annual option", () => {
    expect(priceFor(plan("free"), "annual")).toMatchObject({ amountUsd: 0, period: "month", perMonthUsd: null });
    expect(priceFor(plan("pro"), "monthly")).toMatchObject({ amountLabel: "$16.99", period: "month" });
  });
});

describe("annualSavingsPercent", () => {
  it("computes the saving against twelve monthly payments", () => {
    expect(annualSavingsPercent(plan("creator"))).toBe(38);
    expect(annualSavingsPercent(plan("pro"))).toBe(42);
    expect(annualSavingsPercent(plan("team"))).toBe(20);
    expect(annualSavingsPercent(plan("free"))).toBeNull();
  });
});

describe("waitlistMailto", () => {
  it("opens a mail to the contact address with an encoded subject and body", () => {
    const href = waitlistMailto("Pro, annual", "Tell me when it opens & what it costs");
    expect(href.startsWith("mailto:mutescroll.xyz@gmail.com?subject=")).toBe(true);
    expect(decodeURIComponent(href.split("subject=")[1]?.split("&")[0] ?? "")).toBe("MuteScroll waitlist: Pro, annual");
    expect(href).toContain("body=Tell%20me%20when%20it%20opens%20%26%20what%20it%20costs");
  });
});
