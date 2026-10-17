// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountPanel } from "./account-panel";

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

function account(plan: string, interval: "month" | "year" | null) {
  return {
    email: "reader@example.test",
    plan,
    billing_interval: interval,
    credits: { remaining: 400, allowance: 400, used: 0, bonus: 0, resets_at: "2026-11-01T00:00:00.000Z" },
    seats: { included: plan === "team" ? 3 : 1, extra: 0 },
    created_at: "2026-10-01T00:00:00.000Z",
  };
}

function stubAccount(plan: string, interval: "month" | "year" | null, checkoutBodies: unknown[]) {
  document.cookie = "ms_csrf=csrf-test";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/me") return jsonResponse(200, account(plan, interval));
      if (url === "/api/v1/api-keys") return jsonResponse(200, { items: [] });
      if (url === "/api/v1/oauth/grants") return jsonResponse(200, { grants: [] });
      if (url === "/api/v1/checkout" && init?.method === "POST") {
        checkoutBodies.push(JSON.parse(String(init.body)));
        return jsonResponse(200, { url: "https://checkout.example.test/pay" });
      }
      return jsonResponse(404, {});
    }),
  );
}

describe("AccountPanel billing interval", () => {
  afterEach(() => {
    opened.urls = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("offers the next plan monthly when the subscription is monthly", async () => {
    const checkoutBodies: unknown[] = [];
    stubAccount("creator", "month", checkoutBodies);
    render(<AccountPanel />);
    expect(await screen.findByRole("heading", { name: "Creator" })).toBeTruthy();
    expect(screen.getByText("reader@example.test")).toBeTruthy();
    expect(screen.getByText("0 of 400 credits used")).toBeTruthy();
    expect(screen.getByText("400 credits remaining.")).toBeTruthy();
    expect(screen.getByText("Resets Nov 1, 2026.")).toBeTruthy();
    expect(screen.getAllByText("$7.99").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Pro" })).toBeTruthy();
    expect(screen.getByText("For daily research, hooks and scripts.")).toBeTruthy();
    expect(screen.getAllByText("$16.99").length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toMatch(/\$119|per year/);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Pro" }));
    await waitFor(() => expect(checkoutBodies).toEqual([{ plan: "pro", interval: "month" }]));
  });

  it("keeps a yearly subscriber on yearly prices", async () => {
    const checkoutBodies: unknown[] = [];
    stubAccount("creator", "year", checkoutBodies);
    render(<AccountPanel />);
    expect(await screen.findByRole("heading", { name: "Pro" })).toBeTruthy();
    expect(screen.getAllByText("$59").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$119").length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").toMatch(/per year/);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Pro" }));
    await waitFor(() => expect(checkoutBodies).toEqual([{ plan: "pro", interval: "year" }]));
  });

  it("does not invent a yearly offer when the interval is missing", async () => {
    const checkoutBodies: unknown[] = [];
    stubAccount("creator", null, checkoutBodies);
    render(<AccountPanel />);
    expect(await screen.findByRole("heading", { name: "Creator" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue to Pro" })).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/\$119|per year|per month/);
    expect(checkoutBodies).toEqual([]);
  });

  it("offers Team at the Pro interval and stops at Team", async () => {
    const proBodies: unknown[] = [];
    stubAccount("pro", "month", proBodies);
    const { unmount } = render(<AccountPanel />);
    expect(await screen.findByRole("heading", { name: "Team / API" })).toBeTruthy();
    expect(screen.getAllByText("$49").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Team / API" }));
    await waitFor(() => expect(proBodies).toEqual([{ plan: "team", interval: "month" }]));
    unmount();

    const teamBodies: unknown[] = [];
    stubAccount("team", "month", teamBodies);
    render(<AccountPanel />);
    expect(await screen.findByRole("heading", { name: "Team" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Continue to/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Extra seat" })).toBeTruthy();
    expect(screen.getByText(/\$12 per month/)).toBeTruthy();
  });
});
