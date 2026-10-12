from pathlib import Path

import httpx
import pytest

from mutescroll_media.sources import RetrievalError, SourceInfo
from mutescroll_media.ssrf import media_host_allowed
from mutescroll_media.models import VideoMetadata
from mutescroll_media.vendors import (
    RoutedSource,
    ScrapeCreatorsClient,
    VendorSource,
    build_source,
)
from mutescroll_media.vendors import source as source_module

TIKTOK_URL = "https://www.tiktok.com/@scout2015/video/6718335390845095173"
IG_URL = "https://www.instagram.com/reel/DF5s0duxDts/"
CDN_URL = "https://v45.tiktokcdn-eu.com/abc/video.mp4"
PUBLIC = lambda host: ["93.184.216.34"]  # noqa: E731


def tiktok_body(**overrides):
    video = {
        "duration": 89793,
        "play_addr": {"url_list": [CDN_URL]},
        "download_no_watermark_addr": {"url_list": ["https://v15m.tiktokcdn-eu.com/big.mp4"]},
    }
    detail = {"desc": "Pizza", "author": {"nickname": "Dave", "unique_id": "dave"}, "video": video}
    detail.update(overrides)
    return {"success": True, "credits_charged": 1, "aweme_detail": detail}


def ig_body(**media_overrides):
    media = {
        "is_video": True,
        "video_url": "https://scontent-sea1-1.cdninstagram.com/o1/v/t16/clip.mp4",
        "video_duration": 71.1,
        "owner": {"username": "adrian"},
        "edge_media_to_caption": {"edges": [{"node": {"text": "I built it"}}]},
    }
    media.update(media_overrides)
    return {"success": True, "credits_charged": 1, "data": {"xdt_shortcode_media": media}}


def client_with(handler) -> ScrapeCreatorsClient:
    return ScrapeCreatorsClient(
        "test-key", http=httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda _s: None
    )


def test_tiktok_parse_prefers_small_rendition_and_converts_ms() -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers["x-api-key"]
        seen["url"] = request.url.params["url"]
        return httpx.Response(200, json=tiktok_body())

    media = client_with(handler).resolve("tiktok", TIKTOK_URL)
    assert media.media_url == CDN_URL
    assert media.duration_seconds == pytest.approx(89.793)
    assert (media.title, media.author, media.credits_charged) == ("Pizza", "Dave", 1)
    assert seen == {"key": "test-key", "url": TIKTOK_URL}


def test_instagram_parse() -> None:
    media = client_with(lambda r: httpx.Response(200, json=ig_body())).resolve("instagram", IG_URL)
    assert media.media_url.endswith("clip.mp4")
    assert media.duration_seconds == pytest.approx(71.1)
    assert (media.title, media.author) == ("I built it", "adrian")


@pytest.mark.parametrize(
    "response, code",
    [
        (httpx.Response(401), "worker_misconfigured"),
        (httpx.Response(402), "vendor_unavailable"),
        (httpx.Response(404), "unavailable"),
        (httpx.Response(400, text="bad"), "retrieval_failed"),
        (httpx.Response(200, json={"success": False}), "unavailable"),
        (httpx.Response(200, text="<html>"), "retrieval_failed"),
        (httpx.Response(200, json={"success": True, "aweme_detail": None}), "unavailable"),
        (httpx.Response(200, json=ig_body(is_video=False)), "unavailable"),
        (httpx.Response(200, json=tiktok_body(video={"duration": 5})), "unavailable"),
    ],
)
def test_error_mapping(response: httpx.Response, code: str) -> None:
    platform, url = ("instagram", IG_URL) if "xdt_shortcode_media" in response.text else ("tiktok", TIKTOK_URL)
    with pytest.raises(RetrievalError) as caught:
        client_with(lambda r: response).resolve(platform, url)
    assert caught.value.code == code


def test_retries_transient_errors_then_succeeds() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(503) if len(calls) < 3 else httpx.Response(200, json=tiktok_body())

    assert client_with(handler).resolve("tiktok", TIKTOK_URL).media_url == CDN_URL
    assert len(calls) == 3


def test_gives_up_after_max_attempts() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(429)

    with pytest.raises(RetrievalError) as caught:
        client_with(handler).resolve("tiktok", TIKTOK_URL)
    assert caught.value.code == "retrieval_failed"
    assert len(calls) == 3


def test_missing_api_key_is_rejected() -> None:
    with pytest.raises(ValueError):
        ScrapeCreatorsClient("")


def test_cdn_allowlist_rejects_lookalikes() -> None:
    assert media_host_allowed("v45.tiktokcdn-eu.com")
    assert media_host_allowed("scontent-sea1-1.cdninstagram.com")
    assert not media_host_allowed("tiktokcdn.com.evil.test")
    assert not media_host_allowed("evil-cdninstagram.com")
    assert not media_host_allowed("localhost")


def vendor(media_handler, *, resolve_handler=None, resolver=PUBLIC) -> VendorSource:
    resolve = resolve_handler or (lambda r: httpx.Response(200, json=tiktok_body()))
    return VendorSource(
        client_with(resolve),
        http=httpx.Client(transport=httpx.MockTransport(media_handler), follow_redirects=False),
        resolver=resolver,
    )


def test_download_writes_file_and_spends_one_credit(tmp_path: Path) -> None:
    source = vendor(lambda r: httpx.Response(200, content=b"media-bytes"))
    info = source.fetch_info(TIKTOK_URL)
    path = source.download_audio(TIKTOK_URL, tmp_path)
    assert path.read_bytes() == b"media-bytes"
    assert info.metadata.duration_seconds == pytest.approx(89.793)
    assert source.credits_used == 1  # download reuses the resolved URL; no second vendor call
    assert source.fetch_captions(info, None, automatic=False) is None


def test_download_without_prior_info_still_resolves_once(tmp_path: Path) -> None:
    source = vendor(lambda r: httpx.Response(200, content=b"x"))
    source.download_audio(TIKTOK_URL, tmp_path)
    assert source.credits_used == 1


def test_unsafe_media_host_is_refused_before_any_request(tmp_path: Path) -> None:
    hits = []
    evil = tiktok_body(video={"duration": 1000, "play_addr": {"url_list": ["https://evil.test/a.mp4"]}})
    source = vendor(
        lambda r: hits.append(r) or httpx.Response(200, content=b"x"),
        resolve_handler=lambda r: httpx.Response(200, json=evil),
    )
    with pytest.raises(RetrievalError) as caught:
        source.download_audio(TIKTOK_URL, tmp_path)
    assert caught.value.code == "retrieval_failed" and hits == []


def test_cdn_host_resolving_to_private_ip_is_refused(tmp_path: Path) -> None:
    source = vendor(lambda r: httpx.Response(200, content=b"x"), resolver=lambda host: ["10.0.0.5"])
    with pytest.raises(RetrievalError):
        source.download_audio(TIKTOK_URL, tmp_path)


def test_redirect_hops_are_revalidated(tmp_path: Path) -> None:
    def media(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data"})

    with pytest.raises(RetrievalError):
        vendor(media).download_audio(TIKTOK_URL, tmp_path)


def test_allowed_redirect_is_followed(tmp_path: Path) -> None:
    def media(request: httpx.Request) -> httpx.Response:
        if request.url.host == "v45.tiktokcdn-eu.com":
            return httpx.Response(302, headers={"location": "https://v15m.tiktokcdn-eu.com/final.mp4"})
        return httpx.Response(200, content=b"final")

    assert vendor(media).download_audio(TIKTOK_URL, tmp_path).read_bytes() == b"final"


def test_expired_link_maps_to_retrieval_failed(tmp_path: Path) -> None:
    with pytest.raises(RetrievalError) as caught:
        vendor(lambda r: httpx.Response(403)).download_audio(TIKTOK_URL, tmp_path)
    assert caught.value.code == "retrieval_failed"


def test_oversized_media_is_aborted_and_deleted(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(source_module, "MAX_MEDIA_BYTES", 10)
    with pytest.raises(RetrievalError) as caught:
        vendor(lambda r: httpx.Response(200, content=b"x" * 100)).download_audio(TIKTOK_URL, tmp_path)
    assert caught.value.code == "too_long"
    assert not (tmp_path / "source.mp4").exists()


def test_vendor_rejects_other_platforms() -> None:
    with pytest.raises(RetrievalError) as caught:
        vendor(lambda r: httpx.Response(200)).fetch_info("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert caught.value.code == "unsupported_platform"


class Tagged:
    def __init__(self, name: str) -> None:
        self.name = name

    def fetch_info(self, url: str) -> SourceInfo:
        platform = "tiktok" if "tiktok" in url else "youtube"
        return SourceInfo(metadata=VideoMetadata(platform, self.name))

    def fetch_captions(self, info, language, *, automatic: bool):
        return None

    def download_audio(self, url, workdir):
        return Path(self.name)


def test_router_sends_only_vendor_platforms_to_the_vendor(tmp_path: Path) -> None:
    router = RoutedSource(Tagged("default"), Tagged("vendor"))
    assert router.fetch_info(TIKTOK_URL).metadata.title == "vendor"
    assert router.fetch_info(IG_URL).metadata.title == "vendor"
    assert router.fetch_info("https://www.youtube.com/watch?v=dQw4w9WgXcQ").metadata.title == "default"
    assert router.download_audio(TIKTOK_URL, tmp_path) == Path("vendor")
    assert router.download_audio("https://www.facebook.com/reel/1", tmp_path) == Path("default")


def test_build_source_without_key_is_the_default_unchanged() -> None:
    default = Tagged("default")
    assert build_source(default, scrapecreators_key=None) is default
    assert build_source(default, scrapecreators_key="") is default
    assert isinstance(build_source(default, scrapecreators_key="k"), RoutedSource)
