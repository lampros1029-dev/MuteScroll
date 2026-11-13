import type { JobClient, JobSource } from "./types.js";

export const CLIENT_TEXT_MAX = 200;

export type ClientLabel = "chatgpt" | "claude" | "cursor" | "web" | "other";

export const UNKNOWN_JOB_CLIENT: JobClient = {
  source: null,
  clientName: null,
  clientVersion: null,
  oauthClientId: null,
  userAgent: null,
};

export function jobClientFrom(input: Partial<JobClient> | undefined): JobClient {
  return {
    source: input?.source ?? null,
    clientName: boundClientText(input?.clientName),
    clientVersion: boundClientText(input?.clientVersion),
    oauthClientId: boundClientText(input?.oauthClientId, 120),
    userAgent: boundClientText(input?.userAgent),
  };
}

/** Empty and non-strings become null. Longer values are cut so the column check accepts them. */
export function boundClientText(value: unknown, max = CLIENT_TEXT_MAX): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

export function truncateUserAgent(value: string | undefined): string | null {
  return boundClientText(value);
}

export interface ClientLabelInput {
  readonly source: JobSource | null;
  readonly clientName: string | null;
  readonly oauthClientName: string | null;
  readonly redirectUris: readonly string[];
  readonly userAgent: string | null;
}

/**
 * One label per job. The site is `web`. Otherwise the OAuth client's redirect host wins,
 * then its registered name, then MCP clientInfo, then the user agent.
 */
export function deriveClientLabel(input: ClientLabelInput): ClientLabel {
  switch (input.source) {
    case "web":
      return "web";
    case "rest":
    case "mcp":
    case null:
      break;
    default: {
      const unreachable: never = input.source;
      return unreachable;
    }
  }
  return (
    labelFromRedirects(input.redirectUris) ??
    labelFromText(input.oauthClientName) ??
    labelFromText(input.clientName) ??
    labelFromText(input.userAgent) ??
    "other"
  );
}

function labelFromRedirects(uris: readonly string[]): ClientLabel | undefined {
  for (const uri of uris) {
    const host = hostname(uri);
    if (host === null) continue;
    const label = labelFromHost(host);
    if (label !== undefined) return label;
  }
  return undefined;
}

function hostname(uri: string): string | null {
  try {
    return new URL(uri).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

function labelFromHost(host: string): ClientLabel | undefined {
  if (isHost(host, "claude.ai") || isHost(host, "claude.com")) return "claude";
  if (isHost(host, "chatgpt.com") || isHost(host, "openai.com")) return "chatgpt";
  if (isHost(host, "cursor.com") || isHost(host, "cursor.sh")) return "cursor";
  return undefined;
}

function isHost(host: string, root: string): boolean {
  return host === root || host.endsWith(`.${root}`);
}

function labelFromText(value: string | null): ClientLabel | undefined {
  if (value === null) return undefined;
  const text = value.toLowerCase();
  if (hasWord(text, "claude") || hasWord(text, "anthropic")) return "claude";
  if (hasWord(text, "chatgpt") || hasWord(text, "openai")) return "chatgpt";
  if (hasWord(text, "cursor")) return "cursor";
  return undefined;
}

function hasWord(text: string, word: string): boolean {
  const pattern = new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`);
  return pattern.test(text);
}
