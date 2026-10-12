/** Readable CSRF cookie set beside the session. Echo it as `x-csrf-token` on cookie-authenticated writes. */

export function readCsrf(): string {
  if (typeof document === "undefined") return "";
  const match = /(?:^|; )ms_csrf=([^;]+)/.exec(document.cookie);
  return match?.[1] === undefined ? "" : decodeURIComponent(match[1]);
}

export function csrfHeaders(json: boolean): HeadersInit {
  return {
    accept: "application/json",
    "x-csrf-token": readCsrf(),
    ...(json ? { "content-type": "application/json" } : {}),
  };
}
