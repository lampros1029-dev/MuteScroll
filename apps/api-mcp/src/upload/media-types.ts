/**
 * Upload validation (PRD 6, 14): extension allow-list, declared MIME, and magic bytes.
 * The client file name only contributes an extension; it is never used as a path.
 */

export const ALLOWED_EXTENSIONS = ["mp4", "mov", "webm", "m4a", "mp3", "wav"] as const;
export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mp4",
  "audio/x-m4a",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "application/octet-stream",
  "",
]);

/** Container families recognised from the first bytes of the file. */
export type ContainerFamily = "iso-bmff" | "ebml-webm" | "mpeg-audio" | "riff-wave";

const EXTENSION_FAMILY: Readonly<Record<AllowedExtension, ContainerFamily>> = {
  mp4: "iso-bmff",
  mov: "iso-bmff",
  m4a: "iso-bmff",
  webm: "ebml-webm",
  mp3: "mpeg-audio",
  wav: "riff-wave",
};

export const SNIFF_BYTES = 16;

export function extensionOf(fileName: string): AllowedExtension | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext) ? (ext as AllowedExtension) : null;
}

export function isAllowedMimeType(contentType: string | undefined): boolean {
  const base = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return ALLOWED_MIME_TYPES.has(base);
}

/** Identifies the container from its first bytes. Returns null for anything unrecognised. */
export function sniffContainer(head: Uint8Array): ContainerFamily | null {
  if (head.length >= 8 && ascii(head, 4, 8) === "ftyp") return "iso-bmff";
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return "ebml-webm";
  }
  if (head.length >= 3 && ascii(head, 0, 3) === "ID3") return "mpeg-audio";
  if (head.length >= 2 && head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) return "mpeg-audio";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE") return "riff-wave";
  return null;
}

/** True when the extension and the sniffed container agree (e.g. `.mp3` must really be MPEG audio). */
export function containerMatchesExtension(ext: AllowedExtension, family: ContainerFamily): boolean {
  return EXTENSION_FAMILY[ext] === family;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
