"""Load curated world capitals."""

from __future__ import annotations

import json
from pathlib import Path

_REPO = Path(__file__).resolve().parents[3]
_PATH = _REPO / "data" / "curated" / "capitals.json"


def capitals_location() -> list[dict]:
    """Return the curated capital list.

    Returns:
        Dicts with ``country``, ``capital``, ``lat``, ``lon``.

    Raises:
        FileNotFoundError: If curated data is missing.
    """
    if not _PATH.is_file():
        raise FileNotFoundError(
            "missing data/curated/capitals.json; run /fly-setup"
        )
    data = json.loads(_PATH.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("capitals.json must be a JSON list")
    return data
