# MuteScroll REST API v1

Contract for `apps/api-mcp` (implemented) and `apps/web` (consumer). Base URL: `PUBLIC_BASE_URL`. JSON in, JSON out, UTF-8.
There are no CORS headers: call the API from the web app's own origin, or through the same host.

Every error, on every `/v1` route, has this shape:

```json
{ "error": { "code": "unsupported_url", "message": "Human-readable, safe to show.", "upload_url": "only for retrieval failures" } }
```

Messages are copy from `apps/api-mcp/src/mcp/messages.ts` (PRD 13). Responses never include stack traces, upstream text or internal ids.

## Error codes and HTTP status

| Status | Codes | Meaning |
|---|---|---|
| 400 | `invalid_request`, `invalid_url`, `unsupported_url`, `unsafe_url`, `invalid_language`, `blocked` | Bad body, field, query or link. No work is started. |
| 401 | `unauthorized`, `invalid_credentials` | A presented API key is unknown or malformed, or the endpoint needs an account. Wrong email or password gives the same answer for unknown addresses. |
| 402 | `quota_exceeded` | Account has too few credits left this period. |
| 403 | `forbidden`, `csrf_failed` | API keys cannot manage API keys. A cookie-authenticated write lacks a matching `x-csrf-token`. |
| 404 | `not_found` | Unknown id, or a job the caller may not see. Never 403. |
| 405 | `method_not_allowed` | `Allow` header lists the methods. |
| 409 | `email_taken`, `not_ready`, `job_failed` | Address already registered. Export or delete while a job runs. Export of a failed job. |
| 413 | `too_large`, `too_long` | Body or upload over its limit. Video longer than the plan allows. |
| 415 | `unsupported_media_type`, `unsupported_file_type` | Wrong request `Content-Type`. Upload extension, MIME type or file bytes not supported. |
| 422 | `no_speech`, `no_audio_track`, `media_error`, `live_stream`, `drm_protected` | The media cannot be transcribed. Nothing is charged. |
| 429 | `rate_limited`, `quota_exceeded` | Too many requests, or an anonymous caller's quota is spent. `Retry-After` gives seconds. |
| 500 | `internal` | Our side failed. Worker-internal codes all map here. |
| 502 | `retrieval_failed`, `private_or_login_required`, `blocked_bot_check`, `unavailable`, `asr_error` | The platform or the speech provider failed. Retrieval failures include `upload_url` and charge nothing. |

## Authentication

- **Anonymous:** no credentials. Quota is keyed by client IP (`ANON_CREDITS` per 24 h, `ANON_REQUESTS_PER_MINUTE`).
- **API key:** `Authorization: Bearer msk_...`. A key that is presented but not valid is a 401, never a silent fallback to anonymous.
- **Session cookie:** `ms_session`, set by sign-up and log-in. `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when `PUBLIC_BASE_URL` is https. 30 days, sliding on use.
- **CSRF:** a readable `ms_csrf` cookie is set alongside the session. A cookie-authenticated `POST` or `DELETE` must send `x-csrf-token` with the same value, or it gets 403 `csrf_failed`. Read the value from `document.cookie` and echo it.
- **JSON bodies** must be sent as `Content-Type: application/json`. A cross-site form cannot do that without a CORS preflight, which is never granted.
- **MCP** (`/mcp`) accepts Bearer keys only. Cookies are ignored there.

## Accounts

| Method and path | Auth | Response |
|---|---|---|
| `POST /v1/auth/signup` `{ email, password }` | anonymous, rate-limited per IP | 201 + session cookies, `Me` body |
| `POST /v1/auth/login` `{ email, password }` | anonymous, rate-limited per IP | 200 + new session cookies, `Me` body |
| `POST /v1/auth/logout` | session + CSRF when cookie present | 204, clears both cookies |
| `GET /v1/me` | account | `Me` body |
| `GET /v1/api-keys` | account | `{ "items": [{ id, prefix, created_at, last_used_at }] }` |
| `POST /v1/api-keys` | session + CSRF | 201 `{ id, key }`. The key is shown once. |
| `DELETE /v1/api-keys/:id` | session + CSRF | 204. 404 for another account's id. |

Rules: email is trimmed and lower-cased, and must be a plausible address. Password is 10 to 128 characters. Passwords are stored as scrypt hashes with a per-user salt. Sign-ups are limited per IP (`AUTH_SIGNUPS_PER_IP_PER_HOUR`, default 5). Log-in attempts are limited per IP (`AUTH_LOGINS_PER_IP_PER_MINUTE`, default 10).

`Me` body: `{ "email", "plan", "credits": { "remaining", "resets_at" }, "created_at" }`. `resets_at` is the next UTC month start.

Keys have the form `msk_` plus 43 random base64url characters. Only a SHA-256 hash is stored.

## Credits and plans

- Free accounts get **20 credits per calendar month (UTC)**. 1 credit = up to 10 minutes of audio (started minutes round up).
- A run **holds 1 credit** when it starts. On success the hold is released and the real cost charged. On failure the hold is released and nothing is charged. A run that never finishes (for example, the server restarted mid-job) has its hold released by maintenance once the active-job window (2 h) has passed.
- Each plan has a **longest video**: free 10 min, creator 60 min, pro and team 3 h. `MEDIA_MAX_SECONDS` still caps every plan.
- Anonymous callers keep the IP quota and do not use credits.
- The plan table is `apps/api-mcp/src/billing/plans.ts`.

`GET /v1/plans` (public, no auth): `{ "plans": [{ id, name, monthly_credits, max_video_minutes, price_usd_monthly }] }`. It has no checkout links. Checkout happens only on the web app (M3b).

## Transcriptions

### `POST /v1/transcriptions`

Body: `{ "url": string, "language"?: "auto" | "<ISO 639-1>" }`. Anonymous, session or Bearer.

- `200` `{ "status": "completed", "job_id", "transcription": Transcription }`
- `202` `{ "status": "processing", "job_id" }`. The server waits up to `TOOL_WAIT_MS` first. Poll `GET`.
- Errors per the table above. A retrieval failure answers 502 with `upload_url`. The body has no `job_id`. Accounts find the job in the library.

An identical request from the same account, or from anonymous callers, returns the existing job and charges nothing. Accounts never share jobs with each other.

### `GET /v1/transcriptions/:job_id`

- `200` completed `{ "status": "completed", "job_id", "transcription" }`
- `202` processing `{ "status": "processing", "job_id" }`
- `200` failed `{ "status": "failed", "error": { code, message, upload_url? } }`. A failed job is a 200 here, not an error.
- `404` for unknown ids and for jobs the caller may not see.

### `DELETE /v1/transcriptions/:job_id`

- `204` deleted. Credits are not refunded.
- `409 not_ready` while the job is still running.
- `404` as above. Session + CSRF when cookie auth.

### `GET /v1/transcriptions/:job_id/export?format=txt|md|srt|vtt|json`

`format` defaults to `txt`. The response is an attachment: `Content-Disposition: attachment; filename="transcript-<job_id>.<ext>"`.

| Format | Content type | Body |
|---|---|---|
| `txt` | `text/plain` | `transcript_text`, with a final newline |
| `md` | `text/markdown` | `# <title>`, one metadata line (platform, author, language, method, duration), then one `[MM:SS] text` paragraph per segment. `[HH:MM:SS]` past one hour. Speaker prefix only when the worker supplied one. |
| `srt` | `application/x-subrip` | Numbered cues, `HH:MM:SS,mmm --> HH:MM:SS,mmm` |
| `vtt` | `text/vtt` | `WEBVTT`, then cues with `HH:MM:SS.mmm`. Markup in text is escaped. |
| `json` | `application/json` | The Transcription object |

Cue rules for `srt` and `vtt`: segments longer than 7 s or 84 characters are split at word boundaries, with time shared by character count. Cues never overlap or run backwards. Empty segments are dropped. A speaker label is printed only when the worker supplied one. Names are never invented.

Errors: `400` for an unknown format, `409 not_ready` while running, `409 job_failed` for a failed job, `404` as above.

### `Transcription` object

```json
{
  "metadata": { "platform": "youtube", "content_type": "video", "title": "…", "author": "…", "duration_seconds": 58 },
  "language": "en",
  "method": "asr",
  "transcript_text": "[00:00] …",
  "segments": [{ "start": 0.0, "end": 4.2, "speaker": null, "text": "…" }],
  "uncertain_spans": [{ "start": 21.3, "end": 22.0, "text": "…", "reason": "low_confidence" }],
  "on_screen_references": [{ "at": 34.5, "phrase": "…" }],
  "credits_charged": 1
}
```

`metadata` is the worker's `source` block, renamed as the contract requires. The MCP tools keep the name `source`.

## Uploads

### `POST /v1/uploads`

- Raw body, up to `MAX_UPLOAD_BYTES` (2 GB). `Content-Type` must be `video/*` or `audio/*` and on the allow-list.
- `X-Filename` is required, percent-encoded if needed. Only its extension is used.
- Same validation as the `/upload/:token` page: extension, MIME type, magic bytes and size.
- `202` `{ "status": "processing", "job_id" }`. Each upload is a new job and is never shared between users.
- Anonymous uploads use the IP quota. Account uploads use credits and the plan's longest-video limit.
- Errors: 415 `unsupported_media_type` or `unsupported_file_type`, 413 `too_large`, 400 `invalid_request` (missing name, or interrupted), 402 or 429 `quota_exceeded`, 429 `rate_limited`.

The single-use upload links from a failed job (`upload_url`, the `/upload/:token` page) still continue that job under the same `job_id`. The job's owner pays.

## Library

### `GET /v1/library?limit=&offset=`

Account only. `limit` 1 to 100 (default 50), `offset` 0 or more. Newest first.

`{ "items": [{ "id", "title", "platform", "created_at", "status" }], "limit", "offset" }`

Succeeded jobs are kept for `ACCOUNT_JOB_TTL_DAYS` (default 7). Failed jobs follow `JOB_FAILED_TTL_SECONDS`. Anonymous jobs follow `JOB_TTL_SECONDS` (24 h).

## Ownership

- **Account jobs** belong to the account that created them. Only that account can read, export or delete them. Everyone else gets 404.
- **Anonymous jobs** are capability-by-`job_id`: anyone holding the id can read, export or delete them. `job_id` is a random UUID.
- The MCP `get_transcription` tool follows the same rule when the MCP request carries a Bearer key.

## Deviations from the first draft of this contract

These were decided while implementing M3. Each is also called out in `README.md`.

1. List responses are wrapped: `{ "items": [...] }`. The library adds `limit` and `offset`. `GET /v1/plans` returns `{ "plans": [...] }`.
2. `metadata` is the worker's `source` block (see above).
3. Added status codes: 402 for accounts out of credits (429 stays for anonymous quota), 403, 405, 415, 422 and 502.
4. Added error codes: `invalid_request`, `unauthorized`, `invalid_credentials`, `forbidden`, `csrf_failed`, `email_taken`, `not_found`, `not_ready`, `job_failed`, `unsupported_media_type`, `unsupported_file_type`, `too_large`, `method_not_allowed`, `internal`. Worker-internal codes map to `internal`.
5. CSRF is a double-submit cookie (`ms_csrf` with `x-csrf-token`), not a server-issued token.
6. API keys can be created and deleted only from a web session, so a leaked key cannot mint more keys.
7. Account plans cap the longest video (PRD 20.2), which the first draft did not say.
8. A failed `POST /v1/transcriptions` has no `job_id` in its error body. The error shape is fixed.
9. Anonymous uploads are accepted (IP quota), as well as account uploads.
10. Anonymous jobs can be deleted by `job_id`, matching their read access.

## Known limits (M3)

- No email verification or password reset yet: there is no email provider. Sign-up and log-in are limited per IP only.
- Rate limits, anonymous quota and upload links are per process, even with Postgres. They reset on restart.
- Jobs run in the process that accepted them. A restart loses in-flight work, which then expires, so clients must treat a job that stops moving as failed after its active window.
- A run holds 1 credit. A job can overdraw the balance by up to its plan's longest-job cost minus 1 (for example 5 credits on creator). The next run is then refused.
