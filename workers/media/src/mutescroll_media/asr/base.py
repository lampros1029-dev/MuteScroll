from __future__ import annotations

from pathlib import Path
from typing import Protocol

from ..models import AsrOutput


class AsrError(RuntimeError):
    """Provider failure. `retryable` tells the router whether to fail over or give up."""

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


class TranscriptionProvider(Protocol):
    name: str

    def transcribe(self, audio_path: Path, language: str | None) -> AsrOutput:
        """Transcribe one audio file. `language` is an ISO 639-1 code, or None for auto-detect."""
        ...
