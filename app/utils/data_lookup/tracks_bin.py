"""Pack the wide fly and fish parquet files into a Float32 blob for the app."""

from __future__ import annotations

import math
import statistics
import struct
import sys
from array import array
from pathlib import Path

# Format tag that view.js checks before it reads a track file.
MAGIC = b"SAW2"
TARGET_HZ = 10.0


def _identity_count(table) -> int:
    """Return how many ``xN`` columns the wide table has."""
    return sum(1 for name in table.column_names if name.startswith("x"))


def _points_for_id(table, ident: int) -> list[tuple[float, float]]:
    """Return finite (x, y) samples for one wide identity."""
    xs = table.column(f"x{ident}").to_pylist()
    ys = table.column(f"y{ident}").to_pylist()
    points: list[tuple[float, float]] = []
    for x, y in zip(xs, ys):
        if x is None or y is None:
            break
        points.append((float(x), float(y)))
    return points


def _loop_speeds(points: list[tuple[float, float]]) -> list[float]:
    """Return per-sample speed (unit disk / s) with loop wrap."""
    n_pts = len(points)
    if n_pts < 2:
        return [0.0] * n_pts
    speeds: list[float] = []
    for i in range(n_pts):
        nxt = (i + 1) % n_pts
        dx = points[nxt][0] - points[i][0]
        dy = points[nxt][1] - points[i][1]
        speeds.append(math.hypot(dx, dy) * TARGET_HZ)
    return speeds


def _speed_quantiles(speeds: list[float]) -> tuple[float, float, float]:
    """Return inclusive Q1, median, Q3 from moving samples.

    Stationary (zero) samples are omitted so Q1 is not collapsed to 0.
    Returns zeros if fewer than two moving samples exist.
    """
    finite = [s for s in speeds if math.isfinite(s) and s > 0.0]
    if len(finite) < 2:
        return (0.0, 0.0, 0.0)
    q1, median, q3 = statistics.quantiles(
        finite, n=4, method="inclusive"
    )
    return (float(q1), float(median), float(q3))


def pack_wide_parquet(path: Path, count: int) -> bytes:
    """Return ``SAW2`` with per-sample speed and species quantiles.

    Layout (little-endian):
        4 bytes magic ``SAW2``
        uint32 n_ids
        float32 q1, median, q3 (all parquet identities)
        n_ids × uint32 point counts
        float32 x, y, speed for each point in identity order

    Speed is loop-wrapped displacement times ``TARGET_HZ``. Quantiles
    use every identity in the parquet, not the packed ``count``.

    Args:
        path: Curated ``fly.parquet`` or ``fish.parquet``.
        count: How many identities to pack from the start.

    Returns:
        A binary blob for ``/api/flies.bin`` / ``/api/fish.bin``.

    Raises:
        FileNotFoundError: If ``path`` is missing.
        ValueError: If ``count`` is negative.
        ImportError: If pyarrow is missing from the repo venv.
    """
    if int(count) < 0:
        raise ValueError("count must be >= 0")
    if not path.is_file():
        raise FileNotFoundError(
            f"missing {path.as_posix()}; run scripts/setup.py"
        )
    import pyarrow.parquet as pq

    table = pq.read_table(path)
    n_avail = _identity_count(table)
    n_ids = min(int(count), n_avail)
    all_speeds: list[float] = []
    packed: list[tuple[list[tuple[float, float]], list[float]]] = []
    for i in range(1, n_avail + 1):
        points = _points_for_id(table, i)
        speeds = _loop_speeds(points)
        all_speeds.extend(speeds)
        if i <= n_ids:
            packed.append((points, speeds))
    q1, median, q3 = _speed_quantiles(all_speeds)
    lengths: list[int] = []
    payload = array("f")
    for points, speeds in packed:
        lengths.append(len(points))
        for (x, y), speed in zip(points, speeds):
            payload.append(x)
            payload.append(y)
            payload.append(speed)
    if sys.byteorder != "little":
        payload.byteswap()
    header = MAGIC + struct.pack("<I", n_ids)
    header += struct.pack("<fff", q1, median, q3)
    if lengths:
        header += struct.pack(f"<{n_ids}I", *lengths)
    return header + payload.tobytes()
