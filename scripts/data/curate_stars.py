"""Copy the Yale BSC V/50 catalog into ``data/curated/stars_catalog``.

The CDS ``ReadMe`` stays in ``data/raw/``. Lookup reads
only ``stars_catalog``.

Sources: NOTICE (Hoffleit+ 1991; CDS V/50).
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_RAW = _REPO / "data" / "raw"
_SRC = _RAW / "stars" / "catalog"
_DST = _REPO / "data" / "curated" / "stars_catalog"


def curate() -> Path:
    """Copy the CDS catalog unchanged.

    Returns:
        Path to ``stars_catalog``.

    Raises:
        FileNotFoundError: If the downloaded catalog is missing.
    """
    if not _SRC.is_file():
        raise FileNotFoundError(
            "raw pack missing: data/raw/"
            "stars/catalog"
        )
    _DST.parent.mkdir(parents=True, exist_ok=True)
    for leftover_name in ("stars.json", "catalog", "ReadMe"):
        leftover = _DST.parent / leftover_name
        if leftover.is_file():
            leftover.unlink()
    shutil.copy2(_SRC, _DST)
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
