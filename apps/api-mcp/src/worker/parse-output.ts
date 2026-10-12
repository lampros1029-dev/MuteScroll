import { errorCodeForExitCode, isWorkerErrorCode, MediaWorkerError } from "./errors.js";
import { workerTranscriptSchema, type WorkerTranscript } from "./transcript-schema.js";
import type { WorkerErrorCode } from "./types.js";

/**
 * Turns the worker process outcome into a transcript or a typed error.
 * Success: exit 0 with the `to_dict()` JSON on stdout.
 * Failure: non-zero exit with `{"status":"error","error":{"code":...}}` on stdout (cli.py --json),
 * or the exit-code mapping when that object is missing.
 */
export function parseWorkerOutput(stdout: string, exitCode: number): WorkerTranscript {
  if (exitCode === 0) return parseSuccess(stdout);
  throw new MediaWorkerError(errorCodeFromStdout(stdout) ?? errorCodeForExitCode(exitCode));
}

function parseSuccess(stdout: string): WorkerTranscript {
  const json = tryParseJson(stdout);
  const parsed = workerTranscriptSchema.safeParse(json);
  if (!parsed.success) throw new MediaWorkerError("invalid_output");
  return parsed.data;
}

function errorCodeFromStdout(stdout: string): WorkerErrorCode | null {
  const json = tryParseJson(stdout);
  if (typeof json !== "object" || json === null || !("error" in json)) return null;
  const error = (json as { error: unknown }).error;
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code: unknown }).code;
  return isWorkerErrorCode(code) ? code : null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
