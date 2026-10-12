// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Transcription } from "../../lib/api/types";

import { TranscriptView } from "./transcript-view";

const transcription: Transcription = {
  metadata: { platform: "tiktok", content_type: "video", title: "Two voices", author: "@creator", duration_seconds: 74 },
  language: "en",
  method: "asr",
  transcript_text: "",
  segments: [
    { start: 0, end: 7.5, speaker: "SPEAKER_0", text: "Here is the hook that got three million views." },
    { start: 7.5, end: 15.2, speaker: "SPEAKER_1", text: "Which one? The one with the blue kettle." },
    { start: 15.2, end: 30, speaker: "SPEAKER_1", text: "We used Kestrel's pricing page for $10 a month." },
  ],
  uncertain_spans: [{ start: 16, end: 20, text: "Kestrel's pricing page", reason: "low_confidence_segment" }],
  on_screen_references: [{ at: 16.5, phrase: "link in my bio" }],
  credits_charged: 1,
};

describe("TranscriptView", () => {
  it("shows the title, byline and facts", () => {
    render(<TranscriptView transcription={transcription} />);
    expect(screen.getByRole("heading", { level: 2, name: "Two voices" })).toBeTruthy();
    expect(screen.getByText("By @creator")).toBeTruthy();
    expect(screen.getByText(/TikTok · Video · 1:14 · English · Speech recognition/)).toBeTruthy();
  });

  it("labels speakers as Speaker N and never shows raw diarization labels", () => {
    const { container } = render(<TranscriptView transcription={transcription} />);
    const speakers = Array.from(container.querySelectorAll(".speaker")).map((node) => node.textContent);
    expect(speakers).toEqual(["Speaker 1", "Speaker 2"]);
    expect(container.textContent).not.toContain("SPEAKER_");
  });

  it("renders timestamps as links to the matching line on the page", () => {
    const { container } = render(<TranscriptView transcription={transcription} />);
    const stamps = Array.from(container.querySelectorAll("a.stamp"));
    expect(stamps.map((node) => node.textContent)).toEqual(["[00:00]", "[00:07]", "[00:15]"]);
    expect(stamps[1]?.getAttribute("href")).toBe("#seg-1");
    expect(container.querySelector("#seg-2")).not.toBeNull();
  });

  it("opens the source video at the line time for YouTube links", () => {
    const { container } = render(
      <TranscriptView
        transcription={{ ...transcription, metadata: { ...transcription.metadata, platform: "youtube" } }}
        sourceUrl="https://youtu.be/abcdefghijk"
      />,
    );
    const first = container.querySelector("a.stamp");
    expect(first?.getAttribute("href")).toBe("https://www.youtube.com/watch?v=abcdefghijk&t=0s");
    expect(first?.getAttribute("target")).toBe("_blank");
    expect(first?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("highlights the uncertain words in place, with an explanation linked to them", () => {
    const { container } = render(<TranscriptView transcription={transcription} />);
    const mark = container.querySelector("mark.flag");
    expect(mark?.textContent).toBe("Kestrel's pricing page");
    const describedBy = mark?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const tip = container.querySelector(`[id="${describedBy}"]`);
    expect(tip?.getAttribute("role")).toBe("tooltip");
    expect(tip?.textContent).toContain("whole sentence");
  });

  it("keeps the spoken text exactly, including numbers", () => {
    render(<TranscriptView transcription={transcription} />);
    expect(screen.getByText(/for \$10 a month\./)).toBeTruthy();
  });

  it("lists flagged words and on-screen references for review", () => {
    render(<TranscriptView transcription={transcription} />);
    const review = screen.getByRole("region", { name: "Review before you quote" });
    const items = within(review).getAllByRole("listitem");
    expect(items.some((item) => item.textContent?.includes("Kestrel's pricing page"))).toBe(true);
    expect(within(review).getByText("link in my bio")).toBeTruthy();
    expect(within(review).getByText("On screen")).toBeTruthy();
  });

  it("hides the review panel in the compact sample variant", () => {
    render(<TranscriptView transcription={transcription} variant="sample" />);
    expect(screen.queryByRole("region", { name: "Review before you quote" })).toBeNull();
  });

  it("falls back to plain lines when the transcript has no segments", () => {
    const { container } = render(
      <TranscriptView transcription={{ ...transcription, segments: [], transcript_text: "[00:00] First\n\n[00:05] Second" }} />,
    );
    const lines = Array.from(container.querySelectorAll(".segment-plain .line")).map((node) => node.textContent);
    expect(lines).toEqual(["[00:00] First", "[00:05] Second"]);
  });
});
