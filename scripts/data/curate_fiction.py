"""Curate fictional tracks into ``data/curated/{species}_fiction.parquet``.

The bodies come from ``fiction_tracks``, which fits one curated animal and
walks from that fit. They are written with the same schema, precision and
bridge as the recorded tracks, so the app cannot tell the two apart except
by the file it asked for.
"""

from __future__ import annotations

import sys
from pathlib import Path

_UTILS = Path(__file__).resolve().parent
_REPO = Path(__file__).resolve().parents[2]
_DST = _REPO / "data" / "curated"
_SPECIES = ("fly", "fish")


def curate(species: str) -> Path:
    """Generate one species' fictional tracks and write the parquet.

    The generated bodies are closed here with the **same bridge the
    recorded tracks use**. That is not cosmetic: the piece loops an animal
    by taking its sample index modulo the track length, so a track that
    ends anywhere other than its own first sample teleports the animal
    across the sky every lap. A generated body ends wherever its walk
    ended, which is nowhere near its start.

    Args:
        species: ``fly`` or ``fish``.

    Returns:
        Path to the curated file.

    Raises:
        ImportError: If pyarrow is missing from the repo venv.
        ValueError: If a curated track is too short to fit.
    """
    sys.path.insert(0, str(_UTILS))
    from fiction_tracks import SEED, bodies
    from locomotion_hmm import close_wide_table

    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError as err:
        raise ImportError(
            "pyarrow missing; run scripts/setup.py first"
        ) from err

    from arena_extent import clip_to_unit_disk

    closed = close_wide_table(bodies(species, SEED))
    columns = clip_to_unit_disk(closed)
    # float32 is what the app packs into, so storing doubles only made
    # the file larger. Same choice as curate_flies.py.
    float32 = pa.schema([(name, pa.float32()) for name in columns])
    table = pa.table(columns).cast(float32)
    _DST.mkdir(parents=True, exist_ok=True)
    dst = _DST / f"{species}_fiction.parquet"
    pq.write_table(table, dst)
    return dst


def main() -> int:
    """CLI entry: build both species."""
    try:
        for species in _SPECIES:
            path = curate(species)
            print(f"  wrote {path.relative_to(_REPO).as_posix()}")
    except (FileNotFoundError, ImportError, ValueError) as err:
        print(f"  [fail] {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
