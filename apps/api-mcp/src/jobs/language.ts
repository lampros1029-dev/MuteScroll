const LANGUAGE_PATTERN = /^(auto|[a-z]{2})$/;

/** `auto` or a two-letter ISO 639-1 code. Returns null for anything else. Missing means `auto`. */
export function normalizeLanguage(raw: string | undefined): string | null {
  const value = (raw ?? "auto").trim().toLowerCase();
  return LANGUAGE_PATTERN.test(value) ? value : null;
}
