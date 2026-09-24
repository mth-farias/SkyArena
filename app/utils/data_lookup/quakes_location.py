"""Load curated 2026-06-21 earthquake events."""

from __future__ import annotations

import json
from pathlib import Path

_REPO = Path(__file__).resolve().parents[3]
_PATH = _REPO / "data" / "curated" / "quakes_21062026.json"


def quakes_location() -> list[dict]:
    """Return every curated quake event (all magnitudes).

    Returns:
        Event dicts as stored in ``data/curated/quakes_21062026.json``.

    Raises:
        FileNotFoundError: If curated data is missing.
        ValueError: If the file is not a JSON list.
    """
    if not _PATH.is_file():
        raise FileNotFoundError(
            "missing data/curated/quakes_21062026.json; run /fly-setup"
        )
    data = json.loads(_PATH.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("quakes_21062026.json must be a JSON list")
    return data
