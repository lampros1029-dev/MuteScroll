# MuteScroll — Product Requirements Document

| Field | Value |
|---|---|
| Product | **MuteScroll** — read any video, right inside your AI chat |
| Surfaces | ChatGPT app (Apps SDK / MCP) · Claude, Cursor & any MCP client · Web app · REST API |
| Version | PRD v2.0 (MVP scope) |
| Date | 2026-10-12 |
| Repo | [lampros1029-dev/MuteScroll](https://github.com/lampros1029-dev/MuteScroll) (private) |
| Status | Approved for build. Decisions D1–D8 accepted (§24); starting M0 |

### Changelog

- **v2.0 (2026-10-12)**: rewrite. Added the platform-policy constraints that change the business model (§4), competitive and open-source landscape (§3), a retrieval strategy that survives datacenter IP blocking (§9), the "ears first, eyes when needed" accuracy model (§11), a tool contract compliant with the ChatGPT app guidelines (§8), unit economics (§19), and a Hormozi-based pricing and offer model (§20). Original v1.0 requirements were kept and tightened.
- **v1.0**: initial "Universal Video Transcriber for ChatGPT" PRD.

---

## 1. Summary

MuteScroll turns a video link into a timestamped, trustworthy transcript **inside the AI assistant the user already works in**: ChatGPT, Claude, Cursor or any MCP client. The assistant then does what it is good at: summarizing, translating, extracting hooks, fact-checking, comparing.

```
Today:   Video → download → extract audio → transcription site → copy → paste into ChatGPT → analyze
MuteScroll:  "Transcribe this: <URL>" → transcript in the chat → "Now give me the 3 hooks in Greek"
```

**Division of labour (core design principle).** MuteScroll does one thing extremely well, which is getting reliable, structured video-to-text data. The host LLM does the understanding. MuteScroll is not trying to be an assistant.

**Name rationale.** People "mute-scroll" short video all day. MuteScroll lets you *read* it instead. It's a brand name, not a generic dictionary term, which the directory requires (§4.1).

---

## 2. Users and jobs-to-be-done

| Persona | Job to be done | Frequency | Willingness to pay |
|---|---|---|---|
| **Short-form creator / UGC creator** | "Give me the script and hook of this viral Reel so I can model it" | Daily, 5–50 videos | Medium: already pays $5–10 for single-purpose tools (§3.1) |
| **Marketer / agency** | "Transcribe every video from these 10 competitors and tell me the angles" | Weekly, batches of 50–500 | High: buys on time saved; needs bulk + API |
| **Researcher / journalist / student** | "What exactly did this person say, and when?" | Ad hoc, longer videos | Low–medium: values accuracy and quotes with timestamps |
| **Developer / AI-agent builder** | "Give my agent ears for video URLs" | Programmatic | Medium: pays per usage via API/MCP |
| **Language learner / non-native viewer** | "Transcript + translation of this Greek/Spanish video" | Daily | Low: free-tier heavy |

**Primary MVP persona:** the short-form creator/marketer who already lives in ChatGPT or Claude. They have the highest frequency and the clearest pain.

---

## 3. Market and prior art

### 3.1 Commercial competitors (pricing checked 2026-10)

| Product | Free tier | Paid | Notes |
|---|---|---|---|
| [ReelScribe](https://reelscribe.app/pricing) | 25 credits | $4.99/400 videos · $9.99/1,000 · $24.99/3,000 · $59.99/10,000 | Credits roll over (≤2×), REST API, **MCP server**, n8n node, SRT/VTT, bulk CSV. Founder-price lock as urgency. |
| [TokScript](https://tokscript.com/pricing) | 5/day | $10/mo · **$39/yr** · $199 lifetime | **MCP access**, profile/channel bulk, AI script writer, hook generator. Annual heavily anchored. |
| [ManyScripts](https://www.manyscripts.com/pricing) | 1/day anon, 5/day signed in, ≤20 min | $10/mo · $49.99/yr | 6 platforms incl. X and Xiaohongshu, "Creator Mode" search, ChatGPT/Claude access. |
| [TransClipper](https://transclipper.ai/pricing) | 3/day, ≤60 s | $9.99/mo ($7.42 annual) · $24.99 | Creator tracking, AI "agent runs", transcript API quota. |
| [TokTranscript](https://toktranscript.com/pricing) | 10/mo | $55/yr · $168/yr | TikTok-only, "Viral Breakdown", "Script Remix". |

**What this tells us:**

1. **Transcription alone is a commodity.** It is priced at $4–10/month or less than $0.01 per video. We cannot win on "we transcribe"; we win on **where** (inside the AI chat), **how well** (accuracy guarantees, on-screen text, numbers), and **what comes next** (multi-video research).
2. **MCP is not a moat.** ReelScribe and TokScript already ship MCP. The moat must be quality, reliability, UX polish inside ChatGPT/Claude, and the research workflows (§23).
3. **Annual and founder pricing are the market's conversion levers.** Everyone anchors heavily on annual plans.
4. **Value-adds converge on "creator intelligence":** hooks, script remix, virality breakdown, creator tracking. In MuteScroll the host LLM does this analysis for free, so we can ship these as **prompt-level skills** rather than costly features.

### 3.2 Open-source prior art (what we reuse vs. learn from)

| Repo | Stack | What we take | What we avoid |
|---|---|---|---|
| [woosal1337/media-mcp](https://github.com/woosal1337/media-mcp) (MIT) | TS, whisper.cpp, yt-dlp, Cobalt | **"Ears always, eyes only when ears fail"**: per-token confidence → *uncertainty zones* + *demonstrative phrases* ("in the bio", "this command") → `get_video_frames_at(timestamps[])` so the LLM reads on-screen text with its own vision. **Captions first, ASR second.** sha256(URL) video cache with 24 h TTL. "One tool, one job." | Twitter scope creep (26 tools); session-cookie Instagram access. |
| [TheSethRose/Social-Media-Video-Transcriber](https://github.com/TheSethRose/Social-Media-Video-Transcriber) (MIT per README) | Python, yt-dlp, parakeet-mlx | **Provider plug-in architecture** ("add a file, nothing else changes"); **audio speed-up (2–3× with pitch preservation)** as a cost lever; playlist/channel expansion; existing-subtitle extraction. | parakeet-mlx is Apple-Silicon only (not usable on Linux servers); LLM "enhancement" that rewrites text (violates §11). |
| [royalashu4u/voxi](https://github.com/royalashu4u/voxi) (MIT) | Python, faster-whisper, Textual | Result **cache**, transcript **history**, two-tool MCP surface (`transcribe_video`, `…_with_timestamps`), `[MM:SS → MM:SS]` format. | Instagram via user cookies, which we cannot do (§4.3). |
| [nhatvu148/video-transcriber-mcp](https://github.com/nhatvu148/video-transcriber-mcp) | TS, whisper.cpp | Retries with exponential backoff; 1000+ yt-dlp sites "for free"; local-file input. | — |
| [raultov/media-transcriber-mcp](https://github.com/raultov/media-transcriber-mcp) | yt-dlp, Whisper | `output_format: text / text_speakers / srt`; `task: translate` flag; chunking for long audio. | Browser-cookie extraction. |
| [u2n4/video-url-analyzer-mcp](https://github.com/u2n4/video-url-analyzer-mcp) | FastMCP, Gemini | **Background jobs to avoid client timeouts**; optional multimodal (audio + visual) pass via Gemini Flash as a premium "eyes" mode. | Unofficial third-party APIs (tikwm), anti-bot impersonation, both of which conflict with §4.2. |
| [jadenmaciel/transcript](https://github.com/jadenmaciel/transcript) | Python, uv | Lazy model loading; caption-first for YouTube; batch of mixed URLs. | — |

**Core building blocks:** [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), ffmpeg, [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT), WhisperX (BSD-2; word alignment + pyannote diarization, gated models), [Cobalt](https://github.com/imputnet/cobalt) (**AGPL-3.0**, so run it unmodified as a separate service only, never linked into our code).

**Decision:** we do **not** fork any of these repos. We build a clean TypeScript MCP/API layer plus a Python media worker, and re-implement the good ideas above. This keeps licensing clean (AGPL isolation) and the codebase ours.

---

## 4. Platform constraints that shape the product (critical)

These come from the current [ChatGPT plugin/app submission guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines) and operational reality. They change v1.0's assumptions.

### 4.1 ChatGPT: no selling inside the app

- Apps **may not sell digital products, subscriptions, credits, or freemium upsells**, directly or indirectly.
- Users **may sign in to an existing paid account** and use what their plan already includes.
- When a feature needs a higher plan, the app may **explain that** and **link to an informational plans page**. It may **not** link to checkout or "upgrade now" pages.
- The ChatGPT experience **must not be worse** than our website for the same feature, and **no ChatGPT-specific surcharges** are allowed.
- App name and description **must not mention pricing, trials, discounts, or promotions**.

**Consequences:**

1. **Billing lives on mutescroll's own web app** (Stripe Checkout + Stripe Tax, or Paddle as Merchant of Record for EU VAT, see §24). The ChatGPT app is an *acquisition and usage surface*, not a checkout surface. v1.0's instinct ("don't build assuming ChatGPT is the billing system") was right, and it is now mandatory.
2. **The free tier is the ChatGPT growth engine.** Users can use MuteScroll in ChatGPT anonymously or signed in (OAuth) within free limits. When limits are hit, the tool returns a neutral, policy-compliant message (§16).
3. **Claude, Cursor and other MCP hosts have their own rules.** The web app and API are where we actively sell.

### 4.2 Third-party content and access

- The guidelines forbid scraping or integrating with third-party services **without authorization and ToS compliance**, forbid **unofficial connectors / pass-through layers**, and forbid **circumventing rate limits or access controls**.
- **This is the #1 approval and legal risk.** Retrieving media from Instagram, TikTok and Facebook URLs server-side is, at best, a grey area under those platforms' ToS.

**Mitigations (product requirements, not optional):**

1. **Upload is a first-class path**, not a fallback footnote. The ChatGPT app supports file upload via the Apps SDK file APIs (`window.openai.uploadFile` / `selectFiles`) and a signed upload link. The same pipeline handles both.
2. **Authorized sources first:** use platform-provided captions/transcripts where available; YouTube captions; oEmbed/official metadata endpoints.
3. **Never** use user cookies or credentials, never access private, login-walled or DRM content, never bypass CAPTCHAs, bot checks or rate limits. Collecting credentials is also explicitly prohibited by the guidelines ("Restricted data").
4. **Ship two builds behind one codebase:**
   - **Directory build** (public ChatGPT directory): upload + YouTube/caption-based retrieval + public retrieval only where we've confirmed ToS compliance.
   - **Connector build** (web app, API, Claude/Cursor MCP, ChatGPT Developer Mode connectors): full URL retrieval pipeline under our own ToS, with user attestation that they have the right to process the content.
5. **Legal review before directory submission** (§24, open decision D2).

### 4.3 Operational reality of URL retrieval

- **YouTube blocks datacenter IPs** ("Sign in to confirm you're not a bot"). PO tokens help only partly, and IP reputation dominates ([yt-dlp #10128](https://github.com/yt-dlp/yt-dlp/issues/10128)). A naive yt-dlp-on-Railway deployment **will fail in production**.
- **Instagram increasingly requires authenticated sessions**, which we will not use. Expect lower anonymous success rates and design the UX around that.
- **Platforms change without notice.** yt-dlp needs frequent updates, so we need canary tests (§18).

→ The retrieval layer is a **resolver chain** with health-scored strategies (§9.3), and retrieval success rate per platform is a top-line KPI.

---

## 5. Goals, non-goals, success metrics

### 5.1 MVP goals

1. Accept a supported URL **or an uploaded file** and return a timestamped transcript in the chat.
2. Auto-detect platform and spoken language; handle code-switching (e.g. Greek + English).
3. Prefer existing captions; run ASR only when needed.
4. Never alter meaning (numbers, names, negations). Flag low-confidence spans instead of guessing.
5. Keep the transcript available in the conversation for follow-ups without re-processing.
6. Work identically in ChatGPT and Claude (one MCP server).
7. Accounts, plans, quotas and billing on the web app; OAuth account linking from MCP hosts.

### 5.2 Non-goals (MVP)

A video editor, a social-media downloader (we never return the media file to the user), video hosting, a recommendation engine, private/login/DRM/paywall access, any circumvention, in-chat billing, and a built-in "AI assistant" (the host LLM is the assistant).

### 5.3 Success metrics

| Metric | MVP target |
|---|---|
| Time-to-transcript, 60 s Reel (p50 / p95) | ≤ 12 s / ≤ 30 s |
| Time-to-transcript, 20 min YouTube with captions (p50) | ≤ 5 s |
| Retrieval success, public YouTube / TikTok / Instagram / Facebook | ≥ 97% / ≥ 90% / ≥ 75% / ≥ 80% (upload offered on every failure) |
| Word error rate on internal EN/EL/ES test set | ≤ 8% EN, ≤ 12% EL |
| Numeric fidelity (numbers, prices, dates match audio) | 100% on test set; any regression blocks release |
| All-in cost per short video (≤ 90 s) | ≤ $0.01 |
| Free → paid conversion (web-attributed) | ≥ 3% of activated free users within 30 days |
| Logo retention (paid, month 3) | ≥ 70% |
| ChatGPT invocation precision (tool called when it should be / not called when it shouldn't) | ≥ 95% on golden prompt set |

---

## 6. Supported sources

| Source | MVP | Retrieval notes |
|---|---|---|
| YouTube videos | ✅ | Captions first; audio-only fallback |
| YouTube Shorts | ✅ | Same as YouTube |
| TikTok videos | ✅ | Audio-only; `vm.tiktok.com` short links resolved |
| Instagram Reels / video posts | ✅ (public only) | Lowest anonymous success; strong upload prompt on failure |
| Facebook Reels / videos | ✅ (public only) | `fb.watch` short links resolved |
| **Uploaded file** (mp4, mov, webm, m4a, mp3, wav) | ✅ | Same pipeline, same output |
| X/Twitter, Vimeo, Loom, Reddit, LinkedIn, podcasts (RSS) | V2 | Mostly "free" via yt-dlp extractors |
| Private / login-required / DRM / paywalled | ❌ never | Explain + offer upload |

Platform adapters live behind one interface (§9.2), so adding a source is a single file plus tests.

---

## 7. Core interaction (UX principle)

> **The user should not need to understand how the system works.**
> Good: `Transcribe this: <URL>` · Bad: platform → model → language → timestamp mode → process.

**ChatGPT example:**

```
User:  Transcribe this https://www.instagram.com/reel/XXXX/
App:   (tool call → widget shows progress for >5 s jobs)
GPT:   Transcript — 0:58 · English · Instagram Reel
       [00:00] Today I'm going to show you the one setting that…
       [00:06] First, open your camera app and…
       ⚠ Low confidence at 00:21 ("the Lumix… S5?"). I can check the frame if you want.
       You can ask me to summarize, translate, pull the hook, extract quotes, or fact-check.
User:  Pull the hook and rewrite it for a Greek audience.
GPT:   (uses transcript in context; no second tool call)
```

**Invocation triggers** (must be in tool descriptions, without over-broad triggering, §8.4): "transcribe this", "what does he say", "get the subtitles", "convert this video to text", "what's in this Reel", or a bare supported URL where the apparent intent is to understand spoken content.

**Optional UI (Apps SDK / MCP Apps widget):** a compact transcript card with progress state, collapsible segments, click-to-copy, SRT/VTT/TXT download, and an "upload instead" button on failure. The model still receives the full structured text. The UI is a convenience and never a gate.

---

## 8. MCP tool contract

One remote MCP server (Streamable HTTP, `/mcp`) serves ChatGPT, Claude, Cursor and others. Tools follow the guidelines: verb names, accurate descriptions, explicit annotations, minimal inputs, and no internal IDs in responses unless required.

### 8.1 `transcribe_video`

Starts (and, for short media, completes) a transcription.

```json
{
  "url": "https://www.tiktok.com/@user/video/123",
  "file_id": null,
  "language": "auto",
  "speaker_labels": "auto",
  "detail": "clean"
}
```

- Exactly one of `url` / `file_id` (from upload).
- `detail`: `"clean"` (default; punctuation, filler removal, §11) or `"verbatim"`.
- Annotations: `readOnlyHint: false` (starts a job, stores a result), `destructiveHint: false`, `openWorldHint: true`.

**Response (completed):**

```json
{
  "status": "completed",
  "transcription_id": "tr_01JXYZ",
  "source": { "platform": "instagram", "content_type": "reel", "title": "…", "author": "…", "duration_seconds": 58 },
  "language": "en",
  "method": "asr",
  "transcript_text": "[00:00] Today I'm going to show you…",
  "segments": [ { "start": 0.0, "end": 4.2, "speaker": "SPEAKER_1", "text": "…" } ],
  "uncertain_spans": [ { "start": 21.3, "end": 22.0, "text": "Lumix S5", "reason": "low_confidence" } ],
  "on_screen_references": [ { "at": 34.5, "phrase": "link in my bio" } ],
  "quota": { "remaining_this_period": 12 }
}
```

**Response (long job):** `{ "status": "processing", "transcription_id": "tr_…", "eta_seconds": 40 }`. The model then calls `get_transcription`.

`transcription_id` is returned because it's required for follow-up tools (allowed by the response-minimization rule).

### 8.2 `get_transcription`

`{ "transcription_id": "tr_…", "page": 1 }` returns status or result. **Paging:** transcripts above ~12k tokens are returned in pages plus an auto-generated chapter index, so a 2-hour video doesn't flood the context window. Read-only.

### 8.3 `get_video_frames_at` (V1.1, the "eyes" tool)

`{ "transcription_id": "tr_…", "timestamps": [21.6, 34.5] }` returns up to 6 JPG frames (as image content / short-lived URLs) so the host model can read on-screen text, product names, handles and commands with its own vision. No OCR layer. Only valid for media we already retrieved (cache), and never returns the video itself. Read-only.

### 8.4 Description rules

- State purpose, when to use, and limitations (public videos only; private videos need upload).
- No "prefer this over other tools" language, no promotional words, no pricing.
- Do not ask for conversation history or broad context.

### 8.5 Not tools (handled elsewhere)

Translation, summarization, quote extraction, hook analysis, fact-checking and "is this correct?" are done by the **host LLM** on the transcript. **MuteScroll never runs its own LLM on transcripts.** Reasons:

1. **Cost:** we'd pay for tokens the user's ChatGPT/Claude subscription already covers; our margin stays ~99% because COGS is only retrieval + ASR.
2. **Quality and context:** the host model sees the whole conversation (the user's goal, earlier videos, their tone) and we don't, which is also what the guidelines require us not to request.
3. **Trust:** the transcript is the source of truth; analysis built on top of it is the host's and can be checked against it.
4. **Policy:** "one tool, one job"; extra LLM tools invite review friction and "unofficial connector"-style objections.

**Boundary:** MuteScroll owns *getting reliable text* (retrieval, ASR, timestamps, confidence, frames, export). The host owns *thinking about the text*. The only transformations we do are the mechanical ones in §11.1 (punctuation, segmentation, filler removal).

**Exception (web app only, later):** features that need persistent or batch LLM work the host chat can't do (V4 cross-video research over a library, scheduled creator tracking) may use our own LLM calls. These are web/API products priced for that cost (§20), and never part of the ChatGPT tool surface.

In V2 we may add `export_transcript` (SRT/VTT/DOCX link).

---

## 9. Processing pipeline

### 9.1 Flow

```
URL / upload
  → Normalize & validate (SSRF-safe, strip tracking params, resolve short links)
  → Platform detect (youtube | youtube_short | tiktok | instagram | facebook | upload)
  → Cache lookup  key = sha256(canonical_url) → return if transcript < TTL
  → Resolver chain  (§9.3) → captions? → DONE (method="captions")
  → Audio-only retrieval → ffmpeg → 16 kHz mono (Opus/FLAC for API upload)
  → VAD trim silence/music → (optional) speed-up for cost tier
  → ASR provider (§10) with word timestamps + confidences
  → Post-process: punctuation, segmenting, diarization merge, uncertain spans, demonstratives
  → Store transcript (Postgres) · media cache (object storage, 24 h TTL) → respond
```

### 9.2 Adapter interface

```ts
interface PlatformAdapter {
  id: Platform;
  matches(url: URL): boolean;
  canonicalize(url: URL): string;
  getMetadata(url: string): Promise<VideoMetadata>;
  getCaptions?(url: string, lang: string): Promise<Segment[] | null>;
  getAudio(url: string): Promise<AudioHandle>; // audio-only when possible
}
```

### 9.3 Resolver chain (per platform, health-scored)

Strategies are tried in order. Each strategy has a rolling success rate; unhealthy strategies are skipped automatically and alert on-call.

1. **Official captions / transcripts** (YouTube caption tracks; platform-provided subtitles where exposed in public metadata).
2. **yt-dlp audio-only** (`-f bestaudio`, no full video), from workers with **reputable residential/ISP egress** and per-domain rate limits. Pinned yt-dlp version with nightly canary upgrade.
3. **Self-hosted Cobalt** (separate container, unmodified, AGPL-isolated) as a second extractor.
4. **Licensed vendor fallback** (optional, evaluated per ToS) — decision D3.
5. **Upload prompt**: always available, always offered on failure.

No strategy may use user cookies, solve CAPTCHAs, or impersonate browsers to defeat bot checks.

### 9.4 Caching

- Transcript cache by canonical URL + `detail` + model tier, **global across users** for public URLs (big cost saver for viral videos). Per-user records still created for history/quota.
- Media cache 24 h (enables `get_video_frames_at` without re-download), then hard-deleted.
- Never cache uploads across users.

---

## 10. Transcription engine

Provider-agnostic `TranscriptionService` interface; provider chosen per job by tier, language and duration.

| Provider | Cost (2026-10) | Role |
|---|---|---|
| **Groq Whisper Large v3 Turbo** | ~$0.00067/min (batch ~$0.00033) | **Default** for speed/cost; ~400× realtime |
| ElevenLabs Scribe v2 | ~$0.0037/min | **High-accuracy tier**, diarization, hard audio |
| AssemblyAI Universal-2 / 3.5 Pro | $0.0025–0.0035/min | Alternative premium + diarization |
| Deepgram Nova-3 | ~$0.0043–0.0052/min | Fallback provider |
| Self-hosted faster-whisper / Parakeet on GPU (RunPod) | fixed GPU cost | Scale-stage cost optimization (> ~200k min/month) |

Sources: [iadecider STT reference 2026](https://iadecider.com/articles/speech-to-text-reference-2026), [Deepgram pricing](https://deepgram.com/pricing), [AssemblyAI pricing post](https://www.assemblyai.com/blog/speech-recognition-cost).

Requirements: automatic language ID, code-switching, punctuation, word-level timestamps, per-word confidence (or equivalent), diarization (premium tier / V2 for free), robustness to music and noise. **Automatic failover** to a second provider on error or timeout.

**Speed-up lever** (from TheSethRose): 1.5–2× tempo with pitch preservation cuts ASR minutes by 33–50%. **Off by default.** It may only be enabled per tier after the WER and numeric-fidelity gates (§5.3) pass, and timestamps must be rescaled.

---

## 11. Transcript quality and trust

### 11.1 Fidelity rules

- Formatting fixes are allowed: "uh so basically today we're gonna" → "So basically, today we're going to".
- **Meaning changes are never allowed:** "$10" never becomes "$100"; negations, names and numbers are untouched.
- No LLM rewriting of transcripts in the pipeline. Any "polish" is the host LLM's job, on request.
- Speakers are labeled `Speaker 1/2/…`. **Never infer real identities.**

### 11.2 "Ears first, eyes when needed" (from media-mcp)

ASR is cheap but cannot read the screen and mishears rare names. We surface where it's unreliable instead of hiding it:

- **Uncertain spans:** contiguous low-confidence words (default p < 0.5, merged when < 150 ms apart).
- **On-screen references:** demonstrative phrases ("link in bio", "this command", "as you can see", "the code is", "@…") with timestamps.
- The tool response tells the host LLM it can call `get_video_frames_at` for those timestamps. The LLM decides, so frames are pulled only where accuracy needs them.

This is a **visible quality differentiator** vs. commodity transcript sites, and it doubles as a premium feature (§20).

### 11.3 Timestamps and language

- Every transcript has timestamps: `[MM:SS]` for videos under 1 h, `[HH:MM:SS]` otherwise.
- The original spoken language is preserved, including mixed language: `[00:00] Σήμερα θα μιλήσουμε για artificial intelligence.`

---

## 12. Conversation and persistence

- After a transcript is returned, follow-ups ("summarize", "translate to Greek", "is this correct?", "3 strongest claims") **must not trigger re-transcription**. Tool descriptions say so, and the cache guarantees it even if the model re-calls.
- `transcription_id` lets the model page or fetch frames later in the conversation.
- Retention: anonymous users 24 h; free signed-in users 7 days; paid users keep a **library** (searchable history) while subscribed. Users can delete any transcript at any time (`DELETE` in API/web).

---

## 13. Errors (human-readable, always with a next step)

| Case | Message (model-facing, rephrased naturally by host) |
|---|---|
| Unsupported URL | "This isn't a supported video link. Supported: YouTube, Shorts, TikTok, Instagram Reels, Facebook videos, or upload a file." |
| Private / login-required | "This video needs access I don't have, and I can't bypass private-account restrictions. Upload the file and I'll transcribe it." |
| Retrieval failed (platform blocked) | "I couldn't retrieve this video right now. If you can see it, upload the file here and I'll transcribe it with the same quality." |
| No speech | "I processed the video but found no meaningful speech (music or sound only)." |
| Poor audio | "Audio quality is poor. Here's a best-effort transcript; uncertain parts are marked." |
| Too long for plan | "This video is 2 h 10 min; your current plan supports up to 60 min per video. Plan details: mutescroll.xyz/plans" (informational link, §4.1) |
| Quota reached | "You've used this period's transcriptions. They reset on <date>. Plan details: mutescroll.xyz/plans" |

Failed jobs **never consume quota** (§20.5).

---

## 14. Upload pathway

- ChatGPT: Apps SDK file APIs (`uploadFile` / `selectFiles`) in the widget, plus a signed one-time upload link as a fallback.
- Claude/other MCP hosts: signed upload link (`request_upload` returns a URL) and local-path support for desktop/stdio installs (V1.1).
- Web: drag-and-drop.
- Same validation (type sniffing, size ≤ 2 GB, duration limits), same pipeline, same output format.

---

## 15. Architecture

```
               ChatGPT · Claude · Cursor · Web app · REST API
                                   │
                        ┌──────────▼──────────┐
                        │  Edge / API + MCP   │  TypeScript (MCP SDK + ext-apps),
                        │  auth, quotas, rate │  OAuth 2.1 (PKCE, CIMD/DCR), Stripe webhooks
                        └──────────┬──────────┘
                                   │ enqueue
                        ┌──────────▼──────────┐
                        │   Job queue (Redis) │
                        └──────────┬──────────┘
              ┌────────────────────┼────────────────────┐
     ┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐
     │ Media workers   │  │  ASR router     │  │ Post-processor  │
     │ Python: yt-dlp, │  │ Groq / Scribe / │  │ segments, spans,│
     │ ffmpeg, Cobalt  │  │ AAI / self-host │  │ diarization     │
     │ sandboxed, egress│ └────────┬────────┘  └────────┬────────┘
     │ via residential │           │                    │
     └────────┬────────┘           └─────────┬──────────┘
              │                              ▼
      Object storage (R2, 24 h TTL)    Postgres (transcripts, users, usage)
```

**Recommended hosting** (matches existing accounts; decision D4):

- **API/MCP:** Railway (Node) or Cloudflare Workers. Workers are fine for the API, but media workers can't run there.
- **Media workers:** Railway containers (Python, yt-dlp, ffmpeg), egress through a residential proxy provider, autoscaled on queue depth.
- **Storage:** Cloudflare R2 (media cache, uploads, exports), Postgres (Railway/Neon), Upstash Redis (queue, rate limits).
- **GPU (later):** RunPod serverless for self-hosted ASR once volume justifies it.

**Sync vs. async:** if a job is predicted to finish within ~20 s (short video, cache hit, captions), the tool waits and returns `completed`. Otherwise it returns `processing` and the model polls `get_transcription`. Host tool-call timeouts must be verified per client during M2.

---

## 16. Accounts, auth and entitlements

- **Anonymous use** (ChatGPT/Claude, no login): small free allowance per host user, rate-limited by an opaque host user ID where provided plus IP heuristics. Decision D5: anonymous allowed vs. login required.
- **OAuth account linking** (MCP OAuth 2.1) to a MuteScroll account; scopes are minimal (`transcribe`, `library:read`).
- Entitlements are checked server-side on every call: plan, credits, max duration, features (frames, diarization, bulk, API).
- In ChatGPT the tool **never** presents plans or checkout. It only returns the neutral messages from §13 with an informational link. Claude/web/API may show upgrade CTAs.

---

## 17. Security, privacy, compliance

**Untrusted input:** SSRF protection (allow-listed domains, DNS re-resolution checks, block private/link-local ranges, cap redirects), no shell interpolation (argument arrays only), path traversal guards, size and duration caps **before** download, decompression-bomb and malformed-container protection (ffprobe with limits), and workers in sandboxed containers with no internal network access, read-only FS and per-job temp dirs.

**Privacy (GDPR; we're EU-based):**

- Published privacy policy (required for directory listing): data categories, purposes, recipients (ASR sub-processors), retention, controls.
- Data minimization: we store URL, metadata and transcript, never conversation context.
- Media is deleted ≤ 24 h. Transcripts follow the retention rules in §12. Account deletion purges everything within 30 days.
- DPA with ASR providers. Prefer providers with zero-retention options and EU processing where available.
- No ads, no tracking beyond disclosed product analytics.

**Copyright and platforms:** MuteScroll is a transcription tool. We never redistribute video/audio, never return media files, and process only content the user is entitled to access. We honor takedown requests (cache purge by URL).

**Secrets:** all keys live in environment / platform secrets (Railway / Cloudflare). Nothing is committed to the repo.

---

## 18. Observability and operations

**Events:** `transcription_started|completed|failed`, `retrieval_failed{platform,strategy,reason}`, `captions_hit`, `cache_hit`, `asr_failed{provider}`, `upload_offered`, `upload_completed`, `quota_blocked`, `frames_requested`.

**Dashboards:** success rate per platform × strategy, p50/p95 latency by stage, ASR $/min and $/video, cache hit rate, queue latency, free→paid funnel by host (ChatGPT/Claude/web).

**Canaries:** every 30 min, transcribe a fixed set of public test videos per platform. Alert when success drops below threshold, and auto-demote failing resolver strategies. A daily yt-dlp nightly canary runs before version bumps.

---

## 19. Unit economics (planning numbers, 2026-10)

| Item | Short video (60 s) | Long video (60 min) |
|---|---|---|
| ASR (Groq default) | $0.0007 | $0.04 |
| ASR (Scribe premium) | $0.0037 | $0.22 |
| Audio-only egress via residential proxy (~$2–5/GB) | ~1 MB → $0.002–0.005 | ~50 MB → $0.10–0.25 |
| Compute + storage + DB (amortized) | ~$0.001 | ~$0.01 |
| **All-in (default)** | **≈ $0.004–0.007** | **≈ $0.15–0.30** |
| YouTube with captions (no ASR, little egress) | ≈ $0.001 | ≈ $0.002 |

**Implications:**

- Short-form is almost free to serve, so a generous free tier is affordable (Hormozi's freemium "cost problem" is under control, §20.1).
- **Long videos and proxy bandwidth are the real costs.** Quotas therefore count **credits = 1 per started 10 minutes of audio**, so a Reel costs 1 credit and a 45-minute podcast costs 5.
- Global URL caching of viral videos meaningfully reduces cost at scale.

---

## 20. Pricing and offer (Hormozi-informed)

Built with the Hormozi knowledge base (*$100M Offers*, *$100M Leads*, *$100M Money Models*) plus the competitor scan in §3.1. All prices are hypotheses to A/B test; the structure is the requirement.

### 20.1 Principles applied

1. **"Sell something super cheap to everyone, or extremely expensive to a few. The middle is where people die."** Our marginal cost is under a cent per Reel, so we go **cheap and scalable** for individuals and add a **higher-ticket team/API tier** for agencies.
2. **Freemium only works if you know your numbers.** Hormozi warns about three failure modes: conversion too low, free product not valuable enough to share, and free fulfilment too costly. We control cost (§19), make the free product genuinely shareable (it's *inside* ChatGPT/Claude), and gate the **multi-step** value (library, bulk, frames, long videos, API) rather than the core sample.
3. **Lead magnet = "a sample of the thing, or one step of a multi-step solution."** The free tier gives single-video transcripts. Paid gives the workflow: many videos, history, research, exports.
4. **Value equation:** Value = (Dream Outcome × Perceived Likelihood) / (Time Delay × Effort & Sacrifice).
   - Dream outcome: "Know exactly what any video says, and turn it into hooks, scripts and insights, without leaving my AI chat."
   - Likelihood: confidence flags, the frames check, a numeric-fidelity promise, and "failed = free".
   - Time delay: ~10 s per Reel, with captions instant.
   - Effort: paste a link, nothing to install, no new UI.
5. **Money model sequence:** Attract (free in chat) → Up-front cash (annual founder plan) → Upsell/Downsell (higher tier or credit packs / pause plan) → Continuity (monthly) → Continuity #2 (team seats/API) → Up-front cash #2 (prepay annual after month 1 with bonus + discount).
6. **Decoy / three options:** present three plans with the target plan (Pro annual) as the obvious best value.
7. **Continuity offers:** start people with a **bonus + discount + waived friction**, then offer existing monthly users a prepay discount after their first month.
8. **Guarantees are stackable:** an unconditional refund plus a conditional promise.

### 20.2 Plans (USD primary, EUR shown at parity for EU)

| | **Free** | **Creator** | **Pro** ⭐ | **Team / API** |
|---|---|---|---|---|
| Monthly | $0 | **$7.99** | **$16.99** | **$49** |
| Annual (default toggle) | — | $59 / yr ($4.92/mo) | **$119 / yr ($9.92/mo)** | $468 / yr |
| Credits / month (1 credit = ≤10 min audio) | **20** | 400 | 1,500 | 6,000 pooled |
| Max length per video | 10 min | 60 min | 3 h | 3 h |
| Surfaces | ChatGPT, Claude, web | all | all | all + REST API keys |
| Timestamps, auto-language, captions-first | ✅ | ✅ | ✅ | ✅ |
| Uncertainty flags | ✅ | ✅ | ✅ | ✅ |
| On-screen **frame checks** (`get_video_frames_at`) | 3 / mo | 100 / mo | 1,000 / mo | 5,000 / mo |
| Speaker labels (premium ASR) | — | — | ✅ | ✅ |
| Transcript library & search | 7-day history | ✅ | ✅ | ✅ shared |
| Exports (TXT, SRT, VTT, DOCX, MD) | TXT | ✅ | ✅ | ✅ |
| Bulk URLs (V2) / channel & profile import (V3) | — | 25 per batch | 200 per batch | 1,000 per batch |
| Unused credits roll over | — | up to 2× | up to 2× | up to 2× |
| Seats | 1 | 1 | 1 | 3 (+$12/seat) |
| Priority queue / support | — | — | ✅ | ✅ |

**Rationale:**

- Free at 20 credits/month costs us ≈ $0.10–0.15 per active free user, which is affordable and more generous than TransClipper (60 s cap) or TokTranscript (10/mo).
- Creator at $7.99 sits **under** the $10 market price point that dominates (TokScript, ManyScripts, TransClipper) while carrying a better accuracy story.
- Pro annual at $119 is the decoy-favoured plan: roughly 4× the credits of Creator for 2× the price, plus frames and diarization. Expected gross margin at heavy use (1,500 credits ≈ $6–10 COGS) is ≥ 92% annualized; typical usage is far lower.
- We do **not** price per video like ReelScribe ($0.005/video), because that race to the bottom isn't winnable against a cached-scraper business. We price on **outcome + workflow + trust**.

**Credit packs (downsell / overflow):** 500 credits for $5 and 2,000 for $15. They never expire while subscribed. Sold on the web only.

**Pause plan (downsell at cancellation):** $2.99/mo keeps the library and 30 credits. This saves a share of churners.

### 20.3 Launch offer — "Founding Scroller" (urgency + scarcity, honest)

Named with Hormozi's MAGIC naming: **M**agnet reason (launch), **A**vatar (creators), **G**oal (read any video), **I**nterval (12 months), **C**ontainer word ("Founding Pass").

> **The MuteScroll Founding Pass — 12 months of Pro for $79 (first 500 members only)**
> Price stays at $79/yr for as long as you stay subscribed.

**Value stack** (bonuses cost us ~$0 to deliver because the host LLM does the work):

1. **"Hook Vault" ChatGPT/Claude skill pack**: 25 tested prompts (hook extraction, script remix, angle mining, competitor teardown) that run on any MuteScroll transcript.
2. **Competitor Teardown**: at signup, import up to 50 videos from any 3 public creators (V2 bulk) and get a ready research doc.
3. **Founder-only Discord + roadmap voting.**
4. **Double frame checks for life.**

**Guarantees (stacked):**

- **Unconditional:** 30-day full refund, no questions asked (safe because COGS is pennies).
- **Conditional, always-on:** "**If we can't transcribe a public video, it's free**": failed jobs never consume credits, automatically.
- **Accuracy promise:** "Spot a wrong number in a transcript? Report it and we'll refund that credit ×10."

### 20.4 Continuity mechanics

- Annual is the default toggle on the plans page (anchored against monthly × 12).
- On day 25 of a monthly plan, show a web/email offer to switch to annual at an extra 20% off plus the Hook Vault bonus (Hormozi: prepay offer after the first payment).
- On cancellation, offer the downsell ladder in order: pause plan, then switch to Creator, then 1 free month (one time).
- Win-back at 30/60/90 days with a "your library is still here" message.

### 20.5 Compliance mapping

- ChatGPT surfaces show **none** of the above. They show only the neutral limit messages with an informational link (§4.1, §13).
- The same feature has the **same price** regardless of surface (no ChatGPT surcharge).
- EU consumer law: 14-day withdrawal right covered by the 30-day refund. Show VAT-inclusive prices for EU customers.

---

## 21. Go-to-market and copy (initial)

**Positioning one-liner:** *MuteScroll gives your AI ears for any video. Paste a link and get a timestamped, trustworthy transcript right inside ChatGPT or Claude.*

**Landing page headline candidates (A/B):**

1. "Stop rewatching. Start reading." — Turn any TikTok, Reel or YouTube video into text inside ChatGPT.
2. "Your competitors' scripts, in 10 seconds."
3. "Read any video. Right in your AI chat."

**Directory listing** (no pricing words, no comparisons): "Transcribe public YouTube, TikTok, Instagram and Facebook videos, or uploaded files, into timestamped text you can summarize, translate and analyze."

**Channels (from $100M Leads, the "core four"):**

- **Warm outreach / content:** build in public, and post Reels about MuteScroll *made with* MuteScroll (hook breakdowns of viral videos), which is self-demonstrating.
- **Free content:** SEO pages per platform ("TikTok transcript", "Instagram Reel to text"), as competitors do, but each funnels to "use it inside ChatGPT/Claude".
- **Affiliates:** creator-economy newsletters and YouTubers. Pay from max allowable CAC with Hormozi's 3-tier affiliate payout (sign-up → activation → retention).
- **Paid ads:** later, once LTV:CAC ≥ 3:1 is proven.

---

## 22. Milestones (each ends with a demo + short diff summary)

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 — Repo & skeleton** | Monorepo (`apps/api-mcp` TS, `workers/media` Python, `packages/shared` schemas), CI, `.env.example`, lint/test | CI green on empty services |
| **M1 — Core pipeline** *(implemented 2026-10-12; see §22.1)* | URL normalize/validate, adapters (YT, TikTok, IG, FB), captions-first, yt-dlp audio-only, Groq ASR, segments, uncertain spans, cache | CLI transcribes the golden set; numeric-fidelity test passes |
| **M2 — Remote MCP** *(built 2026-10-12; client E2E pending, see §22.3)* | `transcribe_video`, `get_transcription`, async jobs, upload link, anonymous quotas | Works in Claude Desktop + ChatGPT Developer Mode end-to-end |
| **M3 — Accounts & billing (web)** | Next.js web app, auth, OAuth for MCP, Paddle plans/credits, library, exports | Paid user flow end-to-end; entitlements enforced in MCP |
| **M4 — Production hardening** | Residential egress, resolver health scoring, canaries, dashboards, failover ASR, privacy policy, ToS | 7-day canary ≥ targets in §5.3 |
| **M5 — Directory submission** | Directory build (§4.2), widget UI, test prompts, demo account | Submitted to ChatGPT directory; Claude listing |
| **V1.1** | `get_video_frames_at`, diarization tier, local/stdio install | — |
| **V2** | Bulk URLs, X/Vimeo/Loom/podcasts, SRT/VTT export tool, chapters | — |
| **V3** | Channel/profile/playlist import, searchable library, creator tracking | — |
| **V4 — Video research agent** | "Watch these 50 videos and tell me what everyone says about X": multi-transcript retrieval + citations to timestamps | — |

### 22.1 M1 build findings (2026-10-12)

Verified live from a residential IP with `workers/media` (`python -m mutescroll_media.cli`):

| Path | Result |
|---|---|
| YouTube captions, YouTube ASR, uploaded file ASR (Groq `whisper-large-v3-turbo`) | Work end to end; the 24 h file cache turns repeats into ~1 s |
| Facebook public video | Works via audio-only download plus ASR |
| Instagram | Posts without audio return a clear "no audio track"; most Reels need login, so expect low anonymous success and always offer upload |
| TikTok | **Anonymous retrieval fails** without browser TLS impersonation. We do not impersonate browsers to defeat bot checks (§4.1), so TikTok is **upload-first** until a licensed vendor (§9.1 step 4) or the legal review (D2) says otherwise. The TikTok retrieval target in §5.3 is withdrawn for the connector build |
| YouTube from datacenter IPs | Untested; known to hit "confirm you're not a bot". Production needs residential egress (M4) |

Engineering notes that change the earlier plan:
- yt-dlp needs a JavaScript runtime (Deno or Node) plus `yt-dlp-ejs` for YouTube. The worker refuses to run without one (`worker_misconfigured`).
- Groq returns segment-level `avg_logprob` but no per-word probability, so **uncertain spans use segment confidence** (`exp(avg_logprob)` < 0.5). Word-level confidence arrives with ElevenLabs Scribe (premium tier) or a second provider.
- Hallucinated non-speech segments are dropped (`no_speech_prob` > 0.85 and `avg_logprob` < -0.8).
- Chunk cuts every 20 minutes are not yet silence-aware; fix before the 2 h limit is advertised.
- Redirect hops are re-validated by DNS; a TOCTOU rebinding window remains, so the production worker also needs a network egress policy (§17).

---

### 22.2 TikTok and Reels retrieval: options, legality, decision (proposed D9, 2026-10-12)

**Not legal advice.** The sources are linked inline; D2 (legal review before M5) still applies.

**Technical options, cheapest first**

| Option | Cost per 1-min video | Timestamps | Verdict |
|---|---|---|---|
| Hybrid: licensed API resolves the media URL (ScrapeCreators `video_url` / `play_addr`), our worker downloads the audio from that CDN URL, Groq transcribes | ≈ $0.003 (1 vendor credit at [$0.99–1.88 per 1k](https://scrapecreators.com), plus Groq ≈ $0.00067/min) | Yes, plus our confidence and number-fidelity checks | **Recommended** |
| Vendor transcript only ([ScrapeCreators](https://docs.scrapecreators.com/v2/instagram/media/transcript): 1 credit, ≤ 120 s, text only; longer = 10 credits/min) | ≈ $0.002 | No (Instagram example returns text only) | Rejected: breaks the "timestamped, trustworthy" promise |
| Vendor transcript ([Supadata](https://supadata.ai/pricing): Instagram always AI, 2 credits/min; 100 free credits/month; Pro $17 for 3,000 credits) | ≈ $0.003 (Mega: $47 per 30,000 credits) to ≈ $0.011 (Pro) | Yes | Fallback vendor, behind the same interface; a monthly subscription, unlike ScrapeCreators' non-expiring credits |
| Self-scrape: residential proxy ([$2.75–4/GB](https://decodo.com/proxies/residential-proxies/pricing)) + yt-dlp with TLS impersonation | ≈ $0.03 for ~8 MB of video, plus engineering time | Yes | Rejected: dearer, brittle, and the legally riskiest (evasion by us) |
| Official APIs | n/a | n/a | No transcript or media access: [TikTok Research API](https://developers.tiktok.com/doc/research-api-faq) is non-commercial only, Display API covers a user's own videos, [Meta Content Library](https://developers.facebook.com/docs/content-library-and-api/content-library-api/overview/) is research-only inside a secure environment. Use **oEmbed** only (title, author, thumbnail, public-or-not): [TikTok](https://developers.tiktok.com/docs/en/embed-videos), [Meta tokenless](https://developers.facebook.com/blog/post/2026/06/15/tokenless-access-to-meta-oembed-apis/) |
| User-side retrieval | $0 to us | Yes | Add: local/stdio MCP (pull V1.1 forward) fetches from the user's own device and IP; upload and share-sheet stay as the universal fallback |

**Legal picture (summary)**
- *Criminal/CFAA:* [hiQ v. LinkedIn](https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/18/17-16783.pdf) says scraping data open to the public is unlikely to be "without authorization". This is a Ninth Circuit preliminary-injunction ruling, and hiQ later lost on contract grounds.
- *Contract:* [Meta v. Bright Data](https://arstechnica.com/tech-policy/2024/01/facebook-suffers-big-loss-in-lawsuit-against-data-scraping-company/) (N.D. Cal., 2024) held Meta's terms do not bar logged-off scraping of public data. It is narrow and not binding elsewhere. [TikTok's terms](https://www.tiktok.com/legal/page/us/terms-of-service/en) prohibit automated extraction "for any purpose" without written approval, and no such ruling exists for TikTok. Expect IP blocks and cease-and-desist letters, not criminal exposure.
- *Circumvention:* a bot check on a public page is not DRM, but we never decrypt protected streams and never log in. Impersonating a browser to defeat a block is the part courts have not blessed, so we do not do it ourselves (§4.1).
- *Copyright:* spoken content is copyrightable. User-initiated, transformative text output with short-TTL caching and a takedown path is the defensible posture. No public transcript pages, no redistribution of media.
- *Privacy:* speech can be personal data (GDPR). No voiceprints; speakers stay "Speaker N"; vendors are listed as subprocessors.
- *Using a vendor* moves the collection method and its ToS risk to a specialist under contract, but does not make the activity risk-free. Contract terms: no indemnity from small vendors, so keep the vendor swappable.

**Proposed D9 (needs approval)**
1. Build `VendorSource` in `workers/media` behind the existing `MediaSource` interface: ScrapeCreators first, Supadata as failover. API keys live in env only.
2. Add a media-host allowlist for the vendor-returned CDN URLs (TikTok and Instagram CDNs) to the SSRF layer; same DNS and redirect checks.
3. Use oEmbed for metadata and a free "is this public?" pre-check; pre-check failures cost nothing.
4. **Connector build only** (web, API, Claude, Cursor, ChatGPT Developer Mode). The ChatGPT directory build (§4.2) keeps YouTube, uploads and user-supplied files, because directory rules forbid unauthorized scraping and circumvention.
5. Videos over about 3 minutes from TikTok/Instagram go through the same path; the vendor charge is per call, not per minute, so long videos stay cheap (confirm in the pilot).
6. Kill switch per platform; weekly canary; one-click takedown purge (cache already supports it).
7. Pilot gate before relying on it: run 50 public Reels and 50 TikToks through both vendors using the free credits, and require ≥ 85% success, working signed-URL downloads from our egress IP, and correct timestamps.
8. Revisit in M4: Instagram own-content via the Graph API with creator consent, and a licensed enterprise vendor if volume justifies it.

Cost at 10,000 one-minute TikTok/Reel transcripts: ≈ $17–26 for the hybrid (ScrapeCreators credits ≈ $10–19, Groq ≈ $7, bandwidth negligible) versus ≈ $47 on Supadata Mega (20,000 credits). The hybrid wins at small scale (no subscription, $47 one-off top-up) and keeps our own timestamps and fidelity checks; the two converge at volume.

### 22.3 M2 build status (2026-10-12)

Built in `apps/api-mcp`: stateless Streamable HTTP `/mcp` with `transcribe_video` and `get_transcription`, in-memory async jobs with in-flight dedupe, one-time upload links (extension, MIME and magic-byte checks, size cap, single use), anonymous sliding-window quota and per-minute rate limits, and a subprocess bridge to the Python worker (argument array, `--`, allow-listed child environment, output cap, timeout).

Open before M2 is declared done:
- **Client E2E:** Claude Desktop, Cursor and ChatGPT Developer Mode against a public HTTPS URL, including each client's tool-call timeout (the 25 s inline wait may need tuning).
- **Real-key paths:** ASR with the Groq key through the API, and upload to transcript with the real worker.
- **Capability model:** `get_transcription` has no owner check; a `job_id` (random UUID) is the capability. Acceptable for anonymous use; revisit with accounts in M3 (bind jobs to the user).
- **Deviations accepted:** `job_id` instead of `transcription_id`; no `eta_seconds`; no paging yet; raw-body upload with `X-Filename` instead of multipart; job, quota and token stores are in-memory and single-process (Postgres in M3).

## 23. Acceptance criteria (MVP)

1. **YouTube / Shorts:** paste a URL, the host invokes MuteScroll, and a timestamped transcript appears; captions are used when present (`method: "captions"`).
2. **TikTok / Instagram / Facebook (public):** works via the resolver chain when retrievable. On failure there is a clear message plus an upload offer, and **no credit is consumed**.
3. **Upload:** the same output format and quality as the URL path, in ChatGPT and Claude.
4. **Private / inaccessible:** no circumvention attempt; explains why; offers upload.
5. **Follow-ups:** "summarize", "translate to Greek" and "3 strongest claims" cause **zero** additional tool calls (verified in logs).
6. **Fidelity:** 100% numeric fidelity on the test set; uncertain spans flagged.
7. **Limits:** duration, size and quota enforced server-side with neutral messages; ChatGPT responses contain no pricing or upgrade CTAs.
8. **Security:** SSRF/command-injection test suite passes; media deleted ≤ 24 h (verified job).
9. **Performance:** §5.3 latency targets met on the canary set for 7 consecutive days.

---

## 24. Decisions (owner: Lampros)

Status as of 2026-10-12: all recommendations **accepted** and applied. Revisit only on the stated trigger.

| # | Decision | Status | Outcome / revisit trigger |
|---|---|---|---|
| D1 | Billing provider | ✅ Accepted | **Paddle** (Merchant of Record: handles EU VAT, invoicing and chargebacks). Billing code sits behind a `BillingProvider` interface so Stripe can replace it. Revisit if a company entity + accountant exist and fees matter. |
| D2 | Legal review of IG/TikTok/FB retrieval | ✅ Accepted | Review **before M5** (directory submission). Connector build (web, API, Claude/Cursor, ChatGPT Developer Mode) ships first regardless. |
| D3 | Licensed third-party retrieval vendor | ✅ Accepted | Evaluate in M4 **only if** anonymous IG success < 60%. |
| D4 | API/MCP host | ✅ Accepted | **Railway** for API + media workers. Move the API edge to Cloudflare Workers later if latency or cost demands. |
| D5 | Anonymous usage | ✅ Accepted | **Anonymous: 5 credits per rolling 24 h per client** (implemented as a sliding window, M2), then OAuth sign-in unlocks the free 20/month. |
| D6 | Domain | ✅ Accepted (to register) | **mutescroll.xyz**, to be registered by the owner. `mutescroll.com` is already taken; `.app`, `.io` and `getmutescroll.com` looked free on 2026-10-12 as defensive options. Contact mailbox: mutescroll.xyz@gmail.com until domain mail exists. |
| D7 | Founding Pass | ✅ Accepted | **$79/yr, first 500 members.** Revisit after 100 sales. |
| D8 | Follow-up analysis (summarize, translate, fact-check) | ✅ Accepted | Done by the **host LLM**, never by MuteScroll (§8.5). |

---

## 25. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ChatGPT directory rejects URL retrieval (third-party ToS) | **High** | High | Directory build = upload + authorized sources; connector build for the rest; diversify to Claude/web/API |
| Platforms block retrieval (IP reputation, auth walls) | **High** | High | Residential egress, resolver chain, health scoring, canaries, first-class upload |
| Commodity price war ($0.005/video competitors) | High | Medium | Compete on in-chat UX, trust features, research workflows; don't race per-video price |
| ASR misquotes numbers/names, damaging trust | Medium | High | Uncertain spans + frames check + numeric fidelity gate + premium ASR tier |
| Long-video cost blowups | Medium | Medium | Credits per 10 min, duration caps, caption-first, caching |
| Freemium conversion too low | Medium | High | Gate multi-step value, not the sample; web nurture via OAuth sign-in; founder offer urgency |
| AGPL contamination via Cobalt | Low | High | Run unmodified as separate network service; no code linking |
| Privacy/GDPR complaint | Low | High | Minimization, short retention, DPA with sub-processors, published policy |
