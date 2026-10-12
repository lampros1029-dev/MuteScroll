import type { OutgoingHttpHeaders, ServerResponse } from "node:http";

const BASE_HEADERS: OutgoingHttpHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export function sendJson(res: ServerResponse, status: number, body: unknown, extra: OutgoingHttpHeaders = {}): void {
  res.writeHead(status, {
    ...BASE_HEADERS,
    "content-type": "application/json; charset=utf-8",
    ...extra,
  });
  res.end(JSON.stringify(body));
}

export function sendHtml(res: ServerResponse, status: number, html: string, extra: OutgoingHttpHeaders = {}): void {
  res.writeHead(status, {
    ...BASE_HEADERS,
    "content-type": "text/html; charset=utf-8",
    ...extra,
  });
  res.end(html);
}

export function sendNotFound(res: ServerResponse): void {
  sendJson(res, 404, { error: "not_found" });
}
