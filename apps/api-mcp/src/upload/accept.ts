import type { Readable } from "node:stream";

import { headerString } from "../http/headers.js";
import { containerMatchesExtension, extensionOf, isAllowedMimeType, sniffContainer } from "./media-types.js";
import { readHead, stageUpload, UploadTooLargeError, type StagedUpload } from "./receive.js";

export type UploadRejection = "unsupported_type" | "too_large" | "interrupted";

export type UploadAcceptance =
  | { readonly ok: true; readonly staged: StagedUpload }
  | { readonly ok: false; readonly reason: UploadRejection };

export interface UploadRequest {
  readonly body: Readable;
  /** The client's file name. Only its extension is kept (PRD 14). */
  readonly fileName: string;
  readonly contentType: string | undefined;
  readonly contentLength: number;
  readonly maxBytes: number;
}

/**
 * Shared upload validation for `/upload/:token` and `POST /v1/uploads`: extension, declared MIME type,
 * declared size, streamed size limit and magic bytes. The file is staged under a fixed name.
 */
export async function acceptUpload(request: UploadRequest): Promise<UploadAcceptance> {
  const extension = extensionOf(request.fileName);
  if (extension === null || !isAllowedMimeType(request.contentType)) return { ok: false, reason: "unsupported_type" };
  if (request.contentLength > request.maxBytes) return { ok: false, reason: "too_large" };
  let staged: StagedUpload;
  try {
    staged = await stageUpload(request.body, extension, request.maxBytes);
  } catch (error) {
    return { ok: false, reason: error instanceof UploadTooLargeError ? "too_large" : "interrupted" };
  }
  const family = sniffContainer(await readHead(staged.path));
  if (family === null || !containerMatchesExtension(extension, family)) {
    await staged.cleanup();
    return { ok: false, reason: "unsupported_type" };
  }
  return { ok: true, staged };
}

/** The `X-Filename` header, percent-decoded. Only its extension is ever used. */
export function fileNameFromHeader(raw: string | string[] | undefined): string {
  const value = headerString(raw) ?? "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
