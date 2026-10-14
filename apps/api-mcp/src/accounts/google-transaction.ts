import { createHmac, timingSafeEqual } from "node:crypto";

/** Short-lived HttpOnly cookie that binds a Google redirect to this browser. */
export const GOOGLE_TX_COOKIE = "ms_google_tx";

const TX_TTL_MS = 10 * 60 * 1000;

export interface GoogleTransaction {
  readonly state: string;
  readonly verifier: string;
  readonly nonce: string;
  readonly next: string;
  readonly mode: "login" | "signup";
  readonly exp: number;
}

export function googleTransactionExpiry(now: number): number {
  return now + TX_TTL_MS;
}

/** Signs the transaction with the Google client secret. The secret never goes in the cookie body. */
export function sealGoogleTransaction(transaction: GoogleTransaction, secret: string): string {
  const payload = Buffer.from(JSON.stringify(transaction), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

/** Returns the transaction when the signature, shape, and expiry all match. */
export function openGoogleTransaction(token: string, secret: string, now: number): GoogleTransaction | undefined {
  const dot = token.indexOf(".");
  if (dot <= 0 || token.indexOf(".", dot + 1) !== -1) return undefined;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const got = Buffer.from(mac);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isTransaction(parsed) || parsed.exp <= now) return undefined;
  return parsed;
}

/** Where to send the browser after Google sign-in. Only a path on this site. */
export function safeNextPath(value: string | null): string {
  if (value === null || value.length === 0 || value.length > 2048) return "/account";
  if (value === "checkout") return "/pricing";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("\n") || value.includes("\r")) {
    return "/account";
  }
  try {
    const url = new URL(value, "https://mutescroll.xyz");
    if (url.origin !== "https://mutescroll.xyz") return "/account";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/account";
  }
}

export function authMode(value: string | null): "login" | "signup" {
  return value === "signup" ? "signup" : "login";
}

function isTransaction(value: unknown): value is GoogleTransaction {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["state"] === "string" &&
    record["state"].length > 0 &&
    typeof record["verifier"] === "string" &&
    record["verifier"].length > 0 &&
    typeof record["nonce"] === "string" &&
    record["nonce"].length > 0 &&
    typeof record["next"] === "string" &&
    record["next"].startsWith("/") &&
    (record["mode"] === "login" || record["mode"] === "signup") &&
    typeof record["exp"] === "number"
  );
}
