"""CLI: download the 2026-06-21 FDSN day into ``data/raw/``."""

from __future__ import annotations

import sys

from download_raw import DownloadError, download_quakes


def main() -> int:
    """Fetch the SeismicPortal JSON only."""
    try:
        download_quakes()
    except DownloadError as err:
        print(f"  [fail] {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
