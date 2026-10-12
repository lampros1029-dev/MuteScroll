import { describe, expect, it } from "vitest";

import { MediaWorkerError } from "../../src/worker/errors.js";
import { FakeWorker, delay } from "../helpers/fake-worker.js";
import { sampleUrl, transcriptFixture } from "../helpers/fixtures.js";
import { api, bearer, createKey, sessionHeaders, signUp, type AccountSession } from "../helpers/rest.js";
import type { RunningServer } from "../helpers/harness.js";
import { STORE_MODES } from "../helpers/postgres.js";
import { serverStarter } from "../helpers/suite.js";

async function transcribe(server: RunningServer, url: string, session?: AccountSession) {
  const headers = session === undefined ? {} : sessionHeaders(session);
  return api(server, "/v1/transcriptions", { method: "POST", headers, json: { url } });
}

/** Polls until a check passes: settlement runs just after the job record turns terminal. */
async function eventually(check: () => Promise<boolean> | boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await delay(10, undefined);
  }
}

async function remainingFor(server: RunningServer, session: AccountSession): Promise<number> {
  return (await api(server, "/v1/me", { headers: { cookie: session.cookie } })).body.credits.remaining;
}

describe.each(STORE_MODES)("REST transcriptions on $name stores", (mode) => {
  const start = serverStarter(mode);

  it("completes an anonymous request inline with the Transcription object", async () => {
    const server = await start();
    const result = await transcribe(server, sampleUrl("aaaaaaaaaaa"));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: "completed",
      job_id: expect.stringMatching(/^job_/),
      transcription: {
        metadata: { platform: "youtube", content_type: "video", title: "Demo", duration_seconds: 60 },
        language: "en",
        method: "asr",
        transcript_text: "[00:00] Hello there",
        credits_charged: 1,
      },
    });
    expect(result.body.transcription).not.toHaveProperty("source");
    expect(result.body.transcription.segments).toEqual([{ start: 0, end: 2, speaker: null, text: "Hello there" }]);
  });

  it("answers 202 with a job_id while the worker runs, and GET completes it", async () => {
    const worker = new FakeWorker(() => delay(150, transcriptFixture()));
    const server = await start({ TOOL_WAIT_MS: "20" }, worker);
    const started = await transcribe(server, sampleUrl("bbbbbbbbbbb"));
    expect(started.status).toBe(202);
    expect(started.body).toEqual({ status: "processing", job_id: expect.stringMatching(/^job_/) });

    let finished = await api(server, `/v1/transcriptions/${started.body.job_id}`);
    for (let i = 0; i < 100 && finished.status === 202; i += 1) {
      await delay(20, undefined);
      finished = await api(server, `/v1/transcriptions/${started.body.job_id}`);
    }
    expect(finished.status).toBe(200);
    expect(finished.body.status).toBe("completed");
  });

  it("answers a failed retrieval with 502, an upload link, and no charge", async () => {
    const worker = new FakeWorker(async () => {
      throw new MediaWorkerError("private_or_login_required");
    });
    const server = await start({}, worker);
    const result = await transcribe(server, sampleUrl("ccccccccccc"));
    expect(result.status).toBe(502);
    expect(result.body.error).toMatchObject({ code: "private_or_login_required" });
    expect(result.body.error.upload_url).toMatch(new RegExp(`^${server.baseUrl}/upload/[A-Za-z0-9_-]{16,}$`));
    expect(result.body).not.toHaveProperty("job_id");
    expect(result.text).not.toMatch(/stack|Error:/);
    await eventually(() => server.ctx.quota.remaining("127.0.0.1") === 5);
  });

  it("charges an account one credit per started 10 minutes, and a failed job nothing", async () => {
    const worker = new FakeWorker(async (request) => {
      if (request.target.kind === "url" && request.target.url.endsWith("aaaaaaaaaaa")) throw new MediaWorkerError("retrieval_failed");
      return transcriptFixture(1500);
    });
    const server = await start({}, worker);
    const account = await signUp(server);

    const failed = await transcribe(server, sampleUrl("aaaaaaaaaaa"), account);
    expect(failed.status).toBe(502);
    await eventually(async () => (await remainingFor(server, account)) === 20);

    const ok = await transcribe(server, sampleUrl("bbbbbbbbbbb"), account);
    expect(ok.status).toBe(200);
    expect(ok.body.transcription.credits_charged).toBe(3);
    await eventually(async () => (await remainingFor(server, account)) === 17);
  });

  it("returns 402 for an account out of credits and 429 for an anonymous caller out of quota", async () => {
    const worker = new FakeWorker(async () => transcriptFixture(600));
    const server = await start({ TOOL_WAIT_MS: "100" }, worker);
    const account = await signUp(server);
    for (let i = 0; i < 20; i += 1) {
      const ok = await transcribe(server, sampleUrl(`z${String(i).padStart(10, "0")}`), account);
      expect(ok.status).toBe(200);
    }
    await eventually(async () => (await remainingFor(server, account)) === 0);
    const refused = await transcribe(server, sampleUrl("zzzzzzzzzzz"), account);
    expect(refused.status).toBe(402);
    expect(refused.body.error.code).toBe("quota_exceeded");
    expect(refused.body.error.message).toContain("https://mutescroll.xyz/plans");

    const anonymous = await start({ ANON_CREDITS: "2" }, new FakeWorker());
    expect((await transcribe(anonymous, sampleUrl("anon0000001"))).status).toBe(200);
    expect((await transcribe(anonymous, sampleUrl("anon0000002"))).status).toBe(200);
    const limited = await transcribe(anonymous, sampleUrl("anon0000003"));
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("quota_exceeded");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("joins an identical live request from the same account and does not charge again", async () => {
    const server = await start();
    const account = await signUp(server);
    const first = await transcribe(server, sampleUrl("dddddddddd1"), account);
    const second = await transcribe(server, sampleUrl("dddddddddd1"), account);
    expect(second.body.job_id).toBe(first.body.job_id);
    await eventually(async () => (await remainingFor(server, account)) === 19);
  });

  it("refuses invalid, unsupported and unsafe links before doing any work", async () => {
    const worker = new FakeWorker();
    const server = await start({}, worker);
    const cases: Array<[string, string]> = [
      ["not a link", "invalid_url"],
      ["https://www.tiktok.com/@someone", "unsupported_url"],
      ["http://127.0.0.1/video.mp4", "unsafe_url"],
    ];
    for (const [url, code] of cases) {
      const result = await transcribe(server, url);
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe(code);
    }
    expect(worker.requests).toHaveLength(0);
  });

  it("refuses a malformed language, and a missing or non-string URL", async () => {
    const server = await start();
    const badLanguage = await api(server, "/v1/transcriptions", { method: "POST", json: { url: sampleUrl(), language: "english" } });
    expect(badLanguage.status).toBe(400);
    expect(badLanguage.body.error.code).toBe("invalid_language");
    const numericLanguage = await api(server, "/v1/transcriptions", { method: "POST", json: { url: sampleUrl(), language: 5 } });
    expect(numericLanguage.body.error.code).toBe("invalid_language");
    const noUrl = await api(server, "/v1/transcriptions", { method: "POST", json: { language: "en" } });
    expect(noUrl.status).toBe(400);
    expect(noUrl.body.error.code).toBe("invalid_request");
  });

  it("passes the plan's length cap to the worker: 10 minutes for free accounts", async () => {
    const worker = new FakeWorker();
    const server = await start({}, worker);
    const account = await signUp(server);
    await transcribe(server, sampleUrl("eeeeeeeee01"), account);
    await transcribe(server, sampleUrl("eeeeeeeee02"));
    expect(worker.requests[0]?.maxSeconds).toBe(600);
    expect(worker.requests[1]?.maxSeconds).toBe(7200);
  });

  it("answers an unknown job id with 404 without echoing it", async () => {
    const server = await start();
    const result = await api(server, "/v1/transcriptions/job_does_not_exist");
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe("not_found");
    expect(result.text).not.toContain("job_does_not_exist");
  });

  it("keeps an account's jobs to its owner: other accounts and anonymous callers get 404", async () => {
    const server = await start();
    const alice = await signUp(server);
    const bob = await signUp(server);
    const made = await transcribe(server, sampleUrl("ffffffffff1"), alice);
    const jobId = made.body.job_id as string;

    expect((await api(server, `/v1/transcriptions/${jobId}`, { headers: { cookie: bob.cookie } })).status).toBe(404);
    expect((await api(server, `/v1/transcriptions/${jobId}`)).status).toBe(404);
    expect((await api(server, `/v1/transcriptions/${jobId}/export?format=txt`)).status).toBe(404);
    expect((await api(server, `/v1/transcriptions/${jobId}`, { method: "DELETE", headers: sessionHeaders(bob) })).status).toBe(404);
    expect((await api(server, `/v1/transcriptions/${jobId}`, { headers: { cookie: alice.cookie } })).status).toBe(200);
  });

  it("lets anyone holding an anonymous job_id read it, which is the anonymous capability model", async () => {
    const server = await start();
    const made = await transcribe(server, sampleUrl("gggggggggg1"));
    const account = await signUp(server);
    const read = await api(server, `/v1/transcriptions/${made.body.job_id}`, { headers: { cookie: account.cookie } });
    expect(read.status).toBe(200);
    expect(read.body.status).toBe("completed");
  });

  it("exports SRT, VTT, TXT, Markdown and JSON with download headers", async () => {
    const server = await start();
    const made = await transcribe(server, sampleUrl("hhhhhhhhhh1"));
    const jobId = made.body.job_id as string;
    const base = `/v1/transcriptions/${jobId}/export`;

    const srt = await api(server, `${base}?format=srt`);
    expect(srt.status).toBe(200);
    expect(srt.headers.get("content-type")).toBe("application/x-subrip; charset=utf-8");
    expect(srt.headers.get("content-disposition")).toBe(`attachment; filename="transcript-${jobId}.srt"`);
    expect(srt.text).toBe("1\n00:00:00,000 --> 00:00:02,000\nHello there\n");

    const vtt = await api(server, `${base}?format=vtt`);
    expect(vtt.headers.get("content-type")).toBe("text/vtt; charset=utf-8");
    expect(vtt.text).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello there\n");

    const txt = await api(server, base);
    expect(txt.headers.get("content-disposition")).toContain(".txt");
    expect(txt.text).toBe("[00:00] Hello there\n");

    const md = await api(server, `${base}?format=md`);
    expect(md.text.startsWith("# Demo\n\n")).toBe(true);
    expect(md.text).toContain("[00:00] Hello there");

    const json = await api(server, `${base}?format=json`);
    expect(json.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(json.body).toMatchObject({ metadata: { title: "Demo" }, credits_charged: 1 });

    expect((await api(server, `${base}?format=pdf`)).status).toBe(400);
  });

  it("refuses to export a job that is still running (409) or has failed (409)", async () => {
    const worker = new FakeWorker(async (_request, call) => {
      if (call === 0) {
        await delay(400, undefined);
        return transcriptFixture();
      }
      throw new MediaWorkerError("retrieval_failed");
    });
    const server = await start({ TOOL_WAIT_MS: "20" }, worker);
    const account = await signUp(server);
    const running = await transcribe(server, sampleUrl("iiiiiiiiii1"), account);
    expect(running.status).toBe(202);
    const early = await api(server, `/v1/transcriptions/${running.body.job_id}/export?format=srt`, { headers: { cookie: account.cookie } });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("not_ready");

    await transcribe(server, sampleUrl("iiiiiiiiii2"), account);
    let failedId = "";
    await eventually(async () => {
      const library = await api(server, "/v1/library", { headers: { cookie: account.cookie } });
      failedId = library.body.items.find((item: { status: string }) => item.status === "failed")?.id ?? "";
      return failedId !== "";
    });
    const failed = await api(server, `/v1/transcriptions/${failedId}/export?format=srt`, { headers: { cookie: account.cookie } });
    expect(failed.status).toBe(409);
    expect(failed.body.error.code).toBe("job_failed");
  });

  it("returns the failure with HTTP 200 when a GET finds a failed job, with a fresh upload link", async () => {
    const worker = new FakeWorker(async () => {
      throw new MediaWorkerError("blocked_bot_check");
    });
    const server = await start({}, worker);
    const account = await signUp(server);
    expect((await transcribe(server, sampleUrl("jjjjjjjjjj1"), account)).status).toBe(502);
    const library = await api(server, "/v1/library", { headers: { cookie: account.cookie } });
    const jobId = library.body.items[0]?.id as string;
    const read = await api(server, `/v1/transcriptions/${jobId}`, { headers: { cookie: account.cookie } });
    expect(read.status).toBe(200);
    expect(read.body).toEqual({
      status: "failed",
      error: expect.objectContaining({ code: "blocked_bot_check", upload_url: expect.stringContaining("/upload/") }),
    });
  });

  it("deletes a finished job, refuses to delete a running one, and deleted jobs are gone", async () => {
    const worker = new FakeWorker(async (_request, call) => {
      if (call === 0) {
        await delay(400, undefined);
      }
      return transcriptFixture();
    });
    const server = await start({ TOOL_WAIT_MS: "20" }, worker);
    const account = await signUp(server);
    const running = await transcribe(server, sampleUrl("kkkkkkkkkk1"), account);
    const jobId = running.body.job_id as string;
    const refused = await api(server, `/v1/transcriptions/${jobId}`, { method: "DELETE", headers: sessionHeaders(account) });
    expect(refused.status).toBe(409);

    const readOwn = () => api(server, `/v1/transcriptions/${jobId}`, { headers: { cookie: account.cookie } });
    for (let i = 0; i < 100 && (await readOwn()).status === 202; i += 1) {
      await delay(20, undefined);
    }
    const deleted = await api(server, `/v1/transcriptions/${jobId}`, { method: "DELETE", headers: sessionHeaders(account) });
    expect(deleted.status).toBe(204);
    expect((await readOwn()).status).toBe(404);
  });

  it("lists the account's jobs newest first with title, platform and status, and pages the list", async () => {
    const server = await start();
    const account = await signUp(server);
    await transcribe(server, sampleUrl("llllllllll1"), account);
    await delay(5, undefined);
    const newest = await transcribe(server, sampleUrl("llllllllll2"), account);

    const library = await api(server, "/v1/library", { headers: { cookie: account.cookie } });
    expect(library.status).toBe(200);
    expect(library.body.items).toHaveLength(2);
    expect(library.body.items[0]).toMatchObject({
      id: newest.body.job_id,
      title: "Demo",
      platform: "youtube",
      status: "succeeded",
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });

    const page = await api(server, "/v1/library?limit=1&offset=1", { headers: bearer((await createKey(server, account)).key) });
    expect(page.body.items).toHaveLength(1);
    expect(page.body.limit).toBe(1);
  });

  it("never shares an account's job with another account, even for the same URL", async () => {
    const server = await start();
    const alice = await signUp(server);
    const bob = await signUp(server);
    const a = await transcribe(server, sampleUrl("mmmmmmmmmm1"), alice);
    const b = await transcribe(server, sampleUrl("mmmmmmmmmm1"), bob);
    expect(a.body.job_id).not.toBe(b.body.job_id);
    expect(b.body.transcription.credits_charged).toBe(1);
  });
});
