"""Release gate (PRD 11 / M1 exit): post-processing must never change a digit.

Every sample is raw recogniser-style text. If any case fails, do not ship.
"""

import random
import re
from collections import Counter

import pytest

from mutescroll_media.postprocess import clean_text, numbers_preserved

GOLDEN = [
    "we grew 340% in 18 months",
    "it costs $1,299.99 per seat",
    "call 555-0142 before 5pm",
    "in 2024 we hit 1.5 million users",
    "the ratio is 3:1, not 2:1",
    "version 2.0.1 shipped on 03/04/2025",
    "  weird   spacing   around 42   numbers 7  ",
    "lowercase start with 1,000,000 dollars",
    "€12,50 and £3.20 and ¥1500",
    "0.001 percent chance, so 1 in 100000",
    "room 101, floor 3, 24/7 support",
    "he scored 9.5/10 for 12 straight weeks",
    "the 2nd, 3rd and 21st of May",
    "10x faster than the 4-hour baseline",
    "no numbers at all here",
]

_DIGITS = re.compile(r"\d")


@pytest.mark.parametrize("raw", GOLDEN)
def test_golden_numbers_survive_cleaning(raw: str) -> None:
    cleaned = clean_text(raw)
    assert numbers_preserved(raw, cleaned)
    assert Counter(_DIGITS.findall(raw)) == Counter(_DIGITS.findall(cleaned))


def test_random_whitespace_and_case_never_alters_digits() -> None:
    rng = random.Random(1234)
    alphabet = ["word", "42", "3.14", "$7,500", "12%", "1:30", "ok", "2025", "x9"]
    for _ in range(500):
        parts = [rng.choice(alphabet) for _ in range(rng.randint(1, 12))]
        raw = "".join(p + " " * rng.randint(1, 4) for p in parts)
        assert Counter(_DIGITS.findall(raw)) == Counter(_DIGITS.findall(clean_text(raw)))


def test_gate_detects_a_changed_number() -> None:
    assert not numbers_preserved("we grew 340% in 18 months", "we grew 34% in 18 months")
    assert not numbers_preserved("room 101", "room one hundred one")
