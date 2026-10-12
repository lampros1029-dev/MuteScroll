interface Parts {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly millis: number;
}

function partsOf(ms: number): Parts {
  const total = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  return {
    hours: Math.floor(total / 3_600_000),
    minutes: Math.floor((total % 3_600_000) / 60_000),
    seconds: Math.floor((total % 60_000) / 1000),
    millis: total % 1000,
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** SubRip timestamp: `HH:MM:SS,mmm` (comma before milliseconds). */
export function srtTimestamp(ms: number): string {
  const p = partsOf(ms);
  return `${pad(p.hours, 2)}:${pad(p.minutes, 2)}:${pad(p.seconds, 2)},${pad(p.millis, 3)}`;
}

/** WebVTT timestamp: `HH:MM:SS.mmm` (dot before milliseconds). */
export function vttTimestamp(ms: number): string {
  const p = partsOf(ms);
  return `${pad(p.hours, 2)}:${pad(p.minutes, 2)}:${pad(p.seconds, 2)}.${pad(p.millis, 3)}`;
}

/** Seconds as `HH:MM:SS`, for the markdown metadata line. */
export function clockFromSeconds(seconds: number): string {
  return srtTimestamp(seconds * 1000).slice(0, 8);
}

/** Seconds to whole milliseconds, never negative and never NaN. */
export function secondsToMs(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
}
