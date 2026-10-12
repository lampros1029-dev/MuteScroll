export const SESSION_COOKIE = "ms_session";
/** Double-submit anti-CSRF cookie. Readable by the web app so it can echo it in the CSRF header. */
export const CSRF_COOKIE = "ms_csrf";
export const CSRF_HEADER = "x-csrf-token";

export interface CookieSettings {
  /** Adds `Secure` (set when the public URL is https). */
  readonly secure: boolean;
  readonly maxAgeSeconds: number;
}

/** Parses a Cookie header. The first occurrence of a name wins. */
export function parseCookies(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  if (header === undefined) return jar;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name !== "" && !jar.has(name)) jar.set(name, part.slice(index + 1).trim());
  }
  return jar;
}

/** HttpOnly session cookie: never readable by page scripts. SameSite=Lax blocks cross-site POSTs. */
export function sessionCookie(token: string, settings: CookieSettings): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${settings.maxAgeSeconds}${secureFlag(settings)}`;
}

export function csrfCookie(value: string, settings: CookieSettings): string {
  return `${CSRF_COOKIE}=${value}; Path=/; SameSite=Lax; Max-Age=${settings.maxAgeSeconds}${secureFlag(settings)}`;
}

/** Set-Cookie values that open a session: the session cookie plus the readable CSRF cookie. */
export function sessionCookies(token: string, csrfValue: string, settings: CookieSettings): string[] {
  return [sessionCookie(token, settings), csrfCookie(csrfValue, settings)];
}

/** Set-Cookie values that clear both cookies (logout). */
export function clearedSessionCookies(secure: boolean): string[] {
  const flag = secure ? "; Secure" : "";
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${flag}`,
    `${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${flag}`,
  ];
}

function secureFlag(settings: CookieSettings): string {
  return settings.secure ? "; Secure" : "";
}
