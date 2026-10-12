from mutescroll_media.captions import parse_json3, pick_track

DOC = {
    "events": [
        {"tStartMs": 0, "dDurationMs": 3000, "segs": [{"utf8": "Hello "}, {"utf8": "world"}]},
        {"tStartMs": 3000, "dDurationMs": 2000, "segs": [{"utf8": "\n"}]},  # newline-only
        {"tStartMs": 3000, "dDurationMs": 4000, "segs": [{"utf8": "it&#39;s   $10"}]},
        {"tStartMs": 3500, "dDurationMs": 1000, "segs": [{"utf8": "it&#39;s   $10"}]},  # duplicate
        {"wpWinPosId": 1},  # window definition, no text
        {"tStartMs": 7000, "dDurationMs": 500, "segs": [{"utf8": "bye"}]},
    ]
}


def test_parse_json3_merges_cleans_and_orders() -> None:
    segments = parse_json3(DOC)
    assert [s.text for s in segments] == ["Hello world", "it's $10", "bye"]
    assert [s.start for s in segments] == [0.0, 3.0, 7.0]
    assert segments[1].end == 7.0  # 3.0 + 4.0 duration, next starts at 7.0
    assert all(s.confidence is None for s in segments)


def test_parse_json3_empty() -> None:
    assert parse_json3({}) == []


def fmt(ext: str = "json3") -> list[dict]:
    return [{"ext": "vtt", "url": "u-vtt"}, {"ext": ext, "url": f"u-{ext}"}]


def test_pick_track_prefers_requested_then_video_language() -> None:
    tracks = {"en": fmt(), "el": fmt(), "de": fmt()}
    assert pick_track(tracks, "el", "en")[0] == "el"  # type: ignore[index]
    assert pick_track(tracks, "auto", "de")[0] == "de"  # type: ignore[index]
    assert pick_track(tracks, None, None)[0] == "en"  # type: ignore[index]


def test_pick_track_matches_regional_variants_and_needs_json3() -> None:
    assert pick_track({"en-GB": fmt()}, "en", None)[0] == "en-GB"  # type: ignore[index]
    assert pick_track({"en": [{"ext": "vtt", "url": "x"}]}, "en", None) is None
    assert pick_track({}, "en", None) is None
