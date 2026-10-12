import type { IncomingMessage } from "node:http";

export class BodyError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly reason: "too_large" | "invalid_json",
  ) {
    super(reason);
    this.name = "BodyError";
  }
}

/** Reads a JSON body with a hard byte limit, checked both from Content-Length and while streaming. */
export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyError(413, "too_large");

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) throw new BodyError(413, "too_large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new BodyError(400, "invalid_json");
  }
}
