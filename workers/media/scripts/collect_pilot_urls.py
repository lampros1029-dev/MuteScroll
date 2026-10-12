"""Collect public TikTok / Instagram post URLs for the D9 pilot using the vendor's listing endpoints.

Usage: python workers/media/scripts/collect_pilot_urls.py --out pilot-urls.txt
Each profile listing costs about 1 vendor credit, so keep the account list short.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

import httpx

from mutescroll_media.config import load_dotenv

API = "https://api.scrapecreators.com"
TIKTOK_HANDLES = ("garyvee", "alexhormozi", "stoolpresidente")
INSTAGRAM_HANDLES = ("garyvee", "hormozi", "mrbeast")


def _get(client: httpx.Client, path: str, handle: str) -> dict[str, Any] | None:
    for _ in range(2):  # errors are free, so one retry is cheap
        response = client.get(API + path, params={"handle": handle}, timeout=60)
        if response.status_code == 200:
            body = response.json()
            return body if isinstance(body, dict) else None
    print(f"  {path} {handle}: gave up (HTTP {response.status_code})", file=sys.stderr)
    return None


def tiktok_urls(client: httpx.Client, handle: str, limit: int) -> list[str]:
    body = _get(client, "/v3/tiktok/profile/videos", handle) or {}
    urls = []
    for item in body.get("aweme_list") or []:
        video_id = item.get("aweme_id")
        if video_id:
            urls.append(f"https://www.tiktok.com/@{handle}/video/{video_id}")
    return urls[:limit]


def instagram_urls(client: httpx.Client, handle: str, limit: int) -> list[str]:
    body = _get(client, "/v1/instagram/user/reels", handle) or {}
    urls = []
    for item in body.get("items") or []:
        code = (item.get("media") or {}).get("code")
        if code:
            urls.append(f"https://www.instagram.com/reel/{code}/")
    return urls[:limit]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("pilot-urls.txt"))
    parser.add_argument("--per-platform", type=int, default=45)
    args = parser.parse_args()
    load_dotenv()
    key = os.environ.get("SCRAPECREATORS_API_KEY")
    if not key:
        print("SCRAPECREATORS_API_KEY is not set", file=sys.stderr)
        return 1

    lines: list[str] = []
    with httpx.Client(headers={"x-api-key": key}) as client:
        for label, handles, fetch in (
            ("tiktok", TIKTOK_HANDLES, tiktok_urls),
            ("instagram", INSTAGRAM_HANDLES, instagram_urls),
        ):
            collected: list[str] = []
            for handle in handles:
                found = fetch(client, handle, args.per_platform)
                print(f"{label} @{handle}: {len(found)} urls")
                collected.extend(u for u in found if u not in collected)
            lines.append(f"# {label}")
            lines.extend(collected[: args.per_platform])
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
