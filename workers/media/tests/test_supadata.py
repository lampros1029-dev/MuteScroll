import httpx

from mutescroll_media.models import VideoMetadata
from mutescroll_media.sources import SourceInfo
from mutescroll_media.vendors import ScrapeCreatorsClient, VendorSource
from mutescroll_media.vendors.supadata import SupadataClient, parse_transcript

URL = "https://www.tiktok.com/@scout2015/video/6718335390845095173"
PAYLOAD = {
    "lang": "en",
    "availableLangs": ["en"],
    "content": [
        {"text": "Are you the same guy?", "duration": 2640, "offset": 180},
        {"text": "  ", "duration": 100, "offset": 3000},
        {"text": "Yes, 25 percent.", "duration": 1500, "offset": 3000},
    ],
}


def supadata(handler) -> SupadataClient:
    return SupadataClient("k", http=httpx.Client(transport=httpx.MockTransport(handler)))


def test_parse_converts_ms_and_skips_blank_items() -> None:
    result = parse_transcript(PAYLOAD)
    assert result is not None
    assert result.language == "en"
    assert result.automatic is True
    assert [(s.start, s.end, s.text) for s in result.segments] == [
        (0.18, 0.18 + 2.64, "Are you the same guy?"),
        (3.0, 4.5, "Yes, 25 percent."),
    ]


def test_parse_rejects_garbage() -> None:
    assert parse_transcript([]) is None
    assert parse_transcript({"content": "x"}) is None
    assert parse_transcript({"content": []}) is None


def test_client_returns_none_on_http_error_and_counts_credits_on_success() -> None:
    assert supadata(lambda r: httpx.Response(404, json={})).transcript(URL, None) is None
    ok = supadata(lambda r: httpx.Response(200, json=PAYLOAD, headers={"x-billable-requests": "1"}))
    assert ok.transcript(URL, "en") is not None
    assert ok.credits_used == 1


def _info() -> SourceInfo:
    return SourceInfo(metadata=VideoMetadata(platform="tiktok"), source_url=URL)


def _vendor(failover: SupadataClient | None) -> VendorSource:
    client = ScrapeCreatorsClient("k", http=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500))))
    return VendorSource(client, failover=failover)


def test_vendor_source_uses_failover_only_for_automatic_captions() -> None:
    source = _vendor(supadata(lambda r: httpx.Response(200, json=PAYLOAD)))
    assert source.fetch_captions(_info(), None, automatic=False) is None
    assert source.fetch_captions(_info(), None, automatic=True) is not None


def test_vendor_source_without_failover_returns_none() -> None:
    assert _vendor(None).fetch_captions(_info(), None, automatic=True) is None
