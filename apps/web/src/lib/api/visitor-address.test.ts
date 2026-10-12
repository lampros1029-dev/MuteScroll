import { describe, expect, it } from "vitest";

import { visitorForwardedAddress } from "./visitor-address";

describe("visitorForwardedAddress", () => {
  it("returns the right-most address, the one Railway's edge appended", () => {
    expect(visitorForwardedAddress("6.6.6.6, 198.51.100.7")).toBe("198.51.100.7");
    expect(visitorForwardedAddress("203.0.113.4, 198.51.100.20, 192.0.2.8")).toBe("192.0.2.8");
  });

  it("returns the only address and keeps an IPv6 address intact", () => {
    expect(visitorForwardedAddress("203.0.113.9")).toBe("203.0.113.9");
    expect(visitorForwardedAddress("1.1.1.1, 2001:db8::1")).toBe("2001:db8::1");
  });

  it("trims entries and ignores empty ones", () => {
    expect(visitorForwardedAddress("  203.0.113.1  ")).toBe("203.0.113.1");
    expect(visitorForwardedAddress("198.51.100.7,")).toBe("198.51.100.7");
    expect(visitorForwardedAddress(" , 198.51.100.7 , ")).toBe("198.51.100.7");
  });

  it("returns null when there is no forwarded address", () => {
    expect(visitorForwardedAddress(null)).toBeNull();
    expect(visitorForwardedAddress(undefined)).toBeNull();
    expect(visitorForwardedAddress("")).toBeNull();
    expect(visitorForwardedAddress("   ")).toBeNull();
    expect(visitorForwardedAddress(", ,")).toBeNull();
  });
});
