import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable, pipeline } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { visitorForwardedAddress } from "../../../lib/api/visitor-address";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_API_BASE = "http://localhost:8080";

/** RFC 9110 hop-by-hop headers, plus the non-standard Proxy-Connection. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const BODYLESS_STATUS = new Set([204, 205, 304]);

interface ApiRouteContext {
  params: Promise<{ path: string[] }>;
}

function hopByHopNames(connection: string | null): Set<string> {
  const names = new Set(HOP_BY_HOP);
  if (connection == null) return names;
  for (const part of connection.split(",")) {
    const name = part.trim().toLowerCase();
    if (name.length > 0) names.add(name);
  }
  return names;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? value.join(",") : value;
}

function upstreamUrl(segments: readonly string[], search: string): URL {
  const raw = (process.env.API_BASE_URL ?? DEFAULT_API_BASE).trim().replace(/\/+$/, "");
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API_BASE_URL must use http or https");
  }
  const prefix = url.pathname.replace(/\/+$/, "");
  const suffix = segments.map((segment) => encodeURIComponent(segment)).join("/");
  url.pathname = suffix.length > 0 ? `${prefix}/${suffix}` : `${prefix}/`;
  url.search = search;
  url.hash = "";
  return url;
}

function outgoingHeaders(request: Request, host: string): OutgoingHttpHeaders {
  const drop = hopByHopNames(request.headers.get("connection"));
  const headers: OutgoingHttpHeaders = {};
  request.headers.forEach((value, name) => {
    if (drop.has(name) || name === "host" || name === "x-forwarded-for") return;
    headers[name] = value;
  });
  headers.host = host;
  const visitor = visitorForwardedAddress(request.headers.get("x-forwarded-for"));
  if (visitor !== null) headers["x-forwarded-for"] = visitor;
  const sendsBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
  if (!sendsBody) delete headers["content-length"];
  return headers;
}

function appendUpstreamHeader(target: Headers, name: string, value: string | string[]): void {
  if (name.toLowerCase() === "set-cookie") {
    const cookies = Array.isArray(value) ? value : [value];
    for (const cookie of cookies) target.append("set-cookie", cookie);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) target.append(name, item);
    return;
  }
  target.set(name, value);
}

function responseHeaders(upstream: IncomingMessage): Headers {
  const drop = hopByHopNames(headerValue(upstream.headers.connection));
  const headers = new Headers();
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (value === undefined || drop.has(name.toLowerCase())) continue;
    appendUpstreamHeader(headers, name, value);
  }
  return headers;
}

function badGateway(): Response {
  return new Response("Bad gateway", {
    status: 502,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function toWebResponse(method: string, upstream: IncomingMessage): Response {
  const status = upstream.statusCode ?? 502;
  if (status < 200 || status > 599) {
    upstream.resume();
    return badGateway();
  }
  const headers = responseHeaders(upstream);
  const bodyless = method === "HEAD" || BODYLESS_STATUS.has(status);
  if (bodyless) {
    if (BODYLESS_STATUS.has(status)) headers.delete("content-length");
    upstream.resume();
    return new Response(null, { status, statusText: upstream.statusMessage, headers });
  }
  const body = Readable.toWeb(upstream) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status, statusText: upstream.statusMessage, headers });
}

function proxy(request: Request, context: ApiRouteContext): Promise<Response> {
  return context.params.then(({ path }) => dispatch(request, path));
}

function dispatch(request: Request, path: readonly string[]): Promise<Response> {
  let target: URL;
  try {
    target = upstreamUrl(path, new URL(request.url).search);
  } catch (error) {
    console.error("api proxy failed", error instanceof Error ? error.message : "invalid API_BASE_URL");
    return Promise.resolve(badGateway());
  }

  const requestFn = target.protocol === "https:" ? httpsRequest : httpRequest;
  const headers = outgoingHeaders(request, target.host);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (response: Response): void => {
      if (settled) return;
      settled = true;
      resolve(response);
    };

    let upstreamReq: ReturnType<typeof httpRequest>;
    try {
      upstreamReq = requestFn(target, { method: request.method, headers }, (upstream) => {
        if (settled) {
          upstream.resume();
          return;
        }
        try {
          finish(toWebResponse(request.method, upstream));
        } catch (error) {
          upstream.resume();
          console.error("api proxy failed", error instanceof Error ? error.message : "bad upstream response");
          finish(badGateway());
        }
      });
    } catch (error) {
      console.error("api proxy failed", error instanceof Error ? error.message : "upstream request failed");
      resolve(badGateway());
      return;
    }

    // Set `settled` before destroy(). destroy() emits `error` on the same turn.
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      upstreamReq.destroy();
      if (request.signal.aborted) {
        resolve(new Response(null, { status: 499 }));
        return;
      }
      console.error("api proxy failed", error instanceof Error ? error.message : "upstream error");
      resolve(badGateway());
    };

    upstreamReq.on("error", fail);
    request.signal.addEventListener(
      "abort",
      () => {
        if (settled) {
          upstreamReq.destroy();
          return;
        }
        fail(request.signal.reason);
      },
      { once: true },
    );

    if (request.method === "GET" || request.method === "HEAD" || request.body === null) {
      upstreamReq.end();
      return;
    }

    try {
      pipeline(Readable.fromWeb(request.body as unknown as NodeReadableStream), upstreamReq, (error) => {
        if (error) fail(error);
      });
    } catch (error) {
      fail(error);
    }
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
