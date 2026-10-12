"""Replaceable speech-recognition providers (PRD section 10)."""

from .base import AsrError, TranscriptionProvider
from .groq import GroqProvider

__all__ = ["AsrError", "GroqProvider", "TranscriptionProvider"]
