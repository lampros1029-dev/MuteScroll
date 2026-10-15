import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MediaWorkerError } from "../../src/worker/errors.js";
import { buildWorkerEnv, SubprocessMediaWorker } from "../../src/worker/subprocess-worker.js";

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MediaWorkerError) return error.code;
    throw error;
  }
  throw new Error("expected a MediaWorkerError");
}

const request = { target: { kind: "url", url: "https://example.com/video/sample" } as const, language: "auto", maxSeconds: 60 };

describe("SubprocessMediaWorker process failures", () => {
  it("reports worker_unavailable when the interpreter cannot be started", async () => {
    const worker = new SubprocessMediaWorker({
      python: "mutescroll-no-such-interpreter-xyz",
      timeoutMs: 10_000,
      env: buildWorkerEnv(process.env),
    });
    expect(await codeOf(worker.transcribe(request))).toBe("worker_unavailable");
  });

  it("kills a slow worker and reports worker_timeout", async () => {
    const worker = new SubprocessMediaWorker({ python: process.execPath, timeoutMs: 1, env: {} });
    expect(await codeOf(worker.transcribe(request))).toBe("worker_timeout");
  });
});

const integration = process.env["MUTESCROLL_MEDIA_INTEGRATION"] === "1";

describe.skipIf(!integration)("SubprocessMediaWorker against the real Python worker (opt-in)", () => {
  it("maps a real worker failure for a non-media file to a typed error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mutescroll-itest-"));
    try {
      const path = join(dir, "upload.mp4");
      await writeFile(path, "this is plain text, not media");
      const worker = new SubprocessMediaWorker({
        python: process.env["MEDIA_WORKER_PYTHON"] ?? "python",
        cwd: process.env["MEDIA_WORKER_DIR"],
        timeoutMs: 120_000,
        env: buildWorkerEnv(process.env),
      });
      const code = await codeOf(worker.transcribe({ target: { kind: "file", path }, language: "auto", maxSeconds: 60 }));
      expect(["media_error", "asr_error", "no_audio_track"]).toContain(code);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 150_000);
});
