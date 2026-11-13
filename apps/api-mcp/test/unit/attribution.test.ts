import { describe, expect, it } from "vitest";
import { parseAttributionData, parseAttributionFromCustomData } from "../../src/attribution/sanitize.js";

describe("attribution", () => {
  describe("parseAttributionData", () => {
    it("should parse valid UTM parameters", () => {
      const result = parseAttributionData({
        utmSource: "Google",
        utmMedium: "CPC",
        utmCampaign: "Spring Sale",
        utmContent: "banner-ad",
        utmTerm: "transcription software",
        referrerHost: "google.com",
        landingPath: "/pricing",
        capturedAt: 1000000,
      });

      expect(result).toEqual({
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "spring sale",
        utmContent: "banner-ad",
        utmTerm: "transcription software",
        referrerHost: "google.com",
        landingPath: "/pricing",
        capturedAt: 1000000,
      });
    });

    it("should return null when no valid UTM params", () => {
      const result = parseAttributionData({
        referrerHost: "google.com",
        landingPath: "/pricing",
        capturedAt: 1000000,
      });

      expect(result).toBeNull();
    });

    it("should sanitize junk values", () => {
      const result = parseAttributionData({
        utmSource: "null",
        utmMedium: "undefined",
        utmCampaign: "real-campaign",
        capturedAt: 1000000,
      });

      expect(result).toEqual({
        utmSource: null,
        utmMedium: null,
        utmCampaign: "real-campaign",
        utmContent: null,
        utmTerm: null,
        referrerHost: null,
        landingPath: null,
        capturedAt: 1000000,
      });
    });

    it("should trim and lowercase UTM params", () => {
      const result = parseAttributionData({
        utmSource: "  TWITTER  ",
        utmMedium: "  Social  ",
        utmCampaign: "  Launch  ",
        capturedAt: 1000000,
      });

      expect(result).toEqual({
        utmSource: "twitter",
        utmMedium: "social",
        utmCampaign: "launch",
        utmContent: null,
        utmTerm: null,
        referrerHost: null,
        landingPath: null,
        capturedAt: 1000000,
      });
    });

    it("should reject overly long values", () => {
      const longValue = "a".repeat(101);
      const result = parseAttributionData({
        utmSource: longValue,
        utmMedium: "valid",
        capturedAt: 1000000,
      });

      expect(result).toEqual({
        utmSource: null,
        utmMedium: "valid",
        utmCampaign: null,
        utmContent: null,
        utmTerm: null,
        referrerHost: null,
        landingPath: null,
        capturedAt: 1000000,
      });
    });
  });

  describe("parseAttributionFromCustomData", () => {
    it("should parse valid custom_data object", () => {
      const result = parseAttributionFromCustomData({
        utm_source: "email",
        utm_medium: "newsletter",
        utm_campaign: "weekly-digest",
        referrer_host: "newsletter.example.com",
        landing_path: "/features",
      });

      expect(result).toEqual({
        utmSource: "email",
        utmMedium: "newsletter",
        utmCampaign: "weekly-digest",
        utmContent: null,
        utmTerm: null,
        referrerHost: "newsletter.example.com",
        landingPath: "/features",
      });
    });

    it("should return null for empty custom_data", () => {
      const result = parseAttributionFromCustomData({});
      expect(result).toBeNull();
    });

    it("should return null for non-object input", () => {
      expect(parseAttributionFromCustomData(null)).toBeNull();
      expect(parseAttributionFromCustomData("string")).toBeNull();
      expect(parseAttributionFromCustomData(123)).toBeNull();
    });

    it("should handle partial data", () => {
      const result = parseAttributionFromCustomData({
        utm_source: "direct",
        other_field: "ignored",
      });

      expect(result).toEqual({
        utmSource: "direct",
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
        utmTerm: null,
        referrerHost: null,
        landingPath: null,
      });
    });
  });
});
