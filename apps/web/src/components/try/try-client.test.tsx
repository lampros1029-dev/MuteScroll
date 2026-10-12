// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TryClient } from "./try-client";

const LINK = "https://www.youtube.com/watch?v=abcdefghijk";

const transcription = {
  metadata: { platform: "youtube", content_type: "video", title: "Captions example", author: null, duration_seconds: 58 },
  language: "en",
  method: "captions",
  transcript_text: "[00:00] Hello $10 world",
  segments: [{ start: 0, end: 5, speaker: null, text: "Hello $10 world" }],
  uncertain_spans: [],
  on_screen_references: [],
  credits_charged: 1,
};

function jsonResponse(status: number, body: unknown): Response {
  return { status, text: async () => JSON.stringify(body) } as unknown as Response;
}

describe("TryClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/try");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts a link, polls while processing, then shows the transcript and the address of the job", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(202, { status: "processing", job_id: "job-abcdef12" }))
      .mockResolvedValueOnce(jsonResponse(202, { status: "processing", job_id: "job-abcdef12" }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "completed", job_id: "job-abcdef12", transcription }));

    render(<TryClient initialUrl={LINK} pollIntervalMs={1} maxWaitMs={60_000} />);

    expect(await screen.findByRole("heading", { level: 2, name: "Captions example" })).toBeTruthy();
    expect(screen.getByText("Transcript ready.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy as Markdown" })).toBeTruthy();

    const posted = fetchMock.mock.calls[0];
    expect(posted?.[0]).toBe("/api/v1/transcriptions");
    expect(JSON.parse(String((posted?.[1] as RequestInit).body))).toEqual({ url: LINK, language: "auto" });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/v1/transcriptions/job-abcdef12");
    expect(window.location.search).toBe(`?url=${encodeURIComponent(LINK)}&job=job-abcdef12`);
    expect(screen.getByRole("link", { name: "TXT" }).getAttribute("href")).toBe(
      "/api/v1/transcriptions/job-abcdef12/export?format=txt",
    );
  });

  it("shows the API message and an upload box when retrieval fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(502, {
        error: {
          code: "retrieval_failed",
          message: "I couldn't retrieve this video right now. Upload the file here.",
          upload_url: "https://api.example/upload/token",
        },
      }),
    );

    render(<TryClient />);
    fireEvent.change(screen.getByLabelText("Video link"), { target: { value: "https://www.tiktok.com/@a/video/123456789" } });
    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));

    expect(await screen.findByRole("heading", { level: 2, name: "We couldn't retrieve this video" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("I couldn't retrieve this video right now.");
    expect(screen.getByRole("heading", { level: 2, name: "Upload the file instead" })).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("explains quota problems with a link to plans and no upload offer", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { error: { code: "quota_exceeded", message: "You've used this period's transcriptions." } }),
    );

    render(<TryClient />);
    fireEvent.change(screen.getByLabelText("Video link"), { target: { value: LINK } });
    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Your limit is reached" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "See plans and limits" }).getAttribute("href")).toBe("/pricing");
  });

  it("rejects an invalid link before calling the API", () => {
    render(<TryClient />);
    fireEvent.change(screen.getByLabelText("Video link"), { target: { value: "not a link" } });
    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));
    expect(screen.getByText(/Paste a full link that starts with https/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported file types locally", () => {
    const { container } = render(<TryClient />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "notes.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText(/This file type isn't supported/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up politely when the job runs past the wait limit", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(202, { status: "processing", job_id: "job-timeout1" }))
      .mockResolvedValue(jsonResponse(202, { status: "processing", job_id: "job-timeout1" }));

    render(<TryClient initialUrl={LINK} pollIntervalMs={1} maxWaitMs={0} />);

    expect(await screen.findByRole("heading", { level: 2, name: "Still working on it" })).toBeTruthy();
    expect(screen.getByText(/We stopped checking after 10 minutes/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("resumes an existing job from the address without posting again", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: "completed", job_id: "job-resume01", transcription }),
    );

    render(<TryClient initialJobId="job-resume01" pollIntervalMs={1} maxWaitMs={60_000} />);

    expect(await screen.findByRole("heading", { level: 2, name: "Captions example" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/transcriptions/job-resume01");
  });

  it("does not start a request for an unusable address-bar link", async () => {
    render(<TryClient initialUrl="javascript:alert(1)" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Video link") as HTMLInputElement).value).toBe("javascript:alert(1)");
  });
});
