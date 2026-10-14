"""`mutescroll-transcribe <url-or-file>`: run the pipeline locally (M1 exit-criteria tool)."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .asr import AsrError, GroqProvider
from .audio import MediaError, NoSpeechError
from .cache import TranscriptCache
from .config import load_dotenv
from .pipeline import DEFAULT_MAX_SECONDS, transcribe_file, transcribe_url
from .sources import RetrievalError, YtDlpSource


def _cache_dir() -> Path:
    return Path(os.environ.get("MUTESCROLL_CACHE_DIR") or Path.home() / ".mutescroll" / "cache")


def _fail(args: argparse.Namespace, code: str, exit_code: int) -> int:
    """In --json mode, also emit a machine-readable error object on stdout (no message, no upstream detail)."""
    if args.json:
        print(json.dumps({"status": "error", "error": {"code": code, "exit_code": exit_code}}))
    return exit_code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mutescroll-transcribe", description=__doc__)
    parser.add_argument("target", help="video URL or path to a local media file")
    parser.add_argument("--language", default="auto", help="ISO 639-1 code or 'auto' (default)")
    parser.add_argument("--json", action="store_true", help="print the full structured result")
    parser.add_argument("--max-seconds", type=float, default=DEFAULT_MAX_SECONDS)
    parser.add_argument("--no-auto-captions", action="store_true", help="never fall back to auto-generated captions")
    parser.add_argument("--verbose", action="store_true", help="show raw upstream error details on failure")
    parser.add_argument("--no-cache", action="store_true", help="skip the 24 h transcript cache (URLs only)")
    args = parser.parse_args(argv)

    # Transcripts contain arbitrary Unicode; never let a legacy console codepage crash the run.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    load_dotenv()
    api_key = os.environ.get("GROQ_API_KEY", "")
    asr = GroqProvider(api_key) if api_key else None

    try:
        if Path(args.target).is_file():
            result = transcribe_file(Path(args.target), asr=asr, language=args.language, max_seconds=args.max_seconds)
        else:
            result = transcribe_url(
                args.target,
                source=YtDlpSource(),
                asr=asr,
                language=args.language,
                max_seconds=args.max_seconds,
                allow_auto_captions=not args.no_auto_captions,
                cache=None if args.no_cache else TranscriptCache(_cache_dir()),
            )
    except RetrievalError as exc:
        print(f"retrieval failed [{exc.code}]: {exc}", file=sys.stderr)
        if args.verbose and exc.detail:
            print(f"  detail: {exc.detail}", file=sys.stderr)
        print("Tip: if you can access the video, upload the file instead (same pipeline).", file=sys.stderr)
        return _fail(args, exc.code, 2)
    except NoSpeechError as exc:
        print(f"no speech [{exc.code}]: {exc}", file=sys.stderr)
        return _fail(args, exc.code, 5)
    except MediaError as exc:
        print(f"media processing failed: {exc}", file=sys.stderr)
        return _fail(args, "media_error", 6)
    except AsrError as exc:
        print(f"transcription failed: {exc}", file=sys.stderr)
        return _fail(args, "asr_error", 3)
    except PermissionError as exc:
        print(f"blocked: {exc}", file=sys.stderr)
        return _fail(args, "blocked", 4)

    if args.json:
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    else:
        meta = result.metadata
        print(f"# {meta.title or '(untitled)'} | {meta.platform} | lang={result.language} | method={result.method}")
        print(result.transcript_text)
        if result.uncertain_spans:
            print("\nUncertain spans:")
            for span in result.uncertain_spans:
                print(f"  {span.start:7.1f}s  {span.text!r} ({span.reason})")
        if result.on_screen_references:
            print("\nOn-screen references:")
            for ref in result.on_screen_references:
                print(f"  {ref.at:7.1f}s  {ref.phrase!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
