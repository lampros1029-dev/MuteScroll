"""CLI failure contract: in --json mode the worker prints a machine-readable error object (M2 bridge)."""

from __future__ import annotations

import json
from collections.abc import Callable

import pytest

from mutescroll_media import cli
from mutescroll_media.asr import AsrError
from mutescroll_media.audio import MediaError, NoSpeechError
from mutescroll_media.sources import RetrievalError

URL = "https://example.com/video/sample"


def _raise(exc: BaseException) -> Callable[..., object]:
    def fake(*_args: object, **_kwargs: object) -> object:
        raise exc

    return fake


@pytest.mark.parametrize(
    ("exc", "code", "exit_code"),
    [
        (RetrievalError("blocked_bot_check", "blocked"), "blocked_bot_check", 2),
        (RetrievalError("too_long", "long"), "too_long", 2),
        (NoSpeechError("silent", code="no_audio_track"), "no_audio_track", 5),
        (NoSpeechError("silent"), "no_speech", 5),
        (MediaError("ffmpeg broke"), "media_error", 6),
        (AsrError("provider down"), "asr_error", 3),
        (PermissionError("host not allowed"), "blocked", 4),
    ],
)
def test_json_mode_prints_error_object(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], exc: BaseException, code: str, exit_code: int
) -> None:
    monkeypatch.setattr(cli, "transcribe_url", _raise(exc))
    assert cli.main([URL, "--json", "--no-cache"]) == exit_code
    payload = json.loads(capsys.readouterr().out)
    assert payload == {"status": "error", "error": {"code": code, "exit_code": exit_code}}


def test_error_object_never_contains_upstream_detail(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    secret_ish = "cookie=abc123 /home/worker/.config"
    monkeypatch.setattr(cli, "transcribe_url", _raise(RetrievalError("retrieval_failed", "failed", secret_ish)))
    assert cli.main([URL, "--json", "--no-cache"]) == 2
    assert "abc123" not in capsys.readouterr().out


def test_human_mode_keeps_plain_stderr_and_no_stdout_json(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "transcribe_url", _raise(RetrievalError("unavailable", "gone")))
    assert cli.main([URL, "--no-cache"]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "retrieval failed [unavailable]" in captured.err
