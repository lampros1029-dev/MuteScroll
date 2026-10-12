import { createWriteStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { SNIFF_BYTES } from "./media-types.js";

export class UploadTooLargeError extends Error {
  constructor() {
    super("upload too large");
    this.name = "UploadTooLargeError";
  }
}

export interface StagedUpload {
  readonly path: string;
  readonly cleanup: () => Promise<void>;
}

/**
 * Streams the request body to a fresh temp directory with a fixed file name. The client's
 * file name is never used; only its validated extension appears in the stored name.
 */
export async function stageUpload(body: Readable, extension: string, maxBytes: number): Promise<StagedUpload> {
  const dir = await mkdtemp(join(tmpdir(), "mutescroll-upload-"));
  const path = join(dir, `upload.${extension}`);
  const cleanup = (): Promise<void> => rm(dir, { recursive: true, force: true });
  try {
    await pipeline(body, limitBytes(maxBytes), createWriteStream(path, { flags: "wx" }));
  } catch (error) {
    await cleanup();
    throw error;
  }
  return { path, cleanup };
}

/** First bytes of a staged file, for magic-byte sniffing. */
export async function readHead(path: string): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function limitBytes(maxBytes: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new UploadTooLargeError());
        return;
      }
      callback(null, chunk);
    },
  });
}
