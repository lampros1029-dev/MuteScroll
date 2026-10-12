# MuteScroll REST API v1 (contract for apps/api-mcp and apps/web)

Base URL: `PUBLIC_BASE_URL`. JSON in, JSON out, UTF-8. Errors always use:

```json
{ "error": { "code": "unsupported_url", "message": "Human-readable, safe to show.", "upload_url": "optional" } }
```

Codes reuse the MCP tool codes (`invalid_url`, `unsupported_url`, `unsafe_url`, `unavailable`, `private_or_login_required`,
`blocked_bot_check`, `too_long`, `no_speech`, `quota_exceeded`, `rate_limited`, `retrieval_failed`, `asr_error`, `internal`).
HTTP status: 400 validation, 401 auth, 402 not enough credits (accounts), 404 unknown job, 409 wrong state, 413 too large,
415 bad file type, 429 quota/rate (anonymous), 502 upstream, 500 internal. Never include stack traces or upstream text.

## Authentication
- Anonymous: no header. Quota keyed by client IP (`ANON_CREDITS` per 24 h).
- Account: `Authorization: Bearer msk_<random>` (API key) or the session cookie `ms_session` (web app, HttpOnly, SameSite=Lax,
  CSRF header `x-csrf-token` required on cookie-authenticated POST/DELETE).

## Transcriptions
`POST /v1/transcriptions` body `{ "url": string, "language"?: "auto" | ISO-639-1 }`
- 200 `{ "status": "completed", "job_id", "transcription": Transcription }`
- 202 `{ "status": "processing", "job_id" }` (poll the GET below; server waits up to `TOOL_WAIT_MS` first)
- error body as above; retrieval failures include `upload_url` and charge nothing.

`GET /v1/transcriptions/:job_id` -> same 200/202 shapes, or `{ "status": "failed", "error": {...} }` with HTTP 200.

`Transcription` is exactly the worker result (PRD 8.1): `metadata`, `language`, `method`, `transcript_text`, `segments[]`,
`uncertain_spans[]`, `on_screen_references[]`, plus `credits_charged`.

`GET /v1/transcriptions/:job_id/export?format=txt|md|srt|vtt|json` -> file download with `Content-Disposition`.
Formats: `txt` = `transcript_text`; `md` = title heading, metadata line, then timestamped lines; `srt`/`vtt` from segments
(millisecond cues, no speaker invention); `json` = the Transcription object.

## Uploads (web)
`POST /v1/uploads` raw body (`Content-Type: video/*|audio/*`), header `X-Filename`. Same validation as `/upload/:token`
(extension, MIME, magic bytes, size cap). 202 `{ "status": "processing", "job_id" }`. Uploads are never cached across users.

## Accounts (apps/api-mcp)
- `POST /v1/auth/signup` `{ email, password }` -> 201, sets session cookie. Password policy: 10-128 chars. Stored with scrypt.
- `POST /v1/auth/login`, `POST /v1/auth/logout`, `GET /v1/me` -> `{ email, plan, credits: { remaining, resets_at }, created_at }`.
- `POST /v1/api-keys` -> 201 `{ id, key }` (key shown once), `GET /v1/api-keys` (id, prefix, created_at, last_used_at),
  `DELETE /v1/api-keys/:id`.
- `GET /v1/library` -> the account's past jobs (id, title, platform, created_at, status); `DELETE /v1/transcriptions/:job_id`.
- Free account: 20 credits per calendar month. 1 credit per started 10 minutes of audio. Failed jobs never consume credits.

## Billing (informational in the connector build, PRD 4.1)
`GET /v1/plans` -> public plan list (no checkout links). Checkout happens only on the web app via the billing provider.
