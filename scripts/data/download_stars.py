"""CLI: download CDS Yale BSC V/50 into ``data/raw/``."""

from __future__ import annotations

import sys

from download_raw import DownloadError, download_stars


def main() -> int:
    """Fetch ReadMe and catalog only."""
    try:
        download_stars()
    except DownloadError as err:
        print(f"  [fail] {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
