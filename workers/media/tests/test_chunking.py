import shutil
import subprocess
from pathlib import Path

import pytest

from mutescroll_media.audio import detect_silences, parse_silences, plan_chunks, snap_to_silence

STDERR = """
[silencedetect @ 0x1] silence_start: 1198.5
[silencedetect @ 0x1] silence_end: 1200.7 | silence_duration: 2.2
[silencedetect @ 0x1] silence_start: 2390.25
"""


def test_parse_silences_pairs_and_drops_open_tail() -> None:
    assert parse_silences(STDERR) == [(1198.5, 1200.7)]


def test_snap_moves_cut_to_nearby_silence_and_stays_contiguous() -> None:
    windows = plan_chunks(3000.0)  # cuts near 1200 and 2400
    snapped = snap_to_silence(windows, [(1198.0, 1202.0)])
    assert snapped[0] == (0.0, 1200.0)
    assert sum(length for _, length in snapped) == pytest.approx(3000.0)
    for (start, length), (next_start, _) in zip(snapped, snapped[1:], strict=False):
        assert start + length == pytest.approx(next_start)


def test_snap_ignores_far_silence_and_empty_input() -> None:
    windows = plan_chunks(3000.0)
    assert snap_to_silence(windows, [(1500.0, 1502.0)]) == windows
    assert snap_to_silence(windows, []) == windows
    assert snap_to_silence([(0.0, 600.0)], [(10.0, 12.0)]) == [(0.0, 600.0)]


def test_snap_never_creates_zero_or_negative_windows() -> None:
    windows = [(0.0, 100.0), (100.0, 100.0)]
    snapped = snap_to_silence(windows, [(0.0, 1.0), (199.0, 200.0)], max_shift=500.0)
    assert all(length > 0 for _, length in snapped)


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_detect_silences_on_real_audio(tmp_path: Path) -> None:
    out = tmp_path / "tone.wav"
    subprocess.run(
        [
            "ffmpeg", "-nostdin", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
            "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono:d=2",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
            "-filter_complex", "[0][1][2]concat=n=3:v=0:a=1",
            str(out),
        ],  # fmt: skip
        check=True,
    )
    silences = detect_silences(out)
    assert len(silences) == 1
    begin, end = silences[0]
    assert 1.8 <= begin <= 2.2 and 3.8 <= end <= 4.2
