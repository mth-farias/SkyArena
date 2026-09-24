"""CLI: download Drosophila trajectories from Google Drive."""

from __future__ import annotations

import sys

from download_raw import DownloadError, download_flies


def main() -> int:
    """Fetch the fly CSV only."""
    try:
        download_flies()
    except DownloadError as err:
        print(f"  [fail] {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
