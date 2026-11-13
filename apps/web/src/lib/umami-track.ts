import { getStoredAttribution } from "./attribution";

export type UmamiEventName = "signup" | "purchase";

interface UmamiTracker {
  track: (event: string, data?: Record<string, string>) => void;
}

declare global {
  interface Window {
    umami?: UmamiTracker;
  }
}

const RETRIES = 20;
const RETRY_MS = 100;

/** Sends one Umami event. Missing or broken `umami.track` is ignored. */
export function trackUmami(event: UmamiEventName): void {
  if (typeof window === "undefined") return;
  const data = umamiEventData(campaignTouch());
  attempt(event, data, 0);
}

/** Event data is only the campaign fields we already stored. Empty input sends no data object. */
export function umamiEventData(
  touch: { readonly utmSource: string | null; readonly utmCampaign: string | null } | null,
): Record<string, string> | undefined {
  if (touch === null) return undefined;
  const data: Record<string, string> = {};
  if (touch.utmSource !== null && touch.utmSource !== "") data.utm_source = touch.utmSource;
  if (touch.utmCampaign !== null && touch.utmCampaign !== "") data.utm_campaign = touch.utmCampaign;
  return Object.keys(data).length === 0 ? undefined : data;
}

function campaignTouch(): { utmSource: string | null; utmCampaign: string | null } | null {
  const { firstTouch, lastTouch } = getStoredAttribution();
  return lastTouch ?? firstTouch;
}

function attempt(event: UmamiEventName, data: Record<string, string> | undefined, tries: number): void {
  try {
    const track = window.umami?.track;
    if (typeof track === "function") {
      if (data === undefined) track(event);
      else track(event, data);
      return;
    }
  } catch {
    return;
  }
  if (tries >= RETRIES) return;
  window.setTimeout(() => attempt(event, data, tries + 1), RETRY_MS);
}
