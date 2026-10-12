"""Supadata transcript client: failover when the media itself cannot be fetched (PRD 22.2).

Response shape (verified live): {"lang": "en", "content": [{"text", "offset", "duration"}]} with
offset and duration in milliseconds. One credit per native transcript. Used only as a last resort
because its text is the vendor's, not ours, so results are labelled `captions_auto`.
"""

from __future__ import annotations

import httpx

from ..models import Segment
from ..sources import CaptionResult

DEFAULT_BASE_URL = "https://api.supadata.ai"


class SupadataClient:
    def __init__(self, api_key: str, http: httpx.Client | None = None, base_url: str = DEFAULT_BASE_URL) -> None:
        self._http = http or httpx.Client(timeout=90.0)
        self._base_url = base_url.rstrip("/")
        self._headers = {"x-api-key": api_key}
        self.credits_used = 0

    def transcript(self, url: str, language: str | None) -> CaptionResult | None:
        params = {"url": url, "mode": "native"}
        if language:
            params["lang"] = language
        try:
            response = self._http.get(f"{self._base_url}/v1/transcript", params=params, headers=self._headers)
        except httpx.HTTPError:
            return None
        if response.status_code != 200:
            return None
        try:
            payload = response.json()
        except ValueError:
            return None
        self.credits_used += _billable(response)
        return parse_transcript(payload)


def _billable(response: httpx.Response) -> int:
    try:
        return int(response.headers.get("x-billable-requests", "1"))
    except ValueError:
        return 1


def parse_transcript(payload: object) -> CaptionResult | None:
    if not isinstance(payload, dict):
        return None
    content = payload.get("content")
    if not isinstance(content, list):
        return None
    segments: list[Segment] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text", "")).strip()
        offset = item.get("offset")
        duration = item.get("duration", 0)
        if not text or not isinstance(offset, int | float) or not isinstance(duration, int | float):
            continue
        start = offset / 1000.0
        segments.append(Segment(start=start, end=start + max(duration, 0) / 1000.0, text=text))
    if not segments:
        return None
    return CaptionResult(segments=segments, language=str(payload.get("lang") or "und"), automatic=True)
