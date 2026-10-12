# MuteScroll

Read any video, right inside your AI chat. Paste a link (or upload a file) and get a timestamped, trustworthy transcript in ChatGPT, Claude, Cursor or any MCP client. The host LLM does the summarizing, translating and analysis; MuteScroll gets the text.

Full spec: [`MuteScroll_PRD.md`](./MuteScroll_PRD.md).

## Layout

| Path | Purpose | Milestone |
|---|---|---|
| `packages/shared` | URL parsing, platform detection, URL safety, credit and timestamp rules (TypeScript) | M0 done |
| `apps/web` | Next.js site (plain CSS): marketing, try, pricing, and connect | live on Railway |
| `apps/api-mcp` | Remote MCP server (`/mcp`), REST API v1 (`/v1`), accounts and API keys, credit ledger, Postgres storage, async jobs, upload links, quotas | M2 (MCP, jobs, uploads, quotas), M3 backend (REST, accounts, credits, Postgres) |
| `workers/media` | Implemented pipeline: retrieval, silence-aware audio chunking, ASR, SSRF guard (Python) | M1 done |

## Develop

```bash
npm install
npm run build        # builds packages/shared first, then apps
npm run typecheck
npm test             # TypeScript tests (vitest)
pip install -e "workers/media[dev]"
npm run test:media   # Python tests (pytest)
```

Copy `.env.example` to `.env` for local config. Never commit secrets.

## Run the MCP server locally

The server exposes two tools, `transcribe_video` and `get_transcription`, over Streamable HTTP at `/mcp`. It runs the Python media worker as a subprocess, so install that first (`pip install -e "workers/media[dev]"`, plus `ffmpeg` on PATH).

```bash
npm install
npm run build
# Local config: copy .env.example to .env, then set PUBLIC_BASE_URL=http://localhost:8080
node --env-file=.env apps/api-mcp/dist/index.js
```

PowerShell, without a `.env` file:

```powershell
npm run build
$env:PORT = "8080"
$env:PUBLIC_BASE_URL = "http://localhost:8080"
$env:GROQ_API_KEY = "<your key>"   # never commit it
node apps/api-mcp/dist/index.js
```

Check it is up with `curl http://localhost:8080/healthz`. The MCP endpoint is `http://localhost:8080/mcp`.

Connect a client:

- **Cursor:** add to `~/.cursor/mcp.json`:
  ```json
  { "mcpServers": { "mutescroll": { "url": "http://localhost:8080/mcp" } } }
  ```
- **Claude Desktop:** the desktop app connects to remote servers through a local bridge. Add to `claude_desktop_config.json`:
  ```json
  { "mcpServers": { "mutescroll": { "command": "npx", "args": ["-y", "mcp-remote", "http://localhost:8080/mcp"] } } }
  ```

Run the tests with `npm test` (TypeScript) and `npm run test:media` (Python). The opt-in worker test runs with `MUTESCROLL_MEDIA_INTEGRATION=1`.

## Run the website locally

`apps/web` is a Next.js app. From the repo root, with the API already listening on port 8080:

```bash
npm run dev -w @mutescroll/web
```

The dev server listens on port 3000. It proxies API calls to `API_BASE_URL` (default `http://localhost:8080`). `NEXT_PUBLIC_MCP_URL` and `NEXT_PUBLIC_SITE_URL` are optional public URLs baked in at build time; local defaults are `http://localhost:8080/mcp` and `https://mutescroll.xyz`.

## REST API and accounts

The same server also serves the REST API v1 under `/v1`. The full contract, with every status code and the list of deviations from the first draft, is in [`docs/rest-api.md`](docs/rest-api.md).

- **Anonymous:** call `POST /v1/transcriptions` with no credentials. Quota is per IP.
- **Accounts:** `POST /v1/auth/signup` and `POST /v1/auth/login` set an HttpOnly session cookie. Writes from the web app must echo the `ms_csrf` cookie in the `x-csrf-token` header.
- **API keys:** Team plan only. Create one in a signed-in session (`POST /v1/api-keys`, shown once), then send `Authorization: Bearer msk_...` to any `/v1` route or to `/mcp`. Any other plan gets 403 `plan_required`. A key whose account is not on Team is rejected.
- **OAuth:** ChatGPT, Claude, and Cursor can connect on every plan. `GET /v1/oauth/grants` lists those connections. `POST /oauth/revoke` removes one. The account page does both.
- **Checkout and deletion:** a signed-in session starts checkout with `POST /v1/checkout` and opens the customer portal with `POST /v1/billing/portal`. `DELETE /v1/me` deletes the account, its transcripts, its keys, and its OAuth grants.
- **Credits:** free accounts get 20 credits a month (UTC). A transcription costs 1 credit per started 10 minutes. Failed jobs are free.

Email verification and password reset are implemented. Those routes answer 503 `email_not_configured` when the mailer variables are missing. Once mail can be sent, the forgot-password reply is the same whether or not the address exists. This file does not claim that mail is configured in production. Sign-ups and log-ins are rate-limited per IP.

## Postgres and migrations

With `DATABASE_URL` set (`postgres://user:pass@host:5432/db`), accounts, jobs, sessions, API keys and the credit ledger live in Postgres. Without it, everything lives in memory for one process and is lost on restart. That is fine for local development.

Apply the schema before the first start, and again after each upgrade that adds a migration:

```bash
npm run build
npm run migrate -w @mutescroll/api-mcp
```

PowerShell, without a `.env` file:

```powershell
npm run build
$env:DATABASE_URL = "postgres://postgres:pw@localhost:5432/ms"
npm run migrate -w @mutescroll/api-mcp
```

The runner applies each file in `apps/api-mcp/migrations/` once, in name order, in its own transaction, and records a checksum. Running it again changes nothing. It refuses to run if an applied file has been edited. The server refuses to start while migrations are pending.

To run the Postgres tests, point `TEST_DATABASE_URL` at a throwaway database. Each test uses its own schema, which is dropped afterwards. The suite runs against both stores when the variable is set, and only against memory when it is not:

```powershell
docker run -d --name ms-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=ms -p 55432:5432 postgres:16
$env:TEST_DATABASE_URL = "postgres://postgres:pw@localhost:55432/ms"
npm test
docker rm -f ms-pg
```

## Production

Production runs on Railway. Two images, matching the Dockerfiles:

- The root `Dockerfile` is the API and the media worker (Node, Python, ffmpeg). The process is `node apps/api-mcp/dist/index.js`. `PORT` comes from the platform.
- `Dockerfile.web` is the Next.js site only. It does not include the media worker. Build args are `API_BASE_URL`, `NEXT_PUBLIC_MCP_URL`, `NEXT_PUBLIC_SITE_URL`, and `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`.

Run migrations as a release step before the API process starts (`npm run migrate -w @mutescroll/api-mcp` with `DATABASE_URL` set). The API refuses to start while migrations are pending.

### Uptime and Postgres backups

Neither check is configured in this repo, and this repo does not create a monitoring account.

- Uptime: watch `https://mutescroll.xyz/` and `https://api.mutescroll.xyz/healthz` from an account you already have.
- Backups: in the Railway project, turn on backups for the Postgres service, or schedule `pg_dump` of that database to storage you control. Do not treat the application database as the only copy.

### Errors

`SENTRY_DSN` is optional. When it is set, the API sends Sentry an envelope that contains the error class name only (no message, stack, URL, or request data). When it is unset, the hook does nothing and makes no outbound call. There is no Sentry SDK dependency.
