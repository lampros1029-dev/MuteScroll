import { describe, expect, it } from "vitest";

import { escapeVtt, formatSrt, parseExportFormat, renderExport } from "../../src/export/formatters.js";
import type { Transcription } from "../../src/export/model.js";
import { clockFromSeconds, secondsToMs, srtTimestamp, vttTimestamp } from "../../src/export/timestamps.js";

function transcription(overrides: Partial<Transcription> = {}): Transcription {
  return {
    metadata: { platform: "youtube", content_type: "video", title: "Demo video", author: "Someone", duration_seconds: 9 },
    language: "en",
    method: "asr",
    transcript_text: "[00:00] Hello there\n[00:02] Second line",
    segments: [
      { start: 0, end: 2, speaker: null, text: "Hello there" },
      { start: 2, end: 9, speaker: null, text: "Second line" },
    ],
    uncertain_spans: [],
    on_screen_references: [],
    credits_charged: 1,
    ...overrides,
  };
}

describe("timestamps", () => {
  it("writes SubRip times with a comma and VTT times with a dot", () => {
    expect(srtTimestamp(3_723_004)).toBe("01:02:03,004");
    expect(vttTimestamp(3_723_004)).toBe("01:02:03.004");
    expect(srtTimestamp(0)).toBe("00:00:00,000");
  });

  it("keeps counting hours past 99 and clamps bad input to zero", () => {
    expect(srtTimestamp(100 * 3_600_000)).toBe("100:00:00,000");
    expect(srtTimestamp(-5)).toBe("00:00:00,000");
    expect(vttTimestamp(Number.NaN)).toBe("00:00:00.000");
  });

  it("converts seconds to whole milliseconds and labels clock time", () => {
    expect(secondsToMs(1.2346)).toBe(1235);
    expect(secondsToMs(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clockFromSeconds(3725)).toBe("01:02:05");
  });
});

describe("SRT and VTT output", () => {
  const segments = [
    { start: 0, end: 2, speaker: null, text: "Hello there" },
    { start: 2, end: 4.5, speaker: "SPEAKER_1", text: "Second   line\n" },
  ];

  it("renders numbered SubRip cues with millisecond times", () => {
    expect(renderExport("srt", transcription({ segments })).body).toBe(
      "1\n00:00:00,000 --> 00:00:02,000\nHello there\n\n2\n00:00:02,000 --> 00:00:04,500\nSPEAKER_1: Second line\n",
    );
  });

  it("renders a WebVTT file with a header and dot times", () => {
    expect(renderExport("vtt", transcription({ segments })).body).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello there\n\n00:00:02.000 --> 00:00:04.500\nSPEAKER_1: Second line\n",
    );
  });

  it("never invents speaker names: a null speaker prints no label", () => {
    const body = renderExport("srt", transcription({ segments: [{ start: 0, end: 1, speaker: null, text: "Solo" }] })).body;
    expect(body).toBe("1\n00:00:00,000 --> 00:00:01,000\nSolo\n");
    expect(body).not.toMatch(/Speaker/i);
  });

  it("drops empty segments and produces an empty SRT or a bare VTT header when nothing is left", () => {
    const blank = [{ start: 0, end: 1, speaker: null, text: "   " }];
    expect(renderExport("srt", transcription({ segments: blank })).body).toBe("");
    expect(renderExport("vtt", transcription({ segments: [] })).body).toBe("WEBVTT\n\n");
  });

  it("stretches zero-length segments to the minimum cue length without overlap", () => {
    const body = formatSrt(
      [
        { startMs: 0, endMs: 500, text: "a" },
        { startMs: 500, endMs: 1000, text: "b" },
      ],
    );
    expect(body).toBe("1\n00:00:00,000 --> 00:00:00,500\na\n\n2\n00:00:00,500 --> 00:00:01,000\nb\n");
    const shaped = renderExport("srt", transcription({ segments: [{ start: 0, end: 0, speaker: null, text: "a" }, { start: 0, end: 1, speaker: null, text: "b" }] })).body;
    expect(shaped).toContain("1\n00:00:00,000 --> 00:00:00,500\na\n");
    expect(shaped).toContain("2\n00:00:00,500 --> 00:00:01,000\nb\n");
  });

  it("moves an overlapping segment after the previous cue instead of overlapping it", () => {
    const shaped = renderExport("vtt", transcription({ segments: [
      { start: 0, end: 5, speaker: null, text: "first" },
      { start: 3, end: 4, speaker: null, text: "second" },
    ] })).body;
    expect(shaped).toContain("00:00:00.000 --> 00:00:05.000\nfirst");
    expect(shaped).toContain("00:00:05.000 --> 00:00:05.500\nsecond");
  });

  it("splits a long segment into several cues that cover it in order", () => {
    const words = Array.from({ length: 30 }, (_, index) => `word${index}`);
    const body = renderExport("srt", transcription({ segments: [{ start: 0, end: 20, speaker: null, text: words.join(" ") }] })).body;
    const cues = body.trim().split("\n\n").map((block) => block.split("\n"));
    expect(cues.length).toBeGreaterThanOrEqual(3);
    expect(cues[0]?.[1]?.startsWith("00:00:00,000 --> ")).toBe(true);
    expect(cues.at(-1)?.[1]?.split(" --> ")[1]).toBe("00:00:20,000");
    const spoken = cues.map((block) => block.slice(2).join(" ")).join(" ");
    expect(spoken).toBe(words.join(" "));
  });

  it("splits a text-heavy short segment so no cue is much longer than two subtitle lines", () => {
    const text = Array.from({ length: 40 }, () => "lorem").join(" ");
    const body = renderExport("srt", transcription({ segments: [{ start: 0, end: 3, speaker: null, text }] })).body;
    for (const block of body.trim().split("\n\n")) {
      expect(block.split("\n")[2]?.length ?? 0).toBeLessThanOrEqual(90);
    }
  });

  it("escapes markup in VTT cue text", () => {
    expect(escapeVtt("Tom & Jerry <3 --> ok")).toBe("Tom &amp; Jerry &lt;3 --&gt; ok");
    const body = renderExport("vtt", transcription({ segments: [{ start: 0, end: 1, speaker: null, text: "a < b" }] })).body;
    expect(body).toContain("a &lt; b");
  });

  it("builds cues in timeline order even when the worker lists segments out of order", () => {
    const body = renderExport("srt", transcription({ segments: [
      { start: 5, end: 6, speaker: null, text: "later" },
      { start: 1, end: 2, speaker: null, text: "earlier" },
    ] })).body;
    expect(body.indexOf("earlier")).toBeLessThan(body.indexOf("later"));
  });
});

describe("markdown, text and JSON output", () => {
  it("renders a title heading, a metadata line and timestamped paragraphs", () => {
    expect(renderExport("md", transcription()).body).toBe(
      "# Demo video\n\nyoutube · by Someone · language en · method asr · duration 00:00:09\n\n[00:00] Hello there\n\n[00:02] Second line\n",
    );
  });

  it("escapes markdown characters in the title and author", () => {
    const body = renderExport("md", transcription({ metadata: { platform: "tiktok", content_type: null, title: "A *bold* [x]", author: "_me_", duration_seconds: null } })).body;
    expect(body.startsWith("# A \\*bold\\* \\[x\\]\n")).toBe(true);
    expect(body).toContain("by \\_me\\_");
  });

  it("falls back to the transcript text when there are no segments, and names an untitled transcript", () => {
    const body = renderExport("md", transcription({ segments: [], metadata: { platform: "instagram", content_type: null, title: null, author: null, duration_seconds: null } })).body;
    expect(body.startsWith("# Transcript\n")).toBe(true);
    expect(body).toContain("[00:00] Hello there\n[00:02] Second line");
  });

  it("renders plain text as transcript_text with one trailing newline", () => {
    expect(renderExport("txt", transcription()).body).toBe("[00:00] Hello there\n[00:02] Second line\n");
    expect(renderExport("txt", transcription({ transcript_text: "done\n" })).body).toBe("done\n");
  });

  it("renders JSON as the Transcription object", () => {
    const value = transcription();
    expect(JSON.parse(renderExport("json", value).body)).toEqual(value);
  });

  it("reports the content type for each format", () => {
    expect(renderExport("srt", transcription()).contentType).toBe("application/x-subrip; charset=utf-8");
    expect(renderExport("vtt", transcription()).contentType).toBe("text/vtt; charset=utf-8");
    expect(renderExport("md", transcription()).contentType).toBe("text/markdown; charset=utf-8");
    expect(renderExport("txt", transcription()).contentType).toBe("text/plain; charset=utf-8");
    expect(renderExport("json", transcription()).contentType).toBe("application/json; charset=utf-8");
  });
});

describe("parseExportFormat", () => {
  it("defaults to txt and accepts only the documented lower-case formats", () => {
    expect(parseExportFormat(undefined)).toBe("txt");
    expect(parseExportFormat("srt")).toBe("srt");
    expect(parseExportFormat("json")).toBe("json");
    expect(parseExportFormat("pdf")).toBeNull();
    expect(parseExportFormat("SRT")).toBeNull();
    expect(parseExportFormat("")).toBeNull();
  });
});
