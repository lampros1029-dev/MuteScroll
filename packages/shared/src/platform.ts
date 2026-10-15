/**
 * Public video link checks.
 *
 * Pure string/URL logic: no network I/O. Any public http(s) link is accepted.
 * The media worker follows redirects with an SSRF-safe fetcher, then reads the
 * link with yt-dlp. Private hosts, IP literals, credentials, custom ports, and
 * non-http schemes are rejected here.
 */

export const PUBLIC_PLATFORM = "public" as const;
export const PLATFORMS = [PUBLIC_PLATFORM] as const;
export type Platform = (typeof PLATFORMS)[number];

export type ContentType = "video";

export type UrlErrorCode = "invalid_url" | "unsafe_url" | "unsupported_url";

export interface ParsedVideoUrl {
  readonly ok: true;
  readonly platform: Platform;
  readonly contentType: ContentType;
  /** Stable form used as the cache key input. The fragment is dropped. */
  readonly canonicalUrl: string;
  /** Redirects are followed by the worker's safe fetcher, not by this parser. */
  readonly needsRedirectResolve: boolean;
}

export interface UrlError {
  readonly ok: false;
  readonly code: UrlErrorCode;
  readonly message: string;
}

export type ParseResult = ParsedVideoUrl | UrlError;

export function parseVideoUrl(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) {
    return fail("invalid_url", "That doesn't look like a valid URL.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return fail("invalid_url", "That doesn't look like a valid URL.");
  }

  const safety = checkUrlSafety(url);
  if (safety !== null) return safety;

  return {
    ok: true,
    platform: PUBLIC_PLATFORM,
    contentType: "video",
    canonicalUrl: canonicalOf(url),
    needsRedirectResolve: false,
  };
}

/** Human-readable source label. The stored id is not a host name. */
export function platformLabel(platform: Platform): string {
  switch (platform) {
    case "public":
      return "Public video";
    default: {
      const unreachable: never = platform;
      throw new Error(`Unhandled platform: ${String(unreachable)}`);
    }
  }
}

function canonicalOf(url: URL): string {
  const host = normalizeHost(url.hostname);
  const path = url.pathname === "" ? "/" : url.pathname;
  return `${url.protocol}//${host}${path}${url.search}`;
}

function checkUrlSafety(url: URL): UrlError | null {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return fail("unsafe_url", "Only http(s) links are supported.");
  }
  if (url.username !== "" || url.password !== "") {
    return fail("unsafe_url", "Links containing credentials are not accepted.");
  }
  if (url.port !== "" && url.port !== "80" && url.port !== "443") {
    return fail("unsafe_url", "Links with custom ports are not accepted.");
  }
  const host = normalizeHost(url.hostname);
  if (host === "" || host.startsWith("[") || host.includes(":") || /^\d+(\.\d+){0,3}$/.test(host)) {
    return fail("unsafe_url", "Links pointing at IP addresses are not accepted.");
  }
  if (!host.includes(".")) {
    return fail("unsafe_url", "Links must use a public host name.");
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return fail("unsafe_url", "Links pointing at local hosts are not accepted.");
  }
  return null;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function fail(code: UrlErrorCode, message: string): UrlError {
  return { ok: false, code, message };
}
