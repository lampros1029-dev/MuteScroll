#!/usr/bin/env node
/**
 * Local stand-in for the MuteScroll REST API (docs/rest-api.md), so the web app can be built and
 * tested without the real backend. Canned data only, no network calls, no secrets.
 *
 * Add ?mock=<mode> to a link to pick a behaviour (the rest of the link is ignored):
 *   slow            202, completes after 25 s (exercises polling at the 3 s cadence)
 *   medium          202, completes after 6 s
 *   fail-retrieval  502 retrieval_failed with upload_url (charges nothing)
 *   async-fail      202, then the job reports failed with retrieval_failed
 *   no-speech       202, then the job reports failed with no_speech
 *   quota           429 quota_exceeded
 *   too-long        413 too_long
 *   rate            429 rate_limited
 * Without ?mock the link completes at once. Uploads take 4 s; a filename containing "fail" fails.
 */

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const ACCEPTED_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4a", "mp3", "wav"]);
const PLANS_URL = "https://mutescroll.xyz/plans";

const jobs = new Map();

function log(method, path, status, started) {
  const ms = Date.now() - started;
  console.log(`[mock-api] ${method} ${path} ${status} ${ms}ms`);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sendError(res, status, code, message, extra = {}) {
  sendJson(res, status, { error: { code, message, ...extra } });
}

function sendFile(res, body, contentType, filename) {
  const payload = Buffer.from(body, "utf8");
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": payload.length,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("too large"), { code: "TOO_LARGE" }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Drains a raw upload without keeping it, so a 50 MB limit costs no memory. */
function drainUpload(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
    });
    req.on("end", () => resolve(size));
    req.on("error", reject);
  });
}

function pad(value) {
  return value.toString().padStart(2, "0");
}

function clock(seconds, total) {
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return total >= 3600 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h * 60 + m)}:${pad(s)}`;
}

function stamp(seconds, total) {
  return `[${clock(seconds, total)}]`;
}

function readableDuration(seconds) {
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function srtTime(seconds, separator) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${rest.toString().padStart(3, "0")}`;
}

const FIXTURES = {
  youtube: {
    metadata: {
      platform: "youtube",
      content_type: "video",
      title: "How to read a transcript in 60 seconds (mock)",
      author: "Mock Channel",
      duration_seconds: 58,
    },
    method: "captions",
    segments: [
      { start: 0, end: 6.1, speaker: null, text: "Welcome back. In this clip I'll show you how to read a transcript quickly." },
      { start: 6.1, end: 13.8, speaker: null, text: "Start with the timestamps. They tell you where each claim was made." },
      { start: 13.8, end: 22.4, speaker: null, text: "Next, check the numbers. If the video says ten dollars, the transcript keeps ten dollars." },
      { start: 22.4, end: 36.0, speaker: null, text: "Flagged words deserve a second look. Play that moment and listen again." },
      { start: 36.0, end: 58, speaker: null, text: "That's it. Copy the text, export it, or ask your assistant for a summary." },
    ],
    uncertain: [],
    refs: [],
  },
  instagram: {
    metadata: {
      platform: "instagram",
      content_type: "reel",
      title: "Lumix S5 settings in 60 seconds (mock)",
      author: null,
      duration_seconds: 58,
    },
    method: "asr",
    segments: [
      { start: 0, end: 5.2, speaker: null, text: "Stop scrolling. This setting takes ten seconds and saves your night shots." },
      { start: 5.2, end: 12.6, speaker: null, text: "The kit costs $10 more with the grip, so skip it if you shoot in daylight." },
      { start: 12.6, end: 21.9, speaker: null, text: "Open the menu, pick Picture Style, then set the Lumix S5 preset to Neutral." },
      { start: 21.9, end: 34.4, speaker: null, text: "Set ISO to 400 and turn on long exposure noise reduction for the sky." },
      { start: 34.4, end: 58, speaker: null, text: "Full notes are in the link in my bio. Save this for your next shoot." },
    ],
    uncertain: [{ start: 12.6, end: 13.4, text: "Lumix S5", reason: "low_confidence" }],
    refs: [{ at: 34.5, phrase: "link in my bio" }],
  },
  tiktok: {
    metadata: {
      platform: "tiktok",
      content_type: "video",
      title: "Two voices on hooks (mock)",
      author: "@mock.creator",
      duration_seconds: 74,
    },
    method: "asr",
    segments: [
      { start: 0, end: 7.5, speaker: "SPEAKER_0", text: "Here is the hook that got three million views last week." },
      { start: 7.5, end: 15.2, speaker: "SPEAKER_1", text: "Which one? The one with the blue kettle, right?" },
      { start: 15.2, end: 27.8, speaker: "SPEAKER_0", text: "Yes. The first line is a question, and the second line gives the answer." },
      { start: 27.8, end: 41.0, speaker: "SPEAKER_1", text: "We used Kestrel's pricing page as the example, which is mostly clean copy." },
      { start: 41.0, end: 74, speaker: "SPEAKER_0", text: "Try it on your own product. Write the question first, then the answer." },
    ],
    uncertain: [{ start: 27.8, end: 33.4, text: "Kestrel's pricing page", reason: "low_confidence_segment" }],
    refs: [],
  },
  facebook: {
    metadata: {
      platform: "facebook",
      content_type: "video",
      title: "A long public lecture (mock)",
      author: "Mock Page",
      duration_seconds: 3725,
    },
    method: "asr",
    segments: [
      { start: 0, end: 12, speaker: null, text: "Thanks for coming. The talk runs about an hour, with questions at the end." },
      { start: 1500, end: 1512, speaker: null, text: "Half way through, the budget was 2 million and the team was four people." },
      { start: 3000, end: 3012, speaker: null, text: "The result, after one year, was 37 percent fewer support tickets." },
      { start: 3700, end: 3725, speaker: null, text: "Thank you. We will take questions now." },
    ],
    uncertain: [],
    refs: [],
  },
};

function fixtureFor(platform) {
  return FIXTURES[platform] ?? null;
}

function buildTranscription({ metadata, method, segments, uncertain, refs }) {
  const duration = metadata.duration_seconds ?? (segments.at(-1)?.end ?? 0);
  const numbers = new Map();
  const labelled = segments.map((segment) => {
    if (segment.speaker !== null && !numbers.has(segment.speaker)) numbers.set(segment.speaker, numbers.size + 1);
    return segment;
  });
  const transcript_text = labelled
    .map((segment) => {
      const prefix = segment.speaker === null ? "" : `Speaker ${numbers.get(segment.speaker)}: `;
      return `${stamp(segment.start, duration)} ${prefix}${segment.text}`;
    })
    .join("\n");
  return {
    metadata,
    language: "en",
    method,
    transcript_text,
    segments,
    uncertain_spans: uncertain,
    on_screen_references: refs,
    credits_charged: Math.max(1, Math.ceil(duration / 600)),
  };
}

function uploadFixture(fileName) {
  const base = fileName.replace(/\.[^.]+$/, "").trim() || "Uploaded file";
  return buildTranscription({
    metadata: {
      platform: "upload",
      content_type: "file",
      title: base,
      author: null,
      duration_seconds: 42,
    },
    method: "asr",
    segments: [
      { start: 0, end: 9.5, speaker: null, text: `This is the mock transcript for ${base}.` },
      { start: 9.5, end: 21.0, speaker: null, text: "Uploads run through the same pipeline and produce the same output." },
      { start: 21.0, end: 33.0, speaker: null, text: "The price was $10, and the date was 2026-10-12." },
      { start: 33.0, end: 42, speaker: null, text: "End of the mock upload." },
    ],
    uncertain: [{ start: 9.5, end: 11.0, text: "same output", reason: "low_confidence" }],
    refs: [],
  });
}

function platformFromHost(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "youtube";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch") return "facebook";
  return null;
}

function resetsAt() {
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return next.toUTCString();
}

function newJob(outcome, readyInMs) {
  const id = randomUUID();
  jobs.set(id, { id, readyAt: Date.now() + readyInMs, outcome });
  return id;
}

function completedOutcome(transcription) {
  return { type: "completed", transcription };
}

function failedOutcome(code, message, uploadUrl) {
  return { type: "failed", error: uploadUrl ? { code, message, upload_url: uploadUrl } : { code, message } };
}

function uploadLink() {
  return `http://localhost:${PORT}/upload/${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

async function handleTranscriptions(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString("utf8"));
  } catch (error) {
    if (error && error.code === "TOO_LARGE") return sendError(res, 413, "file_too_large", "Request is too large.");
    return sendError(res, 400, "invalid_url", "The request body must be JSON with a url field.");
  }

  const language = body?.language ?? "auto";
  if (typeof language !== "string" || !(language === "auto" || /^[a-z]{2}$/.test(language))) {
    return sendError(res, 400, "invalid_language", "Language must be 'auto' or a two-letter ISO 639-1 code such as 'en' or 'el'.");
  }

  let url;
  try {
    url = new URL(String(body?.url ?? ""));
  } catch {
    return sendError(res, 400, "invalid_url", "That doesn't look like a valid video link. Paste the full https:// link, or upload the file.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return sendError(res, 400, "unsafe_url", "Only public http(s) video links are accepted.");
  }

  const mode = (url.searchParams.get("mock") ?? "").toLowerCase();
  if (mode === "quota") {
    return sendError(res, 429, "quota_exceeded", `You've used this period's transcriptions. They reset on ${resetsAt()}. Plan details: ${PLANS_URL}`);
  }
  if (mode === "rate") {
    return sendError(res, 429, "rate_limited", "Too many requests in a short time. Try again in 30 seconds.");
  }
  if (mode === "too-long") {
    return sendError(res, 413, "too_long", `This video is 2 h 10 min; your current plan supports up to 60 min per video. Plan details: ${PLANS_URL}`);
  }
  if (mode === "fail-retrieval") {
    return sendError(res, 502, "retrieval_failed", "I couldn't retrieve this video right now. If you can see it, upload the file here and I'll transcribe it with the same quality.", { upload_url: uploadLink() });
  }

  const platform = platformFromHost(url.hostname);
  if (platform === null) {
    return sendError(res, 400, "unsupported_url", "This isn't a supported video link. Supported: YouTube, Shorts, TikTok, Instagram Reels, Facebook videos, or upload a file.");
  }
  const fixture = fixtureFor(platform);
  const transcription = buildTranscription({ ...fixture, metadata: { ...fixture.metadata } });

  if (mode === "async-fail") {
    const jobId = newJob(failedOutcome("retrieval_failed", "I couldn't retrieve this video right now.", uploadLink()), 3000);
    return sendJson(res, 202, { status: "processing", job_id: jobId });
  }
  if (mode === "no-speech") {
    const jobId = newJob(failedOutcome("no_speech", "I processed the video but found no meaningful speech (music or sound only)."), 3000);
    return sendJson(res, 202, { status: "processing", job_id: jobId });
  }
  if (mode === "slow") {
    const jobId = newJob(completedOutcome(transcription), 25000);
    return sendJson(res, 202, { status: "processing", job_id: jobId });
  }
  if (mode === "medium") {
    const jobId = newJob(completedOutcome(transcription), 6000);
    return sendJson(res, 202, { status: "processing", job_id: jobId });
  }

  const jobId = newJob(completedOutcome(transcription), 0);
  return sendJson(res, 200, { status: "completed", job_id: jobId, transcription });
}

function jobStatus(res, jobId) {
  const job = jobs.get(jobId);
  if (job === undefined) {
    return sendError(res, 404, "not_found", "No transcription was found for that job. It may have expired.");
  }
  if (Date.now() < job.readyAt) {
    return sendJson(res, 202, { status: "processing", job_id: job.id });
  }
  if (job.outcome.type === "failed") {
    return sendJson(res, 200, { status: "failed", job_id: job.id, error: job.outcome.error });
  }
  return sendJson(res, 200, { status: "completed", job_id: job.id, transcription: job.outcome.transcription });
}

function exportJob(res, jobId, format) {
  const job = jobs.get(jobId);
  if (job === undefined) return sendError(res, 404, "not_found", "No transcription was found for that job.");
  if (Date.now() < job.readyAt || job.outcome.type !== "completed") {
    return sendError(res, 409, "conflict", "This job has no finished transcript yet.");
  }
  const t = job.outcome.transcription;
  const base = (t.metadata.title || "transcript").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "transcript";
  const duration = t.metadata.duration_seconds ?? 0;

  switch (format) {
    case "txt":
      return sendFile(res, `${t.transcript_text}\n`, "text/plain; charset=utf-8", `${base}.txt`);
    case "md": {
      const facts = [`Platform: ${t.metadata.platform}`, `Duration: ${readableDuration(duration)}`, `Language: en`];
      const lines = t.segments.map((segment) => `${stamp(segment.start, duration)} ${segment.text}`);
      const markdown = [`# ${t.metadata.title}`, "", facts.join(" · "), "", ...lines, ""].join("\n");
      return sendFile(res, markdown, "text/markdown; charset=utf-8", `${base}.md`);
    }
    case "srt": {
      const cues = t.segments.map(
        (segment, index) => `${index + 1}\n${srtTime(segment.start, ",")} --> ${srtTime(segment.end, ",")}\n${segment.text}\n`,
      );
      return sendFile(res, `${cues.join("\n")}`, "application/x-subrip; charset=utf-8", `${base}.srt`);
    }
    case "vtt": {
      const cues = t.segments.map(
        (segment) => `${srtTime(segment.start, ".")} --> ${srtTime(segment.end, ".")}\n${segment.text}\n`,
      );
      return sendFile(res, `WEBVTT\n\n${cues.join("\n")}`, "text/vtt; charset=utf-8", `${base}.vtt`);
    }
    case "json":
      return sendFile(res, JSON.stringify(t, null, 2), "application/json; charset=utf-8", `${base}.json`);
    default:
      return sendError(res, 400, "bad_request", "Format must be one of txt, md, srt, vtt or json.");
  }
}

async function handleUpload(req, res) {
  const contentType = String(req.headers["content-type"] ?? "");
  if (!/^(video|audio)\//.test(contentType)) {
    await drainUpload(req);
    return sendError(res, 415, "unsupported_file", "This file type isn't supported. Accepted: MP4, MOV, WebM, M4A, MP3, WAV.");
  }
  const rawName = String(req.headers["x-filename"] ?? "");
  if (rawName === "") {
    await drainUpload(req);
    return sendError(res, 400, "bad_request", "The X-Filename header is required.");
  }
  let fileName = rawName;
  try {
    fileName = decodeURIComponent(rawName);
  } catch {
    fileName = rawName;
  }
  const extension = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
  if (!ACCEPTED_EXTENSIONS.has(extension)) {
    await drainUpload(req);
    return sendError(res, 415, "unsupported_file", "This file type isn't supported. Accepted: MP4, MOV, WebM, M4A, MP3, WAV.");
  }

  const size = await drainUpload(req);
  if (size > MAX_UPLOAD_BYTES) {
    return sendError(res, 413, "file_too_large", `This file is larger than the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB upload limit.`);
  }

  if (fileName.toLowerCase().includes("fail")) {
    const jobId = newJob(failedOutcome("asr_error", "The speech recognition step failed. Failed jobs never use credits."), 4000);
    return sendJson(res, 202, { status: "processing", job_id: jobId });
  }
  const jobId = newJob(completedOutcome(uploadFixture(fileName)), 4000);
  return sendJson(res, 202, { status: "processing", job_id: jobId });
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  const send = (status, handler) => {
    handler();
    log(method, path + url.search, status, started);
  };

  try {
    if (path === "/healthz" && method === "GET") {
      return send(200, () => sendJson(res, 200, { status: "ok", mock: true }));
    }
    if (path === "/v1/plans" && method === "GET") {
      return send(200, () =>
        sendJson(res, 200, {
          plans: [
            { id: "free", name: "Free", monthly_usd: 0, annual_usd: null },
            { id: "creator", name: "Creator", monthly_usd: 7.99, annual_usd: 59 },
            { id: "pro", name: "Pro", monthly_usd: 16.99, annual_usd: 119 },
            { id: "team", name: "Team / API", monthly_usd: 49, annual_usd: 468 },
          ],
        }),
      );
    }
    if (path === "/v1/transcriptions" && method === "POST") {
      await handleTranscriptions(req, res);
      return log(method, path, res.statusCode, started);
    }
    if (path === "/v1/uploads" && method === "POST") {
      await handleUpload(req, res);
      return log(method, path, res.statusCode, started);
    }
    const exportMatch = /^\/v1\/transcriptions\/([^/]+)\/export$/.exec(path);
    if (exportMatch && method === "GET") {
      exportJob(res, exportMatch[1], url.searchParams.get("format") ?? "");
      return log(method, path + url.search, res.statusCode, started);
    }
    const jobMatch = /^\/v1\/transcriptions\/([^/]+)$/.exec(path);
    if (jobMatch && method === "GET") {
      jobStatus(res, jobMatch[1]);
      return log(method, path, res.statusCode, started);
    }
    sendError(res, 404, "not_found", "No such endpoint.");
    return log(method, path, 404, started);
  } catch (error) {
    console.error("[mock-api] unexpected error", error);
    if (!res.headersSent) sendError(res, 500, "internal", "Something went wrong on our side.");
    return undefined;
  }
});

server.listen(PORT, () => {
  console.log(`[mock-api] MuteScroll mock API listening on http://localhost:${PORT} (canned data, no network)`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
