import type { IncomingMessage, ServerResponse } from "node:http";

import { rateKeyFor } from "../caller.js";
import { transcribeLimiterFor, type AppContext } from "../context.js";
import { acceptUpload, fileNameFromHeader, type UploadRejection } from "../upload/accept.js";
import { headerString } from "../http/headers.js";
import { sendJson } from "../http/respond.js";
import { ApiError } from "./errors.js";
import { quotaExceeded, rateLimited } from "./failures.js";
import { callerOf, identify, requireCsrf } from "./identity.js";

/**
 * POST /v1/uploads: a raw video or audio body with `X-Filename`. Same validation as the upload page
 * (extension, MIME, magic bytes, size cap). Each upload is a new job, never shared between users.
 */
export async function createUpload(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const requester = await identify(req, res, ctx, { allowSession: true });
  requireCsrf(req, requester);
  const caller = callerOf(requester);

  const contentType = headerString(req.headers["content-type"]);
  const media = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!media.startsWith("video/") && !media.startsWith("audio/")) {
    throw new ApiError(415, "unsupported_media_type", "Send the file with a video/* or audio/* Content-Type.");
  }
  const fileName = fileNameFromHeader(req.headers["x-filename"]);
  if (fileName === "") throw new ApiError(400, "invalid_request", "Send the file name in the X-Filename header.");

  const limit = transcribeLimiterFor(ctx, caller).hit(`upload:${rateKeyFor(caller)}`);
  if (!limit.allowed) throw rateLimited(ctx, caller, limit.retryAfterMs);

  const accepted = await acceptUpload({
    body: req,
    fileName,
    contentType,
    contentLength: Number(req.headers["content-length"] ?? 0),
    maxBytes: ctx.config.maxUploadBytes,
  });
  if (!accepted.ok) throw rejectionError(accepted.reason, ctx.config.maxUploadBytes);

  const outcome = await ctx.service.startFileJob(caller, accepted.staged);
  if (outcome.kind === "quota_exceeded") {
    await accepted.staged.cleanup();
    throw quotaExceeded(ctx, caller, outcome.resetAt);
  }
  sendJson(res, 202, { status: "processing", job_id: outcome.job.id });
}

function rejectionError(reason: UploadRejection, maxBytes: number): ApiError {
  switch (reason) {
    case "unsupported_type":
      return new ApiError(415, "unsupported_file_type", "This file type isn't supported. Accepted: MP4, MOV, WebM, M4A, MP3, WAV.");
    case "too_large":
      return new ApiError(413, "too_large", `This file is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB upload limit.`);
    case "interrupted":
      return new ApiError(400, "invalid_request", "The upload was interrupted. Try again.");
    default: {
      const unreachable: never = reason;
      throw new Error(`Unhandled upload rejection: ${String(unreachable)}`);
    }
  }
}
