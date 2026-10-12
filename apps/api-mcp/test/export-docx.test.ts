import { crc32, inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { EXPORT_FORMATS, parseExportFormat, renderExport } from "../src/export/formatters.js";
import type { Transcription } from "../src/export/model.js";

function transcription(overrides: Partial<Transcription> = {}): Transcription {
  return {
    metadata: { platform: "youtube", content_type: "video", title: "Demo video", author: "Someone", duration_seconds: 9 },
    language: "en",
    method: "asr",
    transcript_text: "unused for docx",
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

function unzip(body: string): Map<string, Buffer> {
  const zip = Buffer.from(body, "latin1");
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = zip.readUInt16LE(eocd + 10);
  let central = zip.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    expect(zip.readUInt32LE(central)).toBe(0x02014b50);
    const method = zip.readUInt16LE(central + 10);
    const checksum = zip.readUInt32LE(central + 16);
    const compressedSize = zip.readUInt32LE(central + 20);
    const nameLength = zip.readUInt16LE(central + 28);
    const extraLength = zip.readUInt16LE(central + 30);
    const commentLength = zip.readUInt16LE(central + 32);
    const localOffset = zip.readUInt32LE(central + 42);
    const name = zip.subarray(central + 46, central + 46 + nameLength).toString("utf8");
    expect(zip.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    const raw = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
    expect(crc32(raw) >>> 0).toBe(checksum);
    files.set(name, raw);
    central += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

describe("docx export", () => {
  it("accepts docx and serves the WordprocessingML content type", () => {
    expect(EXPORT_FORMATS).toContain("docx");
    expect(parseExportFormat("docx")).toBe("docx");
    expect(parseExportFormat("DOCX")).toBeNull();
    const rendered = renderExport("docx", transcription());
    expect(rendered.contentType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(rendered.encoding).toBe("latin1");
    expect(renderExport("txt", transcription()).encoding).toBeUndefined();
  });

  it("is a zip of the three Office Open XML parts", () => {
    const files = unzip(renderExport("docx", transcription()).body);
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
    const types = files.get("[Content_Types].xml")?.toString("utf8") ?? "";
    expect(types).toContain('PartName="/word/document.xml"');
    expect(types).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
    expect(files.get("_rels/.rels")?.toString("utf8")).toContain('Target="word/document.xml"');
    expect(crc32(Buffer.from("123456789")) >>> 0).toBe(0xcbf43926);
  });

  it("writes the title, then each segment as a paragraph with a monospace timestamp", () => {
    const xml = unzip(renderExport("docx", transcription()).body).get("word/document.xml")?.toString("utf8") ?? "";
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("Demo video");
    expect(xml).toContain('w:ascii="Courier New"');
    expect(xml.indexOf("Demo video")).toBeLessThan(xml.indexOf("[00:00]"));
    expect(xml).toContain("[00:00]");
    expect(xml).toContain(" Hello there");
    expect(xml).toContain("[00:02]");
    expect(xml).toContain(" Second line");
    expect(xml.match(/<w:p>/g)).toHaveLength(3);
  });

  it("omits the title paragraph when the title is missing", () => {
    const xml = unzip(renderExport("docx", transcription({
      metadata: { platform: "youtube", content_type: null, title: "   ", author: null, duration_seconds: 9 },
    })).body).get("word/document.xml")?.toString("utf8") ?? "";
    expect(xml).not.toContain("<w:b/>");
    expect(xml).not.toContain("Transcript");
    expect(xml.match(/<w:p>/g)).toHaveLength(2);
  });

  it("escapes XML and keeps every word and number in the segment text", () => {
    const text = "Call 1-800-555-0199 about item #42 (3.5x) and $10.00 — Tom & Jerry <3, don't drop words";
    const xml = unzip(renderExport("docx", transcription({
      segments: [{ start: 0, end: 4, speaker: "Room 101", text }],
    })).body).get("word/document.xml")?.toString("utf8") ?? "";
    expect(xml).toContain(" Room 101: Call 1-800-555-0199 about item #42 (3.5x) and $10.00 — Tom &amp; Jerry &lt;3, don't drop words");
    expect(xml).not.toContain("Tom & Jerry");
    expect(xml.match(/<w:p>/g)).toHaveLength(2);
  });

  it("uses an hour clock once the transcript is an hour or longer", () => {
    const xml = unzip(renderExport("docx", transcription({
      metadata: { platform: "youtube", content_type: "video", title: null, author: null, duration_seconds: 3661 },
      segments: [{ start: 61, end: 62, speaker: null, text: "still 42 words here" }],
    })).body).get("word/document.xml")?.toString("utf8") ?? "";
    expect(xml).toContain("[00:01:01]");
    expect(xml).toContain("still 42 words here");
  });
});
