import { describe, expect, it } from "vitest";

import type { Transcription } from "../api/types";

import { buildMarkdown, buildPlainText } from "./markdown";
import { splitByUncertainty } from "./uncertainty";
import { nearestSegmentIndex, reasonExplanation, speakerLabel, speakerNumbers } from "./view-model";
import { youtubeTimeLink, youtubeVideoId } from "./youtube";

const SPOKEN = "Set the Lumix S5 to ISO 400, then pay $10 for the kit.";

function sample(overrides: Partial<Transcription> = {}): Transcription {
  return {
    metadata: { platform: "tiktok", content_type: "video", title: "Hooks", author: "@creator", duration_seconds: 74 },
    language: "en",
    method: "asr",
    transcript_text: "[00:00] Speaker 1: Hello\n[00:07] Speaker 2: Hi",
    segments: [
      { start: 0, end: 7.5, speaker: "SPEAKER_0", text: "Hello $10" },
      { start: 7.5, end: 15.2, speaker: "SPEAKER_1", text: "Hi" },
      { start: 15.2, end: 30, speaker: "SPEAKER_0", text: SPOKEN },
    ],
    uncertain_spans: [{ start: 16, end: 18, text: "Lumix S5", reason: "low_confidence" }],
    on_screen_references: [],
    credits_charged: 1,
    ...overrides,
  };
}

describe("splitByUncertainty", () => {
  const segment = { start: 15.2, end: 30 };

  it("splits text around the flagged words without changing them", () => {
    const pieces = splitByUncertainty(SPOKEN, segment, sample().uncertain_spans);
    expect(pieces.map((piece) => piece.text).join("")).toBe(SPOKEN);
    const flagged = pieces.filter((piece) => piece.flag !== null);
    expect(flagged.map((piece) => piece.text)).toEqual(["Lumix S5"]);
    expect(flagged[0]?.flag?.reason).toBe("low_confidence");
  });

  it("matches case-insensitively and keeps the original casing of the text", () => {
    const pieces = splitByUncertainty("the lumix s5 is here", segment, [
      { start: 16, end: 18, text: "Lumix S5", reason: "low_confidence" },
    ]);
    expect(pieces).toEqual([
      { text: "the ", flag: null },
      { text: "lumix s5", flag: { start: 16, end: 18, text: "Lumix S5", reason: "low_confidence" } },
      { text: " is here", flag: null },
    ]);
  });

  it("ignores spans outside the segment's time range", () => {
    const pieces = splitByUncertainty(SPOKEN, { start: 0, end: 5 }, sample().uncertain_spans);
    expect(pieces).toEqual([{ text: SPOKEN, flag: null }]);
  });

  it("leaves text alone when the flagged words are not in the segment", () => {
    const pieces = splitByUncertainty("Nothing to see", { start: 0, end: 10 }, [
      { start: 1, end: 2, text: "Kestrel", reason: "low_confidence" },
    ]);
    expect(pieces).toEqual([{ text: "Nothing to see", flag: null }]);
  });

  it("escapes regular-expression characters in the flagged text", () => {
    const pieces = splitByUncertainty("Price (approx.) is $10?", { start: 0, end: 10 }, [
      { start: 1, end: 2, text: "(approx.)", reason: "low_confidence" },
    ]);
    expect(pieces.map((piece) => piece.text)).toEqual(["Price ", "(approx.)", " is $10?"]);
  });

  it("handles Greek text", () => {
    const greek = "Σήμερα μιλάμε για artificial intelligence.";
    const pieces = splitByUncertainty(greek, { start: 0, end: 5 }, [
      { start: 1, end: 3, text: "artificial intelligence", reason: "low_confidence_segment" },
    ]);
    expect(pieces.map((piece) => piece.text).join("")).toBe(greek);
    expect(pieces.at(-1)?.text).toBe(".");
  });
});

describe("speaker numbering", () => {
  it("numbers speakers by first appearance and never exposes raw labels", () => {
    const transcription = sample();
    const numbers = speakerNumbers(transcription.segments);
    expect(speakerLabel("SPEAKER_0", numbers)).toBe("Speaker 1");
    expect(speakerLabel("SPEAKER_1", numbers)).toBe("Speaker 2");
    expect(speakerLabel(null, numbers)).toBeNull();
    expect(speakerLabel("SPEAKER_9", numbers)).toBeNull();
  });
});

describe("nearestSegmentIndex", () => {
  it("returns the segment that contains a time, or the closest one", () => {
    const segments = sample().segments;
    expect(nearestSegmentIndex(segments, 8)).toBe(1);
    expect(nearestSegmentIndex(segments, 17)).toBe(2);
    expect(nearestSegmentIndex(segments, 500)).toBe(2);
    expect(nearestSegmentIndex([], 3)).toBe(-1);
  });
});

describe("reasonExplanation", () => {
  it("explains known reasons and falls back for unknown ones", () => {
    expect(reasonExplanation("low_confidence")).toContain("unsure");
    expect(reasonExplanation("low_confidence_segment")).toContain("whole sentence");
    expect(reasonExplanation("something_new")).toContain("flagged");
  });
});

describe("buildMarkdown", () => {
  it("writes a title heading, a metadata line and timestamped lines", () => {
    const markdown = buildMarkdown(sample(), { sourceUrl: "https://www.tiktok.com/@creator/video/123456789" });
    const lines = markdown.split("\n");
    expect(lines[0]).toBe("# Hooks");
    expect(lines[2]).toBe(
      "Platform: TikTok · Author: @creator · Duration: 1:14 · Language: English · Method: Speech recognition · Source: https://www.tiktok.com/@creator/video/123456789",
    );
    expect(lines).toContain("[00:00] Speaker 1: Hello $10");
    expect(lines).toContain("[00:07] Speaker 2: Hi");
    expect(lines).toContain(`[00:15] Speaker 1: ${SPOKEN}`);
  });

  it("keeps numbers exactly as spoken", () => {
    const markdown = buildMarkdown(sample());
    expect(markdown).toContain("$10");
    expect(markdown).toContain("ISO 400");
    expect(markdown).not.toContain("$100");
  });

  it("uses hour timestamps for long videos and a fallback title", () => {
    const markdown = buildMarkdown(
      sample({
        metadata: { platform: "facebook", content_type: null, title: null, author: null, duration_seconds: 3725 },
        segments: [{ start: 3700, end: 3725, speaker: null, text: "Thank you." }],
      }),
    );
    expect(markdown.startsWith("# Transcript\n")).toBe(true);
    expect(markdown).toContain("[01:01:40] Thank you.");
  });

  it("falls back to the plain transcript text when there are no segments", () => {
    const transcription = sample({ segments: [], transcript_text: "[00:00] Only text\n\n[00:03] Lines" });
    expect(buildMarkdown(transcription)).toContain("[00:00] Only text\n[00:03] Lines");
  });
});

describe("buildPlainText", () => {
  it("returns the server's transcript text unchanged when it exists", () => {
    expect(buildPlainText(sample())).toBe("[00:00] Speaker 1: Hello\n[00:07] Speaker 2: Hi");
  });

  it("builds text from segments when the transcript text is empty", () => {
    const text = buildPlainText(sample({ transcript_text: " " }));
    expect(text.split("\n")[0]).toBe("[00:00] Hello $10");
  });
});

describe("YouTube timestamp links", () => {
  it("recognises watch, short-link, shorts and embed URLs", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=abcdefghijk&t=5")).toBe("abcdefghijk");
    expect(youtubeVideoId("https://youtu.be/abcdefghijk")).toBe("abcdefghijk");
    expect(youtubeVideoId("https://www.youtube.com/shorts/abcdefghijk")).toBe("abcdefghijk");
    expect(youtubeVideoId("https://www.youtube.com/embed/abcdefghijk")).toBe("abcdefghijk");
    expect(youtubeVideoId("https://www.youtube.com/@channel")).toBeNull();
    expect(youtubeVideoId("https://example.com/watch?v=abcdefghijk")).toBeNull();
  });

  it("builds a link that opens the video at the segment time", () => {
    expect(youtubeTimeLink("https://youtu.be/abcdefghijk", 12.7)).toBe("https://www.youtube.com/watch?v=abcdefghijk&t=12s");
    expect(youtubeTimeLink("https://www.tiktok.com/@a/video/123456789", 3)).toBeNull();
    expect(youtubeTimeLink(null, 3)).toBeNull();
  });
});
