"""Stdlib locomotion HMM on (v_parallel, v_perpendicular).

Tao, L., Ozarkar, S., Beck, J. & Bhandawat, V. (2019). Statistical
structure of locomotion and its modulation by odors. eLife 8:e41235
model each step as velocity along the previous heading (v||) and the
perpendicular turn (v⊥). Their MATLAB
(https://github.com/bhandawat/HHMM) fits a hierarchical HMM; ``HMM.m``
updates and forward-backward decodes and does not sample paths.

This module stays in the stdlib. It bins those observables, counts
first-order transitions, and uses a **short** sampled walk only to
close each real 10 Hz track back to its first point.

Sources: NOTICE (Tao 2019; idtracker.ai).
"""

from __future__ import annotations

import csv
import math
import random
from pathlib import Path

_MAX_POINTS = 512
# eLife 107602: each benchmark video is 10 minutes; CSVs have no fps
# column. Infer recording fps as frame_count / 600 s.
PAPER_DURATION_S = 600.0
TARGET_HZ = 10.0
_N_BINS = 3
_MIN_STEPS = 256
_MAX_STEPS = 4000
_MIN_CLOSE_STEPS = 4
_MAX_CLOSE_STEPS = 80
_MIN_OBS = 24


def csv_n_frames(path: Path) -> int:
    """Return data-row count for an idtracker CSV."""
    with path.open(encoding="utf-8", newline="") as handle:
        return max(0, sum(1 for _ in handle) - 1)


def src_fps_for_frames(n_frames: int) -> float:
    """Infer fps from frame count over a 10-minute paper video.

    Args:
        n_frames: Rows in ``trajectories.csv`` (one per video frame).

    Returns:
        Frames per second so the pack lasts ``PAPER_DURATION_S``.
    """
    if n_frames < 1:
        raise ValueError("csv has no frames")
    return n_frames / PAPER_DURATION_S


def hz_sample_count(
    n_frames: int,
    hz: float = TARGET_HZ,
    src_fps: float | None = None,
) -> int:
    """Return how many samples equal ``hz`` over a ``src_fps`` recording."""
    if n_frames < 1:
        return _MAX_POINTS
    fps = src_fps if src_fps is not None else src_fps_for_frames(n_frames)
    return max(2, int(round(hz * n_frames / fps)))


def parse_idtracker_csv(path: Path) -> list[list[tuple[float, float]]]:
    """Load validated idtracker.ai ``xN,yN`` columns into per-id paths.

    Args:
        path: ``trajectories.csv`` from a ``validated_csv`` folder.

    Returns:
        One list of ``(x, y)`` samples per identity, in column order.
    """
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        header = next(reader)
    n_ids = len(header) // 2
    paths: list[list[tuple[float, float]]] = [[] for _ in range(n_ids)]
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            for i in range(n_ids):
                xs = row.get(f"x{i + 1}", "")
                ys = row.get(f"y{i + 1}", "")
                if not xs or not ys:
                    continue
                try:
                    x = float(xs)
                    y = float(ys)
                except ValueError:
                    continue
                if math.isnan(x) or math.isnan(y):
                    continue
                paths[i].append((x, y))
    return paths


def downsample(
    points: list[tuple[float, float]],
    max_points: int | None = None,
) -> list[tuple[float, float]]:
    """Keep real samples at ``TARGET_HZ`` (time stride from source fps).

    Args:
        points: Open polyline from idtracker.
        max_points: Unused; kept so old callers still import this name.

    Returns:
        About ``hz * duration`` vertices, including the last sample.
    """
    del max_points
    return decimate_hz(points, src_fps=src_fps_for_frames(len(points)))


def decimate_hz(
    points: list[tuple[float, float]],
    hz: float = TARGET_HZ,
    src_fps: float | None = None,
) -> list[tuple[float, float]]:
    """Take one sample every ``src_fps / hz`` frames."""
    if not points:
        return []
    fps = (
        src_fps
        if src_fps is not None
        else src_fps_for_frames(len(points))
    )
    stride = fps / hz
    if stride < 1:
        return list(points)
    out: list[tuple[float, float]] = []
    last_i = -1
    t = 0.0
    end = len(points) - 1
    while True:
        i = min(int(round(t)), end)
        if i != last_i:
            out.append(points[i])
            last_i = i
        if i >= end:
            break
        t += stride
    return out


def observables(
    points: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    """Return (v||, v⊥) for each step after the first heading.

    Args:
        points: Raw track samples.

    Returns:
        One pair per displacement that has a previous heading.
    """
    out: list[tuple[float, float]] = []
    if len(points) < 3:
        return out
    heading = math.atan2(
        points[1][1] - points[0][1],
        points[1][0] - points[0][0],
    )
    for i in range(1, len(points) - 1):
        dx = points[i + 1][0] - points[i][0]
        dy = points[i + 1][1] - points[i][1]
        ux = math.cos(heading)
        uy = math.sin(heading)
        v_par = dx * ux + dy * uy
        v_perp = -dx * uy + dy * ux
        out.append((v_par, v_perp))
        if dx * dx + dy * dy > 1e-18:
            heading = math.atan2(dy, dx)
    return out


def _quantile_edges(values: list[float], n_bins: int) -> list[float]:
    """Return interior quantile cuts for ``n_bins`` bins."""
    if not values or n_bins < 2:
        return []
    ordered = sorted(values)
    last = len(ordered) - 1
    return [ordered[round(last * k / n_bins)] for k in range(1, n_bins)]


def _bin_value(value: float, edges: list[float]) -> int:
    """Map a scalar onto ``len(edges) + 1`` bins."""
    for i, edge in enumerate(edges):
        if value < edge:
            return i
    return len(edges)


def _state_index(
    v_par: float,
    v_perp: float,
    par_edges: list[float],
    perp_edges: list[float],
    n_bins: int,
) -> int:
    """Pack two 1-D bins into one discrete state."""
    return (
        _bin_value(v_par, par_edges) * n_bins
        + _bin_value(v_perp, perp_edges)
    )


def _fit_hmm(
    obs: list[tuple[float, float]],
    n_bins: int = _N_BINS,
) -> tuple[
    list[float],
    list[list[float]],
    list[list[tuple[float, float]]],
]:
    """Fit a first-order HMM on binned (v||, v⊥) pairs.

    Args:
        obs: Empirical observables.
        n_bins: Quantile bins per axis.

    Returns:
        ``(pi0, A, bags)`` with Laplace-smoothed rows.
    """
    n_states = n_bins * n_bins
    par_edges = _quantile_edges([v[0] for v in obs], n_bins)
    perp_edges = _quantile_edges([v[1] for v in obs], n_bins)
    states = [
        _state_index(v[0], v[1], par_edges, perp_edges, n_bins)
        for v in obs
    ]
    bags: list[list[tuple[float, float]]] = [[] for _ in range(n_states)]
    for state, pair in zip(states, obs):
        bags[state].append(pair)
    counts = [[1.0] * n_states for _ in range(n_states)]
    start = [1.0] * n_states
    start[states[0]] += 1.0
    for prev, nxt in zip(states, states[1:]):
        counts[prev][nxt] += 1.0
    trans = []
    for row in counts:
        total = sum(row)
        trans.append([x / total for x in row])
    pi_total = sum(start)
    pi0 = [x / pi_total for x in start]
    return pi0, trans, bags


def _draw_index(weights: list[float], rng: random.Random) -> int:
    """Sample an index from a discrete distribution."""
    draw = rng.random() * sum(weights)
    acc = 0.0
    last = len(weights) - 1
    for i, weight in enumerate(weights):
        acc += weight
        if draw <= acc:
            return i
    return last


def _bbox_span(points: list[tuple[float, float]]) -> float:
    """Return the bounding-box diagonal length."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return math.hypot(max(xs) - min(xs), max(ys) - min(ys))


def append_hmm_close(
    points: list[tuple[float, float]],
    rng: random.Random,
) -> list[tuple[float, float]]:
    """Keep ``points`` and append a short HMM walk back to the start.

    Args:
        points: Real ``TARGET_HZ`` track (unit disk).
        rng: Seeded RNG.

    Returns:
        Real samples plus a short fictive close (last vertex is start
        when a close was added).
    """
    if not points:
        return [(0.0, 0.0)]
    if len(points) < 3:
        path = list(points)
        if path[-1] != path[0]:
            path.append(path[0])
        return path
    origin = points[0]
    x, y = points[-1]
    heading = math.atan2(
        points[-1][1] - points[-2][1],
        points[-1][0] - points[-2][0],
    )
    close_r = max(_bbox_span(points) * 0.06, 1e-3)
    close_r2 = close_r * close_r
    dist2 = (x - origin[0]) ** 2 + (y - origin[1]) ** 2
    out = list(points)
    obs = observables(points)
    if dist2 <= close_r2 or len(obs) < _MIN_OBS:
        if out[-1] != origin:
            out.append(origin)
        return out
    pi0, trans, bags = _fit_hmm(obs)
    all_obs = obs
    state = _draw_index(pi0, rng)
    for step in range(_MAX_CLOSE_STEPS):
        bag = bags[state] or all_obs
        v_par, v_perp = bag[rng.randrange(len(bag))]
        ux = math.cos(heading)
        uy = math.sin(heading)
        dx = v_par * ux - v_perp * uy
        dy = v_par * uy + v_perp * ux
        x += dx
        y += dy
        out.append((x, y))
        if dx * dx + dy * dy > 1e-18:
            heading = math.atan2(dy, dx)
        dist2 = (x - origin[0]) ** 2 + (y - origin[1]) ** 2
        if step + 1 >= _MIN_CLOSE_STEPS and dist2 <= close_r2:
            break
        state = _draw_index(trans[state], rng)
    if out[-1] != origin:
        out.append(origin)
    return out


def generate_fictive_trajectory(
    points: list[tuple[float, float]],
    rng: random.Random,
) -> list[tuple[float, float]]:
    """Decimate real samples to ``TARGET_HZ``, then HMM-close the loop.

    Args:
        points: Empirical identity track.
        rng: Seeded RNG for a reproducible close.

    Returns:
        Real 10 Hz samples plus a short fictive return to the start.
    """
    return append_hmm_close(
        decimate_hz(points, src_fps=src_fps_for_frames(len(points))),
        rng,
    )


def loop_identities(
    paths: list[list[tuple[float, float]]],
    seed: int = 201941235,
) -> list[dict]:
    """Build curated identity records: 10 Hz real samples plus a close.

    Args:
        paths: Raw per-id sample lists.
        seed: Base RNG seed; identity id is added.

    Returns:
        Dicts with ``id`` (1-based) and ``points`` ``[[x, y], ...]``.
    """
    records = []
    for i, path in enumerate(paths, start=1):
        rng = random.Random(seed + i)
        closed = generate_fictive_trajectory(path, rng)
        records.append(
            {
                "id": i,
                "points": [[round(x, 3), round(y, 3)] for x, y in closed],
            }
        )
    return records


def close_wide_table(
    paths: list[list[tuple[float, float]]],
    seed: int = 201941235,
    max_points: int | None = None,
) -> dict[str, list]:
    """HMM-close already-normalized 10 Hz tracks into a wide table.

    Args:
        paths: Per-id 10 Hz polylines on the unit disk.
        seed: Base RNG seed; identity id is added.
        max_points: Pad rows. Default is the longest closed identity.

    Returns:
        Column name to column values (floats or None after close).
    """
    n_ids = len(paths)
    columns = {f"x{i}": [] for i in range(1, n_ids + 1)}
    columns.update({f"y{i}": [] for i in range(1, n_ids + 1)})
    loops: list[list[tuple[float, float]]] = []
    for i, path in enumerate(paths, start=1):
        rng = random.Random(seed + i)
        loops.append(append_hmm_close(path, rng))
    if max_points is None:
        max_points = max((len(item) for item in loops), default=0)
    for row in range(max_points):
        for i, slim in enumerate(loops, start=1):
            if row < len(slim):
                x, y = slim[row]
                columns[f"x{i}"].append(round(x, 3))
                columns[f"y{i}"].append(round(y, 3))
            else:
                columns[f"x{i}"].append(None)
                columns[f"y{i}"].append(None)
    ordered: dict[str, list] = {}
    for i in range(1, n_ids + 1):
        ordered[f"x{i}"] = columns[f"x{i}"]
        ordered[f"y{i}"] = columns[f"y{i}"]
    return ordered


loop_wide_table = close_wide_table
