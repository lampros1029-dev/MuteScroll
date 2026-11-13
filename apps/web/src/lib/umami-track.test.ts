import { afterEach, describe, expect, it, vi } from "vitest";

import { trackUmami, umamiEventData } from "./umami-track";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("umami events", () => {
  it("keeps utm_source and utm_campaign and drops empty fields", () => {
    expect(umamiEventData({ utmSource: "newsletter", utmCampaign: "launch" })).toEqual({
      utm_source: "newsletter",
      utm_campaign: "launch",
    });
    expect(umamiEventData({ utmSource: "reddit", utmCampaign: null })).toEqual({ utm_source: "reddit" });
    expect(umamiEventData(null)).toBeUndefined();
    expect(umamiEventData({ utmSource: null, utmCampaign: null })).toBeUndefined();
  });

  it("calls umami.track when the script is present", () => {
    const track = vi.fn();
    vi.stubGlobal("window", { umami: { track }, setTimeout });
    vi.stubGlobal("localStorage", { getItem: () => null, removeItem: () => undefined });
    trackUmami("signup");
    expect(track).toHaveBeenCalledWith("signup");
  });

  it("does not throw when Umami is not loaded", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { umami: undefined, setTimeout });
    vi.stubGlobal("localStorage", { getItem: () => null, removeItem: () => undefined });
    expect(() => trackUmami("purchase")).not.toThrow();
    vi.runAllTimers();
  });
});
