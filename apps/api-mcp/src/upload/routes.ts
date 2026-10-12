import type { IncomingMessage, ServerResponse } from "node:http";

import type { AppContext } from "../context.js";
import { sendHtml, sendJson } from "../http/respond.js";
import { containerMatchesExtension, extensionOf, isAllowedMimeType, sniffContainer } from "./media-types.js";
import { messagePageHtml, uploadPageCsp, uploadPageHtml } from "./page.js";
import { readHead, stageUpload, UploadTooLargeError, type StagedUpload } from "./receive.js";

interface UploadResult {
  readonly status: number;
  readonly body: { readonly status: "processing" | "error"; readonly message: string };
  /** True when the link has done its job (accepted, or no longer valid). False keeps it usable for a retry. */
  readonly consumed: boolean;
}

const UNSUPPORTED_TYPE = "This file type isn't supported. Accepted: MP4, MOV, WebM, M4A, MP3, WAV.";
const LINK_INVALID = "This upload link is invalid or has expired. Ask your assistant for a new one.";
const LINK_USED = "This upload link has already been used or replaced. Ask your assistant for a new one.";

export async function handleUploadRoute(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  clientKey: string,
  ctx: AppContext,
): Promise<void> {
  if (req.method === "GET") return sendUploadPage(res, token, ctx);
  if (req.method === "POST") return handleUploadPost(req, res, token, clientKey, ctx);
  sendJson(res, 405, { error: "method_not_allowed" }, { allow: "GET, POST" });
}

function sendUploadPage(res: ServerResponse, token: string, ctx: AppContext): void {
  const state = ctx.uploads.peek(token);
  if (state === "unknown") {
    return sendHtml(res, 404, messagePageHtml("Link not found", LINK_INVALID));
  }
  if (state === "used") {
    return sendHtml(res, 410, messagePageHtml("Link already used", LINK_USED));
  }
  sendHtml(res, 200, uploadPageHtml(ctx.config.maxUploadBytes), { "content-security-policy": uploadPageCsp() });
}

async function handleUploadPost(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  clientKey: string,
  ctx: AppContext,
): Promise<void> {
  const lease = ctx.uploads.acquire(token);
  if (!lease.ok) {
    const status = lease.reason === "used" ? 410 : lease.reason === "busy" ? 409 : 404;
    const message = lease.reason === "used" ? LINK_USED : lease.reason === "busy" ? "An upload is already in progress for this link." : LINK_INVALID;
    return sendJson(res, status, { status: "error", message });
  }
  const result = await acceptUpload(req, lease.jobId, clientKey, ctx);
  if (result.consumed) ctx.uploads.complete(token);
  else ctx.uploads.release(token);
  sendJson(res, result.status, result.body);
}

/** Validates headers, stages the file, sniffs its bytes and hands it to the job service. */
async function acceptUpload(req: IncomingMessage, jobId: string, clientKey: string, ctx: AppContext): Promise<UploadResult> {
  const reject = (status: number, message: string): UploadResult => ({
    status,
    body: { status: "error", message },
    consumed: false,
  });

  const limit = ctx.rateLimiter.hit(`upload:${clientKey}`);
  if (!limit.allowed) return reject(429, "Too many upload attempts. Wait a minute and try again.");

  const extension = extensionOf(decodeFileName(req.headers["x-filename"]));
  if (extension === null || !isAllowedMimeType(headerString(req.headers["content-type"]))) {
    return reject(415, UNSUPPORTED_TYPE);
  }

  const maxBytes = ctx.config.maxUploadBytes;
  if (Number(req.headers["content-length"] ?? 0) > maxBytes) {
    return reject(413, tooLargeMessage(maxBytes));
  }

  let staged: StagedUpload;
  try {
    staged = await stageUpload(req, extension, maxBytes);
  } catch (error) {
    if (error instanceof UploadTooLargeError) return reject(413, tooLargeMessage(maxBytes));
    return reject(400, "The upload was interrupted. Try again.");
  }

  const family = sniffContainer(await readHead(staged.path));
  if (family === null || !containerMatchesExtension(extension, family)) {
    await staged.cleanup();
    return reject(415, UNSUPPORTED_TYPE);
  }
  return startJob(ctx, jobId, staged);
}

async function startJob(ctx: AppContext, jobId: string, staged: StagedUpload): Promise<UploadResult> {
  const outcome = await ctx.service.startUpload(jobId, staged);
  switch (outcome) {
    case "accepted":
      return {
        status: 202,
        body: { status: "processing", message: "Upload received. Go back to your chat and ask it to check the transcription." },
        consumed: true,
      };
    case "quota_exceeded":
      await staged.cleanup();
      return {
        status: 429,
        body: { status: "error", message: `You've used this period's transcriptions. Plan details: ${ctx.config.plansUrl}` },
        consumed: false,
      };
    case "not_found":
      await staged.cleanup();
      return { status: 404, body: { status: "error", message: LINK_INVALID }, consumed: true };
    case "not_failed":
      await staged.cleanup();
      return {
        status: 409,
        body: { status: "error", message: "This video already has a result or is being processed." },
        consumed: true,
      };
    default: {
      const unreachable: never = outcome;
      throw new Error(`Unhandled upload outcome: ${String(unreachable)}`);
    }
  }
}

function tooLargeMessage(maxBytes: number): string {
  return `This file is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB upload limit.`;
}

function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Only the extension is read from this name; it is never used as a path. */
function decodeFileName(raw: string | string[] | undefined): string {
  const value = headerString(raw) ?? "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
