import json
from pathlib import Path

import httpx
import pytest

from mutescroll_media.asr import AsrError, GroqProvider
from mutescroll_media.audio import plan_chunks

VERBOSE = {
    "language": "English",
    "duration": 12.5,
    "segments": [
        {"start": 0.0, "end": 4.0, "text": " Hello there.", "avg_logprob": -0.1, "no_speech_prob": 0.01},
        {"start": 4.0, "end": 8.0, "text": " Thank you for watching", "avg_logprob": -1.2, "no_speech_prob": 0.9},
        {"start": 8.0, "end": 12.5, "text": " It costs $10.", "avg_logprob": -0.9, "no_speech_prob": 0.02},
    ],
    "words": [
        {"word": "Hello", "start": 0.0, "end": 0.5},
        {"word": "there.", "start": 0.5, "end": 1.0},
        {"word": "It", "start": 8.0, "end": 8.2},
        {"word": "costs", "start": 8.2, "end": 8.6},
        {"word": "$10.", "start": 8.6, "end": 9.2},
    ],
}


def provider(handler, **kw) -> GroqProvider:
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return GroqProvider("test-key", client=client, sleep=lambda _s: None, **kw)


@pytest.fixture
def audio(tmp_path: Path) -> Path:
    path = tmp_path / "a.ogg"
    path.write_bytes(b"fake-audio")
    return path


def test_parses_segments_words_language_and_drops_hallucinated_silence(audio: Path) -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["authorization"]
        seen["body"] = request.content
        return httpx.Response(200, json=VERBOSE)

    out = provider(handler).transcribe(audio, None)
    assert seen["auth"] == "Bearer test-key"
    assert b'name="model"' in seen["body"] and b"whisper-large-v3-turbo" in seen["body"]
    assert b'name="language"' not in seen["body"]  # auto-detect
    assert out.language == "en"
    assert out.duration_seconds == 12.5
    assert [s.text for s in out.segments] == ["Hello there.", "It costs $10."]
    assert out.segments[0].confidence == pytest.approx(0.905, abs=0.01)
    assert [w.text for w in out.segments[1].words] == ["It", "costs", "$10."]


def test_sends_language_when_given(audio: Path) -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.content
        return httpx.Response(200, json=VERBOSE)

    provider(handler).transcribe(audio, "el")
    assert b'name="language"' in seen["body"]


def test_retries_rate_limits_then_succeeds(audio: Path) -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(429, headers={"retry-after": "1"}, json={"error": {"message": "slow down"}})
        return httpx.Response(200, json=VERBOSE)

    assert provider(handler).transcribe(audio, None).language == "en"
    assert calls["n"] == 3


def test_does_not_retry_auth_errors(audio: Path) -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(401, json={"error": {"message": "invalid api key"}})

    with pytest.raises(AsrError) as err:
        provider(handler).transcribe(audio, None)
    assert calls["n"] == 1
    assert err.value.retryable is False
    assert "test-key" not in str(err.value)


def test_gives_up_after_max_attempts_as_retryable(audio: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="unavailable")

    with pytest.raises(AsrError) as err:
        provider(handler, max_attempts=2).transcribe(audio, None)
    assert err.value.retryable is True


def test_rejects_oversized_files_without_calling_the_api(tmp_path: Path) -> None:
    big = tmp_path / "big.ogg"
    with big.open("wb") as fh:
        fh.truncate(25 * 1024 * 1024)

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("must not call the API")

    with pytest.raises(AsrError):
        provider(handler).transcribe(big, None)


def test_requires_api_key() -> None:
    with pytest.raises(ValueError):
        GroqProvider("")


@pytest.mark.parametrize(
    ("duration", "expected"),
    [
        (60, [(0.0, 60)]),
        (1500, [(0.0, 1500)]),  # within 1.25x of one chunk
        (2400, [(0.0, 1200), (1200.0, 1200)]),
        (2500, [(0.0, 1200), (1200.0, 1300)]),  # 100 s remainder folded in, no tiny chunk
        (3000, [(0.0, 1200), (1200.0, 1200), (2400.0, 600)]),
        (7200, [(i * 1200.0, 1200) for i in range(6)]),
    ],
)
def test_plan_chunks(duration: float, expected: list[tuple[float, float]]) -> None:
    windows = plan_chunks(duration)
    assert windows == expected
    assert sum(length for _s, length in windows) == pytest.approx(duration)
    assert json.dumps(windows)  # serializable
