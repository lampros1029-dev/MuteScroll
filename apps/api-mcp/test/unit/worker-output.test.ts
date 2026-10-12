import { describe, expect, it } from "vitest";

import { errorCodeForExitCode, MediaWorkerError } from "../../src/worker/errors.js";
import { parseWorkerOutput } from "../../src/worker/parse-output.js";
import { buildCliArgs, buildWorkerEnv } from "../../src/worker/subprocess-worker.js";
import { transcriptFixture } from "../helpers/fixtures.js";

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof MediaWorkerError) return error.code;
    throw error;
  }
  throw new Error("expected a MediaWorkerError");
}

describe("parseWorkerOutput", () => {
  it("returns the transcript for exit 0 with a valid to_dict() payload", () => {
    const stdout = JSON.stringify(transcriptFixture(58));
    expect(parseWorkerOutput(stdout, 0).transcript_text).toBe("[00:00] Hello there");
  });

  it("rejects exit 0 with a payload that does not match the contract", () => {
    expect(codeOf(() => parseWorkerOutput('{"status":"completed"}', 0))).toBe("invalid_output");
    expect(codeOf(() => parseWorkerOutput("not json", 0))).toBe("invalid_output");
  });

  it("uses the machine-readable error code from the --json error object", () => {
    const stdout = JSON.stringify({ status: "error", error: { code: "blocked_bot_check", exit_code: 2 } });
    expect(codeOf(() => parseWorkerOutput(stdout, 2))).toBe("blocked_bot_check");
  });

  it("falls back to the exit-code mapping when the error object is missing or unknown", () => {
    expect(codeOf(() => parseWorkerOutput("", 4))).toBe("blocked");
    expect(codeOf(() => parseWorkerOutput("traceback...", 1))).toBe("worker_failed");
    const unknown = JSON.stringify({ status: "error", error: { code: "something_new", exit_code: 3 } });
    expect(codeOf(() => parseWorkerOutput(unknown, 3))).toBe("asr_error");
  });
});

describe("errorCodeForExitCode", () => {
  it.each([
    [2, "retrieval_failed"],
    [3, "asr_error"],
    [4, "blocked"],
    [5, "no_speech"],
    [6, "media_error"],
    [1, "worker_failed"],
    [99, "worker_failed"],
  ])("maps exit %i to %s", (exitCode, code) => {
    expect(errorCodeForExitCode(exitCode)).toBe(code);
  });
});

describe("buildCliArgs", () => {
  it("passes the URL as a separate argument after '--' and never through a shell", () => {
    const args = buildCliArgs({
      target: { kind: "url", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      language: "auto",
      maxSeconds: 7200,
    });
    expect(args).toEqual([
      "-m",
      "mutescroll_media.cli",
      "--json",
      "--language",
      "auto",
      "--max-seconds",
      "7200",
      "--",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ]);
  });

  it("keeps hostile-looking input as one literal argument", () => {
    const hostile = "https://example.com/x;rm -rf /";
    const args = buildCliArgs({ target: { kind: "url", url: hostile }, language: "en", maxSeconds: 60 });
    expect(args.at(-1)).toBe(hostile);
    expect(args.at(-2)).toBe("--");
  });

  it("uses the file path for upload targets", () => {
    const args = buildCliArgs({ target: { kind: "file", path: "/tmp/x/upload.mp4" }, language: "el", maxSeconds: 60 });
    expect(args.at(-1)).toBe("/tmp/x/upload.mp4");
  });
});

describe("buildWorkerEnv", () => {
  it("passes only the allow-listed variables to the worker", () => {
    const env = buildWorkerEnv({
      PATH: "/bin",
      GROQ_API_KEY: "gsk_test",
      DATABASE_URL: "postgres://secret",
      PADDLE_API_KEY: "pdl_secret",
      EMPTY: "",
    });
    expect(env["PATH"]).toBe("/bin");
    expect(env["GROQ_API_KEY"]).toBe("gsk_test");
    expect(env["PYTHONUTF8"]).toBe("1");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("PADDLE_API_KEY");
  });

  it("passes the vendor key so TikTok/Instagram retrieval works through the API", () => {
    const env = buildWorkerEnv({ SCRAPECREATORS_API_KEY: "sc_test" });
    expect(env["SCRAPECREATORS_API_KEY"]).toBe("sc_test");
  });
});
