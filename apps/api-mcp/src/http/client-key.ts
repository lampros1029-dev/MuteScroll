import type { IncomingMessage } from "node:http";

/**
 * Anonymous quota key. Uses the socket address unless TRUST_PROXY=true, in which case the
 * right-most entry of CLIENT_IP_HEADER (the one appended by our own proxy) is used.
 * The left-most entries are client-controlled and are never trusted.
 */
export function clientKeyFor(req: IncomingMessage, trustProxy: boolean, headerName: string): string {
  if (trustProxy) {
    const raw = req.headers[headerName];
    const value = Array.isArray(raw) ? raw.join(",") : raw;
    const last = value?.split(",").map((part) => part.trim()).filter((part) => part.length > 0).at(-1);
    if (last !== undefined) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}
