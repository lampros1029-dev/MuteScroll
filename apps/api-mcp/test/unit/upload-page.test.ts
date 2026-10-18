import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { messagePageHtml, uploadPageCsp, uploadPageHtml } from "../../src/upload/page.js";

const ICON_RECTS = [
  '<rect width="64" height="64" rx="14" fill="#1d1b16"/>',
  '<rect x="12" y="16" width="40" height="6" rx="3" fill="#f6f2ea"/>',
  '<rect x="12" y="29" width="26" height="6" rx="3" fill="#ff8a5c"/>',
  '<rect x="12" y="42" width="34" height="6" rx="3" fill="#f6f2ea" opacity="0.55"/>',
];

function inlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  expect(match?.[1]).toBeTruthy();
  return match?.[1] ?? "";
}

describe("upload page copy", () => {
  it("renders the MuteScroll one-time upload with the real file rules", () => {
    const html = uploadPageHtml(2 * 1024 ** 3);

    expect(html).toContain("MuteScroll");
    expect(html).toContain("One-time upload");
    expect(html).toContain("This is the one-time upload.");
    expect(html).toContain("Choose a file");
    expect(html).toContain("No file chosen");
    expect(html).toContain("Accepted: MP4, MOV, WebM, M4A, MP3, WAV.");
    expect(html).toContain("Maximum size: 2048 MB.");
    expect(html).toContain('id="file"');
    expect(html).toContain('type="file"');
    expect(html).toContain('id="filename"');
    expect(html).toContain('id="send"');
    expect(html).toContain("viewBox=\"0 0 64 64\"");
    for (const rect of ICON_RECTS) expect(html).toContain(rect);

    expect(html).toContain("background:#14130f");
    expect(html).toContain("color:#f6f2ea");
    expect(html).toMatch(/#send\{[^}]*background:#ff8a5c/);
    expect(html).toMatch(/#send\{[^}]*color:#1d1b16/);
    const height = html.match(/#send\{[^}]*min-height:(\d+)px/);
    expect(height).toBeTruthy();
    expect(Number(height?.[1])).toBeGreaterThanOrEqual(44);
    expect(html).toContain("clip:rect(0,0,0,0)");

    expect(html).not.toContain("any public video link");
    expect(html.toLowerCase()).not.toMatch(/youtube|youtu\.be|vimeo|tiktok|instagram|facebook|twitch|dailymotion/);
    expect(html).not.toMatch(/<link\b|fonts\.googleapis|fonts\.gstatic|tailwind|cdn\./i);
    expect(html).not.toMatch(/(src|href)="https?:/);
  });

  it("prints the size limit it was given", () => {
    expect(uploadPageHtml(10 * 1024 * 1024)).toContain("Maximum size: 10 MB.");
    expect(uploadPageHtml(10 * 1024 * 1024)).not.toContain("2048");
  });

  it("keeps the content security policy hash equal to the inline script", () => {
    const script = inlineScript(uploadPageHtml(2 * 1024 ** 3));
    const hash = createHash("sha256").update(script, "utf8").digest("base64");
    expect(uploadPageCsp()).toContain(`script-src 'sha256-${hash}'`);
    expect(script).toContain('getElementById("filename")');
    expect(script).toContain("name.textContent = file ? file.name : \"No file chosen\"");
  });

  it("uses the same dark MuteScroll page for an invalid link", () => {
    const html = messagePageHtml("Link not found", "This upload link is invalid or has expired. Ask your assistant for a new one.");
    expect(html).toContain("background:#14130f");
    expect(html).toContain("MuteScroll");
    expect(html).toContain(ICON_RECTS[2]);
    expect(html).not.toContain("<script>");
  });
});
