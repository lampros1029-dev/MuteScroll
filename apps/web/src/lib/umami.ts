/** Umami website ids are short hex strings. Anything else is ignored so the script is not injected. */
const UMAMI_WEBSITE_ID = /^[0-9a-f-]{8,64}$/i;

/**
 * The public website id, or undefined when Umami must stay off.
 * The cookieless cloud script is rendered only when this returns a value.
 */
export function umamiWebsiteId(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!UMAMI_WEBSITE_ID.test(trimmed)) return undefined;
  return trimmed;
}
