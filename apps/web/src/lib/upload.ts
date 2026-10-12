/**
 * Upload rules mirrored from the API (PRD 14, apps/api-mcp media-types). The server is the authority;
 * these checks only give instant feedback and pick a Content-Type the server will accept.
 */

export const ACCEPTED_EXTENSIONS = ["mp4", "mov", "webm", "m4a", "mp3", "wav"] as const;
export type AcceptedExtension = (typeof ACCEPTED_EXTENSIONS)[number];

export const ACCEPTED_LABEL = "MP4, MOV, WebM, M4A, MP3, WAV";

export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(",");

const MIME_BY_EXTENSION: Readonly<Record<AcceptedExtension, string>> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

export function extensionOf(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

export function isAcceptedExtension(extension: string): extension is AcceptedExtension {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension);
}

/** Content-Type sent with the raw body. Taken from the extension, which the server always accepts. */
export function uploadContentType(fileName: string): string | null {
  const extension = extensionOf(fileName);
  if (extension === null || !isAcceptedExtension(extension)) return null;
  return MIME_BY_EXTENSION[extension];
}

export type UploadCheck = { readonly ok: true } | { readonly ok: false; readonly message: string };

export function checkUploadFile(file: { readonly name: string; readonly size: number }): UploadCheck {
  if (file.size === 0) {
    return { ok: false, message: "This file is empty. Choose a file with audio or video in it." };
  }
  if (uploadContentType(file.name) === null) {
    return { ok: false, message: `This file type isn't supported. Accepted: ${ACCEPTED_LABEL}.` };
  }
  return { ok: true };
}

/**
 * Header-safe file name for X-Filename. Non-ASCII characters are dropped (they cannot travel in
 * an HTTP header reliably); the extension is kept because the server uses it for validation.
 */
export function asciiFileName(fileName: string): string {
  const normalized = fileName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const extension = extensionOf(normalized);
  const base = extension === null ? normalized : normalized.slice(0, normalized.length - extension.length - 1);
  const safeBase = base
    .replace(/[^A-Za-z0-9._ ()-]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const name = safeBase === "" ? "upload" : safeBase;
  const safeExtension = extension === null ? "" : extension.replace(/[^a-z0-9]/g, "");
  return safeExtension === "" ? name : `${name}.${safeExtension}`;
}
