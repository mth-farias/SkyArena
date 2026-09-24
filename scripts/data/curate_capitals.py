"""Copy world-capital locations into ``data/curated/capitals.json``."""

from __future__ import annotations

import json
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_RAW = _REPO / "data" / "raw"
_SRC = _RAW / "capitals" / "locations.json"
_DST = _REPO / "data" / "curated" / "capitals.json"


def curate() -> Path:
    """Write capitals as a JSON list. No LAX extra point.

    Returns:
        Path to the curated file.

    Raises:
        FileNotFoundError: If the raw pack is missing.
    """
    if not _SRC.is_file():
        raise FileNotFoundError(
            "raw pack missing: data/raw/"
            "capitals/locations.json"
        )
    data = json.loads(_SRC.read_text(encoding="utf-8"))
    _DST.parent.mkdir(parents=True, exist_ok=True)
    _DST.write_text(
        json.dumps(data, indent=2) + "\n",
        encoding="utf-8",
    )
    return _DST


def main() -> int:
    """CLI entry."""
    try:
        path = curate()
    except FileNotFoundError as err:
        print(f"  [fail] {err}", file=sys.stderr)
        return 1
    print(f"  wrote {path.relative_to(_REPO).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
