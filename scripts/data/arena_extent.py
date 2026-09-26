"""AABB circle extents for 10 Hz fly and fish tracks.

After time-decimation and **before** the HMM close, this module
measures the real 10 Hz points, writes proof PNG + arena JSON, then
maps those same points onto the unit disk.
"""

from __future__ import annotations

import csv
import json
import math
import struct
import zlib
from pathlib import Path
from typing import Any

_SIZE = 1024
_PAD = 0.08
_REPO = Path(__file__).resolve().parents[2]
_PROOF_DIR = _REPO / "data" / "raw"
_BG = (22, 22, 24)
_DOT = (230, 230, 220)
_BOX = (80, 200, 120)
_RING = (80, 180, 255)
_TEXT = (240, 240, 240)
_GLYPHS: dict[str, tuple[int, ...]] = {
    " ": (0, 0, 0, 0, 0, 0, 0),
    "-": (0, 0, 0, 31, 0, 0, 0),
    ".": (0, 0, 0, 0, 0, 0, 4),
    "=": (0, 0, 10, 0, 10, 0, 0),
    "0": (14, 17, 19, 21, 25, 17, 14),
    "1": (4, 6, 4, 4, 4, 4, 14),
    "2": (14, 17, 16, 8, 4, 2, 31),
    "3": (14, 17, 16, 12, 16, 17, 14),
    "4": (8, 12, 10, 9, 31, 8, 8),
    "5": (31, 1, 15, 16, 16, 17, 14),
    "6": (12, 2, 1, 15, 17, 17, 14),
    "7": (31, 16, 8, 4, 4, 4, 4),
    "8": (14, 17, 17, 14, 17, 17, 14),
    "9": (14, 17, 17, 30, 16, 8, 6),
    "C": (14, 17, 1, 1, 1, 17, 14),
    "R": (15, 17, 17, 15, 5, 9, 17),
    "X": (17, 17, 10, 4, 10, 17, 17),
    "Y": (17, 17, 10, 4, 4, 4, 4),
    "N": (17, 19, 21, 21, 25, 17, 17),
    "A": (14, 17, 17, 31, 17, 17, 17),
}


def _id_count(columns: dict[str, list]) -> int:
    """Return how many xN columns are in a wide table."""
    return sum(1 for name in columns if name.startswith("x"))


def wide_from_csv(path: Path) -> dict[str, list]:
    """Load a validated idtracker ``xN,yN`` CSV as a wide table."""
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise ValueError(f"empty header: {path}")
        n_ids = len(reader.fieldnames) // 2
        columns: dict[str, list] = {}
        for i in range(1, n_ids + 1):
            columns[f"x{i}"] = []
            columns[f"y{i}"] = []
        for row in reader:
            for i in range(1, n_ids + 1):
                xs = row.get(f"x{i}", "")
                ys = row.get(f"y{i}", "")
                if not xs or not ys:
                    columns[f"x{i}"].append(None)
                    columns[f"y{i}"].append(None)
                    continue
                try:
                    x = float(xs)
                    y = float(ys)
                except ValueError:
                    columns[f"x{i}"].append(None)
                    columns[f"y{i}"].append(None)
                    continue
                if math.isnan(x) or math.isnan(y):
                    columns[f"x{i}"].append(None)
                    columns[f"y{i}"].append(None)
                    continue
                columns[f"x{i}"].append(x)
                columns[f"y{i}"].append(y)
    return columns


def iter_points(
    columns: dict[str, list],
    *,
    row_step: int = 1,
) -> list[tuple[float, float]]:
    """Collect finite (x, y) samples from every identity.

    Args:
        columns: Wide ``xN,yN`` table.
        row_step: Keep row 0, ``row_step``, ``2 * row_step``, ...
    """
    step = max(1, int(row_step))
    n_ids = _id_count(columns)
    points: list[tuple[float, float]] = []
    n_rows = len(next(iter(columns.values()))) if columns else 0
    for row in range(0, n_rows, step):
        for i in range(1, n_ids + 1):
            x = columns[f"x{i}"][row]
            y = columns[f"y{i}"][row]
            if x is None or y is None:
                continue
            xf = float(x)
            yf = float(y)
            if math.isfinite(xf) and math.isfinite(yf):
                points.append((xf, yf))
    return points


def measure(points: list[tuple[float, float]]) -> dict[str, float]:
    """Return AABB and enclosing circle for ``points``.

    Args:
        points: Finite pixel samples.

    Returns:
        xmin, xmax, ymin, ymax, cx, cy, r, n_points.

    Raises:
        ValueError: If ``points`` is empty.
    """
    if not points:
        raise ValueError("no finite trajectory points")
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    xmin = min(xs)
    xmax = max(xs)
    ymin = min(ys)
    ymax = max(ys)
    cx = (xmin + xmax) / 2.0
    cy = (ymin + ymax) / 2.0
    radius = 0.0
    for x, y in points:
        radius = max(radius, math.hypot(x - cx, y - cy))
    if radius <= 0:
        raise ValueError("degenerate arena radius")
    return {
        "xmin": xmin,
        "xmax": xmax,
        "ymin": ymin,
        "ymax": ymax,
        "cx": cx,
        "cy": cy,
        "r": radius,
        "n_points": float(len(points)),
    }


def to_unit(
    columns: dict[str, list],
    cx: float,
    cy: float,
    radius: float,
) -> dict[str, list]:
    """Map pixel columns onto the unit disk."""
    n_ids = _id_count(columns)
    n_rows = len(next(iter(columns.values())))
    out: dict[str, list] = {name: [] for name in columns}
    for row in range(n_rows):
        for i in range(1, n_ids + 1):
            x = columns[f"x{i}"][row]
            y = columns[f"y{i}"][row]
            if x is None or y is None:
                out[f"x{i}"].append(None)
                out[f"y{i}"].append(None)
                continue
            out[f"x{i}"].append((float(x) - cx) / radius)
            out[f"y{i}"].append((float(y) - cy) / radius)
    return out


def paths_to_unit(
    paths: list[list[tuple[float, float]]],
    cx: float,
    cy: float,
    radius: float,
) -> list[list[tuple[float, float]]]:
    """Map identity polylines onto the unit disk."""
    out: list[list[tuple[float, float]]] = []
    for path in paths:
        out.append(
            [((x - cx) / radius, (y - cy) / radius) for x, y in path]
        )
    return out


def clip_to_unit_disk(columns: dict[str, list]) -> dict[str, list]:
    """Project any sample outside the unit circle onto the rim."""
    n_ids = _id_count(columns)
    n_rows = len(next(iter(columns.values())))
    out: dict[str, list] = {name: [] for name in columns}
    for row in range(n_rows):
        for i in range(1, n_ids + 1):
            x = columns[f"x{i}"][row]
            y = columns[f"y{i}"][row]
            if x is None or y is None:
                out[f"x{i}"].append(None)
                out[f"y{i}"].append(None)
                continue
            xf = float(x)
            yf = float(y)
            hyp = math.hypot(xf, yf)
            if hyp > 1.0:
                xf /= hyp
                yf /= hyp
            out[f"x{i}"].append(xf)
            out[f"y{i}"].append(yf)
    return out


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    """Return one PNG chunk."""
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def write_png(path: Path, width: int, height: int, rgb: bytearray) -> None:
    """Write an 8-bit RGB PNG from packed pixels."""
    raw = bytearray()
    row_bytes = width * 3
    for y in range(height):
        raw.append(0)
        start = y * row_bytes
        raw.extend(rgb[start : start + row_bytes])
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    payload = (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _png_chunk(b"IEND", b"")
    )
    path.write_bytes(payload)


def _put(
    rgb: bytearray,
    width: int,
    x: int,
    y: int,
    color: tuple[int, int, int],
) -> None:
    """Set one pixel if it is inside the canvas."""
    if x < 0 or y < 0 or x >= width or y >= _SIZE:
        return
    i = (y * width + x) * 3
    rgb[i] = color[0]
    rgb[i + 1] = color[1]
    rgb[i + 2] = color[2]


def _line(
    rgb: bytearray,
    width: int,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    color: tuple[int, int, int],
) -> None:
    """Draw a Bresenham segment."""
    dx = abs(x1 - x0)
    dy = -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    x, y = x0, y0
    while True:
        _put(rgb, width, x, y, color)
        if x == x1 and y == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x += sx
        if e2 <= dx:
            err += dx
            y += sy


def _circle(
    rgb: bytearray,
    width: int,
    cx: int,
    cy: int,
    radius: int,
    color: tuple[int, int, int],
) -> None:
    """Draw a midpoint circle."""
    x = radius
    y = 0
    err = 1 - radius
    while x >= y:
        for px, py in (
            (cx + x, cy + y),
            (cx + y, cy + x),
            (cx - y, cy + x),
            (cx - x, cy + y),
            (cx - x, cy - y),
            (cx - y, cy - x),
            (cx + y, cy - x),
            (cx + x, cy - y),
        ):
            _put(rgb, width, px, py, color)
        y += 1
        if err < 0:
            err += 2 * y + 1
        else:
            x -= 1
            err += 2 * (y - x) + 1


def _draw_char(
    rgb: bytearray,
    width: int,
    ox: int,
    oy: int,
    ch: str,
    color: tuple[int, int, int],
) -> None:
    """Draw one 5x7 character."""
    rows = _GLYPHS.get(ch.upper(), _GLYPHS[" "])
    for row, line in enumerate(rows):
        for col in range(5):
            if line & (1 << col):
                _put(rgb, width, ox + col, oy + row, color)


def _draw_text(
    rgb: bytearray,
    width: int,
    ox: int,
    oy: int,
    text: str,
    color: tuple[int, int, int],
) -> None:
    """Draw a short label."""
    x = ox
    for ch in text:
        _draw_char(rgb, width, x, oy, ch, color)
        x += 6


def render_proof(
    path: Path,
    points: list[tuple[float, float]],
    stats: dict[str, float],
) -> None:
    """Draw all points, the AABB, and the enclosing circle."""
    rgb = bytearray(_BG * _SIZE * _SIZE)
    xmin = stats["xmin"]
    xmax = stats["xmax"]
    ymin = stats["ymin"]
    ymax = stats["ymax"]
    span = max(xmax - xmin, ymax - ymin, stats["r"] * 2.0)
    pad = span * _PAD
    left = (xmin + xmax) / 2.0 - span / 2.0 - pad
    top = (ymin + ymax) / 2.0 - span / 2.0 - pad
    scale = (_SIZE - 24) / (span + 2.0 * pad)

    def to_px(x: float, y: float) -> tuple[int, int]:
        return (
            int(round((x - left) * scale)) + 12,
            int(round((y - top) * scale)) + 12,
        )

    for x, y in points:
        px, py = to_px(x, y)
        for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
            _put(rgb, _SIZE, px + dx, py + dy, _DOT)
    x0, y0 = to_px(xmin, ymin)
    x1, y1 = to_px(xmax, ymax)
    _line(rgb, _SIZE, x0, y0, x1, y0, _BOX)
    _line(rgb, _SIZE, x1, y0, x1, y1, _BOX)
    _line(rgb, _SIZE, x1, y1, x0, y1, _BOX)
    _line(rgb, _SIZE, x0, y1, x0, y0, _BOX)
    cx, cy = to_px(stats["cx"], stats["cy"])
    pr = max(1, int(round(stats["r"] * scale)))
    _circle(rgb, _SIZE, cx, cy, pr, _RING)
    label = (
        f"N={int(stats['n_points'])} "
        f"CX={stats['cx']:.1f} CY={stats['cy']:.1f} "
        f"R={stats['r']:.1f}"
    )
    _draw_text(rgb, _SIZE, 8, 4, label, _TEXT)
    write_png(path, _SIZE, _SIZE, rgb)


def write_sidecar(path: Path, stats: dict[str, float]) -> None:
    """Write measured extents as JSON."""
    payload: dict[str, Any] = {
        "xmin": stats["xmin"],
        "xmax": stats["xmax"],
        "ymin": stats["ymin"],
        "ymax": stats["ymax"],
        "cx": stats["cx"],
        "cy": stats["cy"],
        "r": stats["r"],
        "n_points": int(stats["n_points"]),
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_hz_proofs(
    species: str,
    paths: list[list[tuple[float, float]]],
    out_dir: Path | None = None,
    label: str | None = None,
) -> tuple[float, float, float]:
    """Measure 10 Hz real tracks, write PNG/JSON, return (cx, cy, r).

    Call this **before** unit-disk normalize and **before** the HMM close.

    Each species is curated from more than one recording, and each is
    normalized on its own circle, so every pack needs its own proof rather
    than overwriting the last one's.

    Args:
        species: ``fly`` or ``fish``.
        paths: Per-identity 10 Hz polylines in pixel space.
        out_dir: Lesson ``data/`` by default.
        label: Names the proof files. Defaults to ``species``.

    Returns:
        Arena center and radius used to normalize ``paths``.
    """
    if species not in {"fly", "fish"}:
        raise ValueError(f"unknown species {species!r}")
    points = [xy for path in paths for xy in path]
    if not points:
        raise ValueError(f"no 10 Hz points for {species}")
    name = label if label is not None else species
    stats = measure(points)
    dest = out_dir if out_dir is not None else _PROOF_DIR
    dest.mkdir(parents=True, exist_ok=True)
    write_sidecar(dest / f"{name}_arena.json", stats)
    render_proof(dest / f"{name}_extent.png", points, stats)
    print(
        f"  {name}: {len(paths)} identities, "
        f"{int(stats['n_points'])} 10 Hz dots",
        flush=True,
    )
    return float(stats["cx"]), float(stats["cy"]), float(stats["r"])
