"""D9 pilot: run public TikTok / Instagram URLs through the vendor path and report the gate (PRD 22.2).

Usage (from repo root, keys in .env):
    python workers/media/scripts/pilot_vendors.py urls.txt [--limit 16] [--max-credits 16]

`urls.txt` has one public URL per line; blank lines and lines starting with '#' are ignored.
Gate: success >= 85%, downloads work from this egress IP, timestamps present. Uses real credits.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from mutescroll_media.asr import AsrError, GroqProvider
from mutescroll_media.audio import MediaError, NoSpeechError
from mutescroll_media.config import load_dotenv
from mutescroll_media.pipeline import transcribe_url
from mutescroll_media.sources import RetrievalError, YtDlpSource
from mutescroll_media.vendors import RoutedSource, ScrapeCreatorsClient, VendorSource

GATE_SUCCESS_RATE = 0.85


def run_one(url: str, source: Any, asr: GroqProvider) -> dict[str, Any]:
    started = time.monotonic()
    row: dict[str, Any] = {"url": url}
    try:
        result = transcribe_url(url, source=source, asr=asr, language="auto", allow_auto_captions=False)
    except RetrievalError as exc:
        row.update(ok=False, stage="retrieval", code=exc.code, detail=exc.detail)
    except NoSpeechError as exc:
        row.update(ok=True, no_speech=True, code=exc.code)  # retrieval worked; the clip is silent
    except (MediaError, AsrError, PermissionError) as exc:
        row.update(ok=False, stage=exc.__class__.__name__, code="error", detail=str(exc)[:200])
    else:
        words = len(result.transcript_text.split())
        row.update(
            ok=True,
            platform=result.metadata.platform,
            seconds=result.metadata.duration_seconds,
            words=words,
            segments=len(result.segments),
            timestamped=all(s.end > s.start for s in result.segments) and bool(result.segments),
            method=result.method,
        )
    row["elapsed_s"] = round(time.monotonic() - started, 1)
    return row


def interleave(urls: list[str]) -> list[str]:
    """Alternate platforms so a small sample covers both."""
    tiktok = [u for u in urls if "tiktok.com" in u]
    other = [u for u in urls if "tiktok.com" not in u]
    mixed: list[str] = []
    for index in range(max(len(tiktok), len(other))):
        mixed.extend(group[index] for group in (tiktok, other) if index < len(group))
    return mixed


def load_done(results: Path) -> dict[str, dict[str, Any]]:
    if not results.exists():
        return {}
    rows = [json.loads(line) for line in results.read_text(encoding="utf-8").splitlines() if line.strip()]
    return {row["url"]: row for row in rows}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("urls_file", type=Path)
    parser.add_argument("--limit", type=int, default=16, help="max URLs to try this run (default 16)")
    parser.add_argument("--max-credits", type=int, default=16, help="hard stop once this many vendor credits are spent")
    parser.add_argument("--results", type=Path, default=Path("pilot-results.jsonl"), help="one JSON row per URL; reruns resume")
    args = parser.parse_args()

    load_dotenv()
    key = os.environ.get("SCRAPECREATORS_API_KEY")
    groq = os.environ.get("GROQ_API_KEY")
    if not key or not groq:
        print("Set SCRAPECREATORS_API_KEY and GROQ_API_KEY in .env first.", file=sys.stderr)
        return 1

    vendor = VendorSource(ScrapeCreatorsClient(key))
    source = RoutedSource(YtDlpSource(), vendor)
    asr = GroqProvider(groq)
    done = load_done(args.results)
    candidates = [
        line.strip()
        for line in args.urls_file.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]
    todo = [u for u in interleave(candidates) if u not in done][: args.limit]
    print(f"{len(done)} already done; trying {len(todo)} (credit budget {args.max_credits})", flush=True)

    for index, url in enumerate(todo, 1):
        if vendor.credits_used >= args.max_credits:
            print(f"Credit budget reached ({vendor.credits_used}); stopping.", flush=True)
            break
        row = run_one(url, source, asr)
        row["vendor_credits_so_far"] = vendor.credits_used
        with args.results.open("a", encoding="utf-8") as handle:  # persisted per row: a crash loses nothing
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        done[url] = row
        status = "ok " if row["ok"] else f"FAIL {row.get('code')}"
        print(f"[{index}/{len(todo)}] {status:<28} {row['elapsed_s']:>5}s  {url}", flush=True)

    return report(list(done.values()), vendor.credits_used)


def report(rows: list[dict[str, Any]], credits: int) -> int:
    if not rows:
        print("No results yet.")
        return 1
    by_platform: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_platform.setdefault("tiktok" if "tiktok.com" in row["url"] else "instagram", []).append(row)
    for name, group in sorted(by_platform.items()):
        ok = sum(1 for r in group if r["ok"])
        codes: dict[str, int] = {}
        for r in group:
            if not r["ok"]:
                codes[r.get("code", "?")] = codes.get(r.get("code", "?"), 0) + 1
        print(f"{name}: {ok}/{len(group)} ok ({ok / len(group):.0%}) failures: {codes or 'none'}")
    passed = sum(1 for r in rows if r["ok"])
    rate = passed / len(rows)
    stamped = sum(1 for r in rows if r.get("timestamped"))
    print(f"overall {passed}/{len(rows)} ok ({rate:.0%}); timestamped {stamped}; vendor credits this run {credits}")
    print(f"D9 gate (>= {GATE_SUCCESS_RATE:.0%} on >= 50 per platform): {'sample passes' if rate >= GATE_SUCCESS_RATE else 'below threshold'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
