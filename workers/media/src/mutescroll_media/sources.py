"""Media retrieval via yt-dlp (PRD 9.3 strategy 1-2).

Hard rules, enforced here rather than left to callers (PRD 4.2):
- never pass cookies or credentials, never read user yt-dlp config files;
- single videos only (no playlists); audio-only download; size cap;
- egress proxy comes from server config, never from user input.
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlsplit

import httpx
import yt_dlp
from yt_dlp.utils import DownloadError

from .captions import parse_json3, pick_track
from .models import Segment, VideoMetadata

MAX_DOWNLOAD_BYTES = 2 * 1024**3


class RetrievalError(RuntimeError):
    """Retrieval failed. `code` is stable and maps to the user-facing messages in PRD section 13."""

    def __init__(self, code: str, message: str, detail: str = "") -> None:
        super().__init__(message)
        self.code = code
        # Raw upstream error for operator logs only; never show this to end users.
        self.detail = detail[:500]


@dataclass(frozen=True)
class CaptionResult:
    segments: list[Segment]
    language: str
    automatic: bool


@dataclass
class SourceInfo:
    metadata: VideoMetadata
    manual_captions: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    automatic_captions: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    video_language: str | None = None
    source_url: str | None = None


class MediaSource(Protocol):
    def fetch_info(self, url: str) -> SourceInfo: ...

    def fetch_captions(self, info: SourceInfo, language: str | None, *, automatic: bool) -> CaptionResult | None: ...

    def download_audio(self, url: str, workdir: Path) -> Path: ...


def platform_of(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    for domain, platform in (
        ("youtube.com", "youtube"), ("youtu.be", "youtube"), ("tiktok.com", "tiktok"),
        ("instagram.com", "instagram"), ("facebook.com", "facebook"), ("fb.watch", "facebook"),
        ("fb.com", "facebook"),
    ):  # fmt: skip
        if host == domain or host.endswith(f".{domain}"):
            return platform
    return "unknown"


def classify_error(message: str) -> RetrievalError:
    lowered = message.lower()
    if "confirm you" in lowered and "bot" in lowered:
        return RetrievalError("blocked_bot_check", "The platform blocked automated access from this server.", message)
    if any(
        t in lowered
        for t in (
            "private", "login", "log in", "sign in", "cookies", "members-only", "age-restricted",
            "age restricted", "empty media response",
        )
    ):  # fmt: skip
        return RetrievalError("private_or_login_required", "This video needs an account or special access.", message)
    if any(t in lowered for t in ("unavailable", "removed", "deleted", "not exist", "no video", "404")):
        return RetrievalError("unavailable", "This video is unavailable or was removed.", message)
    if "drm" in lowered:
        return RetrievalError("drm_protected", "This video is DRM-protected.", message)
    return RetrievalError("retrieval_failed", "Could not retrieve this video.", message)


class _SilentLogger:
    """yt-dlp writes progress to the console even in quiet mode; failures arrive as exceptions."""

    def debug(self, _msg: str) -> None: ...
    def info(self, _msg: str) -> None: ...
    def warning(self, _msg: str) -> None: ...
    def error(self, _msg: str) -> None: ...


class YtDlpSource:
    def __init__(self, *, proxy: str | None = None, http: httpx.Client | None = None) -> None:
        self._proxy = proxy if proxy is not None else (os.environ.get("MEDIA_EGRESS_PROXY_URL") or None)
        self._http = http or httpx.Client(timeout=20.0, follow_redirects=False)

    def _base_options(self) -> dict[str, Any]:
        # YouTube extraction needs a JS runtime for signature challenges (yt-dlp EJS).
        runtimes = {name: {} for name in ("deno", "node") if shutil.which(name)}
        return {
            "js_runtimes": runtimes or {"deno": {}},
            "logger": _SilentLogger(),
            "quiet": True,
            "noprogress": True,
            "no_warnings": True,
            "noplaylist": True,
            "ignoreconfig": True,
            "socket_timeout": 30,
            "retries": 3,
            "restrictfilenames": True,
            "cookiefile": None,
            "cookiesfrombrowser": None,
            "username": None,
            "password": None,
            "proxy": self._proxy,
        }

    def fetch_info(self, url: str) -> SourceInfo:
        if platform_of(url) == "youtube" and not (shutil.which("deno") or shutil.which("node")):
            raise RetrievalError(
                "worker_misconfigured", "YouTube needs a JavaScript runtime (deno or node) on the worker."
            )
        try:
            with yt_dlp.YoutubeDL({**self._base_options(), "skip_download": True}) as ydl:
                info = ydl.extract_info(url, download=False)
        except DownloadError as exc:
            raise classify_error(str(exc)) from exc
        except Exception as exc:  # yt-dlp raises many types for extractor bugs
            raise RetrievalError("retrieval_failed", f"Could not read video info ({exc.__class__.__name__}).") from exc
        if not isinstance(info, dict):
            raise RetrievalError("retrieval_failed", "Could not read video info.")
        if info.get("is_live"):
            raise RetrievalError("live_stream", "Live streams are not supported.")
        metadata = VideoMetadata(
            platform=platform_of(url),
            title=info.get("title"),
            author=info.get("uploader") or info.get("channel"),
            duration_seconds=float(info["duration"]) if info.get("duration") else None,
            content_type="short" if "/shorts/" in url else None,
        )
        return SourceInfo(
            metadata=metadata,
            manual_captions=info.get("subtitles") or {},
            automatic_captions=info.get("automatic_captions") or {},
            video_language=info.get("language"),
        )

    def fetch_captions(self, info: SourceInfo, language: str | None, *, automatic: bool) -> CaptionResult | None:
        tracks = info.automatic_captions if automatic else info.manual_captions
        picked = pick_track(tracks, language, info.video_language)
        if picked is None:
            return None
        code, fmt = picked
        try:
            response = self._http.get(fmt["url"])
            response.raise_for_status()
            segments = parse_json3(response.json())
        except (httpx.HTTPError, ValueError):
            return None
        if not segments:
            return None
        return CaptionResult(segments=segments, language=code.split("-")[0], automatic=automatic)

    def download_audio(self, url: str, workdir: Path) -> Path:
        options = {
            **self._base_options(),
            "format": "bestaudio/best",
            "outtmpl": str(workdir / "source.%(ext)s"),
            "max_filesize": MAX_DOWNLOAD_BYTES,
            "overwrites": True,
        }
        try:
            with yt_dlp.YoutubeDL(options) as ydl:
                ydl.extract_info(url, download=True)
        except DownloadError as exc:
            raise classify_error(str(exc)) from exc
        except Exception as exc:
            raise RetrievalError("retrieval_failed", f"Download failed ({exc.__class__.__name__}).") from exc
        files = sorted(workdir.glob("source.*"))
        files = [f for f in files if f.suffix not in (".part", ".ytdl")]
        if not files:
            raise RetrievalError("retrieval_failed", "No audio was downloaded (file too large or blocked).")
        return files[0]
