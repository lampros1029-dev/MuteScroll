import { WORKER_ERROR_CODES, type WorkerErrorCode } from "./types.js";

/** Typed failure from the worker bridge. `message` is the code only; upstream text is never kept. */
export class MediaWorkerError extends Error {
  readonly code: WorkerErrorCode;

  constructor(code: WorkerErrorCode) {
    super(code);
    this.name = "MediaWorkerError";
    this.code = code;
  }
}

const WORKER_ERROR_CODE_SET: ReadonlySet<string> = new Set(WORKER_ERROR_CODES);

export function isWorkerErrorCode(value: unknown): value is WorkerErrorCode {
  return typeof value === "string" && WORKER_ERROR_CODE_SET.has(value);
}

/** Fallback mapping when the worker did not print a JSON error object (PRD 13, cli.py exit codes). */
export function errorCodeForExitCode(exitCode: number): WorkerErrorCode {
  switch (exitCode) {
    case 2:
      return "retrieval_failed";
    case 3:
      return "asr_error";
    case 4:
      return "blocked";
    case 5:
      return "no_speech";
    case 6:
      return "media_error";
    default:
      return "worker_failed";
  }
}
