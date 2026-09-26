"""Curate Drosophila tracks into looped ``data/curated/fly.parquet``."""

from __future__ import annotations

import sys
from pathlib import Path

_UTILS = Path(__file__).resolve().parent
_REPO = Path(__file__).resolve().parents[2]
_RAW = _REPO / "data" / "raw"
# Two recordings of the same species. Each is normalized on its own arena
# circle, so the two arenas' sizes never interact.
_SOURCES = (
    (_RAW / "flies" / "trajectories.csv", "fly"),
    (_RAW / "flies" / "trajectories_b.csv", "fly_b"),
)
_DST = _REPO / "data" / "curated" / "fly.parquet"
# Matches MAX_ANIMALS in app/view.js, which is how many the piece can hold.
_TARGET = 100


def curate() -> Path:
    """Pool both recordings, keep the 100 most mobile, then HMM-close.

    Returns:
        Path to the curated file.

    Raises:
        FileNotFoundError: If a raw pack is missing.
        ImportError: If pyarrow is missing from the repo venv.
        ValueError: If the packs hold fewer animals than the target.
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
            "pyarrow missing; run scripts/setup.py first"
        ) from err

    from arena_extent import (
        clip_to_unit_disk,
        paths_to_unit,
        write_hz_proofs,
    )
    from mobility import select

    unit: list[list[tuple[float, float]]] = []
    for src, label in _SOURCES:
        if not src.is_file():
            raise FileNotFoundError(
                f"raw pack missing: {src.relative_to(_REPO).as_posix()}"
            )
        # Each pack carries its own frame count, and the pipeline infers
        # fps from it over a fixed 10-minute video. Decimating both with
        # one pack's rate would give the other the wrong 10 Hz track.
        src_fps = src_fps_for_frames(csv_n_frames(src))
        hz_paths = [
            decimate_hz(path, src_fps=src_fps)
            for path in parse_idtracker_csv(src)
        ]
        cx, cy, radius = write_hz_proofs("fly", hz_paths, label=label)
        unit.extend(paths_to_unit(hz_paths, cx, cy, radius))

    chosen = [unit[index] for index in select(unit, _TARGET)]
    columns = clip_to_unit_disk(close_wide_table(chosen))
    # float32 is what the app packs into, so storing doubles only made
    # the file larger: 5 decimals halve in size this way.
    float32 = pa.schema([(name, pa.float32()) for name in columns])
    table = pa.table(columns).cast(float32)
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
