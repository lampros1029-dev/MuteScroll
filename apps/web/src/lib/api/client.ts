import { csrfHeaders, readCsrf } from "../csrf";
import { uploadContentType, asciiFileName } from "../upload";

import { parseOutcome } from "./parse";
import type { ExportFormat, Failure, Outcome } from "./types";

/** Same-origin prefix. `app/api/[...path]/route.ts` proxies it to the REST service. */
export const API_BASE = "/api/v1";

export interface TranscribeInput {
  url: string;
  language: string;
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}

const NETWORK_FAILURE: Failure = {
  status: 0,
  code: "network_error",
  message: "",
};

export function exportUrl(jobId: string, format: ExportFormat): string {
  return `${API_BASE}/transcriptions/${encodeURIComponent(jobId)}/export?format=${format}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function send(url: string, init: RequestInit, options: RequestOptions, jobIdHint?: string): Promise<Outcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: options.signal ?? null });
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { kind: "error", failure: NETWORK_FAILURE };
  }
  const body = await readJson(response);
  return parseOutcome(response.status, body, jobIdHint);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function createTranscription(input: TranscribeInput, options: RequestOptions = {}): Promise<Outcome> {
  return send(
    `${API_BASE}/transcriptions`,
    {
      method: "POST",
      headers: csrfHeaders(true),
      body: JSON.stringify({ url: input.url, language: input.language }),
    },
    options,
  );
}

export function fetchJob(jobId: string, options: RequestOptions = {}): Promise<Outcome> {
  return send(
    `${API_BASE}/transcriptions/${encodeURIComponent(jobId)}`,
    { method: "GET", headers: { Accept: "application/json" } },
    options,
    jobId,
  );
}

export interface UploadOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
}

/**
 * Sends the raw file to POST /uploads (PRD 14). XHR is used because fetch cannot report
 * upload progress. The file name is sent ASCII-only in X-Filename; the server reads only its extension.
 */
export function uploadFile(file: File, options: UploadOptions = {}): Promise<Outcome> {
  const mime = uploadContentType(file.name);
  if (mime === null) {
    return Promise.resolve({
      kind: "error",
      failure: { status: 415, code: "unsupported_file", message: "" },
    });
  }

  return new Promise<Outcome>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/uploads`);
    xhr.setRequestHeader("Content-Type", mime);
    xhr.setRequestHeader("X-Filename", asciiFileName(file.name));
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("x-csrf-token", readCsrf());
    xhr.responseType = "text";

    xhr.upload.onprogress = (event: ProgressEvent) => {
      if (event.lengthComputable && event.total > 0) {
        options.onProgress?.(Math.min(1, event.loaded / event.total));
      }
    };
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText) as unknown;
      } catch {
        body = undefined;
      }
      resolve(parseOutcome(xhr.status, body));
    };
    xhr.onerror = () => resolve({ kind: "error", failure: NETWORK_FAILURE });
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    xhr.send(file);
  });
}
