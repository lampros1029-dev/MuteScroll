import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStorage = new Map<string, string>();

beforeEach(() => {
  mockStorage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => mockStorage.get(key) ?? null,
    setItem: (key: string, value: string) => mockStorage.set(key, value),
    removeItem: (key: string) => mockStorage.delete(key),
  });
  vi.stubGlobal("window", {
    location: {
      search: "",
      pathname: "/",
    },
  });
  vi.stubGlobal("document", {
    referrer: "",
  });
});

describe("attribution client-side storage", () => {
  it("should capture and store UTM parameters", async () => {
    const { captureAttribution, getStoredAttribution } = await import("./attribution");

    let cookie = "";
    vi.stubGlobal("window", {
      location: {
        search: "?utm_source=twitter&utm_medium=social&utm_campaign=launch",
        pathname: "/pricing",
        protocol: "https:",
      },
    });
    vi.stubGlobal("document", {
      referrer: "https://twitter.com/post/123",
      get cookie() {
        return cookie;
      },
      set cookie(value: string) {
        cookie = value;
      },
    });

    captureAttribution();

    expect(cookie.startsWith("ms_attr=")).toBe(true);
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    const stored = getStoredAttribution();
    expect(stored.firstTouch).toBeTruthy();
    expect(stored.firstTouch?.utmSource).toBe("twitter");
    expect(stored.firstTouch?.utmMedium).toBe("social");
    expect(stored.firstTouch?.utmCampaign).toBe("launch");
    expect(stored.firstTouch?.referrerHost).toBe("twitter.com");
    expect(stored.firstTouch?.landingPath).toBe("/pricing");

    expect(stored.lastTouch).toBeTruthy();
    expect(stored.lastTouch?.utmSource).toBe("twitter");
  });

  it("should not overwrite first-touch attribution", async () => {
    const { captureAttribution, getStoredAttribution } = await import("./attribution");

    vi.stubGlobal("window", {
      location: {
        search: "?utm_source=email&utm_campaign=first",
        pathname: "/",
      },
    });
    vi.stubGlobal("document", { referrer: "" });

    captureAttribution();

    vi.stubGlobal("window", {
      location: {
        search: "?utm_source=twitter&utm_campaign=second",
        pathname: "/",
      },
    });
    vi.stubGlobal("document", { referrer: "" });

    captureAttribution();

    const stored = getStoredAttribution();
    expect(stored.firstTouch?.utmSource).toBe("email");
    expect(stored.firstTouch?.utmCampaign).toBe("first");

    expect(stored.lastTouch?.utmSource).toBe("twitter");
    expect(stored.lastTouch?.utmCampaign).toBe("second");
  });

  it("should not store anything when no UTM parameters", async () => {
    const { captureAttribution, getStoredAttribution } = await import("./attribution");

    vi.stubGlobal("window", {
      location: {
        search: "",
        pathname: "/",
      },
    });
    vi.stubGlobal("document", { referrer: "" });

    captureAttribution();

    const stored = getStoredAttribution();
    expect(stored.firstTouch).toBeNull();
    expect(stored.lastTouch).toBeNull();
  });

  it("should clear stored attribution", async () => {
    const { captureAttribution, getStoredAttribution, clearStoredAttribution } = await import("./attribution");

    vi.stubGlobal("window", {
      location: {
        search: "?utm_source=test&utm_campaign=test",
        pathname: "/",
      },
    });
    vi.stubGlobal("document", { referrer: "" });

    captureAttribution();
    expect(getStoredAttribution().firstTouch).toBeTruthy();

    clearStoredAttribution();
    expect(getStoredAttribution().firstTouch).toBeNull();
    expect(getStoredAttribution().lastTouch).toBeNull();
  });
});
