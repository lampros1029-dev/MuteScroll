/**
 * Client-side hints only. The API performs the authoritative URL validation (PRD 9.1), so this
 * module never blocks a link that merely looks unusual: it explains what will happen.
 */

export type PlatformId = "public";

export type LinkHint =
  | { readonly kind: "empty" }
  | { readonly kind: "invalid" }
  | { readonly kind: "link"; readonly platform: PlatformId; readonly label: string; readonly note: string };

const PUBLIC_LABEL = "Public video";
const PUBLIC_NOTE =
  "MuteScroll reads a public video link when it can reach it. Other links get the one-time upload path.";

/** Adds https:// to a bare host such as `example.com/video`. Returns null if nothing usable is left. */
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

export function detectPlatform(input: string): LinkHint {
  if (input.trim() === "") return { kind: "empty" };
  const link = normalizeLink(input);
  if (link === null) return { kind: "invalid" };
  return { kind: "link", platform: "public", label: PUBLIC_LABEL, note: PUBLIC_NOTE };
}
