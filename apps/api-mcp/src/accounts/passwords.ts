import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** scrypt cost (N=2^15, r=8, p=1: about 32 MB and well under a second). Stored in every hash, so it can rise later. */
const COST = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;
const MIN_PASSWORD_CHARS = 10;
const MAX_PASSWORD_CHARS = 128;

interface StoredHash {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly key: Buffer;
}

/** Returns a user-facing message when the password breaks the policy (PRD 17), otherwise null. */
export function passwordPolicyError(password: string): string | null {
  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_CHARS || length > MAX_PASSWORD_CHARS) {
    return `Password must be ${MIN_PASSWORD_CHARS} to ${MAX_PASSWORD_CHARS} characters.`;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, COST.N, COST.r, COST.p);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** False for any malformed stored value; never throws on user input. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (parsed === null) return false;
  const key = await deriveKey(password, parsed.salt, parsed.N, parsed.r, parsed.p);
  return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
}

let absentUserHash: Promise<string> | undefined;

/**
 * Login for an unknown address still runs one scrypt check, so response time does not reveal which
 * addresses have accounts.
 */
export async function spendPasswordCheck(password: string): Promise<void> {
  absentUserHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await absentUserHash);
}

function deriveKey(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { N, r, p, maxmem: MAX_MEMORY_BYTES }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function parseStoredHash(stored: string): StoredHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  // Bounds keep a hand-edited row from turning verification into a memory or CPU bomb.
  if (!Number.isInteger(N) || N < 2 ** 10 || N > 2 ** 17 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 4) return null;
  const salt = Buffer.from(parts[4] ?? "", "base64url");
  const key = Buffer.from(parts[5] ?? "", "base64url");
  if (salt.length !== SALT_BYTES || key.length !== KEY_BYTES) return null;
  return { N, r, p, salt, key };
}
