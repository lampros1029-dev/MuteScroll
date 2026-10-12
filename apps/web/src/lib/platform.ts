/**
 * Client-side hints only. The API performs the authoritative URL validation (PRD 9.1), so this
 * module never blocks a link that merely looks unusual: it explains what will happen.
 */

export type PlatformId = "youtube" | "tiktok" | "instagram" | "facebook" | "other";

export type LinkHint =
  | { readonly kind: "empty" }
  | { readonly kind: "invalid" }
  | { readonly kind: "link"; readonly platform: PlatformId; readonly label: string; readonly note: string };

const HOST_RULES: ReadonlyArray<{ readonly platform: PlatformId; readonly label: string; readonly hosts: readonly string[] }> = [
  { platform: "youtube", label: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  { platform: "tiktok", label: "TikTok", hosts: ["tiktok.com"] },
  { platform: "instagram", label: "Instagram", hosts: ["instagram.com"] },
  { platform: "facebook", label: "Facebook", hosts: ["facebook.com", "fb.watch", "fb.com"] },
];

const NOTES: Readonly<Record<PlatformId, string>> = {
  youtube: "Public videos work. Captions are used when the video has them, which is the fastest path.",
  tiktok: "Public videos only. If retrieval fails, upload the file: it costs nothing and gives the same output.",
  instagram: "Public posts and Reels only. If retrieval fails, upload the file instead.",
  facebook: "Public videos only. Private or login-only videos need an upload.",
  other: "We'll check this link when you submit it. If it isn't a supported platform, you can upload the file.",
};

/** Adds https:// to bare hosts such as `youtube.com/watch?v=...`. Returns null if nothing usable is left. */
export function normalizeLink(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed.length > 2048 || /\s/.test(trimmed)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function hostOf(link: string): string {
  return new URL(link).hostname.toLowerCase().replace(/^www\./, "");
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function detectPlatform(input: string): LinkHint {
  if (input.trim() === "") return { kind: "empty" };
  const link = normalizeLink(input);
  if (link === null) return { kind: "invalid" };
  const host = hostOf(link);
  for (const rule of HOST_RULES) {
    if (rule.hosts.some((domain) => hostMatches(host, domain))) {
      return { kind: "link", platform: rule.platform, label: rule.label, note: NOTES[rule.platform] };
    }
  }
  return { kind: "link", platform: "other", label: "Unrecognised platform", note: NOTES.other };
}
