# MuteScroll

Read any video, right inside your AI chat. Paste a link (or upload a file) and get a timestamped, trustworthy transcript in ChatGPT, Claude, Cursor or any MCP client. The host LLM does the summarizing, translating and analysis; MuteScroll gets the text.

Full spec: [`MuteScroll_PRD.md`](./MuteScroll_PRD.md).

## Layout

| Path | Purpose | Milestone |
|---|---|---|
| `packages/shared` | URL parsing, platform detection, URL safety, credit and timestamp rules (TypeScript) | M0 done |
| `apps/api-mcp` | Remote MCP server (`/mcp`), async jobs, upload links, anonymous quotas | M2 (tools, jobs, uploads, quotas) |
| `workers/media` | Retrieval, audio extraction, ASR routing, SSRF guard (Python) | skeleton; pipeline in M1 |

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
