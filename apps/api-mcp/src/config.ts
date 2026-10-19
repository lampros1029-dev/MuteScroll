import { readPaddleConfig, type PaddleConfig } from "./billing/paddle-config.js";
import type { JobTtls } from "./jobs/types.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_JOB_TTL_MS = 2 * 60 * 60 * 1000;

export interface WorkerConfig {
  readonly python: string;
  readonly cwd: string | undefined;
  readonly timeoutMs: number;
}

export interface GmailConfig {
  readonly clientId: string | undefined;
  readonly clientSecret: string | undefined;
  readonly refreshToken: string | undefined;
}

/** Website Google sign-in. Separate from the Gmail send client. */
export interface GoogleOAuthConfig {
  readonly clientId: string | undefined;
  readonly clientSecret: string | undefined;
}

export interface Config {
  readonly port: number;
  readonly publicBaseUrl: string;
  /** Session and CSRF cookies get the Secure flag when the public URL is https. */
  readonly secureCookies: boolean;
  readonly plansUrl: string;
  /** Website origin that shows the ChatGPT approval page. Taken from PLANS_URL. */
  readonly webOrigin: string;
  readonly trustProxy: boolean;
  readonly clientIpHeader: string;
  readonly mcpMaxBodyBytes: number;
  /** Largest JSON body the REST API reads (REST_JSON_MAX_BODY_BYTES). */
  readonly jsonMaxBodyBytes: number;
  readonly maxUploadBytes: number;
  /** Anonymous credits per window (ANON_CREDITS, PRD D5). */
  readonly anonCredits: number;
  readonly anonQuotaWindowMs: number;
  readonly anonRequestsPerMinute: number;
  /** Transcribe calls per account per minute. */
  readonly accountRequestsPerMinute: number;
  /** Sign-ups per client IP per hour (AUTH_SIGNUPS_PER_IP_PER_HOUR). */
  readonly signupsPerIpPerHour: number;
  /** Login attempts per client IP per minute (AUTH_LOGINS_PER_IP_PER_MINUTE). */
  readonly loginsPerIpPerMinute: number;
  /** Verification and password-reset emails per client IP per hour. */
  readonly authMailPerIpPerHour: number;
  /**
   * Gmail send credentials. Any missing name means mail is not configured.
   * The values are never logged. Sender is always mutescroll.xyz@gmail.com.
   */
  readonly gmail: GmailConfig;
  /**
   * Google sign-in for accounts. Unset means the button explains that it is not configured.
   * Never read from GMAIL_OAUTH_CLIENT_ID: that client is gmail.send only.
   */
  readonly google: GoogleOAuthConfig;
  /** Session lifetime; it slides forward on use (SESSION_TTL_DAYS). */
  readonly sessionTtlMs: number;
  /** How long transcribe_video waits for a result before returning `processing`. */
  readonly toolWaitMs: number;
  readonly jobConcurrency: number;
  readonly jobTtl: JobTtls;
  readonly uploadTokenTtlMs: number;
  readonly mediaMaxSeconds: number;
  /** Postgres connection string (DATABASE_URL). Unset = in-memory stores for a single process. */
  readonly databaseUrl: string | undefined;
  readonly worker: WorkerConfig;
  /** Paddle Billing. Absent key means the in-memory billing provider and no outbound calls. */
  readonly paddle: PaddleConfig;
  /**
   * Public OpenAI domain-ownership token served at `/.well-known/openai-apps-challenge`.
   * Unset means that path stays 404. The value is never logged.
   */
  readonly openaiAppsChallenge: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Config {
  const port = intEnv(env, "PORT", 8080, 1, 65535);
  const publicBaseUrl = urlEnv(env, "PUBLIC_BASE_URL", `http://localhost:${port}`);
  const paddle = readPaddleConfig(env);
  if (!paddle.ok) throw new ConfigError(paddle.message);
  const plansUrl = urlEnv(env, "PLANS_URL", "https://mutescroll.xyz/plans");
  return {
    port,
    publicBaseUrl,
    secureCookies: publicBaseUrl.startsWith("https://"),
    plansUrl,
    webOrigin: new URL(plansUrl).origin,
    trustProxy: boolEnv(env, "TRUST_PROXY", false),
    clientIpHeader: (env["CLIENT_IP_HEADER"] ?? "x-forwarded-for").trim().toLowerCase(),
    mcpMaxBodyBytes: intEnv(env, "MCP_MAX_BODY_BYTES", 256 * 1024, 1024, 16 * 1024 * 1024),
    jsonMaxBodyBytes: intEnv(env, "REST_JSON_MAX_BODY_BYTES", 16 * 1024, 1024, 1024 * 1024),
    maxUploadBytes: intEnv(env, "MAX_UPLOAD_BYTES", 2 * 1024 ** 3, 1024, 10 * 1024 ** 3),
    anonCredits: intEnv(env, "ANON_CREDITS", 5, 0, 100_000),
    anonQuotaWindowMs: intEnv(env, "ANON_QUOTA_WINDOW_SECONDS", 24 * 3600, 60, 31 * 24 * 3600) * 1000,
    anonRequestsPerMinute: intEnv(env, "ANON_REQUESTS_PER_MINUTE", 10, 1, 10_000),
    accountRequestsPerMinute: intEnv(env, "ACCOUNT_REQUESTS_PER_MINUTE", 30, 1, 10_000),
    signupsPerIpPerHour: intEnv(env, "AUTH_SIGNUPS_PER_IP_PER_HOUR", 5, 1, 10_000),
    loginsPerIpPerMinute: intEnv(env, "AUTH_LOGINS_PER_IP_PER_MINUTE", 10, 1, 10_000),
    authMailPerIpPerHour: intEnv(env, "AUTH_MAIL_PER_IP_PER_HOUR", 5, 1, 10_000),
    gmail: readGmailConfig(env),
    google: readGoogleConfig(env),
    sessionTtlMs: intEnv(env, "SESSION_TTL_DAYS", 30, 1, 365) * DAY_MS,
    toolWaitMs: intEnv(env, "TOOL_WAIT_MS", 25_000, 0, 120_000),
    jobConcurrency: intEnv(env, "JOB_CONCURRENCY", 2, 1, 64),
    jobTtl: {
      activeMs: ACTIVE_JOB_TTL_MS,
      succeededMs: intEnv(env, "JOB_TTL_SECONDS", 24 * 3600, 60, 31 * 24 * 3600) * 1000,
      accountSucceededMs: intEnv(env, "ACCOUNT_JOB_TTL_DAYS", 7, 1, 365) * DAY_MS,
      failedMs: intEnv(env, "JOB_FAILED_TTL_SECONDS", 3600, 60, 31 * 24 * 3600) * 1000,
    },
    uploadTokenTtlMs: intEnv(env, "UPLOAD_TOKEN_TTL_SECONDS", 3600, 60, 7 * 24 * 3600) * 1000,
    mediaMaxSeconds: intEnv(env, "MEDIA_MAX_SECONDS", 2 * 3600, 1, 24 * 3600),
    databaseUrl: databaseUrlEnv(env, "DATABASE_URL"),
    worker: {
      python: nonEmpty(env["MEDIA_WORKER_PYTHON"]) ?? (platform === "win32" ? "python" : "python3"),
      cwd: nonEmpty(env["MEDIA_WORKER_DIR"]),
      timeoutMs: intEnv(env, "MEDIA_WORKER_TIMEOUT_SECONDS", 900, 10, 6 * 3600) * 1000,
    },
    paddle: paddle.config,
    openaiAppsChallenge: readOpenAiAppsChallenge(env),
  };
}

/** A public verification token. Reject a bad value without echoing it. */
function readOpenAiAppsChallenge(env: NodeJS.ProcessEnv): string | undefined {
  const raw = nonEmpty(env["OPENAI_APPS_CHALLENGE"]);
  if (raw === undefined) return undefined;
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(raw)) {
    throw new ConfigError("OPENAI_APPS_CHALLENGE must be a single URL-safe token");
  }
  return raw;
}

function readGmailConfig(env: NodeJS.ProcessEnv): GmailConfig {
  return {
    clientId: nonEmpty(env["GMAIL_OAUTH_CLIENT_ID"]),
    clientSecret: nonEmpty(env["GMAIL_OAUTH_CLIENT_SECRET"]),
    refreshToken: nonEmpty(env["GMAIL_OAUTH_REFRESH_TOKEN"]),
  };
}

function readGoogleConfig(env: NodeJS.ProcessEnv): GoogleOAuthConfig {
  return {
    clientId: nonEmpty(env["GOOGLE_OAUTH_CLIENT_ID"]),
    clientSecret: nonEmpty(env["GOOGLE_OAUTH_CLIENT_SECRET"]),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = nonEmpty(env[name]);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function boolEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = nonEmpty(env[name])?.toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  throw new ConfigError(`${name} must be true or false`);
}

function urlEnv(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = nonEmpty(env[name]) ?? fallback;
  try {
    return new URL(raw).toString().replace(/\/+$/, "");
  } catch {
    throw new ConfigError(`${name} must be an absolute URL`);
  }
}

/** The error names the variable but never echoes the connection string (it carries the password). */
function databaseUrlEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = nonEmpty(env[name]);
  if (raw === undefined) return undefined;
  if (!/^postgres(ql)?:\/\//i.test(raw)) throw new ConfigError(`${name} must be a postgres:// URL`);
  return raw;
}
