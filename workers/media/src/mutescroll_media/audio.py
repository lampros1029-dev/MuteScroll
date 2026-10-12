"""ffmpeg/ffprobe helpers. Arguments are always passed as lists (never through a shell)."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

FFMPEG_TIMEOUT_SECONDS = 600
# Whisper models resample to 16 kHz mono internally, so we do it up front: smaller upload, same accuracy.
AUDIO_ARGS = ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", "-application", "voip"]
CHUNK_SECONDS = 20 * 60


class MediaError(RuntimeError):
    pass


class NoSpeechError(MediaError):
    """The media has no audio track, or no recognisable speech (PRD section 13, 'No speech')."""

    def __init__(self, message: str, code: str = "no_speech") -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Chunk:
    path: Path
    offset_seconds: float


def _require(binary: str) -> str:
    found = shutil.which(binary)
    if found is None:
        raise MediaError(f"{binary} is not installed or not on PATH")
    return found


def _run(args: list[str], timeout: int = FFMPEG_TIMEOUT_SECONDS) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired as exc:
        raise MediaError(f"{Path(args[0]).stem} timed out after {timeout}s") from exc


def probe_duration(path: Path) -> float:
    result = _run(
        [_require("ffprobe"), "-v", "error", "-print_format", "json", "-show_format", str(path)],
        timeout=60,
    )
    if result.returncode != 0:
        raise MediaError(f"ffprobe failed: {result.stderr.strip()[-300:]}")
    try:
        return float(json.loads(result.stdout)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        raise MediaError("could not read media duration (not a valid audio/video file?)") from exc


def has_audio_stream(path: Path) -> bool:
    result = _run(
        [_require("ffprobe"), "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
        timeout=60,
    )
    if result.returncode != 0:
        raise MediaError(f"ffprobe failed: {result.stderr.strip()[-300:]}")
    return result.stdout.strip() != ""


def extract_audio(source: Path, destination: Path) -> Path:
    """Convert any local media file to small mono opus (ogg). Rejects network protocols."""
    if not has_audio_stream(source):
        raise NoSpeechError("This video has no audio track.", code="no_audio_track")
    result = _run(
        [
            _require("ffmpeg"), "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
            "-protocol_whitelist", "file",
            "-i", str(source), *AUDIO_ARGS, str(destination),
        ]  # fmt: skip
    )
    if result.returncode != 0 or not destination.exists():
        raise MediaError(f"audio extraction failed: {result.stderr.strip()[-300:]}")
    return destination


def plan_chunks(duration: float, chunk_seconds: float = CHUNK_SECONDS) -> list[tuple[float, float]]:
    """(start, length) windows covering [0, duration]. A single window if it fits in one chunk."""
    if duration <= chunk_seconds * 1.25:  # avoid a tiny trailing chunk
        return [(0.0, duration)]
    windows: list[tuple[float, float]] = []
    start = 0.0
    while start < duration:
        length = min(chunk_seconds, duration - start)
        if duration - (start + length) < chunk_seconds * 0.25:
            length = duration - start
        windows.append((start, length))
        start += length
    return windows


_SILENCE_EVENT = re.compile(r"silence_(start|end): (-?\d+(?:\.\d+)?)")
SNAP_WINDOW_SECONDS = 30.0


def parse_silences(stderr: str) -> list[tuple[float, float]]:
    """(start, end) pairs from ffmpeg `silencedetect` output. A trailing open silence is dropped."""
    silences: list[tuple[float, float]] = []
    open_start: float | None = None
    for kind, value in _SILENCE_EVENT.findall(stderr):
        if kind == "start":
            open_start = max(float(value), 0.0)
        elif open_start is not None:
            silences.append((open_start, float(value)))
            open_start = None
    return silences


def detect_silences(path: Path) -> list[tuple[float, float]]:
    result = _run(
        [
            _require("ffmpeg"), "-nostdin", "-hide_banner", "-nostats",
            "-i", str(path), "-af", "silencedetect=noise=-35dB:d=0.4", "-f", "null", "-",
        ],  # fmt: skip
    )
    if result.returncode != 0:
        return []  # chunking still works, just at fixed boundaries
    return parse_silences(result.stderr)


def snap_to_silence(
    windows: list[tuple[float, float]],
    silences: list[tuple[float, float]],
    max_shift: float = SNAP_WINDOW_SECONDS,
) -> list[tuple[float, float]]:
    """Move each interior cut to the middle of the nearest silence within `max_shift` seconds,
    so a word is not split across two ASR requests. Windows stay contiguous and cover the same span."""
    if len(windows) < 2 or not silences:
        return windows
    total_end = windows[-1][0] + windows[-1][1]
    cuts = [start for start, _ in windows[1:]]
    snapped: list[float] = []
    previous = 0.0
    for cut in cuts:
        best = cut
        best_distance = max_shift
        for begin, end in silences:
            middle = (begin + end) / 2
            distance = abs(middle - cut)
            if distance <= best_distance and previous + 1.0 < middle < total_end - 1.0:
                best, best_distance = middle, distance
        snapped.append(best)
        previous = best
    edges = [0.0, *snapped, total_end]
    return [(edges[i], edges[i + 1] - edges[i]) for i in range(len(edges) - 1)]


def split_audio(source: Path, workdir: Path, duration: float, chunk_seconds: float = CHUNK_SECONDS) -> list[Chunk]:
    windows = plan_chunks(duration, chunk_seconds)
    if len(windows) == 1:
        return [Chunk(source, 0.0)]
    windows = snap_to_silence(windows, detect_silences(source))
    chunks: list[Chunk] = []
    for index, (start, length) in enumerate(windows):
        target = workdir / f"chunk_{index:03d}.ogg"
        result = _run(
            [
                _require("ffmpeg"), "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
                "-ss", f"{start:.3f}", "-t", f"{length:.3f}",
                "-i", str(source), "-c", "copy", str(target),
            ]  # fmt: skip
        )
        if result.returncode != 0 or not target.exists():
            raise MediaError(f"audio split failed: {result.stderr.strip()[-300:]}")
        chunks.append(Chunk(target, start))
    return chunks
