"""Parse platform caption tracks (YouTube json3) into segments (PRD 9.3 step 1: captions first)."""

from __future__ import annotations

import html
import re
from typing import Any

from .models import Segment

_WHITESPACE = re.compile(r"\s+")


def parse_json3(payload: dict[str, Any]) -> list[Segment]:
    """Convert a YouTube `json3` caption document to segments.

    Auto-generated tracks contain rolling, overlapping events; we merge events that start inside
    the previous one so the text is not duplicated, and clamp segment ends to the next start.
    """
    segments: list[Segment] = []
    for event in payload.get("events") or []:
        raw_segs = event.get("segs")
        if not raw_segs or "tStartMs" not in event:
            continue
        text = "".join(str(s.get("utf8", "")) for s in raw_segs)
        text = _WHITESPACE.sub(" ", html.unescape(text)).strip()
        if not text:
            continue
        start = int(event["tStartMs"]) / 1000.0
        end = start + int(event.get("dDurationMs") or 0) / 1000.0
        if segments and text == segments[-1].text:
            continue
        segments.append(Segment(start=start, end=max(end, start), text=text))

    clamped: list[Segment] = []
    for index, segment in enumerate(segments):
        end = segment.end
        if index + 1 < len(segments):
            end = min(end, segments[index + 1].start) if segments[index + 1].start > segment.start else end
        clamped.append(Segment(start=segment.start, end=max(end, segment.start), text=segment.text))
    return clamped


def pick_track(
    tracks: dict[str, list[dict[str, Any]]], preferred_language: str | None, video_language: str | None
) -> tuple[str, dict[str, Any]] | None:
    """Pick the best (language, json3 format entry) from yt-dlp's subtitle dict."""
    if not tracks:
        return None
    wanted = [c for c in (preferred_language, video_language, "en") if c and c != "auto"]
    candidates: list[str] = []
    for code in wanted:
        candidates.extend(k for k in tracks if k == code or k.startswith(f"{code}-"))
    candidates.extend(k for k in tracks if k not in candidates and not k.endswith("-orig") and k != "live_chat")
    for code in candidates:
        for fmt in tracks.get(code, []):
            if fmt.get("ext") == "json3" and fmt.get("url"):
                return code, fmt
    return None
