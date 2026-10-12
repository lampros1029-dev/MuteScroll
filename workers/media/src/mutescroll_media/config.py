"""Tiny .env loader so the CLI works locally without extra dependencies.

Real environment variables always win. Production uses platform secrets, not files.
"""

from __future__ import annotations

import os
from pathlib import Path


def load_dotenv(start: Path | None = None) -> Path | None:
    """Load KEY=VALUE lines from the nearest `.env` at or above `start`. Returns the file used."""
    here = (start or Path.cwd()).resolve()
    for directory in (here, *here.parents):
        candidate = directory / ".env"
        if candidate.is_file():
            for raw in candidate.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key, value = key.strip(), value.strip().strip("\"'")
                if key and value and key not in os.environ:
                    os.environ[key] = value
            return candidate
    return None
