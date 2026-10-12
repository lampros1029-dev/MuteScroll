import { spawn } from "node:child_process";

import { MediaWorkerError } from "./errors.js";
import { parseWorkerOutput } from "./parse-output.js";
import type { WorkerTranscript } from "./transcript-schema.js";
import type { MediaWorker, WorkerRequest } from "./types.js";

export interface SubprocessWorkerOptions {
  /** Python interpreter with `mutescroll_media` installed (MEDIA_WORKER_PYTHON). */
  readonly python: string;
  /** Working directory for the child; `.env` discovery walks up from here (MEDIA_WORKER_DIR). */
  readonly cwd?: string | undefined;
  readonly timeoutMs: number;
  /** Environment for the child. Use `buildWorkerEnv` to pass only what the worker needs. */
  readonly env: NodeJS.ProcessEnv;
  readonly maxOutputBytes?: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

/** Only these variables reach the worker. The API's other secrets never leave this process. */
const PASSTHROUGH_ENV = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "DENO_DIR",
  "MUTESCROLL_CACHE_DIR",
  "GROQ_API_KEY",
  "SCRAPECREATORS_API_KEY",
  "MEDIA_EGRESS_PROXY_URL",
] as const;

export function buildWorkerEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
  for (const key of PASSTHROUGH_ENV) {
    const value = source[key];
    if (value !== undefined && value !== "") env[key] = value;
  }
  return env;
}

/** Argument array only (never a shell). `--` ends option parsing so a target can never be read as a flag. */
export function buildCliArgs(request: WorkerRequest): string[] {
  const target = request.target.kind === "url" ? request.target.url : request.target.path;
  return [
    "-m",
    "mutescroll_media.cli",
    "--json",
    "--language",
    request.language,
    "--max-seconds",
    String(request.maxSeconds),
    "--",
    target,
  ];
}

interface ProcessOutcome {
  readonly exitCode: number;
  readonly stdout: string;
}

export class SubprocessMediaWorker implements MediaWorker {
  constructor(private readonly options: SubprocessWorkerOptions) {}

  async transcribe(request: WorkerRequest): Promise<WorkerTranscript> {
    const outcome = await runProcess(this.options.python, buildCliArgs(request), this.options);
    return parseWorkerOutput(outcome.stdout, outcome.exitCode);
  }
}

function runProcess(command: string, args: string[], options: SubprocessWorkerOptions): Promise<ProcessOutcome> {
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      action();
    };
    const fail = (code: "worker_timeout" | "invalid_output" | "worker_unavailable"): void => {
      child.kill("SIGKILL");
      settle(() => reject(new MediaWorkerError(code)));
    };

    timer = setTimeout(() => fail("worker_timeout"), options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) return fail("invalid_output");
      chunks.push(chunk);
    });
    child.stderr.resume(); // drained, never logged: it can echo upstream platform text
    child.on("error", () => fail("worker_unavailable"));
    child.on("close", (code) => {
      settle(() => resolve({ exitCode: code ?? 1, stdout: Buffer.concat(chunks).toString("utf8") }));
    });
  });
}
