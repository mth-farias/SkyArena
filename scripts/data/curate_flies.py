"""Curate Drosophila tracks into looped ``data/curated/fly.parquet``."""

from __future__ import annotations

import sys
from pathlib import Path

_UTILS = Path(__file__).resolve().parent
_REPO = Path(__file__).resolve().parents[2]
_RAW = _REPO / "data" / "raw"
_SRC = _RAW / "flies" / "trajectories.csv"
_DST = _REPO / "data" / "curated" / "fly.parquet"


def curate() -> Path:
    """10 Hz real tracks, scale proofs, normalize, then HMM-close.

    Returns:
        Path to the curated file.

    Raises:
        FileNotFoundError: If the raw pack is missing.
        ImportError: If pyarrow is missing from the repo venv.
    """
    sys.path.insert(0, str(_UTILS))
    from fly_hmm_trajectory import parse_idtracker_csv
    from locomotion_hmm import (
        close_wide_table,
        csv_n_frames,
        decimate_hz,
        src_fps_for_frames,
    )

    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError as err:
        raise ImportError(
            "pyarrow missing; run fly-setup first"
        ) from err

    if not _SRC.is_file():
        raise FileNotFoundError(
            "raw pack missing: data/raw/"
            "flies/trajectories.csv"
        )
    from arena_extent import (
        clip_to_unit_disk,
        paths_to_unit,
        write_hz_proofs,
    )

    src_fps = src_fps_for_frames(csv_n_frames(_SRC))
    hz_paths = [
        decimate_hz(path, src_fps=src_fps)
        for path in parse_idtracker_csv(_SRC)
    ]
    cx, cy, radius = write_hz_proofs("fly", hz_paths)
    unit = paths_to_unit(hz_paths, cx, cy, radius)
    columns = clip_to_unit_disk(close_wide_table(unit))
    table = pa.table(columns)
    _DST.parent.mkdir(parents=True, exist_ok=True)
    leftover = _DST.with_name("flies.json")
    if leftover.is_file():
        leftover.unlink()
    pq.write_table(table, _DST)
    return _DST


def main() -> int:
    """CLI entry."""
    try:
        path = curate()
    except (FileNotFoundError, ImportError, ValueError) as err:
        print(f"  [fail] {err}", file=sys.stderr)
        return 1
    print(f"  wrote {path.relative_to(_REPO).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
