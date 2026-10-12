# MuteScroll

Read any video, right inside your AI chat. Paste a link (or upload a file) and get a timestamped, trustworthy transcript in ChatGPT, Claude, Cursor or any MCP client. The host LLM does the summarizing, translating and analysis; MuteScroll gets the text.

Full spec: [`MuteScroll_PRD.md`](./MuteScroll_PRD.md).

## Layout

| Path | Purpose | Milestone |
|---|---|---|
| `packages/shared` | URL parsing, platform detection, URL safety, credit and timestamp rules (TypeScript) | M0 done |
| `apps/api-mcp` | HTTP API and remote MCP server (`/mcp`) | skeleton; MCP tools in M2 |
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
