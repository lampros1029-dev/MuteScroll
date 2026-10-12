import { describe, expect, it } from "vitest";

import { formatClock, formatCredits, formatDuration, formatTimestamp, formatUsd, languageName } from "./format";

describe("formatTimestamp", () => {
  it("uses [MM:SS] under one hour", () => {
    expect(formatTimestamp(0, 58)).toBe("[00:00]");
    expect(formatTimestamp(12.9, 58)).toBe("[00:12]");
    expect(formatTimestamp(65, 300)).toBe("[01:05]");
  });

  it("switches to [HH:MM:SS] once the total reaches one hour", () => {
    expect(formatTimestamp(0, 3600)).toBe("[00:00:00]");
    expect(formatTimestamp(3725, 3725)).toBe("[01:02:05]");
  });

  it("treats invalid input as zero instead of throwing", () => {
    expect(formatTimestamp(Number.NaN, 10)).toBe("[00:00]");
    expect(formatTimestamp(-4, 10)).toBe("[00:00]");
  });
});

describe("formatClock and formatDuration", () => {
  it("formats clocks without brackets", () => {
    expect(formatClock(9, 30)).toBe("00:09");
    expect(formatClock(4000, 4000)).toBe("01:06:40");
  });

  it("formats durations for metadata", () => {
    expect(formatDuration(58)).toBe("0:58");
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(3725)).toBe("1:02:05");
  });
});

describe("formatCredits", () => {
  it("pluralises credits", () => {
    expect(formatCredits(1)).toBe("1 credit");
    expect(formatCredits(0)).toBe("0 credits");
    expect(formatCredits(5)).toBe("5 credits");
  });
});

describe("languageName", () => {
  it("returns display names and falls back to the code", () => {
    expect(languageName("el")).toBe("Greek");
    expect(languageName("en")).toBe("English");
    expect(languageName(null)).toBeNull();
    expect(languageName("  ")).toBeNull();
  });
});

describe("formatUsd", () => {
  it("drops cents for whole amounts and keeps them otherwise", () => {
    expect(formatUsd(59)).toBe("$59");
    expect(formatUsd(7.99)).toBe("$7.99");
    expect(formatUsd(4.92)).toBe("$4.92");
  });
});
