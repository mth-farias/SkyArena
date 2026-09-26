"""Load curated zebrafish loop trajectories from parquet."""

from __future__ import annotations

from pathlib import Path

_REPO = Path(__file__).resolve().parents[3]
_PATH = _REPO / "data" / "curated" / "fish.parquet"


def _identities_from_wide(table) -> list[dict]:
    """Transpose wide ``xN,yN`` columns into identity records."""
    names = list(table.column_names)
    n_ids = len(names) // 2
    records = []
    for i in range(1, n_ids + 1):
        xs = table.column(f"x{i}").to_pylist()
        ys = table.column(f"y{i}").to_pylist()
        points = []
        for x, y in zip(xs, ys):
            if x is None or y is None:
                continue
            points.append([float(x), float(y)])
        records.append({"id": i, "points": points})
    return records


def fish_location(count: int) -> list[dict]:
    """Return ``count`` curated fish identities.

    Args:
        count: How many trajectories to return (from the start).

    Returns:
        Identity dicts with ``id`` and unit-disk ``points``.

    Raises:
        FileNotFoundError: If curated data is missing.
        ValueError: If ``count`` is not a positive integer.
        ImportError: If pyarrow is missing from the repo venv.
    """
    if int(count) < 1:
        raise ValueError("count must be a positive integer")
    if not _PATH.is_file():
        raise FileNotFoundError(
            "missing data/curated/fish.parquet; run scripts/setup.py"
        )
    import pyarrow.parquet as pq

    ids = _identities_from_wide(pq.read_table(_PATH))
    return ids[: int(count)]
