"""Stdlib locomotion HMM on (v_parallel, v_perpendicular).

Tao, L., Ozarkar, S., Beck, J. & Bhandawat, V. (2019). Statistical
structure of locomotion and its modulation by odors. eLife 8:e41235
model each step as velocity along the previous heading (v||) and the
perpendicular turn (v⊥). Their MATLAB
(https://github.com/bhandawat/HHMM) fits a hierarchical HMM; ``HMM.m``
updates and forward-backward decodes and does not sample paths.

This module stays in the stdlib. It bins those observables, counts
first-order transitions, and draws the *shape* of a bridge that closes
each real 10 Hz track back to its first point: the fitted distributions
set the waypoint spacing and the sideways meander, while the bridge's
overall length and pace come from the track's own endpoints.

The empirical step magnitudes cannot span the gap on their own. A fly's
median step is about 0.0007 on the unit disk, against closing gaps of
0.7 to 1.8, so a walk that only draws real steps would need thousands of
them. That is why the fitted model shapes the bridge rather than
generating it outright.

Sources: NOTICE (Tao 2019; idtracker.ai).
"""

from __future__ import annotations

import csv
import math
import random
import statistics
from pathlib import Path

_MAX_POINTS = 512
# eLife 107602: each benchmark video is 10 minutes; CSVs have no fps
# column. Infer recording fps as frame_count / 600 s.
PAPER_DURATION_S = 600.0
TARGET_HZ = 10.0
_N_BINS = 3
_MIN_STEPS = 256
_MIN_OBS = 24

# Bridge shape. The waypoint count and the lateral amplitude were chosen
# from rendered figures rather than from a metric: see
# .claude/workspace/plans/2026-09-25-track-bridge.md.
_BRIDGE_WAYPOINTS = 12
_BRIDGE_LATERAL = 0.30
_BRIDGE_END_TANGENT = 0.5
_BRIDGE_TANGENT_CAP = 1.2
_BRIDGE_SEGMENT_SAMPLES = 80
_BRIDGE_FIT_TRIES = 5
# Sample intervals held straight at each end of the bridge, so the seam
# is arrived at and left along the real heading.
_BRIDGE_LEAD_STEPS = 4.0
# An endpoint slower than this share of the animal's own median moving
# speed is treated as resting, so the bridge is paced at that median
# instead of crawling for minutes.
_IDLE_FRAC = 0.5
# Decimals kept for curated coordinates. A fly's median step is 0.0007,
# so 3 decimals rounded 38% of its samples into exact repeats.
_DECIMALS = 5


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


def _bbox_span(points: list[tuple[float, float]]) -> float:
    """Return the bounding-box diagonal length."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return math.hypot(max(xs) - min(xs), max(ys) - min(ys))


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Return the distance between two points."""
    return math.hypot(b[0] - a[0], b[1] - a[1])


def _unit(vec: tuple[float, float]) -> tuple[float, float]:
    """Return ``vec`` scaled to unit length, or zero if it is degenerate."""
    norm = math.hypot(vec[0], vec[1])
    if norm < 1e-12:
        return (0.0, 0.0)
    return (vec[0] / norm, vec[1] / norm)


def _lerp(
    a: tuple[float, float],
    b: tuple[float, float],
    t: float,
) -> tuple[float, float]:
    """Blend two points; ``t`` runs from 0 to 1."""
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _hermite(
    p0: tuple[float, float],
    m0: tuple[float, float],
    p1: tuple[float, float],
    m1: tuple[float, float],
    t: float,
) -> tuple[float, float]:
    """Evaluate a cubic Hermite segment at ``t``."""
    t2 = t * t
    t3 = t2 * t
    h00 = 2 * t3 - 3 * t2 + 1
    h10 = t3 - 2 * t2 + t
    h01 = -2 * t3 + 3 * t2
    h11 = t3 - t2
    return (
        h00 * p0[0] + h10 * m0[0] + h01 * p1[0] + h11 * m1[0],
        h00 * p0[1] + h10 * m0[1] + h01 * p1[1] + h11 * m1[1],
    )


def _bridge_speeds(points: list[tuple[float, float]]) -> tuple[float, float]:
    """Return the speeds to ramp between at the two ends of a bridge.

    Args:
        points: Real ``TARGET_HZ`` track (unit disk).

    Returns:
        ``(v_end, v_start)`` in unit-disk units per second. An endpoint
        resting below ``_IDLE_FRAC`` of the track's own median moving
        speed is lifted to that median, so a bridge never crawls.
    """
    speeds = [
        _dist(points[i], points[i + 1]) * TARGET_HZ
        for i in range(len(points) - 1)
    ]
    moving = [s for s in speeds if s > 1e-9]
    typical = statistics.median(moving) if moving else 0.01
    v_end = speeds[-1] if speeds else 0.0
    v_start = speeds[0] if speeds else 0.0
    if v_end < _IDLE_FRAC * typical:
        v_end = typical
    if v_start < _IDLE_FRAC * typical:
        v_start = typical
    return v_end, v_start


def _draw_bridge_shape(
    points: list[tuple[float, float]],
    rng: random.Random,
    k: int,
) -> tuple[list[float], list[float]]:
    """Draw the waypoint fractions and the sideways meander of a bridge.

    Only the *shape* comes from the fitted model: how long the animal's
    strides are relative to one another, and which way it favours
    turning. The scale comes from the gap, since empirical magnitudes
    cannot span it.

    Args:
        points: Real ``TARGET_HZ`` track (unit disk).
        rng: Seeded RNG.
        k: Interior waypoints to place.

    Returns:
        ``(fracs, meander)`` with ``k + 2`` fractions running from 0 to
        1, and ``k`` meander values normalised to at most 1.
    """
    lengths = [1.0] * (k + 1)
    perp = [0.0] * (k + 1)
    obs = observables(points)
    if len(obs) >= _MIN_OBS:
        _, _, bags = _fit_hmm(obs)
        flat = [pair for bag in bags for pair in bag]
        moving = [math.hypot(v[0], v[1]) for v in flat]
        moving = [m for m in moving if m > 1e-9]
        if len(moving) >= 4:
            low = min(moving)
            lengths = [max(rng.choice(moving), low) for _ in range(k + 1)]
            perp = [rng.choice(flat)[1] for _ in range(k + 1)]
    # The fitted magnitudes are heavy-tailed, so a raw draw can put two
    # waypoints on top of each other and blow the tangents up.
    floor = 0.4 / (k + 1)
    total = sum(lengths) or 1.0
    weights = [max(value / total, floor) for value in lengths]
    total = sum(weights) or 1.0
    fracs = [0.0]
    acc = 0.0
    for weight in weights:
        acc += weight / total
        fracs.append(acc)
    fracs[-1] = 1.0
    # A cumulative walk, not independent draws, so the animal wanders
    # rather than zigzagging.
    meander = []
    acc = 0.0
    for j in range(1, k + 1):
        acc += perp[j]
        meander.append(acc)
    peak = max((abs(m) for m in meander), default=0.0)
    if peak > 1e-12:
        meander = [m / peak for m in meander]
    return fracs, meander


def _bounce_inside(ctrl: list[tuple[float, float]]) -> None:
    """Mirror interior control points that left the unit disk back in.

    A reflection off the wall reverses the radial part of the step, which
    maps a radius of ``r`` onto ``2 - r``. The animal therefore turns at
    the rim rather than the bridge being reshaped to stay off it. Seven
    flies and five fish need this; without it the fit guard has to blunt
    the meander and the heading blend instead.
    """
    for i in range(1, len(ctrl) - 1):
        x, y = ctrl[i]
        radius = math.hypot(x, y)
        if radius > 1.0:
            scale = max(0.0, 2.0 - radius) / radius
            ctrl[i] = (x * scale, y * scale)


def _align_end(
    ctrl: list[tuple[float, float]],
    fixed: int,
    moved: int,
    direction: tuple[float, float],
    min_reach: float,
    blend: float,
) -> None:
    """Turn one control point toward ``direction`` from ``fixed``.

    Keeps the distance between the two, so the segment's length is
    unchanged and only its bearing moves. ``min_reach`` stretches that
    segment when it would otherwise be shorter than the samples landing
    in it, which would let the join reach back into the curved part of
    the bridge and put a bend at the seam. ``blend`` mixes the result
    back toward where the meander put it: turning toward the heading can
    push a waypoint past the rim when the track runs along it, and this
    is what the caller gives up when the bridge will not fit.
    """
    if direction == (0.0, 0.0) or blend <= 0.0:
        return
    base = ctrl[moved]
    reach = max(_dist(ctrl[fixed], base), min_reach)
    target = (
        ctrl[fixed][0] + direction[0] * reach,
        ctrl[fixed][1] + direction[1] * reach,
    )
    ctrl[moved] = _lerp(base, target, blend)


def _bridge_control(
    points: list[tuple[float, float]],
    fracs: list[float],
    meander: list[float],
    lateral: float,
    v_end: float,
    v_start: float,
    blend: float,
) -> tuple[list[tuple[float, float]], float, tuple[float, float], tuple]:
    """Build the control points of a bridge.

    Args:
        points: Real ``TARGET_HZ`` track (unit disk).
        fracs: Waypoint fractions, from 0 to 1.
        meander: Normalised sideways offsets for the interior points.
        lateral: Peak sideways offset, as a fraction of the gap.
        v_end: Speed to leave the real track at.
        v_start: Speed to arrive at its first sample at.
        blend: How far to turn the end segments onto the headings, 0 to 1.

    Returns:
        ``(ctrl, gap, end_dir, start_dir)``, where ``ctrl`` runs from the
        last real sample to the first, and the two directions are the
        real track's headings at those ends.
    """
    start = points[0]
    end = points[-1]
    chord = (start[0] - end[0], start[1] - end[1])
    gap = math.hypot(chord[0], chord[1])
    along = _unit(chord)
    across = (-along[1], along[0])
    end_dir = _unit((end[0] - points[-2][0], end[1] - points[-2][1]))
    start_dir = _unit((points[1][0] - start[0], points[1][1] - start[1]))
    ctrl = [end]
    for j in range(1, len(fracs) - 1):
        f = fracs[j]
        wobble = math.sin(math.pi * f)
        offset = meander[j - 1] * gap * lateral * wobble
        ctrl.append((
            end[0] + chord[0] * f + across[0] * offset,
            end[1] + chord[1] * f + across[1] * offset,
        ))
    ctrl.append(start)
    # Leave and arrive along the headings the real track actually has, at
    # the same distance the meander first put those waypoints at. Without
    # this the first and last segments approach on the chord's direction
    # while the tangents point elsewhere, and the curve has to turn
    # sharply inside the final sample interval to reconcile the two.
    if len(ctrl) > 2:
        # The bridge travels ctrl[0] -> ctrl[1], so ctrl[1] goes ahead of
        # the end along the heading. It travels ctrl[-2] -> ctrl[-1], so
        # ctrl[-2] goes *behind* the start along the heading instead. Each
        # end segment is kept at least a few sample intervals long.
        _align_end(
            ctrl, 0, 1, end_dir,
            v_end * _BRIDGE_LEAD_STEPS / TARGET_HZ, blend,
        )
        _align_end(
            ctrl, -1, -2, (-start_dir[0], -start_dir[1]),
            v_start * _BRIDGE_LEAD_STEPS / TARGET_HZ, blend,
        )
    _bounce_inside(ctrl)
    return ctrl, gap, end_dir, start_dir


def _bridge_tangents(
    ctrl: list[tuple[float, float]],
    fracs: list[float],
    end_dir: tuple[float, float],
    start_dir: tuple[float, float],
    gap: float,
) -> list[tuple[float, float]]:
    """Return a tangent per control point.

    The endpoints inherit the real track's own heading; the interior
    uses non-uniform Catmull-Rom. Every tangent is capped to a multiple
    of the chord rate, because crowded waypoints otherwise make the
    curve swing far past the chord and loop.
    """
    n = len(ctrl)
    tangents = [(0.0, 0.0)] * n
    span0 = max(fracs[1] - fracs[0], 1e-6)
    span_n = max(fracs[-1] - fracs[-2], 1e-6)
    scale = _BRIDGE_END_TANGENT * _dist(ctrl[0], ctrl[1]) / span0
    tangents[0] = (end_dir[0] * scale, end_dir[1] * scale)
    scale = _BRIDGE_END_TANGENT * _dist(ctrl[-1], ctrl[-2]) / span_n
    tangents[-1] = (start_dir[0] * scale, start_dir[1] * scale)
    for j in range(1, n - 1):
        h_prev = max(fracs[j] - fracs[j - 1], 1e-6)
        h_next = max(fracs[j + 1] - fracs[j], 1e-6)
        d_prev = (
            (ctrl[j][0] - ctrl[j - 1][0]) / h_prev,
            (ctrl[j][1] - ctrl[j - 1][1]) / h_prev,
        )
        d_next = (
            (ctrl[j + 1][0] - ctrl[j][0]) / h_next,
            (ctrl[j + 1][1] - ctrl[j][1]) / h_next,
        )
        tangents[j] = (
            (d_prev[0] * h_next + d_next[0] * h_prev) / (h_prev + h_next),
            (d_prev[1] * h_next + d_next[1] * h_prev) / (h_prev + h_next),
        )
    cap = _BRIDGE_TANGENT_CAP * max(gap, 1e-6)
    capped: list[tuple[float, float]] = []
    for m in tangents:
        mag = math.hypot(m[0], m[1])
        if mag > cap:
            capped.append((m[0] * cap / mag, m[1] * cap / mag))
        else:
            capped.append(m)
    return capped


def _bridge_polyline(
    ctrl: list[tuple[float, float]],
    tangents: list[tuple[float, float]],
    fracs: list[float],
) -> list[tuple[float, float]]:
    """Sample the Hermite segments into a dense polyline."""
    dense: list[tuple[float, float]] = []
    for j in range(len(ctrl) - 1):
        h = fracs[j + 1] - fracs[j]
        m0 = (tangents[j][0] * h, tangents[j][1] * h)
        m1 = (tangents[j + 1][0] * h, tangents[j + 1][1] * h)
        for step in range(_BRIDGE_SEGMENT_SAMPLES):
            t = step / _BRIDGE_SEGMENT_SAMPLES
            dense.append(_hermite(ctrl[j], m0, ctrl[j + 1], m1, t))
    dense.append(ctrl[-1])
    return dense


def _sample_by_arclength(
    dense: list[tuple[float, float]],
    v_end: float,
    v_start: float,
) -> list[tuple[float, float]]:
    """Place samples along ``dense`` at a speed ramping end to start.

    The speed rises or falls linearly from ``v_end`` to ``v_start`` over
    the bridge, so its duration follows from the arc length rather than
    being fixed. The first and last samples land on the polyline's own
    ends.
    """
    lengths = [0.0]
    for i in range(1, len(dense)):
        lengths.append(lengths[-1] + _dist(dense[i - 1], dense[i]))
    total = lengths[-1]
    if total <= 0.0:
        return [dense[-1]]
    mean_v = (v_end + v_start) / 2.0
    if mean_v <= 0.0:
        mean_v = 1e-6
    duration = total / mean_v
    n = max(2, int(round(duration * TARGET_HZ)))
    out: list[tuple[float, float]] = []
    cursor = 0
    for i in range(n + 1):
        t = duration * i / n
        ramp = v_end * t + (v_start - v_end) * t * t / (2.0 * duration)
        ramp = min(max(ramp, 0.0), total)
        while cursor < len(lengths) - 2 and lengths[cursor + 1] < ramp:
            cursor += 1
        span = lengths[cursor + 1] - lengths[cursor]
        u = 0.0 if span <= 0.0 else (ramp - lengths[cursor]) / span
        out.append(_lerp(dense[cursor], dense[cursor + 1], u))
    out[-1] = dense[-1]
    return out


def _bridge(
    points: list[tuple[float, float]],
    rng: random.Random,
    lateral: float,
    blend: float = 1.0,
) -> list[tuple[float, float]]:
    """Return bridge samples from the last real sample to the first."""
    k = _BRIDGE_WAYPOINTS
    v_end, v_start = _bridge_speeds(points)
    fracs, meander = _draw_bridge_shape(points, rng, k)
    ctrl, gap, end_dir, start_dir = _bridge_control(
        points, fracs, meander, lateral, v_end, v_start, blend
    )
    tangents = _bridge_tangents(ctrl, fracs, end_dir, start_dir, gap)
    dense = _bridge_polyline(ctrl, tangents, fracs)
    return _sample_by_arclength(dense, v_end, v_start)


def append_hmm_close(
    points: list[tuple[float, float]],
    rng: random.Random,
) -> list[tuple[float, float]]:
    """Keep ``points`` and append a bridge back to the first sample.

    Args:
        points: Real ``TARGET_HZ`` track (unit disk).
        rng: Seeded RNG.

    Returns:
        Real samples plus a bridge; the last vertex is the start.
    """
    if not points:
        return [(0.0, 0.0)]
    if len(points) < 3:
        path = list(points)
        if path[-1] != path[0]:
            path.append(path[0])
        return path
    origin = points[0]
    close_r = max(_bbox_span(points) * 0.06, 1e-3)
    gap = _dist(points[-1], origin)
    out = list(points)
    if gap <= close_r or len(observables(points)) < _MIN_OBS:
        if out[-1] != origin:
            out.append(origin)
        return out
    # The piece frames the animals by the unit disk, and the caller
    # clips to it, which would flatten a bridge that strayed outside
    # onto the rim. Shrink the meander and give up the heading blend
    # until the bridge fits. At blend 0 the bridge is the meander alone,
    # which stays inside; the trade is a blunter join.
    lateral = _BRIDGE_LATERAL
    blend = 1.0
    bridge = _bridge(points, rng, lateral, blend)
    for _ in range(_BRIDGE_FIT_TRIES - 1):
        if all(math.hypot(p[0], p[1]) <= 1.0 for p in bridge):
            break
        lateral /= 2.0
        blend /= 2.0
        bridge = _bridge(points, rng, lateral, blend)
    out.extend(bridge[1:])
    if out[-1] != origin:
        out.append(origin)
    return out


def generate_fictive_trajectory(
    points: list[tuple[float, float]],
    rng: random.Random,
) -> list[tuple[float, float]]:
    """Decimate real samples to ``TARGET_HZ``, then close the loop.

    Args:
        points: Empirical identity track.
        rng: Seeded RNG for a reproducible close.

    Returns:
        Real 10 Hz samples plus a bridge back to the start.
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
                "points": [
                    [round(x, _DECIMALS), round(y, _DECIMALS)]
                    for x, y in closed
                ],
            }
        )
    return records


def close_wide_table(
    paths: list[list[tuple[float, float]]],
    seed: int = 201941235,
    max_points: int | None = None,
) -> dict[str, list]:
    """Close already-normalized 10 Hz tracks into a wide table.

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
                columns[f"x{i}"].append(round(x, _DECIMALS))
                columns[f"y{i}"].append(round(y, _DECIMALS))
            else:
                columns[f"x{i}"].append(None)
                columns[f"y{i}"].append(None)
    ordered: dict[str, list] = {}
    for i in range(1, n_ids + 1):
        ordered[f"x{i}"] = columns[f"x{i}"]
        ordered[f"y{i}"] = columns[f"y{i}"]
    return ordered


loop_wide_table = close_wide_table
