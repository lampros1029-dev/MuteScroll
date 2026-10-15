"""Caption URL fetches must use the same SSRF guard as other worker HTTP calls."""

import httpx
import pytest

from mutescroll_media.models import VideoMetadata
from mutescroll_media.sources import RetrievalError, SourceInfo, YtDlpSource, _NoImpersonation

_JSON3 = {
    "events": [{"tStartMs": 0, "dDurationMs": 1200, "segs": [{"utf8": "hello"}]}],
}


def _info(url: str) -> SourceInfo:
    return SourceInfo(
        metadata=VideoMetadata(platform="public"),
        manual_captions={"en": [{"ext": "json3", "url": url}]},
    )


def _source(handler, resolver) -> YtDlpSource:
    return YtDlpSource(http=httpx.Client(transport=httpx.MockTransport(handler)), resolver=resolver)


def _public(_host: str) -> list[str]:
    return ["8.8.8.8"]


def test_unsafe_caption_url_is_not_fetched() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"fetched {request.url}")

    source = _source(handler, _public)
    blocked = (
        "http://169.254.169.254/latest/meta-data",
        "https://user:pw@example.com/caption.json",
        "https://example.com:8443/caption.json",
        "file:///tmp/caption.json",
        "http://localhost/caption.json",
    )
    for url in blocked:
        assert source.fetch_captions(_info(url), None, automatic=False) is None


def test_caption_url_resolving_to_private_address_is_not_fetched() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"fetched {request.url}")

    source = _source(handler, lambda _host: ["10.0.0.7"])
    assert source.fetch_captions(_info("https://example.com/caption.json?lang=en"), None, automatic=False) is None


def test_signature_host_without_js_runtime_fails_before_fetch(monkeypatch: pytest.MonkeyPatch) -> None:
    """The signature-challenge extractor is the one host check that stays in the worker."""
    monkeypatch.setattr("mutescroll_media.sources.shutil.which", lambda _name: None)
    source = YtDlpSource(resolver=_public)

    with pytest.raises(RetrievalError) as caught:
        source.fetch_info("https://www.youtube.com/watch?v=abcdefghijk")

    assert caught.value.code == "worker_misconfigured"
    assert "youtube" not in str(caught.value).lower()


def test_allowed_caption_url_is_fetched() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json=_JSON3)

    source = _source(handler, _public)
    result = source.fetch_captions(_info("https://example.com/caption.json?lang=en"), None, automatic=False)
    assert result is not None
    assert result.segments[0].text == "hello"
    assert seen == ["https://example.com/caption.json?lang=en"]


def test_caption_redirect_is_not_followed() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host != "example.com":
            raise AssertionError(f"followed redirect to {request.url}")
        return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data"})

    source = _source(handler, _public)
    assert source.fetch_captions(_info("https://example.com/caption.json?lang=en"), None, automatic=False) is None


def test_public_fetch_does_not_impersonate_a_browser_or_send_cookies() -> None:
    options = YtDlpSource(proxy="")._base_options()
    assert options["cookiefile"] is None
    assert options["cookiesfrombrowser"] is None
    assert options["username"] is None
    assert options["password"] is None
    ydl = _NoImpersonation({"quiet": True, "skip_download": True, "logger": None})
    assert ydl._parse_impersonate_targets(True) == (None, [])
