import type { IncomingMessage } from "node:http";

import { BodyError, readJsonBody } from "../http/body.js";
import { headerString } from "../http/headers.js";
import { ApiError } from "./errors.js";

/** Strict content type: browsers cannot send `application/json` cross-site without a CORS preflight, which we never grant. */
export function assertJsonContentType(req: IncomingMessage): void {
  const media = headerString(req.headers["content-type"])?.split(";")[0]?.trim().toLowerCase();
  if (media !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Send the request body as application/json.");
  }
}

export async function readJsonRequest(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  assertJsonContentType(req);
  try {
    return await readJsonBody(req, maxBytes);
  } catch (error) {
    if (!(error instanceof BodyError)) throw error;
    if (error.reason === "too_large") throw new ApiError(413, "too_large", "The request body is too large.");
    throw new ApiError(400, "invalid_request", "The request body must be valid JSON.");
  }
}

/** A JSON object with no keys outside `allowed`. Unknown keys are rejected so typos fail loudly. */
export function objectBody(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError(400, "invalid_request", "The request body must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, "invalid_request", "The request has a field that this endpoint does not accept.");
  }
  return record;
}

/** A required string field, or an invalid_request error that names the field. */
export function requiredString(body: Record<string, unknown>, field: string, maxChars: number): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) {
    throw new ApiError(400, "invalid_request", `Field "${field}" is required and must be a string of at most ${maxChars} characters.`);
  }
  return value;
}
