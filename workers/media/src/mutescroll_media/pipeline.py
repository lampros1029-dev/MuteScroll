"""End-to-end transcription pipeline (PRD section 9.1).

URL -> safety checks -> info -> captions (manual) -> audio -> ASR -> post-process.
Local files take the same ASR path, so output is identical (PRD section 14).
"""

from __future__ import annotations

import tempfile
from dataclasses import replace
from pathlib import Path
from urllib.parse import urlsplit

from .asr import AsrError, TranscriptionProvider
from .audio import NoSpeechError, extract_audio, probe_duration, split_audio
from .cache import TranscriptCache
from .models import Method, Segment, TranscriptResult, VideoMetadata, Word
from .postprocess import (
    clean_text,
    find_on_screen_references,
    find_uncertain_spans,
    render_transcript,
)
from .sources import CaptionResult, MediaSource, RetrievalError, SourceInfo, platform_of
from .ssrf import assert_url_safe, resolve_redirects

DEFAULT_MAX_SECONDS = 2 * 60 * 60
_SHORT_LINK_HOSTS = {"vm.tiktok.com", "vt.tiktok.com", "fb.watch"}


def transcribe_url(
    url: str,
    *,
    source: MediaSource,
    asr: TranscriptionProvider | None,
    language: str = "auto",
    max_seconds: float = DEFAULT_MAX_SECONDS,
    allow_auto_captions: bool = True,
    workdir: Path | None = None,
    cache: TranscriptCache | None = None,
) -> TranscriptResult:
    url = _prepare_url(url)
    if cache is not None:
        hit = cache.get(url, language)
        if hit is not None:
            return hit
    result = _transcribe_uncached(
        url, source, asr, language, max_seconds, allow_auto_captions, workdir
    )
    if cache is not None:
        cache.put(url, language, result)
    return result


def _transcribe_uncached(
    url: str,
    source: MediaSource,
    asr: TranscriptionProvider | None,
    language: str,
    max_seconds: float,
    allow_auto_captions: bool,
    workdir: Path | None,
) -> TranscriptResult:
    requested = None if language == "auto" else language
    info = source.fetch_info(url)

    duration = info.metadata.duration_seconds
    if duration is not None and duration > max_seconds:
        raise RetrievalError("too_long", f"Video is {int(duration)}s; the limit is {int(max_seconds)}s.")

    manual = source.fetch_captions(info, requested, automatic=False)
    if manual is not None:
        return _from_captions(info.metadata, manual, "captions")

    with _workspace(workdir) as tmp:
        try:
            audio = source.download_audio(url, tmp)
        except RetrievalError:
            # Audio could not be fetched (e.g. datacenter IP block). Auto-captions beat nothing.
            if allow_auto_captions:
                auto = source.fetch_captions(info, requested, automatic=True)
                if auto is not None:
                    # Automatic platform captions stay captions_auto.
                    # Groq audio transcription below is asr, never a caption method.
                    method: Method = "captions_vendor" if auto.vendor else "captions_auto"
                    return _from_captions(info.metadata, auto, method)
            raise
        return _transcribe_media(audio, tmp, info.metadata, asr, requested, max_seconds)


def transcribe_file(
    path: Path,
    *,
    asr: TranscriptionProvider | None,
    language: str = "auto",
    max_seconds: float = DEFAULT_MAX_SECONDS,
    title: str | None = None,
    workdir: Path | None = None,
) -> TranscriptResult:
    if not path.is_file():
        raise RetrievalError("file_not_found", f"File not found: {path.name}")
    requested = None if language == "auto" else language
    metadata = VideoMetadata(platform="upload", title=title or path.name)
    with _workspace(workdir) as tmp:
        return _transcribe_media(path, tmp, metadata, asr, requested, max_seconds)


def _prepare_url(url: str) -> str:
    url = url.strip()
    assert_url_safe(url)
    host = (urlsplit(url).hostname or "").lower()
    path = urlsplit(url).path
    if host in _SHORT_LINK_HOSTS or path.startswith(("/t/", "/share/")):
        url = resolve_redirects(url)
    if platform_of(url) == "unknown":
        raise PermissionError("unsupported host after redirect resolution")
    return url


class _workspace:
    """Use the caller's directory, or a temp dir that is always deleted (PRD 17: media is ephemeral)."""

    def __init__(self, workdir: Path | None) -> None:
        self._given = workdir
        self._tmp: tempfile.TemporaryDirectory[str] | None = None

    def __enter__(self) -> Path:
        if self._given is not None:
            self._given.mkdir(parents=True, exist_ok=True)
            return self._given
        self._tmp = tempfile.TemporaryDirectory(prefix="mutescroll_")
        return Path(self._tmp.name)

    def __exit__(self, *_exc: object) -> None:
        if self._tmp is not None:
            self._tmp.cleanup()


def _transcribe_media(
    media: Path,
    workdir: Path,
    metadata: VideoMetadata,
    asr: TranscriptionProvider | None,
    language: str | None,
    max_seconds: float,
) -> TranscriptResult:
    if asr is None:
        raise AsrError("no ASR provider configured (set GROQ_API_KEY)")
    audio = extract_audio(media, workdir / "audio.ogg")
    duration = probe_duration(audio)
    if duration > max_seconds:
        raise RetrievalError("too_long", f"Media is {int(duration)}s; the limit is {int(max_seconds)}s.")

    segments: list[Segment] = []
    detected = language
    for chunk in split_audio(audio, workdir, duration):
        output = asr.transcribe(chunk.path, detected)
        if detected is None and output.segments:
            detected = output.language  # keep later chunks consistent with the first speech chunk
        segments.extend(_shift(s, chunk.offset_seconds) for s in output.segments)

    segments = [replace(s, text=clean_text(s.text)) for s in segments if s.text.strip()]
    if not segments:
        raise NoSpeechError("Processed the media but found no meaningful speech (music or sound only).")
    metadata = replace(metadata, duration_seconds=metadata.duration_seconds or duration)
    return _assemble(metadata, detected, "asr", segments, duration)


def _from_captions(metadata: VideoMetadata, captions: CaptionResult, method: Method) -> TranscriptResult:
    segments = [replace(s, text=clean_text(s.text)) for s in captions.segments if s.text.strip()]
    duration = metadata.duration_seconds or (segments[-1].end if segments else 0.0)
    return _assemble(metadata, captions.language, method, segments, duration)


def _assemble(
    metadata: VideoMetadata, language: str | None, method: Method, segments: list[Segment], duration: float
) -> TranscriptResult:
    return TranscriptResult(
        metadata=metadata,
        language=language,
        method=method,
        segments=segments,
        transcript_text=render_transcript(segments, duration),
        uncertain_spans=find_uncertain_spans(segments),
        on_screen_references=find_on_screen_references(segments),
    )


def _shift(segment: Segment, offset: float) -> Segment:
    if offset == 0:
        return segment
    words = tuple(Word(w.start + offset, w.end + offset, w.text, w.probability) for w in segment.words)
    return replace(segment, start=segment.start + offset, end=segment.end + offset, words=words)


__all__ = ["SourceInfo", "transcribe_file", "transcribe_url"]
