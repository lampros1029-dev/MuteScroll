"""Plain data types shared across the media worker (PRD section 8.1 response shape)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

Method = Literal["captions", "captions_auto", "asr"]


@dataclass(frozen=True)
class Word:
    start: float
    end: float
    text: str
    probability: float | None = None


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    text: str
    speaker: str | None = None
    # 0..1; exp(avg_logprob) for Whisper-style providers. None when the source has no signal
    # (human-written captions).
    confidence: float | None = None
    words: tuple[Word, ...] = ()


@dataclass(frozen=True)
class UncertainSpan:
    start: float
    end: float
    text: str
    reason: str


@dataclass(frozen=True)
class OnScreenReference:
    at: float
    phrase: str


@dataclass(frozen=True)
class VideoMetadata:
    platform: str
    title: str | None = None
    author: str | None = None
    duration_seconds: float | None = None
    content_type: str | None = None


@dataclass(frozen=True)
class AsrOutput:
    language: str | None
    duration_seconds: float
    segments: tuple[Segment, ...]


@dataclass
class TranscriptResult:
    metadata: VideoMetadata
    language: str | None
    method: Method
    segments: list[Segment]
    transcript_text: str
    uncertain_spans: list[UncertainSpan] = field(default_factory=list)
    on_screen_references: list[OnScreenReference] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """JSON-ready dict matching the `transcribe_video` completed response (PRD 8.1)."""
        return {
            "status": "completed",
            "source": {
                "platform": self.metadata.platform,
                "content_type": self.metadata.content_type,
                "title": self.metadata.title,
                "author": self.metadata.author,
                "duration_seconds": self.metadata.duration_seconds,
            },
            "language": self.language,
            "method": self.method,
            "transcript_text": self.transcript_text,
            "segments": [
                {
                    "start": s.start,
                    "end": s.end,
                    "speaker": s.speaker,
                    "text": s.text,
                }
                for s in self.segments
            ],
            "uncertain_spans": [asdict(u) for u in self.uncertain_spans],
            "on_screen_references": [asdict(r) for r in self.on_screen_references],
        }
