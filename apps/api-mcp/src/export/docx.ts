import { crc32, deflateRawSync } from "node:zlib";

import { formatTimestamp } from "@mutescroll/shared";

import type { Transcription, TranscriptionSegment } from "./model.js";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
`;

const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
`;

/** Fixed DOS stamp (2026-01-01 00:00:00) so the same transcript always zips to the same bytes. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface ZipFile {
  readonly name: string;
  readonly data: Buffer;
}

/** Office Open XML package. `body` is the ZIP bytes as a Latin-1 string (one char per byte). */
export function renderDocx(transcription: Transcription): { readonly body: string; readonly contentType: string } {
  const zip = zipFiles([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(PACKAGE_RELS, "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml(transcription), "utf8") },
  ]);
  return { body: zip.toString("latin1"), contentType: DOCX_CONTENT_TYPE };
}

function documentXml(transcription: Transcription): string {
  const title = transcription.metadata.title?.trim() ?? "";
  const total = totalSeconds(transcription);
  const paragraphs = [
    ...(title === "" ? [] : [titleParagraph(title)]),
    ...transcription.segments.map((segment) => segmentParagraph(segment, total)),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>
`;
}

function titleParagraph(title: string): string {
  return `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(title)}</w:t></w:r></w:p>`;
}

/** Timestamp in a monospace run, then the segment text unchanged (speaker prefix only when one was supplied). */
function segmentParagraph(segment: TranscriptionSegment, totalSeconds: number): string {
  const start = Number.isFinite(segment.start) ? Math.max(0, segment.start) : 0;
  const stamp = formatTimestamp(start, totalSeconds);
  const speaker = segment.speaker !== null && segment.speaker.trim() !== "" ? `${segment.speaker}: ` : "";
  return `<w:p><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/></w:rPr><w:t xml:space="preserve">${escapeXml(stamp)}</w:t></w:r><w:r><w:t xml:space="preserve">${escapeXml(` ${speaker}${segment.text}`)}</w:t></w:r></w:p>`;
}

function totalSeconds(transcription: Transcription): number {
  const declared = transcription.metadata.duration_seconds;
  const fallback = transcription.segments.reduce(
    (latest, segment) => Math.max(latest, Number.isFinite(segment.end) ? segment.end : 0),
    0,
  );
  const chosen = declared ?? fallback;
  return Number.isFinite(chosen) ? Math.max(0, chosen) : 0;
}

/** Escape XML text. Illegal XML 1.0 controls are dropped; words and digits stay. */
function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function zipFiles(files: readonly ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(file.data);
    const checksum = crc32(file.data) >>> 0;
    locals.push(localHeader(name, checksum, compressed.length, file.data.length), compressed);
    centrals.push(centralHeader(name, checksum, compressed.length, file.data.length, offset));
    offset += 30 + name.length + compressed.length;
  }
  const central = Buffer.concat(centrals);
  return Buffer.concat([...locals, central, endOfCentralDirectory(files.length, central.length, offset)]);
}

function localHeader(name: Buffer, checksum: number, compressedSize: number, uncompressedSize: number): Buffer {
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(uncompressedSize, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);
  return header;
}

function centralHeader(name: Buffer, checksum: number, compressedSize: number, uncompressedSize: number, offset: number): Buffer {
  const header = Buffer.alloc(46 + name.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(uncompressedSize, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  name.copy(header, 46);
  return header;
}

function endOfCentralDirectory(count: number, centralSize: number, centralOffset: number): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(count, 8);
  header.writeUInt16LE(count, 10);
  header.writeUInt32LE(centralSize, 12);
  header.writeUInt32LE(centralOffset, 16);
  header.writeUInt16LE(0, 20);
  return header;
}
