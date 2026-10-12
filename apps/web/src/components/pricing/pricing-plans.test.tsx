// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PricingPlans } from "./pricing-plans";

const opened = vi.hoisted(() => ({ urls: [] as string[] }));

vi.mock("../../lib/api/account", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api/account")>("../../lib/api/account");
  return {
    ...actual,
    openUrl: (url: string) => {
      opened.urls.push(url);
    },
  };
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

describe("PricingPlans", () => {
  afterEach(() => {
    opened.urls = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("defaults to annual billing, as PRD 20.4 specifies", () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { error: { code: "unauthorized", message: "Sign in required." } })));
    render(<PricingPlans />);
    expect(screen.getByRole("button", { name: "Annual" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Monthly" }).getAttribute("aria-pressed")).toBe("false");
    const pro = findCard("Pro");
    expect(within(pro).getByText("$119")).toBeTruthy();
    expect(within(pro).getByText("$9.92 per month, billed yearly. Save 42%")).toBeTruthy();
  });

  it("switches prices when the toggle changes", () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { error: { code: "unauthorized", message: "Sign in required." } })));
    render(<PricingPlans />);
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    const creator = findCard("Creator");
    expect(within(creator).getByText("$7.99")).toBeTruthy();
    expect(within(creator).getByText("Billed monthly.")).toBeTruthy();
    expect(within(creator).getByText("Plus VAT or sales tax for your country.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Monthly" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("sends paid plans to sign-up when signed out, never to a waitlist mailbox", () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { error: { code: "unauthorized", message: "Sign in required." } })));
    render(<PricingPlans />);
    const links = screen.getAllByRole("link", { name: "Continue" });
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe("/signup?next=checkout");
    }
    expect(document.body.textContent ?? "").not.toMatch(/Billing isn't live yet|Free accounts arrive with sign-up|Join the waitlist/);
  });

  it("explains the free plan without a purchase button", () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { error: { code: "unauthorized", message: "Sign in required." } })));
    render(<PricingPlans />);
    const free = findCard("Free");
    expect(within(free).queryByRole("link", { name: "Continue" })).toBeNull();
    expect(within(free).getByRole("link", { name: "Create a free account" }).getAttribute("href")).toBe("/signup");
    expect(within(free).getByText("Anonymous use is open now.")).toBeTruthy();
  });

  it("starts checkout for the signed-in card and says so when billing is closed", async () => {
    document.cookie = "ms_csrf=csrf-test";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/me") {
        return jsonResponse(200, {
          email: "a@example.com",
          plan: "free",
          credits: { remaining: 20, resets_at: "2026-11-01T00:00:00.000Z" },
          created_at: "2026-10-01T00:00:00.000Z",
        });
      }
      if (url === "/api/v1/checkout" && init?.body !== undefined && String(init.body).includes('"plan":"pro"')) {
        return jsonResponse(503, { error: { code: "billing_not_configured", message: "Billing is not open yet." } });
      }
      if (url === "/api/v1/checkout") {
        return jsonResponse(200, { url: "https://buy.paddle.com/checkout/test" });
      }
      return jsonResponse(404, { error: { code: "not_found", message: "Missing." } });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PricingPlans />);
    const pro = findCard("Pro");
    await waitFor(() => expect(within(pro).getByRole("button", { name: "Continue" })).toBeTruthy());
    fireEvent.click(within(pro).getByRole("button", { name: "Continue" }));
    expect(await within(pro).findByRole("alert")).toHaveProperty("textContent", "Billing is not open yet.");

    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    const creator = findCard("Creator");
    fireEvent.click(within(creator).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(opened.urls).toEqual(["https://buy.paddle.com/checkout/test"]));

    const checkoutCalls = fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/checkout");
    expect(JSON.parse(String(checkoutCalls[0]?.[1]?.body))).toEqual({ plan: "pro", interval: "year" });
    expect(JSON.parse(String(checkoutCalls[1]?.[1]?.body))).toEqual({ plan: "creator", interval: "month" });
    expect(checkoutCalls[0]?.[1]?.headers).toMatchObject({ "x-csrf-token": "csrf-test" });
  });
});

/** Finds a plan card by its heading, e.g. "Pro". */
function findCard(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { level: 3, name });
  const card = heading.closest("li");
  if (card === null) throw new Error(`No card for ${name}`);
  return card;
}
