/**
 * Right-most X-Forwarded-For entry. Railway's edge appends the connecting
 * client in that position; earlier entries are chosen by the caller.
 * A missing or blank header returns null so the proxy leaves the header unset.
 */
export function visitorForwardedAddress(header: string | null | undefined): string | null {
  if (header == null) return null;
  const last = header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .at(-1);
  return last ?? null;
}
