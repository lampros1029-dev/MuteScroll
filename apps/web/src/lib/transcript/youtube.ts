/**
 * Builds a YouTube link that opens the video at a given second. Returns null for anything that is
 * not a recognisable YouTube video URL, so other platforms fall back to in-page anchors.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function youtubeVideoId(sourceUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  const segments = url.pathname.split("/").filter((part) => part !== "");

  if (host === "youtu.be") {
    const id = segments[0];
    return id !== undefined && VIDEO_ID.test(id) ? id : null;
  }
  if (host !== "youtube.com") return null;

  if (segments[0] === "watch") {
    const id = url.searchParams.get("v");
    return id !== null && VIDEO_ID.test(id) ? id : null;
  }
  const kind = segments[0];
  const id = segments[1];
  if ((kind === "shorts" || kind === "embed" || kind === "live") && id !== undefined && VIDEO_ID.test(id)) {
    return id;
  }
  return null;
}

export function youtubeTimeLink(sourceUrl: string | null | undefined, seconds: number): string | null {
  if (!sourceUrl) return null;
  const id = youtubeVideoId(sourceUrl);
  if (id === null) return null;
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `https://www.youtube.com/watch?v=${id}&t=${whole}s`;
}
