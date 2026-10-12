/** Pure formatting helpers. Timestamps follow PRD 11.3: [MM:SS] under one hour, [HH:MM:SS] otherwise. */

function finiteOrZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** Clock label without brackets, e.g. `00:12` or `1:02:03`. `totalSeconds` decides the format. */
export function formatClock(seconds: number, totalSeconds: number): string {
  const whole = Math.floor(finiteOrZero(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (finiteOrZero(totalSeconds) >= 3600) return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  return `${pad(hours * 60 + minutes)}:${pad(secs)}`;
}

/** Bracketed timestamp used in plain-text and Markdown output, e.g. `[00:12]`. */
export function formatTimestamp(seconds: number, totalSeconds: number): string {
  return `[${formatClock(seconds, totalSeconds)}]`;
}

/** Human duration for metadata, e.g. `0:58` or `1:02:03`. */
export function formatDuration(seconds: number): string {
  const whole = Math.floor(finiteOrZero(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(secs)}`;
  return `${minutes}:${pad(secs)}`;
}

export function formatCredits(count: number): string {
  const safe = Math.max(0, Math.floor(finiteOrZero(count)));
  return safe === 1 ? "1 credit" : `${safe} credits`;
}

/** Display name for an ISO 639-1 code (e.g. `el` -> `Greek`). Falls back to the code itself. */
export function languageName(code: string | null | undefined): string | null {
  if (code === null || code === undefined || code.trim() === "") return null;
  const trimmed = code.trim();
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(trimmed);
    return name && name !== trimmed ? name : trimmed;
  } catch {
    return trimmed;
  }
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}
