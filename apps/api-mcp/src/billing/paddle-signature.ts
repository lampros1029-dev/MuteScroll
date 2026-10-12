import { createHmac, timingSafeEqual } from "node:crypto";

/** Older than this and the notification is rejected (replay window). Paddle's SDK default is 5 seconds; we allow 5 minutes. */
export const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

export type SignatureFailure = "missing_signature" | "bad_signature" | "stale_timestamp";

export type SignatureCheck = { readonly ok: true } | { readonly ok: false; readonly reason: SignatureFailure };

/**
 * Paddle Billing `Paddle-Signature` header: `ts=<unix>;h1=<hex>` (extra `h1` values during secret rotation).
 * The HMAC-SHA256 key is the notification destination secret. The signed message is `ts` + `:` + raw body bytes.
 */
export function verifyPaddleSignature(rawBody: Uint8Array, header: string | undefined, secret: string, now: number): SignatureCheck {
  if (header === undefined || header.trim() === "" || secret.trim() === "") return { ok: false, reason: "missing_signature" };
  const parsed = parseSignature(header);
  if (parsed === undefined) return { ok: false, reason: "bad_signature" };
  const tsSeconds = Number(parsed.ts);
  if (!Number.isSafeInteger(tsSeconds)) return { ok: false, reason: "bad_signature" };
  if (now - tsSeconds * 1000 > WEBHOOK_MAX_AGE_MS) return { ok: false, reason: "stale_timestamp" };

  const expected = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${parsed.ts}:`, "utf8"), rawBody]))
    .digest("hex");
  const match = parsed.h1.some((candidate) => hexEqual(candidate.toLowerCase(), expected));
  return match ? { ok: true } : { ok: false, reason: "bad_signature" };
}

function parseSignature(header: string): { ts: string; h1: string[] } | undefined {
  let ts: string | undefined;
  const h1: string[] = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return undefined;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (value === "") return undefined;
    if (key === "ts") ts = value;
    else if (key === "h1") h1.push(value);
  }
  if (ts === undefined || !/^\d+$/.test(ts) || h1.length === 0) return undefined;
  return { ts, h1 };
}

function hexEqual(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
