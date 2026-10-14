// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { PHASE_PRODUCTION_SERVER } from "next/constants";
import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

import PlansPage from "./page";

describe("plans page", () => {
  it("states the anonymous allowance and does not sell", () => {
    render(<PlansPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Limits" })).toBeTruthy();
    expect(screen.getByText(/5 credits per rolling 24 hours/)).toBeTruthy();
    expect(screen.getByText(/One credit covers up to 10 minutes of audio/)).toBeTruthy();
    expect(screen.getByText("Paid plans are described on the website.")).toBeTruthy();

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("/");
    expect(screen.queryByRole("button")).toBeNull();

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\$|save|Founding Pass|checkout|upgrade/i);
  });
});

describe("/plans route", () => {
  it("does not redirect to the pricing page", async () => {
    const config = nextConfig(PHASE_PRODUCTION_SERVER);
    const redirects = config.redirects === undefined ? [] : await config.redirects();
    expect(redirects.some((rule) => rule.source === "/plans")).toBe(false);
  });
});
