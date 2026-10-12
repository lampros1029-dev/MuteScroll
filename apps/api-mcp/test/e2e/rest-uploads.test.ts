import { describe, expect, it } from "vitest";

import { periodKey } from "../../src/billing/period.js";
import { mp4Bytes } from "../helpers/fixtures.js";
import { FakeWorker, delay } from "../helpers/fake-worker.js";
import { api, sessionHeaders, signUp, type AccountSession } from "../helpers/rest.js";
import type { RunningServer } from "../helpers/harness.js";
import { STORE_MODES } from "../helpers/postgres.js";
import { serverStarter } from "../helpers/suite.js";

function upload(server: RunningServer, body: Uint8Array, fileName: string, type = "video/mp4", extra: Record<string, string> = {}) {
  return api(server, "/v1/uploads", {
    method: "POST",
    body,
    headers: { "content-type": type, "x-filename": encodeURIComponent(fileName), ...extra },
  });
}

async function waitForCompleted(server: RunningServer, jobId: string, cookie: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const result = await api(server, `/v1/transcriptions/${jobId}`, { headers: { cookie } });
    if (result.status === 200) return;
    await delay(10, undefined);
  }
  throw new Error("upload job did not complete");
}

describe.each(STORE_MODES)("REST uploads on $name stores", (mode) => {
  const start = serverStarter(mode);

  it("accepts a video from an account as a new job, processes it, and charges the account", async () => {
    const worker = new FakeWorker();
    const server = await start({}, worker);
    const account = await signUp(server);
    const result = await upload(server, new Uint8Array(mp4Bytes()), "clip.mp4", "video/mp4", { cookie: account.cookie, "x-csrf-token": account.csrf });
    expect(result.status).toBe(202);
    expect(result.body).toEqual({ status: "processing", job_id: expect.stringMatching(/^job_/) });

    await waitForCompleted(server, result.body.job_id, account.cookie);
    expect(worker.requests[0]?.target.kind).toBe("file");
    const path = worker.requests[0]?.target.kind === "file" ? worker.requests[0].target.path : "";
    expect(path).toMatch(/upload\.mp4$/);
    expect(path).not.toContain("clip");
    const me = await api(server, "/v1/me", { headers: { cookie: account.cookie } });
    expect(me.body.credits.remaining).toBe(19);
  });

  it("gives each upload its own job, even for identical bytes", async () => {
    const server = await start({}, new FakeWorker());
    const account = await signUp(server);
    const headers = sessionHeaders(account);
    const first = await api(server, "/v1/uploads", { method: "POST", body: new Uint8Array(mp4Bytes()), headers: { ...headers, "content-type": "video/mp4", "x-filename": "a.mp4" } });
    const second = await api(server, "/v1/uploads", { method: "POST", body: new Uint8Array(mp4Bytes()), headers: { ...headers, "content-type": "video/mp4", "x-filename": "a.mp4" } });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(first.body.job_id).not.toBe(second.body.job_id);
  });

  it("refuses a non-media Content-Type with 415 before reading the file", async () => {
    const server = await start();
    const notMedia = await upload(server, new Uint8Array(mp4Bytes()), "clip.mp4", "text/plain");
    expect(notMedia.status).toBe(415);
    expect(notMedia.body.error.code).toBe("unsupported_media_type");
    const generic = await upload(server, new Uint8Array(mp4Bytes()), "clip.mp4", "application/octet-stream");
    expect(generic.status).toBe(415);
  });

  it("refuses a file whose extension or bytes do not match a supported media type with 415", async () => {
    const worker = new FakeWorker();
    const server = await start({}, worker);
    const wrongExtension = await upload(server, new Uint8Array(mp4Bytes()), "notes.txt");
    expect(wrongExtension.status).toBe(415);
    expect(wrongExtension.body.error.code).toBe("unsupported_file_type");
    const wrongBytes = await upload(server, new Uint8Array(Buffer.from("plain text, not media")), "clip.mp4");
    expect(wrongBytes.status).toBe(415);
    expect(wrongBytes.body.error.code).toBe("unsupported_file_type");
    expect(worker.requests).toHaveLength(0);
  });

  it("requires the X-Filename header", async () => {
    const server = await start();
    const result = await api(server, "/v1/uploads", { method: "POST", body: new Uint8Array(mp4Bytes()), headers: { "content-type": "video/mp4" } });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("invalid_request");
  });

  it("refuses a body over MAX_UPLOAD_BYTES with 413", async () => {
    const server = await start({ MAX_UPLOAD_BYTES: "1024" });
    const result = await upload(server, new Uint8Array(4096).fill(1), "clip.mp4");
    expect(result.status).toBe(413);
    expect(result.body.error.code).toBe("too_large");
  });

  it("requires the CSRF echo for a cookie session", async () => {
    const server = await start();
    const account = await signUp(server);
    const result = await upload(server, new Uint8Array(mp4Bytes()), "clip.mp4", "video/mp4", { cookie: account.cookie });
    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe("csrf_failed");
  });

  it("charges anonymous uploads to the IP quota and refuses them with 429 once it is spent", async () => {
    const server = await start({ ANON_CREDITS: "0" }, new FakeWorker());
    const result = await upload(server, new Uint8Array(mp4Bytes()), "clip.mp4");
    expect(result.status).toBe(429);
    expect(result.body.error.code).toBe("quota_exceeded");
  });

  it("refuses an account upload with 402 when the plan's credits are spent", async () => {
    const worker = new FakeWorker();
    const server = await start({}, worker);
    const account: AccountSession = await signUp(server);
    const user = await server.ctx.stores.users.findByEmail(account.email);
    if (user === undefined) throw new Error("account missing");
    await server.ctx.stores.ledger.reserve({
      userId: user.id,
      jobId: "job_spent",
      runKey: "spent-run",
      period: periodKey(Date.now()),
      credits: 20,
      allowance: 20,
      now: Date.now(),
    });
    const result = await upload(server, new Uint8Array(mp4Bytes()), "clip.mp4", "video/mp4", sessionHeaders(account));
    expect(result.status).toBe(402);
    expect(result.body.error.code).toBe("quota_exceeded");
    expect(worker.requests).toHaveLength(0);
  });
});
