import type { IncomingMessage, ServerResponse } from "node:http";

import type { AppContext } from "../context.js";
import { sendHtml, sendJson } from "../http/respond.js";
import { headerString } from "../http/headers.js";
import { acceptUpload, fileNameFromHeader, type UploadRejection } from "./accept.js";
import { messagePageHtml, uploadPageCsp, uploadPageHtml } from "./page.js";
import type { UploadFile } from "../jobs/transcription-service.js";

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
  const result = await acceptUploadFromLink(req, lease.jobId, clientKey, ctx);
  if (result.consumed) ctx.uploads.complete(token);
  else ctx.uploads.release(token);
  sendJson(res, result.status, result.body);
}

/** Validates headers, rate-limits, stages and sniffs the file, then hands it to the job service. */
async function acceptUploadFromLink(req: IncomingMessage, jobId: string, clientKey: string, ctx: AppContext): Promise<UploadResult> {
  const limit = ctx.rateLimiter.hit(`upload:${clientKey}`);
  if (!limit.allowed) return reject(429, "Too many upload attempts. Wait a minute and try again.");

  const contentLength = Number(req.headers["content-length"] ?? 0);
  const accepted = await acceptUpload({
    body: req,
    fileName: fileNameFromHeader(req.headers["x-filename"]),
    contentType: headerString(req.headers["content-type"]),
    contentLength,
    maxBytes: ctx.config.maxUploadBytes,
  });
  if (!accepted.ok) return rejectionResult(accepted.reason, ctx.config.maxUploadBytes);
  return startJob(ctx, jobId, accepted.staged, clientKey);
}

async function startJob(ctx: AppContext, jobId: string, staged: UploadFile, clientKey: string): Promise<UploadResult> {
  const outcome = await ctx.service.continueFailedJob(jobId, staged, clientKey);
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

function rejectionResult(reason: UploadRejection, maxBytes: number): UploadResult {
  switch (reason) {
    case "unsupported_type":
      return reject(415, UNSUPPORTED_TYPE);
    case "too_large":
      return reject(413, tooLargeMessage(maxBytes));
    case "interrupted":
      return reject(400, "The upload was interrupted. Try again.");
    default: {
      const unreachable: never = reason;
      throw new Error(`Unhandled upload rejection: ${String(unreachable)}`);
    }
  }
}

function reject(status: number, message: string): UploadResult {
  return { status, body: { status: "error", message }, consumed: false };
}

function tooLargeMessage(maxBytes: number): string {
  return `This file is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB upload limit.`;
}
