/**
 * URL parsing, platform detection and first-line URL safety (PRD §6, §9.1, §17).
 *
 * This is pure string/URL logic: it never performs network I/O. Short links that need a
 * redirect to be followed are flagged with `needsRedirectResolve`; the media worker must
 * resolve them with an SSRF-safe fetcher and then re-run `parseVideoUrl` on the result.
 */

export const PLATFORMS = ["youtube", "tiktok", "instagram", "facebook"] as const;
export type Platform = (typeof PLATFORMS)[number];

export type ContentType = "video" | "short" | "reel";

export type UrlErrorCode = "invalid_url" | "unsafe_url" | "unsupported_url";

export interface ParsedVideoUrl {
  readonly ok: true;
  readonly platform: Platform;
  readonly contentType: ContentType;
  /** Tracking-free, stable form used as the cache key input (PRD §9.4). */
  readonly canonicalUrl: string;
  /** True for short links (vm.tiktok.com, fb.watch, ...) that must be redirect-resolved first. */
  readonly needsRedirectResolve: boolean;
}

export interface UrlError {
  readonly ok: false;
  readonly code: UrlErrorCode;
  readonly message: string;
}

export type ParseResult = ParsedVideoUrl | UrlError;

type Match = Omit<ParsedVideoUrl, "ok" | "platform">;

interface PlatformParser {
  readonly platform: Platform;
  readonly domains: readonly string[];
  parse(url: URL, host: string): Match | null;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TIKTOK_USER = /^@[A-Za-z0-9._]{1,64}$/;
const TIKTOK_VIDEO_ID = /^\d{6,25}$/;
const SHORT_CODE = /^[A-Za-z0-9_-]{4,32}$/;
const NUMERIC_ID = /^\d{5,25}$/;

const parsers: readonly PlatformParser[] = [
  {
    platform: "youtube",
    domains: ["youtube.com", "youtu.be"],
    parse(url, host) {
      const segments = pathSegments(url);
      if (host === "youtu.be") {
        const id = segments[0];
        return id !== undefined && YOUTUBE_ID.test(id) ? youtubeVideo(id) : null;
      }
      const [kind, id] = segments;
      if (kind === "watch") {
        const v = url.searchParams.get("v");
        return v !== null && YOUTUBE_ID.test(v) ? youtubeVideo(v) : null;
      }
      if (id === undefined || !YOUTUBE_ID.test(id)) return null;
      if (kind === "shorts") {
        return {
          contentType: "short",
          canonicalUrl: `https://www.youtube.com/shorts/${id}`,
          needsRedirectResolve: false,
        };
      }
      if (kind === "live" || kind === "embed") return youtubeVideo(id);
      return null;
    },
  },
  {
    platform: "tiktok",
    domains: ["tiktok.com"],
    parse(url, host) {
      const segments = pathSegments(url);
      if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
        const code = segments[0];
        return code !== undefined && SHORT_CODE.test(code)
          ? { contentType: "video", canonicalUrl: `https://${host}/${code}/`, needsRedirectResolve: true }
          : null;
      }
      if (segments[0] === "t" && segments[1] !== undefined && SHORT_CODE.test(segments[1])) {
        return {
          contentType: "video",
          canonicalUrl: `https://www.tiktok.com/t/${segments[1]}/`,
          needsRedirectResolve: true,
        };
      }
      const [user, kind, id] = segments;
      if (
        user !== undefined &&
        TIKTOK_USER.test(user) &&
        kind === "video" &&
        id !== undefined &&
        TIKTOK_VIDEO_ID.test(id)
      ) {
        return {
          contentType: "video",
          canonicalUrl: `https://www.tiktok.com/${user}/video/${id}`,
          needsRedirectResolve: false,
        };
      }
      return null;
    },
  },
  {
    platform: "instagram",
    domains: ["instagram.com"],
    parse(url) {
      const segments = pathSegments(url);
      // Supports /reel/CODE, /reels/CODE, /p/CODE, /tv/CODE and /<user>/reel/CODE.
      const offset = segments.length >= 3 ? 1 : 0;
      const kind = segments[offset];
      const code = segments[offset + 1];
      if (kind === undefined || code === undefined || !SHORT_CODE.test(code)) return null;
      if (kind === "reel" || kind === "reels") {
        return {
          contentType: "reel",
          canonicalUrl: `https://www.instagram.com/reel/${code}/`,
          needsRedirectResolve: false,
        };
      }
      if (kind === "p" || kind === "tv") {
        return {
          contentType: "video",
          canonicalUrl: `https://www.instagram.com/${kind}/${code}/`,
          needsRedirectResolve: false,
        };
      }
      return null;
    },
  },
  {
    platform: "facebook",
    domains: ["facebook.com", "fb.watch", "fb.com"],
    parse(url, host) {
      const segments = pathSegments(url);
      if (host === "fb.watch") {
        const code = segments[0];
        return code !== undefined && SHORT_CODE.test(code)
          ? { contentType: "video", canonicalUrl: `https://fb.watch/${code}/`, needsRedirectResolve: true }
          : null;
      }
      const [first, second, third] = segments;
      if (first === "reel" && second !== undefined && NUMERIC_ID.test(second)) {
        return {
          contentType: "reel",
          canonicalUrl: `https://www.facebook.com/reel/${second}`,
          needsRedirectResolve: false,
        };
      }
      if (first === "watch") {
        const v = url.searchParams.get("v");
        return v !== null && NUMERIC_ID.test(v)
          ? { contentType: "video", canonicalUrl: `https://www.facebook.com/watch/?v=${v}`, needsRedirectResolve: false }
          : null;
      }
      if (second === "videos" && third !== undefined && NUMERIC_ID.test(third)) {
        return {
          contentType: "video",
          canonicalUrl: `https://www.facebook.com/watch/?v=${third}`,
          needsRedirectResolve: false,
        };
      }
      if (first === "share" && (second === "r" || second === "v") && third !== undefined && SHORT_CODE.test(third)) {
        return {
          contentType: second === "r" ? "reel" : "video",
          canonicalUrl: `https://www.facebook.com/share/${second}/${third}/`,
          needsRedirectResolve: true,
        };
      }
      return null;
    },
  },
];

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

  const host = normalizeHost(url.hostname);
  for (const parser of parsers) {
    if (!parser.domains.some((domain) => hostMatches(host, domain))) continue;
    const match = parser.parse(url, host);
    if (match !== null) return { ok: true, platform: parser.platform, ...match };
    return fail("unsupported_url", `This ${parser.platform} link is not a supported public video URL.`);
  }
  return fail("unsupported_url", "This isn't a supported video link.");
}

/** Human-readable platform name for user-facing messages. */
export function platformLabel(platform: Platform): string {
  switch (platform) {
    case "youtube":
      return "YouTube";
    case "tiktok":
      return "TikTok";
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    default: {
      const unreachable: never = platform;
      throw new Error(`Unhandled platform: ${String(unreachable)}`);
    }
  }
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
  if (host.startsWith("[") || host.includes(":") || /^\d+(\.\d+){0,3}$/.test(host)) {
    return fail("unsafe_url", "Links pointing at IP addresses are not accepted.");
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return fail("unsafe_url", "Links pointing at local hosts are not accepted.");
  }
  return null;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function pathSegments(url: URL): string[] {
  return url.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

function youtubeVideo(id: string): Match {
  return {
    contentType: "video",
    canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
    needsRedirectResolve: false,
  };
}

function fail(code: UrlErrorCode, message: string): UrlError {
  return { ok: false, code, message };
}
