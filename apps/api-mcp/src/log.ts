export type LogValue = string | number | boolean | null;

/**
 * One JSON line per event. Callers pass ids, status codes and counts only:
 * never URLs, tokens, IP addresses, file names or upstream error text.
 */
export function logEvent(event: string, fields: Readonly<Record<string, LogValue>> = {}): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}
