"""Groq-hosted Whisper (default ASR tier, PRD section 10).

Groq's verbose_json gives segment-level `avg_logprob` and `no_speech_prob` and word timestamps,
but no per-word probability, so uncertain spans come from segment confidence for this provider.
"""

from __future__ import annotations

import math
import time
from pathlib import Path
from typing import Any

import httpx

from ..models import AsrOutput, Segment, Word
from .base import AsrError

API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
DEFAULT_MODEL = "whisper-large-v3-turbo"
MAX_FILE_BYTES = 24 * 1024 * 1024  # free tier allows 25 MB; keep headroom

# Groq returns language names; map the ones we expect to ISO 639-1.
_LANGUAGE_CODES = {
    "english": "en", "greek": "el", "spanish": "es", "french": "fr", "german": "de",
    "italian": "it", "portuguese": "pt", "dutch": "nl", "turkish": "tr", "russian": "ru",
    "arabic": "ar", "hindi": "hi", "japanese": "ja", "korean": "ko", "chinese": "zh",
    "polish": "pl", "ukrainian": "uk", "romanian": "ro", "swedish": "sv", "hebrew": "he",
}  # fmt: skip


class GroqProvider:
    name = "groq"

    def __init__(
        self,
        api_key: str,
        *,
        model: str = DEFAULT_MODEL,
        client: httpx.Client | None = None,
        max_attempts: int = 4,
        sleep: Any = time.sleep,
    ) -> None:
        if not api_key:
            raise ValueError("GROQ_API_KEY is required")
        self._api_key = api_key
        self._model = model
        self._client = client or httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0))
        self._max_attempts = max_attempts
        self._sleep = sleep

    def transcribe(self, audio_path: Path, language: str | None) -> AsrOutput:
        size = audio_path.stat().st_size
        if size > MAX_FILE_BYTES:
            raise AsrError(f"audio file too large for one request ({size} bytes); chunk it first")

        data: dict[str, str | list[str]] = {
            "model": self._model,
            "response_format": "verbose_json",
            "timestamp_granularities[]": ["segment", "word"],
            "temperature": "0",
        }
        if language and language != "auto":
            data["language"] = language

        payload = self._request_with_retries(audio_path, data)
        return _parse_verbose_json(payload)

    def _request_with_retries(self, audio_path: Path, data: dict[str, str | list[str]]) -> dict[str, Any]:
        last_error = "unknown error"
        for attempt in range(1, self._max_attempts + 1):
            try:
                with audio_path.open("rb") as handle:
                    response = self._client.post(
                        API_URL,
                        headers={"Authorization": f"Bearer {self._api_key}"},
                        data=data,
                        files={"file": (audio_path.name, handle, "application/octet-stream")},
                    )
            except httpx.TransportError as exc:
                last_error = f"network error: {exc.__class__.__name__}"
            else:
                if response.status_code == 200:
                    return response.json()  # type: ignore[no-any-return]
                last_error = f"HTTP {response.status_code}: {_error_message(response)}"
                if response.status_code in (400, 401, 403, 404, 413, 422):
                    raise AsrError(f"groq rejected the request ({last_error})", retryable=False)
                if response.status_code == 429:
                    self._sleep(_retry_after(response, attempt))
                    continue
            if attempt < self._max_attempts:
                self._sleep(min(2.0**attempt, 20.0))
        raise AsrError(f"groq failed after {self._max_attempts} attempts ({last_error})", retryable=True)


def _retry_after(response: httpx.Response, attempt: int) -> float:
    header = response.headers.get("retry-after")
    try:
        if header is not None:
            return min(float(header), 60.0)
    except ValueError:
        pass
    return min(2.0**attempt, 20.0)


def _error_message(response: httpx.Response) -> str:
    try:
        return str(response.json().get("error", {}).get("message", ""))[:200]
    except (ValueError, AttributeError):
        return response.text[:200]


def _parse_verbose_json(payload: dict[str, Any]) -> AsrOutput:
    raw_words = payload.get("words") or []
    words = [
        Word(start=float(w["start"]), end=float(w["end"]), text=str(w["word"]))
        for w in raw_words
        if "start" in w and "end" in w and "word" in w
    ]

    segments: list[Segment] = []
    for raw in payload.get("segments") or []:
        start, end = float(raw["start"]), float(raw["end"])
        text = str(raw.get("text", "")).strip()
        avg_logprob = raw.get("avg_logprob")
        no_speech = float(raw.get("no_speech_prob", 0.0))
        # Whisper hallucinates text over silence/music; drop segments it itself flags as non-speech.
        if not text or (no_speech > 0.85 and (avg_logprob is None or avg_logprob < -0.8)):
            continue
        confidence = math.exp(float(avg_logprob)) if avg_logprob is not None else None
        in_segment = tuple(w for w in words if w.start >= start - 0.05 and w.end <= end + 0.05)
        segments.append(Segment(start=start, end=end, text=text, confidence=confidence, words=in_segment))

    duration = float(payload.get("duration") or (segments[-1].end if segments else 0.0))
    language = _language_code(payload.get("language"))
    return AsrOutput(language=language, duration_seconds=duration, segments=tuple(segments))


def _language_code(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).strip().lower()
    if len(text) <= 3:
        return text
    return _LANGUAGE_CODES.get(text, text)
