from pathlib import Path

from mutescroll_media import pipeline
from mutescroll_media.cache import TranscriptCache, cache_key
from mutescroll_media.models import (
    OnScreenReference,
    Segment,
    TranscriptResult,
    UncertainSpan,
    VideoMetadata,
    Word,
)
from mutescroll_media.sources import CaptionResult, SourceInfo

URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def sample() -> TranscriptResult:
    return TranscriptResult(
        metadata=VideoMetadata("youtube", "T", "A", 12.5, "short"),
        language="el",
        method="asr",
        segments=[Segment(0.0, 2.0, "Σήμερα $10", confidence=0.9, words=(Word(0.0, 0.5, "Σήμερα", 0.8),))],
        transcript_text="[00:00] Σήμερα $10",
        uncertain_spans=[UncertainSpan(0.0, 0.5, "Σήμερα", "low_confidence")],
        on_screen_references=[OnScreenReference(1.0, "link in bio")],
    )


def test_round_trip_preserves_everything(tmp_path: Path) -> None:
    cache = TranscriptCache(tmp_path)
    cache.put(URL, "auto", sample())
    assert cache.get(URL, "auto") == sample()


def test_miss_for_other_language_or_url(tmp_path: Path) -> None:
    cache = TranscriptCache(tmp_path)
    cache.put(URL, "auto", sample())
    assert cache.get(URL, "el") is None
    assert cache.get(URL + "x", "auto") is None
    assert cache_key(URL, "auto") != cache_key(URL, "el")


def test_entries_expire(tmp_path: Path) -> None:
    now = [1000.0]
    cache = TranscriptCache(tmp_path, ttl_seconds=60, clock=lambda: now[0])
    cache.put(URL, "auto", sample())
    now[0] += 59
    assert cache.get(URL, "auto") is not None
    now[0] += 2
    assert cache.get(URL, "auto") is None
    assert list(tmp_path.glob("*.json")) == []  # expired file removed


def test_corrupt_entry_is_a_miss_and_removed(tmp_path: Path) -> None:
    cache = TranscriptCache(tmp_path)
    cache.put(URL, "auto", sample())
    (next(tmp_path.glob("*.json"))).write_text("{not json", encoding="utf-8")
    assert cache.get(URL, "auto") is None
    assert list(tmp_path.glob("*.json")) == []


def test_purge_for_takedowns(tmp_path: Path) -> None:
    cache = TranscriptCache(tmp_path)
    cache.put(URL, "auto", sample())
    assert cache.purge(URL, "auto") is True
    assert cache.purge(URL, "auto") is False
    assert cache.get(URL, "auto") is None


class CountingSource:
    def __init__(self) -> None:
        self.calls = 0

    def fetch_info(self, url: str) -> SourceInfo:
        self.calls += 1
        return SourceInfo(metadata=VideoMetadata("youtube", "T", duration_seconds=10))

    def fetch_captions(self, info, language, *, automatic: bool):
        return None if automatic else CaptionResult([Segment(0.0, 2.0, "hello")], "en", False)

    def download_audio(self, url, workdir):
        raise AssertionError("not needed")


def test_pipeline_uses_cache_and_skips_the_source_on_a_hit(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(pipeline, "assert_url_safe", lambda *a, **k: None)
    cache = TranscriptCache(tmp_path)
    source = CountingSource()
    first = pipeline.transcribe_url(URL, source=source, asr=None, cache=cache)
    second = pipeline.transcribe_url(URL, source=source, asr=None, cache=cache)
    assert source.calls == 1
    assert second.transcript_text == first.transcript_text
