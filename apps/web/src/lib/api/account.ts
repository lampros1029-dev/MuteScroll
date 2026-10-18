import { VERIFY_EMAIL_PATH, readMailError, verificationRequestResult } from "../auth-mail";
import { csrfHeaders } from "../csrf";

export interface Me {
  readonly email: string;
  readonly email_verified: boolean;
  readonly plan: string;
  /** `month` or `year` when the subscription reported it. Null must not be treated as yearly. */
  readonly billing_interval: "month" | "year" | null;
  readonly credits: {
    readonly remaining: number;
    readonly allowance: number;
    readonly used: number;
    readonly bonus: number;
    readonly resets_at: string;
  };
  readonly seats: { readonly included: number; readonly extra: number };
  readonly created_at: string;
}

export interface ApiKeyRecord {
  readonly id: string;
  readonly prefix: string;
  readonly created_at: string;
  readonly last_used_at: string | null;
}

export interface OauthGrant {
  readonly id: string;
  readonly client_name: string;
  readonly scope: string;
  readonly created_at: string;
}

export interface LibraryItem {
  readonly id: string;
  readonly title: string | null;
  readonly platform: string | null;
  readonly created_at: string;
  readonly status: string;
}

export interface ApiErrorBody {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiErrorBody };

export type CheckoutPlan = "creator" | "pro" | "team" | "founding";
export type CheckoutInterval = "month" | "year";
export type CheckoutAddon = "pack_500" | "pack_2000" | "seat";

export const BILLING_CLOSED_MESSAGE = "Billing is not open yet.";

const JSON_HEADERS = { accept: "application/json" } as const;

export function isBillingClosed(error: ApiErrorBody): boolean {
  return error.status === 503 || error.code === "billing_not_configured";
}

export function openUrl(url: string): void {
  window.location.assign(url);
}

export async function fetchMe(signal?: AbortSignal): Promise<Result<Me | null>> {
  try {
    const response = await fetch("/api/v1/me", { method: "GET", headers: JSON_HEADERS, cache: "no-store", signal });
    const body = await parseJson(response);
    if (response.status === 401 || response.status === 403) return { ok: true, value: null };
    if (!response.ok) return { ok: false, error: errorFrom(response.status, body) };
    const me = parseMe(body);
    if (me === null) {
      return { ok: false, error: { status: response.status, code: "invalid_request", message: "The account response was not readable." } };
    }
    return { ok: true, value: me };
  } catch (error) {
    if (isAbort(error)) throw error;
    return { ok: false, error: networkError() };
  }
}

export async function listApiKeys(signal?: AbortSignal): Promise<Result<readonly ApiKeyRecord[]>> {
  try {
    const response = await fetch("/api/v1/api-keys", { method: "GET", headers: JSON_HEADERS, cache: "no-store", signal });
    const body = await parseJson(response);
    if (!response.ok) return { ok: false, error: errorFrom(response.status, body) };
    return { ok: true, value: parseApiKeys(body) };
  } catch (error) {
    if (isAbort(error)) throw error;
    return { ok: false, error: networkError() };
  }
}

export async function listGrants(signal?: AbortSignal): Promise<Result<readonly OauthGrant[]>> {
  try {
    const response = await fetch("/api/v1/oauth/grants", { method: "GET", headers: JSON_HEADERS, cache: "no-store", signal });
    const body = await parseJson(response);
    if (!response.ok) return { ok: false, error: errorFrom(response.status, body) };
    const grants = parseGrants(body);
    if (grants === null) {
      return { ok: false, error: { status: response.status, code: "invalid_request", message: "Connected apps could not be loaded." } };
    }
    return { ok: true, value: grants };
  } catch (error) {
    if (isAbort(error)) throw error;
    return { ok: false, error: networkError() };
  }
}

export async function createApiKey(): Promise<Result<{ id: string; key: string }>> {
  const sent = await send("POST", "/api/v1/api-keys", {});
  if (!sent.ok) return sent;
  const record = sent.value;
  if (record === null || typeof record !== "object") {
    return { ok: false, error: { status: 200, code: "invalid_request", message: "The new key was not readable." } };
  }
  const row = record as Record<string, unknown>;
  if (typeof row["id"] !== "string" || typeof row["key"] !== "string" || row["key"] === "") {
    return { ok: false, error: { status: 200, code: "invalid_request", message: "The new key was not readable." } };
  }
  return { ok: true, value: { id: row["id"], key: row["key"] } };
}

export async function revokeApiKey(id: string): Promise<Result<null>> {
  const sent = await send("DELETE", `/api/v1/api-keys/${encodeURIComponent(id)}`);
  if (!sent.ok) return sent;
  return { ok: true, value: null };
}

export async function revokeGrant(grantId: string): Promise<Result<null>> {
  const sent = await send("POST", "/api/oauth/revoke", { grant_id: grantId });
  if (!sent.ok) return sent;
  return { ok: true, value: null };
}

export async function deleteAccount(): Promise<Result<null>> {
  const sent = await send("DELETE", "/api/v1/me");
  if (!sent.ok) return sent;
  return { ok: true, value: null };
}

export async function logoutAccount(): Promise<Result<null>> {
  const sent = await send("POST", "/api/v1/auth/logout");
  if (!sent.ok) return sent;
  return { ok: true, value: null };
}

/** Signed-in request for the confirmation mail. The link in that mail is /verify-email. */
export async function requestEmailVerification(): Promise<Result<"inbox" | "already_verified">> {
  try {
    const response = await fetch(VERIFY_EMAIL_PATH, {
      method: "POST",
      headers: csrfHeaders(false),
      cache: "no-store",
    });
    const body = await parseJson(response);
    const outcome = verificationRequestResult(response.status, body);
    if (!outcome.ok) {
      const error = readMailError(body);
      return {
        ok: false,
        error: { status: response.status, code: error.code === "" ? "request_failed" : error.code, message: outcome.message },
      };
    }
    switch (outcome.kind) {
      case "inbox":
      case "already_verified":
        return { ok: true, value: outcome.kind };
      case "reset":
      case "verified":
        return { ok: false, error: { status: response.status, code: "invalid_response", message: "That did not work. Try again." } };
      default: {
        const unreachable: never = outcome.kind;
        return { ok: false, error: { status: response.status, code: "invalid_response", message: `Unhandled verification result: ${String(unreachable)}` } };
      }
    }
  } catch (error) {
    if (isAbort(error)) throw error;
    return { ok: false, error: networkError() };
  }
}

export async function startAddonCheckout(addon: CheckoutAddon): Promise<Result<string>> {
  const sent = await send("POST", "/api/v1/checkout", { addon });
  if (!sent.ok) return sent;
  const url = checkoutUrl(sent.value);
  if (url === null) {
    return { ok: false, error: { status: 200, code: "billing_not_configured", message: BILLING_CLOSED_MESSAGE } };
  }
  return { ok: true, value: url };
}

export async function startCheckout(plan: CheckoutPlan, interval: CheckoutInterval): Promise<Result<string>> {
  const sent = await send("POST", "/api/v1/checkout", { plan, interval });
  if (!sent.ok) return sent;
  const url = checkoutUrl(sent.value);
  if (url === null) {
    return { ok: false, error: { status: 200, code: "billing_not_configured", message: BILLING_CLOSED_MESSAGE } };
  }
  return { ok: true, value: url };
}

export interface LibraryPage {
  readonly items: readonly LibraryItem[];
  readonly limit: number;
}

export async function fetchLibrary(offset: number, signal?: AbortSignal): Promise<Result<LibraryPage>> {
  try {
    const response = await fetch(`/api/v1/library?limit=50&offset=${offset}`, {
      method: "GET",
      headers: JSON_HEADERS,
      cache: "no-store",
      signal,
    });
    const body = await parseJson(response);
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: errorFrom(response.status, body) };
    }
    if (!response.ok) return { ok: false, error: errorFrom(response.status, body) };
    return { ok: true, value: parseLibrary(body) };
  } catch (error) {
    if (isAbort(error)) throw error;
    return { ok: false, error: networkError() };
  }
}

async function send(method: "POST" | "DELETE", path: string, body?: unknown): Promise<Result<unknown>> {
  try {
    const response = await fetch(path, {
      method,
      headers: csrfHeaders(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const parsed = await parseJson(response);
    if (!response.ok) return { ok: false, error: errorFrom(response.status, parsed) };
    return { ok: true, value: parsed };
  } catch (error) {
    if (isAbort(error)) throw error;
    return { ok: false, error: networkError() };
  }
}

function networkError(): ApiErrorBody {
  return { status: 0, code: "network_error", message: "The connection failed. Try again." };
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function errorFrom(status: number, body: unknown): ApiErrorBody {
  const record = body !== null && typeof body === "object" ? (body as { error?: { code?: unknown; message?: unknown } }) : {};
  const code = typeof record.error?.code === "string" ? record.error.code : "request_failed";
  const message =
    typeof record.error?.message === "string" && record.error.message !== "" ? record.error.message : "That request did not work.";
  return { status, code, message };
}

function parseMe(body: unknown): Me | null {
  if (body === null || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const credits = row["credits"];
  if (typeof row["email"] !== "string" || typeof row["plan"] !== "string") return null;
  if (credits === null || typeof credits !== "object") return null;
  const creditRow = credits as Record<string, unknown>;
  if (typeof creditRow["remaining"] !== "number" || typeof creditRow["resets_at"] !== "string") return null;
  const seats = row["seats"];
  const seatRow = seats !== null && typeof seats === "object" ? (seats as Record<string, unknown>) : {};
  return {
    email: row["email"],
    email_verified: row["email_verified"] === true,
    plan: row["plan"],
    billing_interval: row["billing_interval"] === "month" || row["billing_interval"] === "year" ? row["billing_interval"] : null,
    credits: {
      remaining: creditRow["remaining"],
      allowance: typeof creditRow["allowance"] === "number" ? creditRow["allowance"] : 0,
      used: typeof creditRow["used"] === "number" ? creditRow["used"] : 0,
      bonus: typeof creditRow["bonus"] === "number" ? creditRow["bonus"] : 0,
      resets_at: creditRow["resets_at"],
    },
    seats: {
      included: typeof seatRow["included"] === "number" ? seatRow["included"] : 1,
      extra: typeof seatRow["extra"] === "number" ? seatRow["extra"] : 0,
    },
    created_at: typeof row["created_at"] === "string" ? row["created_at"] : "",
  };
}

function parseGrants(body: unknown): OauthGrant[] | null {
  if (body === null || typeof body !== "object") return null;
  const grants = (body as { grants?: unknown }).grants;
  if (!Array.isArray(grants)) return null;
  const rows: OauthGrant[] = [];
  for (const item of grants) {
    if (item === null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row["id"] !== "string" || row["id"] === "") continue;
    rows.push({
      id: row["id"],
      client_name: typeof row["client_name"] === "string" && row["client_name"] !== "" ? row["client_name"] : "Connected app",
      scope: typeof row["scope"] === "string" ? row["scope"] : "",
      created_at: typeof row["created_at"] === "string" ? row["created_at"] : "",
    });
  }
  return rows;
}

function parseApiKeys(body: unknown): ApiKeyRecord[] {
  if (body === null || typeof body !== "object") return [];
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const keys: ApiKeyRecord[] = [];
  for (const item of items) {
    if (item === null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row["id"] !== "string" || typeof row["prefix"] !== "string") continue;
    keys.push({
      id: row["id"],
      prefix: row["prefix"],
      created_at: typeof row["created_at"] === "string" ? row["created_at"] : "",
      last_used_at: typeof row["last_used_at"] === "string" ? row["last_used_at"] : null,
    });
  }
  return keys;
}

function parseLibrary(body: unknown): LibraryPage {
  const limit = body !== null && typeof body === "object" && typeof (body as { limit?: unknown }).limit === "number"
    ? (body as { limit: number }).limit
    : 50;
  if (body === null || typeof body !== "object") return { items: [], limit };
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return { items: [], limit };
  const rows: LibraryItem[] = [];
  for (const item of items) {
    if (item === null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row["id"] !== "string" || row["id"] === "") continue;
    rows.push({
      id: row["id"],
      title: typeof row["title"] === "string" ? row["title"] : null,
      platform: typeof row["platform"] === "string" ? row["platform"] : null,
      created_at: typeof row["created_at"] === "string" ? row["created_at"] : "",
      status: typeof row["status"] === "string" ? row["status"] : "",
    });
  }
  return { items: rows, limit };
}

function checkoutUrl(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  if (typeof row["url"] === "string" && row["url"] !== "") return row["url"];
  if (typeof row["checkout_url"] === "string" && row["checkout_url"] !== "") return row["checkout_url"];
  return null;
}
