// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PricingPlans } from "./pricing-plans";

describe("PricingPlans", () => {
  it("defaults to annual billing, as PRD 20.4 specifies", () => {
    render(<PricingPlans />);
    expect(screen.getByRole("button", { name: "Annual" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Monthly" }).getAttribute("aria-pressed")).toBe("false");
    const pro = findCard("Pro");
    expect(within(pro).getByText("$119")).toBeTruthy();
    expect(within(pro).getByText("$9.92 per month, billed yearly. Save 42%")).toBeTruthy();
  });

  it("switches prices when the toggle changes", () => {
    render(<PricingPlans />);
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    const creator = findCard("Creator");
    expect(within(creator).getByText("$7.99")).toBeTruthy();
    expect(within(creator).getByText("Billed monthly.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Monthly" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("sends every call to action to the waitlist mailbox, never to checkout", () => {
    render(<PricingPlans />);
    const links = screen.getAllByRole("link", { name: "Join the waitlist" });
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.getAttribute("href")?.startsWith("mailto:mutescroll.xyz@gmail.com?subject=")).toBe(true);
    }
  });

  it("explains the free plan without a purchase button", () => {
    render(<PricingPlans />);
    const free = findCard("Free");
    expect(within(free).queryByRole("link")).toBeNull();
    expect(within(free).getByText("Anonymous use is open now. Free accounts arrive with sign-up.")).toBeTruthy();
  });
});

/** Finds a plan card by its heading, e.g. "Pro". */
function findCard(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { level: 3, name });
  const card = heading.closest("li");
  if (card === null) throw new Error(`No card for ${name}`);
  return card;
}
