import type { JobTtls } from "./jobs/types.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface WorkerConfig {
  readonly python: string;
  readonly cwd: string | undefined;
  readonly timeoutMs: number;
}

export interface Config {
  readonly port: number;
  readonly publicBaseUrl: string;
  readonly plansUrl: string;
  readonly trustProxy: boolean;
  readonly clientIpHeader: string;
  readonly mcpMaxBodyBytes: number;
  readonly maxUploadBytes: number;
  /** Anonymous credits per window (ANON_CREDITS, PRD D5). */
  readonly anonCredits: number;
  readonly anonQuotaWindowMs: number;
  readonly anonRequestsPerMinute: number;
  /** How long transcribe_video waits for a result before returning `processing`. */
  readonly toolWaitMs: number;
  readonly jobConcurrency: number;
  readonly jobTtl: JobTtls;
  readonly uploadTokenTtlMs: number;
  readonly mediaMaxSeconds: number;
  readonly worker: WorkerConfig;
}

const ACTIVE_JOB_TTL_MS = 2 * 60 * 60 * 1000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Config {
  const port = intEnv(env, "PORT", 8080, 1, 65535);
  const publicBaseUrl = urlEnv(env, "PUBLIC_BASE_URL", `http://localhost:${port}`);
  return {
    port,
    publicBaseUrl,
    plansUrl: urlEnv(env, "PLANS_URL", "https://mutescroll.xyz/plans"),
    trustProxy: boolEnv(env, "TRUST_PROXY", false),
    clientIpHeader: (env["CLIENT_IP_HEADER"] ?? "x-forwarded-for").trim().toLowerCase(),
    mcpMaxBodyBytes: intEnv(env, "MCP_MAX_BODY_BYTES", 256 * 1024, 1024, 16 * 1024 * 1024),
    maxUploadBytes: intEnv(env, "MAX_UPLOAD_BYTES", 2 * 1024 ** 3, 1024, 10 * 1024 ** 3),
    anonCredits: intEnv(env, "ANON_CREDITS", 5, 0, 100_000),
    anonQuotaWindowMs: intEnv(env, "ANON_QUOTA_WINDOW_SECONDS", 24 * 3600, 60, 31 * 24 * 3600) * 1000,
    anonRequestsPerMinute: intEnv(env, "ANON_REQUESTS_PER_MINUTE", 10, 1, 10_000),
    toolWaitMs: intEnv(env, "TOOL_WAIT_MS", 25_000, 0, 120_000),
    jobConcurrency: intEnv(env, "JOB_CONCURRENCY", 2, 1, 64),
    jobTtl: {
      activeMs: ACTIVE_JOB_TTL_MS,
      succeededMs: intEnv(env, "JOB_TTL_SECONDS", 24 * 3600, 60, 31 * 24 * 3600) * 1000,
      failedMs: intEnv(env, "JOB_FAILED_TTL_SECONDS", 3600, 60, 31 * 24 * 3600) * 1000,
    },
    uploadTokenTtlMs: intEnv(env, "UPLOAD_TOKEN_TTL_SECONDS", 3600, 60, 7 * 24 * 3600) * 1000,
    mediaMaxSeconds: intEnv(env, "MEDIA_MAX_SECONDS", 2 * 3600, 1, 24 * 3600),
    worker: {
      python: nonEmpty(env["MEDIA_WORKER_PYTHON"]) ?? (platform === "win32" ? "python" : "python3"),
      cwd: nonEmpty(env["MEDIA_WORKER_DIR"]),
      timeoutMs: intEnv(env, "MEDIA_WORKER_TIMEOUT_SECONDS", 900, 10, 6 * 3600) * 1000,
    },
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
