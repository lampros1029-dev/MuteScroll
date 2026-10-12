import pytest

from mutescroll_media.models import Segment, Word
from mutescroll_media.postprocess import (
    clean_text,
    find_on_screen_references,
    find_uncertain_spans,
    format_timestamp,
    numbers_preserved,
    render_transcript,
)


def seg(text: str, start: float = 0.0, end: float = 4.0, **kw) -> Segment:
    return Segment(start=start, end=end, text=text, **kw)


def test_word_level_spans_merge_close_low_words() -> None:
    words = (
        Word(0.0, 0.4, "the", 0.99),
        Word(0.4, 0.9, "Lumix", 0.2),
        Word(0.95, 1.3, "S5", 0.3),  # 50 ms gap: merged
        Word(1.3, 1.6, "is", 0.98),
        Word(3.0, 3.4, "Sigma", 0.1),  # separate run
    )
    spans = find_uncertain_spans([seg("the Lumix S5 is Sigma", words=words)])
    assert [(s.text, s.start, s.end) for s in spans] == [("Lumix S5", 0.4, 1.3), ("Sigma", 3.0, 3.4)]
    assert all(s.reason == "low_confidence" for s in spans)


def test_word_gap_larger_than_threshold_splits_runs() -> None:
    words = (Word(0.0, 0.3, "a", 0.1), Word(1.0, 1.3, "b", 0.1))
    spans = find_uncertain_spans([seg("a b", words=words)])
    assert len(spans) == 2


def test_segment_level_fallback_when_no_word_scores() -> None:
    spans = find_uncertain_spans(
        [seg("fine", confidence=0.9), seg("garbled stuff", 5, 9, confidence=0.3), seg("captions only")]
    )
    assert len(spans) == 1
    assert spans[0].reason == "low_confidence_segment"
    assert spans[0].text == "garbled stuff"


def test_human_captions_without_signal_are_never_flagged() -> None:
    assert find_uncertain_spans([seg("anything")]) == []


@pytest.mark.parametrize(
    "text",
    [
        "Check the link in my bio for the full guide.",
        "As you can see here, the button is blue.",
        "Just run this command and you're done.",
        "Use code SAVE20 at checkout.",
        "Our website is mutescroll dot com",
        "My handle is at mute scroll",
    ],
)
def test_detects_demonstrative_phrases(text: str) -> None:
    refs = find_on_screen_references([seg(text, 10, 14)])
    assert len(refs) == 1
    assert refs[0].at == 12.0


def test_no_false_positive_on_plain_speech() -> None:
    assert find_on_screen_references([seg("I think AI will change how we work.")]) == []


def test_numbers_preserved_detects_changes() -> None:
    assert numbers_preserved("AI costs $10 and 3.5 hours", "AI costs $10 and 3.5 hours.")
    assert not numbers_preserved("AI costs $10", "AI costs $100")
    assert not numbers_preserved("in 2024 we", "in we")
    assert not numbers_preserved("1,000 users", "1000 users")


def test_clean_text_fixes_whitespace_and_case_but_keeps_numbers() -> None:
    assert clean_text("  so   basically today we have 3 things ") == "So basically today we have 3 things"
    assert clean_text("it costs $10") == "It costs $10"


def test_format_timestamp() -> None:
    assert format_timestamp(7.9, 120) == "[00:07]"
    assert format_timestamp(754, 3000) == "[12:34]"
    assert format_timestamp(3725, 7200) == "[01:02:05]"
    with pytest.raises(ValueError):
        format_timestamp(-1, 10)


def test_render_transcript_with_and_without_speakers() -> None:
    text = render_transcript(
        [seg("Hello.", 0, 2), seg("", 2, 3), seg("Thanks.", 7.2, 9, speaker="SPEAKER_2")],
        total_duration=60,
    )
    assert text == "[00:00] Hello.\n[00:07] SPEAKER_2: Thanks."
