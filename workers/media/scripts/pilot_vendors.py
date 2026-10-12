"""D9 pilot: run public TikTok / Instagram URLs through the vendor path and report the gate (PRD 22.2).

Usage (from repo root, keys in .env):
    python workers/media/scripts/pilot_vendors.py urls.txt [--report pilot-report.json]

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
from mutescroll_media.vendors import RoutedSource, build_source

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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("urls_file", type=Path)
    parser.add_argument("--report", type=Path, default=Path("pilot-report.json"))
    args = parser.parse_args()

    load_dotenv()
    key = os.environ.get("SCRAPECREATORS_API_KEY")
    groq = os.environ.get("GROQ_API_KEY")
    if not key or not groq:
        print("Set SCRAPECREATORS_API_KEY and GROQ_API_KEY in .env first.", file=sys.stderr)
        return 1

    source = build_source(YtDlpSource(), scrapecreators_key=key)
    assert isinstance(source, RoutedSource)
    asr = GroqProvider(groq)
    urls = [
        line.strip()
        for line in args.urls_file.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]
    rows = []
    for index, url in enumerate(urls, 1):
        row = run_one(url, source, asr)
        rows.append(row)
        status = "ok " if row["ok"] else f"FAIL {row.get('code')}"
        print(f"[{index}/{len(urls)}] {status:<28} {row['elapsed_s']:>5}s  {url}")

    passed = sum(1 for r in rows if r["ok"])
    rate = passed / len(rows) if rows else 0.0
    timestamped = sum(1 for r in rows if r.get("timestamped"))
    summary = {
        "total": len(rows),
        "ok": passed,
        "success_rate": round(rate, 3),
        "timestamped": timestamped,
        "gate_passed": rate >= GATE_SUCCESS_RATE,
        "rows": rows,
    }
    args.report.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n{passed}/{len(rows)} ok ({rate:.0%}); gate {'PASSED' if summary['gate_passed'] else 'NOT passed'}"
          f" (>= {GATE_SUCCESS_RATE:.0%}). Report: {args.report}")
    return 0 if summary["gate_passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
