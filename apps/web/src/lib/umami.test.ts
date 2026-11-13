import { describe, expect, it } from "vitest";

import { umamiWebsiteId } from "./umami";

describe("umami website id", () => {
  it("accepts a website id and ignores an empty or unsafe value", () => {
    expect(umamiWebsiteId("  abcdef01-2345-6789-abcd-ef0123456789 ")).toBe("abcdef01-2345-6789-abcd-ef0123456789");
    expect(umamiWebsiteId(undefined)).toBeUndefined();
    expect(umamiWebsiteId("")).toBeUndefined();
    expect(umamiWebsiteId("https://evil.example/script.js")).toBeUndefined();
  });
});
