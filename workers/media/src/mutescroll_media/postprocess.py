"""Transcript post-processing: trust features from PRD section 11.

- Uncertain spans ("ears first, eyes when needed"): where the recogniser admits it was guessing.
- On-screen references: demonstrative phrases that point at content the audio can't carry.
- Fidelity guard: formatting may never change numbers.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable, Sequence

from .models import OnScreenReference, Segment, UncertainSpan

WORD_PROBABILITY_THRESHOLD = 0.5
MERGE_GAP_SECONDS = 0.15
SEGMENT_CONFIDENCE_THRESHOLD = 0.5  # exp(avg_logprob) < 0.5, i.e. avg_logprob below ~ -0.69

# Phrases that usually refer to something visible or linked, not spoken. Kept deliberately
# narrow: a false positive only costs the host LLM one optional frame lookup.
_DEMONSTRATIVE_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\blink in (?:my |the |our )?(?:bio|description|comments?)\b",
        r"\b(?:in|check|see) (?:my |the |our )?bio\b",
        r"\bas you can see\b",
        r"\b(?:right )?here on (?:the )?screen\b",
        r"\b(?:on|at) (?:the )?screen\b",
        r"\bthis (?:command|code|link|url|website|site|app|tool|extension|setting|button|number|price)\b",
        r"\bvisit (?:our|my|the) (?:website|site|page)\b",
        r"\b(?:the|my|our) (?:handle|username|email|address|promo code|discount code|coupon code) is\b",
        r"\buse (?:the )?code\b",
        r"\b(?:type|enter|run|paste) (?:this|the following)\b",
        r"\bfollow me at\b",
        r"\bdot (?:com|io|ai|app|org|net|xyz|co)\b",
    )
)

_NUMBER_TOKEN = re.compile(r"\d+(?:[.,]\d+)*")


def find_uncertain_spans(segments: Iterable[Segment]) -> list[UncertainSpan]:
    """Return low-confidence spans, preferring word-level evidence over segment-level."""
    spans: list[UncertainSpan] = []
    for segment in segments:
        scored_words = [w for w in segment.words if w.probability is not None]
        if scored_words:
            spans.extend(_word_level_spans(scored_words))
        elif segment.confidence is not None and segment.confidence < SEGMENT_CONFIDENCE_THRESHOLD:
            spans.append(
                UncertainSpan(
                    start=segment.start,
                    end=segment.end,
                    text=segment.text.strip(),
                    reason="low_confidence_segment",
                )
            )
    return spans


def _word_level_spans(words: Sequence) -> list[UncertainSpan]:
    spans: list[UncertainSpan] = []
    run: list = []
    for word in words:
        low = word.probability is not None and word.probability < WORD_PROBABILITY_THRESHOLD
        if low and run and word.start - run[-1].end <= MERGE_GAP_SECONDS:
            run.append(word)
            continue
        if run:
            spans.append(_span_from_run(run))
            run = []
        if low:
            run = [word]
    if run:
        spans.append(_span_from_run(run))
    return spans


def _span_from_run(run: Sequence) -> UncertainSpan:
    return UncertainSpan(
        start=run[0].start,
        end=run[-1].end,
        text=" ".join(w.text.strip() for w in run).strip(),
        reason="low_confidence",
    )


def find_on_screen_references(segments: Iterable[Segment]) -> list[OnScreenReference]:
    refs: list[OnScreenReference] = []
    for segment in segments:
        midpoint = round((segment.start + segment.end) / 2, 2)
        for pattern in _DEMONSTRATIVE_PATTERNS:
            match = pattern.search(segment.text)
            if match is not None:
                refs.append(OnScreenReference(at=midpoint, phrase=match.group(0)))
                break  # one reference per segment is enough for a frame lookup
    return refs


def numbers_preserved(raw: str, cleaned: str) -> bool:
    """True when both texts contain exactly the same multiset of numeric tokens."""
    return Counter(_NUMBER_TOKEN.findall(raw)) == Counter(_NUMBER_TOKEN.findall(cleaned))


def clean_text(raw: str) -> str:
    """Whitespace and capitalisation fixes only. Falls back to the raw text if numbers differ.

    We deliberately do not strip filler words or rewrite anything yet: the recogniser already
    punctuates, and the fidelity rules (PRD 11.1) prefer an unchanged word to a risky edit.
    """
    cleaned = re.sub(r"\s+", " ", raw).strip()
    if cleaned and cleaned[0].islower():
        cleaned = cleaned[0].upper() + cleaned[1:]
    return cleaned if numbers_preserved(raw, cleaned) else raw.strip()


def format_timestamp(seconds: float, total_duration: float) -> str:
    """[MM:SS] under one hour, [HH:MM:SS] otherwise (mirrors @mutescroll/shared)."""
    if seconds < 0 or seconds != seconds:
        raise ValueError(f"invalid timestamp: {seconds}")
    whole = int(seconds)
    h, rem = divmod(whole, 3600)
    m, s = divmod(rem, 60)
    if total_duration >= 3600:
        return f"[{h:02d}:{m:02d}:{s:02d}]"
    return f"[{h * 60 + m:02d}:{s:02d}]"


def render_transcript(segments: Sequence[Segment], total_duration: float) -> str:
    lines: list[str] = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        label = format_timestamp(segment.start, total_duration)
        prefix = f"{label} {segment.speaker}: " if segment.speaker else f"{label} "
        lines.append(f"{prefix}{text}")
    return "\n".join(lines)
