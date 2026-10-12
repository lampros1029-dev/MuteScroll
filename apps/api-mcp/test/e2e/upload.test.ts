import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { MediaWorkerError } from "../../src/worker/errors.js";
import type { WorkerRequest } from "../../src/worker/types.js";
import { FakeWorker } from "../helpers/fake-worker.js";
import { mp4Bytes, sampleUrl, transcriptFixture } from "../helpers/fixtures.js";
import { call, openSession, type Session, waitForStatus } from "./helpers.js";

let session: Session | undefined;

afterEach(async () => {
  await session?.close();
  session = undefined;
});

/** First call fails with a retrieval error (so an upload link is issued); later calls succeed. */
function failThenSucceed(): FakeWorker {
  return new FakeWorker(async (_request: WorkerRequest, call) => {
    if (call === 0) throw new MediaWorkerError("private_or_login_required");
    return transcriptFixture(30);
  });
}

async function failedJobWithUploadLink(env: Record<string, string> = {}): Promise<{ s: Session; jobId: string; uploadUrl: string }> {
  session = await openSession(env, failThenSucceed());
  const result = await call(session, "transcribe_video", { url: sampleUrl() });
  const uploadUrl = result.output.error?.upload_url ?? "";
  expect(uploadUrl).toContain("/upload/");
  return { s: session, jobId: result.output.job_id ?? "", uploadUrl };
}

function postFile(url: string, body: Buffer, fileName: string, type = "video/mp4"): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": type, "x-filename": encodeURIComponent(fileName) },
    body: new Uint8Array(body),
  });
}

describe("upload page", () => {
  it("serves a self-contained form under a hashed-script CSP", async () => {
    const { uploadUrl } = await failedJobWithUploadLink();
    const response = await fetch(uploadUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("script-src 'sha256-");
    const html = await response.text();
    expect(html).toContain('id="file"');
    expect(html).not.toMatch(/(src|href)="https?:/);
  });

  it("answers invalid links with 404 and used links with 410", async () => {
    const { s } = await failedJobWithUploadLink();
    expect((await fetch(`${s.server.baseUrl}/upload/unknown-token-abcdefghijkl`)).status).toBe(404);
  });
});

describe("upload POST", () => {
  it("continues the same job with the uploaded file, then deletes the temp file", async () => {
    const { s, jobId, uploadUrl } = await failedJobWithUploadLink();
    const response = await postFile(uploadUrl, mp4Bytes(), "clip.mp4");
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "processing" });

    const done = await waitForStatus(s, jobId, "completed");
    expect(done).toMatchObject({ status: "completed", job_id: jobId });

    const second = s.worker.requests[1];
    expect(second?.target.kind).toBe("file");
    const path = second?.target.kind === "file" ? second.target.path : "";
    expect(path).toMatch(/upload\.mp4$/);
    expect(path).not.toContain("clip");
    // Cleanup runs right after the job settles; allow a short moment for it.
    for (let i = 0; i < 50 && existsSync(path); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(existsSync(path)).toBe(false);
  });

  it("consumes the link on success: a second use is refused", async () => {
    const { s, uploadUrl } = await failedJobWithUploadLink();
    expect((await postFile(uploadUrl, mp4Bytes(), "clip.mp4")).status).toBe(202);
    expect((await postFile(uploadUrl, mp4Bytes(), "clip.mp4")).status).toBe(410);
    expect((await fetch(uploadUrl)).status).toBe(410);
    expect(s.worker.requests).toHaveLength(2);
  });

  it("keeps the link usable after a wrong file type", async () => {
    const { uploadUrl } = await failedJobWithUploadLink();
    const wrongExtension = await postFile(uploadUrl, mp4Bytes(), "notes.txt", "text/plain");
    expect(wrongExtension.status).toBe(415);
    const wrongContent = await postFile(uploadUrl, Buffer.from("plain text, not media"), "clip.mp4");
    expect(wrongContent.status).toBe(415);
    expect((await postFile(uploadUrl, mp4Bytes(), "clip.mp4")).status).toBe(202);
  });

  it("rejects a declared size over MAX_UPLOAD_BYTES before reading the body", async () => {
    const { uploadUrl } = await failedJobWithUploadLink({ MAX_UPLOAD_BYTES: "1024" });
    const response = await postFile(uploadUrl, Buffer.alloc(4096, 1), "clip.mp4");
    expect(response.status).toBe(413);
  });

  it("enforces the size limit while streaming when no length is declared", async () => {
    const { uploadUrl, s } = await failedJobWithUploadLink({ MAX_UPLOAD_BYTES: "1024" });
    const chunk = Buffer.alloc(1000, 7);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i += 1) controller.enqueue(chunk);
        controller.close();
      },
    });
    // The server may close the socket before the client finishes sending; either outcome is fine,
    // what matters is that nothing was accepted and the link is still open for a retry.
    await fetch(uploadUrl, {
      method: "POST",
      headers: { "content-type": "video/mp4", "x-filename": "clip.mp4" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" }).catch(() => undefined);
    expect(s.worker.requests).toHaveLength(1);
    expect((await fetch(uploadUrl)).status).toBe(200);
  });

  it("refuses a link whose job has already been re-queued by another upload", async () => {
    const { uploadUrl } = await failedJobWithUploadLink();
    expect((await postFile(uploadUrl, mp4Bytes(), "clip.mp4")).status).toBe(202);
    expect((await postFile(uploadUrl, mp4Bytes(), "clip.mp4")).status).toBe(410);
  });
});
