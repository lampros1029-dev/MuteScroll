# MuteScroll API + MCP server with the Python media worker (PRD 15). One container for the MVP.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ffmpeg/ffprobe for audio, python for the worker. Node (already present) is the JS runtime yt-dlp needs for YouTube.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python worker in its own virtualenv.
COPY workers/media /app/workers/media
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install /app/workers/media

# TypeScript workspaces: install, build, then drop dev dependencies.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api-mcp apps/api-mcp
RUN npm ci && npm run build && npm prune --omit=dev

# Non-root runtime; uploads and the transcript cache live under /tmp and the home directory.
RUN useradd --create-home --uid 10001 mutescroll
USER mutescroll

ENV NODE_ENV=production \
    MEDIA_WORKER_PYTHON=/opt/venv/bin/python \
    TRUST_PROXY=true

# PORT is provided by the platform (Railway); the server defaults to 8080 locally.
EXPOSE 8080
CMD ["node", "apps/api-mcp/dist/index.js"]
