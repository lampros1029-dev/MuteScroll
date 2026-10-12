import shutil
import subprocess
from pathlib import Path

import pytest

from mutescroll_media import pipeline
from mutescroll_media.asr import AsrError
from mutescroll_media.audio import probe_duration, extract_audio
from mutescroll_media.models import AsrOutput, Segment, VideoMetadata, Word
from mutescroll_media.sources import CaptionResult, RetrievalError, SourceInfo

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    # URL safety is covered in test_ssrf; here DNS must not be touched.
    monkeypatch.setattr(pipeline, "assert_url_safe", lambda url, *a, **k: None)


def make_tone(path: Path, seconds: float = 3.0) -> Path:
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", str(path)],
        check=True,
    )
    return path


class FakeAsr:
    name = "fake"

    def __init__(self) -> None:
        self.languages: list[str | None] = []

    def transcribe(self, audio_path: Path, language: str | None) -> AsrOutput:
        self.languages.append(language)
        return AsrOutput(
            language="en",
            duration_seconds=3.0,
            segments=(
                Segment(
                    0.0, 3.0, "link in my bio is $10", confidence=0.3,
                    words=(Word(0.0, 0.5, "link", 0.9),),
                ),
            ),
        )


class FakeSource:
    def __init__(self, *, manual=None, auto=None, audio: Path | None = None, duration: float | None = 60.0) -> None:
        self.manual, self.auto, self.audio = manual, auto, audio
        self.duration = duration
        self.downloaded = False

    def fetch_info(self, url: str) -> SourceInfo:
        return SourceInfo(metadata=VideoMetadata(platform="youtube", title="T", duration_seconds=self.duration))

    def fetch_captions(self, info, language, *, automatic: bool):
        return self.auto if automatic else self.manual

    def download_audio(self, url: str, workdir: Path) -> Path:
        self.downloaded = True
        if self.audio is None:
            raise RetrievalError("blocked_bot_check", "blocked")
        return self.audio


URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def captions(text: str = "hello there") -> CaptionResult:
    return CaptionResult(segments=[Segment(0.0, 2.0, text)], language="en", automatic=False)


def test_manual_captions_skip_download_and_asr() -> None:
    source = FakeSource(manual=captions("so we have 3 things"))
    result = pipeline.transcribe_url(URL, source=source, asr=None)
    assert result.method == "captions"
    assert not source.downloaded
    assert result.transcript_text == "[00:00] So we have 3 things"


def test_asr_path_produces_flags_and_timestamps(tmp_path: Path) -> None:
    tone = make_tone(tmp_path / "in.wav")
    asr = FakeAsr()
    result = pipeline.transcribe_url(URL, source=FakeSource(audio=tone), asr=asr)
    assert result.method == "asr"
    assert result.language == "en"
    assert result.transcript_text == "[00:00] Link in my bio is $10"
    assert [r.phrase.lower() for r in result.on_screen_references] == ["link in my bio"]
    assert result.uncertain_spans == []  # word-level evidence exists and is above threshold
    assert asr.languages == [None]  # auto-detect on first chunk


def test_low_confidence_segment_without_words_is_flagged(tmp_path: Path) -> None:
    class LowConf(FakeAsr):
        def transcribe(self, audio_path, language):
            return AsrOutput("en", 3.0, (Segment(0.0, 3.0, "Lumix S5", confidence=0.2),))

    result = pipeline.transcribe_url(URL, source=FakeSource(audio=make_tone(tmp_path / "t.wav")), asr=LowConf())
    assert [s.text for s in result.uncertain_spans] == ["Lumix S5"]


def test_falls_back_to_auto_captions_when_audio_blocked() -> None:
    source = FakeSource(auto=captions("auto text"))
    result = pipeline.transcribe_url(URL, source=source, asr=None)
    assert result.method == "captions_auto"


def test_no_auto_caption_fallback_when_disabled_reraises_retrieval_error() -> None:
    source = FakeSource(auto=captions())
    with pytest.raises(RetrievalError) as err:
        pipeline.transcribe_url(URL, source=source, asr=None, allow_auto_captions=False)
    assert err.value.code == "blocked_bot_check"


def test_blocked_with_no_captions_reraises() -> None:
    with pytest.raises(RetrievalError):
        pipeline.transcribe_url(URL, source=FakeSource(), asr=None)


def test_rejects_videos_over_the_duration_limit() -> None:
    with pytest.raises(RetrievalError) as err:
        pipeline.transcribe_url(URL, source=FakeSource(duration=9000), asr=None, max_seconds=7200)
    assert err.value.code == "too_long"


def test_too_long_from_asr_stage_is_not_masked_by_caption_fallback(tmp_path: Path) -> None:
    tone = make_tone(tmp_path / "in.wav", 3.0)
    source = FakeSource(audio=tone, auto=captions(), duration=None)
    with pytest.raises(RetrievalError) as err:
        pipeline.transcribe_url(URL, source=source, asr=FakeAsr(), max_seconds=1)
    assert err.value.code == "too_long"


def test_missing_asr_provider_is_a_clear_error(tmp_path: Path) -> None:
    tone = make_tone(tmp_path / "in.wav")
    with pytest.raises(AsrError, match="GROQ_API_KEY"):
        pipeline.transcribe_url(URL, source=FakeSource(audio=tone), asr=None)


def test_transcribe_file_uses_same_asr_path_and_cleans_up(tmp_path: Path) -> None:
    tone = make_tone(tmp_path / "upload.wav")
    result = pipeline.transcribe_file(tone, asr=FakeAsr())
    assert result.metadata.platform == "upload"
    assert result.method == "asr"
    assert result.metadata.duration_seconds == pytest.approx(3.0, abs=0.2)


def test_video_without_audio_track_is_reported_as_no_speech(tmp_path: Path) -> None:
    from mutescroll_media.audio import NoSpeechError

    silent = tmp_path / "silent.mp4"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1", str(silent)],
        check=True,
    )
    with pytest.raises(NoSpeechError) as err:
        pipeline.transcribe_file(silent, asr=FakeAsr())
    assert err.value.code == "no_audio_track"


def test_asr_returning_nothing_is_reported_as_no_speech(tmp_path: Path) -> None:
    from mutescroll_media.audio import NoSpeechError

    class Empty(FakeAsr):
        def transcribe(self, audio_path, language):
            return AsrOutput("en", 3.0, ())

    with pytest.raises(NoSpeechError) as err:
        pipeline.transcribe_file(make_tone(tmp_path / "t.wav"), asr=Empty())
    assert err.value.code == "no_speech"


def test_transcribe_file_missing() -> None:
    with pytest.raises(RetrievalError) as err:
        pipeline.transcribe_file(Path("nope.mp4"), asr=None)
    assert err.value.code == "file_not_found"


def test_extract_audio_rejects_network_inputs(tmp_path: Path) -> None:
    from mutescroll_media.audio import MediaError

    with pytest.raises(MediaError):
        extract_audio(Path("http://127.0.0.1/secret.mp4"), tmp_path / "o.ogg")


def test_probe_duration_on_real_audio(tmp_path: Path) -> None:
    assert probe_duration(make_tone(tmp_path / "a.wav", 2.0)) == pytest.approx(2.0, abs=0.1)
