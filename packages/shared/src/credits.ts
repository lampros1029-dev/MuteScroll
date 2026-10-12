/**
 * Credit accounting (PRD §19, §20.2): 1 credit per started 10 minutes of audio.
 * A Reel costs 1 credit, a 45-minute podcast costs 5.
 */

export const SECONDS_PER_CREDIT = 600;

export function creditsForDuration(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new RangeError(`Invalid duration: ${durationSeconds}`);
  }
  return Math.max(1, Math.ceil(durationSeconds / SECONDS_PER_CREDIT));
}

/** Timestamp label: [MM:SS] under one hour, [HH:MM:SS] otherwise (PRD §11.3). */
export function formatTimestamp(seconds: number, totalDurationSeconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`Invalid timestamp: ${seconds}`);
  }
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return totalDurationSeconds >= 3600 ? `[${pad(h)}:${pad(m)}:${pad(s)}]` : `[${pad(h * 60 + m)}:${pad(s)}]`;
}
