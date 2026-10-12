import { randomUUID } from "node:crypto";

/**
 * Optional error-class reporter. When SENTRY_DSN is unset or not a DSN, this does nothing.
 * The envelope carries the error class name only: no message, stack, URL, or request data.
 */

const DSN_PATTERN = /^(https?):\/\/([A-Za-z0-9]+)@([A-Za-z0-9.-]+(?::\d+)?)\/([0-9]+)\/?$/;
const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_$]{0,63}$/;

interface SentryTarget {
  readonly storeUrl: string;
  readonly key: string;
}

export function reportErrorClass(
  error: unknown,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): void {
  try {
    const target = parseDsn(env["SENTRY_DSN"]);
    if (target === null) return;
    const className = errorClassName(error);
    const eventId = randomUUID().replaceAll("-", "");
    void fetchImpl(target.storeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_client=mutescroll-api/0, sentry_key=${target.key}`,
      },
      body: envelope(eventId, className),
      signal: AbortSignal.timeout(2_000),
    }).catch(() => undefined);
  } catch {
    // Reporting must not change the request outcome.
  }
}

function errorClassName(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return CLASS_NAME.test(name) ? name : "unknown";
}

function parseDsn(raw: string | undefined): SentryTarget | null {
  const value = raw?.trim() ?? "";
  if (value === "") return null;
  const match = DSN_PATTERN.exec(value);
  if (match === null) return null;
  const scheme = match[1];
  const key = match[2];
  const host = match[3];
  const project = match[4];
  if (scheme === undefined || key === undefined || host === undefined || project === undefined) return null;
  return { storeUrl: `${scheme}://${host}/api/${project}/envelope/`, key };
}

function envelope(eventId: string, className: string): string {
  const header = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() });
  const item = JSON.stringify({ type: "event" });
  const payload = JSON.stringify({
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    exception: { values: [{ type: className, value: className }] },
  });
  return `${header}\n${item}\n${payload}\n`;
}
