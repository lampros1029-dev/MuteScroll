"""File-backed transcript cache keyed by sha256(canonical URL, language) with a TTL (PRD 9.4).

Only public-URL results are cached. Uploads are never cached across users (PRD 9.4), and this
module has no entry point for them. The API layer will replace this with Postgres in M2/M3;
the interface (`get` / `put`) stays the same.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

from .models import Method, OnScreenReference, Segment, TranscriptResult, UncertainSpan, VideoMetadata, Word

DEFAULT_TTL_SECONDS = 24 * 3600
_SCHEMA = 1


def cache_key(canonical_url: str, language: str) -> str:
    return hashlib.sha256(f"{canonical_url}|{language}|v{_SCHEMA}".encode()).hexdigest()


class TranscriptCache:
    def __init__(self, directory: Path, *, ttl_seconds: int = DEFAULT_TTL_SECONDS, clock: Any = time.time) -> None:
        self._dir = directory
        self._ttl = ttl_seconds
        self._clock = clock

    def get(self, canonical_url: str, language: str) -> TranscriptResult | None:
        path = self._path(canonical_url, language)
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError:
            return None  # not cached
        try:
            document = json.loads(raw)
        except ValueError:
            path.unlink(missing_ok=True)  # corrupt entry: drop it so it can be rebuilt
            return None
        if not isinstance(document, dict):
            path.unlink(missing_ok=True)
            return None
        if document.get("schema") != _SCHEMA or self._clock() - float(document.get("stored_at", 0)) > self._ttl:
            path.unlink(missing_ok=True)
            return None
        try:
            return _decode(document["result"])
        except (KeyError, TypeError, ValueError):
            path.unlink(missing_ok=True)
            return None

    def put(self, canonical_url: str, language: str, result: TranscriptResult) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        path = self._path(canonical_url, language)
        temp = path.with_suffix(".tmp")
        temp.write_text(
            json.dumps({"schema": _SCHEMA, "stored_at": self._clock(), "result": _encode(result)}, ensure_ascii=False),
            encoding="utf-8",
        )
        temp.replace(path)  # atomic: readers never see a half-written file

    def purge(self, canonical_url: str, language: str) -> bool:
        """Takedown support (PRD 17): remove one entry."""
        path = self._path(canonical_url, language)
        existed = path.exists()
        path.unlink(missing_ok=True)
        return existed

    def _path(self, canonical_url: str, language: str) -> Path:
        return self._dir / f"{cache_key(canonical_url, language)}.json"


def _encode(result: TranscriptResult) -> dict[str, Any]:
    m = result.metadata
    return {
        "metadata": {
            "platform": m.platform, "title": m.title, "author": m.author,
            "duration_seconds": m.duration_seconds, "content_type": m.content_type,
        },  # fmt: skip
        "language": result.language,
        "method": result.method,
        "transcript_text": result.transcript_text,
        "segments": [
            {
                "start": s.start, "end": s.end, "text": s.text, "speaker": s.speaker, "confidence": s.confidence,
                "words": [[w.start, w.end, w.text, w.probability] for w in s.words],
            }
            for s in result.segments
        ],
        "uncertain_spans": [[u.start, u.end, u.text, u.reason] for u in result.uncertain_spans],
        "on_screen_references": [[r.at, r.phrase] for r in result.on_screen_references],
    }  # fmt: skip


def _decode(data: dict[str, Any]) -> TranscriptResult:
    method: Method = data["method"]
    return TranscriptResult(
        metadata=VideoMetadata(**data["metadata"]),
        language=data["language"],
        method=method,
        transcript_text=data["transcript_text"],
        segments=[
            Segment(
                start=s["start"], end=s["end"], text=s["text"], speaker=s["speaker"], confidence=s["confidence"],
                words=tuple(Word(*w) for w in s["words"]),
            )
            for s in data["segments"]
        ],  # fmt: skip
        uncertain_spans=[UncertainSpan(*u) for u in data["uncertain_spans"]],
        on_screen_references=[OnScreenReference(*r) for r in data["on_screen_references"]],
    )
