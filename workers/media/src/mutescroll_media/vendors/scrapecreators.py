"""ScrapeCreators client: resolves a public TikTok / Instagram post URL to a media URL (PRD 22.2).

We pay one credit per call and do the transcription ourselves, so timestamps, confidence and the
number-fidelity guard stay ours. Response shapes were taken from the vendor docs on 2026-10-12 and
must be re-verified by the pilot (`scripts/pilot_vendors.py`).
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

from ..sources import RetrievalError

API_BASE = "https://api.scrapecreators.com"
_RETRY_STATUS = frozenset({429, 500, 502, 503, 504})


@dataclass(frozen=True)
class ResolvedMedia:
    media_url: str
    duration_seconds: float | None
    title: str | None
    author: str | None
    credits_charged: int


class ScrapeCreatorsClient:
    def __init__(
        self,
        api_key: str,
        *,
        http: httpx.Client | None = None,
        base_url: str = API_BASE,
        max_attempts: int = 3,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if not api_key:
            raise ValueError("a ScrapeCreators API key is required")
        self._http = http or httpx.Client(timeout=45.0)  # their AI paths can take 10-30 s
        self._base = base_url.rstrip("/")
        self._headers = {"x-api-key": api_key}
        self._attempts = max_attempts
        self._sleep = sleep

    def resolve(self, platform: str, url: str) -> ResolvedMedia:
        if platform == "tiktok":
            return _parse_tiktok(self._get("/v2/tiktok/video", url))
        if platform == "instagram":
            return _parse_instagram(self._get("/v1/instagram/post", url))
        raise RetrievalError("unsupported_platform", f"The video vendor does not handle {platform}.")

    def _get(self, path: str, url: str) -> dict[str, Any]:
        last = ""
        for attempt in range(1, self._attempts + 1):
            try:
                response = self._http.get(self._base + path, params={"url": url}, headers=self._headers)
            except httpx.HTTPError as exc:
                last = exc.__class__.__name__
            else:
                if response.status_code in _RETRY_STATUS and attempt < self._attempts:
                    last = f"HTTP {response.status_code}"
                    self._sleep(min(2.0 * attempt, 6.0))
                    continue
                return _check(response)
            if attempt < self._attempts:
                self._sleep(min(2.0 * attempt, 6.0))
        raise RetrievalError("retrieval_failed", "The video service did not respond.", last)


def _check(response: httpx.Response) -> dict[str, Any]:
    status = response.status_code
    if status in (401, 403):
        raise RetrievalError("worker_misconfigured", "The video service rejected our credentials.", f"HTTP {status}")
    if status == 402:
        raise RetrievalError("vendor_unavailable", "The video service is out of credits.", "HTTP 402")
    if status == 404:
        raise RetrievalError("unavailable", "This video is unavailable or was removed.", "HTTP 404")
    if status >= 400:
        raise RetrievalError("retrieval_failed", "Could not retrieve this video.", f"HTTP {status} {response.text[:200]}")
    try:
        body = response.json()
    except ValueError as exc:
        raise RetrievalError("retrieval_failed", "Could not retrieve this video.", "non-JSON response") from exc
    if not isinstance(body, dict) or body.get("success") is False:
        raise RetrievalError("unavailable", "This video is unavailable or was removed.", str(body)[:200])
    return body


def _first_url(address: Any) -> str | None:
    urls = address.get("url_list") if isinstance(address, dict) else None
    if isinstance(urls, list):
        for candidate in urls:
            if isinstance(candidate, str) and candidate.startswith("https://"):
                return candidate
    return None


def _credits(body: dict[str, Any]) -> int:
    value = body.get("credits_charged")
    return value if isinstance(value, int) else 0


def _parse_tiktok(body: dict[str, Any]) -> ResolvedMedia:
    detail = body.get("aweme_detail")
    if not isinstance(detail, dict):
        raise RetrievalError("unavailable", "This video is unavailable or was removed.")
    video = detail.get("video") if isinstance(detail.get("video"), dict) else {}
    # play_addr is the smaller rendition; we only need the audio track.
    media = _first_url(video.get("play_addr")) or _first_url(video.get("download_no_watermark_addr"))
    if media is None:
        raise RetrievalError("unavailable", "This post has no video to transcribe.")
    duration_ms = video.get("duration")
    author = detail.get("author") if isinstance(detail.get("author"), dict) else {}
    return ResolvedMedia(
        media_url=media,
        duration_seconds=duration_ms / 1000 if isinstance(duration_ms, int | float) and duration_ms > 0 else None,
        title=(detail.get("desc") or None),
        author=author.get("nickname") or author.get("unique_id"),
        credits_charged=_credits(body),
    )


def _parse_instagram(body: dict[str, Any]) -> ResolvedMedia:
    data = body.get("data")
    media = data.get("xdt_shortcode_media") if isinstance(data, dict) else None
    if not isinstance(media, dict):
        raise RetrievalError("unavailable", "This video is unavailable or was removed.")
    video_url = media.get("video_url")
    if not media.get("is_video") or not isinstance(video_url, str) or not video_url.startswith("https://"):
        raise RetrievalError("unavailable", "This post has no video to transcribe.")
    edges = (media.get("edge_media_to_caption") or {}).get("edges") or []
    caption = edges[0].get("node", {}).get("text") if edges and isinstance(edges[0], dict) else None
    owner = media.get("owner") if isinstance(media.get("owner"), dict) else {}
    duration = media.get("video_duration")
    return ResolvedMedia(
        media_url=video_url,
        duration_seconds=float(duration) if isinstance(duration, int | float) and duration > 0 else None,
        title=caption or None,
        author=owner.get("username"),
        credits_charged=_credits(body),
    )
