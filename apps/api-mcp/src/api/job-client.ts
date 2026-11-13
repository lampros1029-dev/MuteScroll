import type { IncomingMessage } from "node:http";

import { truncateUserAgent } from "../jobs/client.js";
import type { JobClient, JobSource } from "../jobs/types.js";
import { headerString } from "../http/headers.js";
import type { Requester } from "./identity.js";

/** Set by the website on transcription and upload requests. The API ignores it when a bearer credential is present. */
export const WEB_SOURCE_HEADER = "x-mutescroll-source";

export function restJobClient(req: IncomingMessage, requester: Requester): JobClient {
  const authorization = headerString(req.headers.authorization);
  return {
    source: restJobSource({
      cookieAuth: requester.kind === "account" && requester.cookieAuth,
      hasAuthorization: authorization !== undefined,
      sourceHeader: headerString(req.headers[WEB_SOURCE_HEADER]),
    }),
    clientName: null,
    clientVersion: null,
    oauthClientId: requester.kind === "account" ? (requester.oauthClientId ?? null) : null,
    userAgent: truncateUserAgent(headerString(req.headers["user-agent"])),
  };
}

export function restJobSource(input: {
  readonly cookieAuth: boolean;
  readonly hasAuthorization: boolean;
  readonly sourceHeader: string | undefined;
}): JobSource {
  if (input.cookieAuth) return "web";
  if (!input.hasAuthorization && input.sourceHeader?.trim().toLowerCase() === "web") return "web";
  return "rest";
}
