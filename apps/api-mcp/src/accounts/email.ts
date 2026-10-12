const MAX_EMAIL_CHARS = 254;
const MAX_LOCAL_PART_CHARS = 64;
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Trims, lower-cases and validates an address. Returns null when it is not a plausible email. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > MAX_EMAIL_CHARS || !EMAIL_PATTERN.test(email)) return null;
  const at = email.lastIndexOf("@");
  return at > MAX_LOCAL_PART_CHARS ? null : email;
}
