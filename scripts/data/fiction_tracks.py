"""Generate fictional animal tracks from the fitted locomotion model.

Parts: NOTICE (Tao 2019; idtracker.ai), and the archived track-bridge plan.

Each fictional animal is fitted from **one** curated animal's own recorded
track and then walked from that fit. Nothing is pooled across animals: the
step-magnitude spread, the turning, the radius preference and the radial
restoring force all come from the individual being imitated, so a generated
animal inherits its source's character rather than an average of the pool.

The magnitude and the turn each carry their own memory, because a
first-order chain over binned values cannot hold it. Measured on the fly
pack, the step-magnitude autocorrelation is 0.748 at lag 1 and still 0.208
at lag 30, while a chain over 10 bins manages 0.593 and 0.010, and a
second-order chain does no better. Both are therefore drawn through a
two-factor latent and mapped back through their own empirical quantile
function, which leaves the distribution exact and puts the persistence
back.

Sources: NOTICE (Tao 2019; idtracker.ai).
"""

from __future__ import annotations

import math
import random
import statistics
from pathlib import Path

from arena_extent import measure, paths_to_unit
from locomotion_hmm import (
    _MIN_OBS,
    _unit,
    csv_n_frames,
    decimate_hz,
    observables,
    parse_idtracker_csv,
    src_fps_for_frames,
)
from mobility import select

_REPO = Path(__file__).resolve().parents[2]
SEED = 20260926
# Matches MAX_ANIMALS in app/view.js and _TARGET in curate_flies.py.
TARGET = 100
# The two recordings each species is curated from.
_PACKS = {
    "fly": ("flies", ("trajectories.csv", "trajectories_b.csv")),
    "fish": ("fish", ("trajectories.csv", "trajectories_b.csv")),
}
# Radius bins for the empirical radial drift. Twenty gives a bin width of
# 0.05, which is a few median fish steps and many fly steps.
_DRIFT_BINS = 20
# Share of a real track's samples allowed beyond each end when picking the
# radius the restoring force starts at.
_TAIL_FRAC = 0.01
# Magnitude bins the turn is conditioned on, and the shortest series worth
# fitting the magnitude dynamics to.
_TURN_BINS = 8
_MIN_FIT = 64
# Radius bands the turn is conditioned on, and the fewest samples a cell
# needs before it is used. The outer band is the whole point: it is where
# the real animal turns away from the wall, and it holds few samples
# precisely because the animal rarely goes there.
_RADIUS_BINS = 5
_MIN_CELL = 32
# Ceiling on a fitted per-step retention, so a single-factor fit taken from
# a lag-1 value at or near 1 stays a strictly stable process.
_MAX_MU = 0.999


def _bin_index(value: float, edges: list[float]) -> int:
    """Return the bin index for ``value`` against interior ``edges``."""
    index = 0
    while index < len(edges) and value >= edges[index]:
        index += 1
    return index


def load_curated(species: str) -> list[list[tuple[float, float]]]:
    """Load the curated pool: both packs, normalized, ranked to 100.

    The curated parquet holds each body with its closing bridge already
    appended, and a generated animal must be fitted to the recorded motion
    alone. So the selection is repeated from the raw packs rather than
    sliced out of the parquet, which also keeps this module independent of
    how the bridge is built.

    Args:
        species: ``fly`` or ``fish``.

    Returns:
        One unit-disk polyline per curated animal, most mobile first.

    Raises:
        FileNotFoundError: If a raw pack is missing.
    """
    folder, names = _PACKS[species]
    pool: list[list[tuple[float, float]]] = []
    for name in names:
        src = _REPO / "data" / "raw" / folder / name
        if not src.is_file():
            raise FileNotFoundError(f"raw pack missing: {src}")
        # Each pack carries its own frame count and decimates at its own
        # rate; see scripts/data/curate_flies.py.
        src_fps = src_fps_for_frames(csv_n_frames(src))
        hz_paths = [
            decimate_hz(path, src_fps=src_fps)
            for path in parse_idtracker_csv(src)
        ]
        # Normalized on its own arena circle, matching the curation.
        arena = measure([point for path in hz_paths for point in path])
        pool.extend(
            paths_to_unit(hz_paths, arena["cx"], arena["cy"], arena["r"])
        )
    return [pool[index] for index in select(pool, TARGET)]


def _fit_two_factor(scores: list[float], tail_lag: int = 25) -> dict:
    """Split a series into a slow AR(1) plus an essentially white part.

    The real step-magnitude autocorrelation does not decay at one rate.
    Measured over the fly pack it is 0.748 at lag 1, 0.642 at lag 2, and
    still 0.208 at lag 30. A single AR(1) through the first point decays
    to nothing long before that; one through the last starts far too
    high. Two components fit both ends.

    Args:
        scores: The series to fit, on normal scores.
        tail_lag: The lag whose autocorrelation pins the slow rate.

    Returns:
        ``mu``, the slow component's per-step retention, and ``weight``,
        the share of variance carried by the fast part. ``None`` only when
        there is no positive lag-1 autocorrelation to fit at all.
    """
    mean = statistics.mean(scores)
    centred = [value - mean for value in scores]
    variance = statistics.pvariance(scores) or 1.0

    def autocorr(lag):
        pairs = [
            centred[i] * centred[i + lag]
            for i in range(len(centred) - lag)
        ]
        return statistics.mean(pairs) / variance if pairs else 0.0

    near = autocorr(1)
    far = autocorr(tail_lag)
    if near <= 1e-6:
        return None
    # A single AR(1) through lag 1, used whenever the tail is at or below
    # noise. That is not rare and it is not a defect: one curated fish
    # measures +0.3817 at lag 1 and -0.0025 at lag 25, so it has real
    # short-lag memory and no second timescale to find. Rejecting the
    # series there would discard a measured correlation, and a white
    # latent would throw away the short-lag memory as well.
    single = {"mu": min(near, _MAX_MU), "weight": 0.0}
    if far <= 1e-6 or far >= near:
        return single
    # near = (1 - w) * mu   and   far = (1 - w) * mu ** tail_lag
    mu = (far / near) ** (1.0 / (tail_lag - 1))
    slow_share = near / mu
    if not 0.0 < mu < 1.0 or not 0.0 < slow_share < 1.0:
        return single
    return {"mu": mu, "weight": 1.0 - slow_share}


def _normal_scores(values: list[float], normal) -> list[float]:
    """Return the normal scores of ``values``, in their original order.

    Rank-transforming first is what lets the two-factor fit describe the
    persistence without being dragged around by a heavy tail: the series
    becomes roughly Gaussian whatever its shape, and the quantile map in
    the walk puts the original shape back afterwards.
    """
    order = sorted(range(len(values)), key=lambda i: values[i])
    scores = [0.0] * len(values)
    for rank, index in enumerate(order):
        scores[index] = normal.inv_cdf((rank + 0.5) / len(values))
    return scores


def fit_step_model(real_unit: list[tuple[float, float]]) -> dict:
    """Fit a step model: magnitude and turn, each with its own memory.

    The magnitude is the part a quantised model cannot carry. Binning it
    destroys its memory: a chain over 10 magnitude bins reaches 0.593 at
    lag 1 and 0.010 at lag 30 against a real 0.748 and 0.208, and a
    *second-order* chain is no better. So the magnitude keeps its full
    empirical spread here, drawn through the two-factor latent above.

    The turn needs the same treatment for the same reason. Drawn
    independently each step it carries the right distribution and no
    persistence at all, and the measured ``|turn|`` autocorrelation is
    0.353 at lag 1 falling to 0.071 at lag 30, which is the same
    two-timescale shape. The turn is therefore drawn by indexing its bag
    at a latent share rather than by picking a member at random, which
    leaves the distribution untouched and gives the sequence the fitted
    memory.

    The turn is also conditioned on the radius the animal is turning
    from, which is what keeps a generated walk off the wall. Nothing else
    does: the step model has no idea where it is, so a reflecting rim just
    accumulates mass against it, and a generated walk ends up with far too
    little of its time in the middle of the arena. The real animal turns
    away from the wall, and that bias is measurable in its own outer
    samples, so taking the turn from the matching radius band puts it back.

    Args:
        real_unit: The real 10 Hz unit-disk track to fit.

    Returns:
        The sorted ``sizes`` and ``flat_turns``; ``turn_bags``, indexed by
        magnitude bin then radius band; ``mag_turns``, the magnitude
        marginal used when a cell is too thin; ``edges`` and
        ``radius_edges``; and two ``mu``/``weight`` pairs -- for the
        magnitude, then ``turn_mu``/``turn_weight``. ``None`` if the track
        is too short to fit.
    """
    observed = observables(real_unit)
    if len(observed) < _MIN_OBS:
        return None
    magnitudes = [math.hypot(pair[0], pair[1]) for pair in observed]
    turns = [math.atan2(pair[1], pair[0]) for pair in observed]
    # ``observables`` returns one pair per step starting at ``points[i]``
    # for i from 1, so the radius that conditions a turn is the one the
    # animal turned *from*, not the one it arrived at.
    radii = [
        math.hypot(*real_unit[i + 1]) for i in range(1, len(real_unit) - 1)
    ]
    alive = [
        (size, turn, radius)
        for size, turn, radius in zip(magnitudes, turns, radii)
        if size > 1e-12
    ]
    if len(alive) < _MIN_FIT:
        return None
    normal = statistics.NormalDist()
    sizes = sorted(size for size, _, _ in alive)
    factors = _fit_two_factor(
        _normal_scores([size for size, _, _ in alive], normal)
    )
    if factors is None:
        return None
    # A turn series with no positive autocorrelation to fit falls back to a
    # white latent, which copies its bag at random and so reproduces the
    # behaviour this model had before the memory was added.
    turn_scores = _normal_scores([turn for _, turn, _ in alive], normal)
    turn_factors = _fit_two_factor(turn_scores)
    if turn_factors is None:
        turn_factors = {"mu": 0.0, "weight": 1.0}
    last = len(sizes) - 1
    edges = [sizes[round(last * k / _TURN_BINS)] for k in range(1, _TURN_BINS)]
    ordered = sorted(radius for _, _, radius in alive)
    last_radius = len(ordered) - 1
    radius_edges = [
        ordered[round(last_radius * k / _RADIUS_BINS)]
        for k in range(1, _RADIUS_BINS)
    ]
    turn_bags: list[list[list[float]]] = [
        [[] for _ in range(_RADIUS_BINS)] for _ in range(_TURN_BINS)
    ]
    radius_turns: list[list[float]] = [[] for _ in range(_RADIUS_BINS)]
    mag_turns: list[list[float]] = [[] for _ in range(_TURN_BINS)]
    for size, turn, radius in alive:
        band = _bin_index(size, edges)
        reach = _bin_index(radius, radius_edges)
        turn_bags[band][reach].append(turn)
        radius_turns[reach].append(turn)
        mag_turns[band].append(turn)
    # Sorted, because the walk indexes these by share rather than choosing
    # a member: that is what lets the marginal stay exact while the order
    # carries the memory.
    for row in turn_bags:
        for bag in row:
            bag.sort()
    for bag in radius_turns:
        bag.sort()
    for bag in mag_turns:
        bag.sort()
    return {
        "sizes": sizes,
        "flat_turns": sorted(turn for _, turn, _ in alive),
        "turn_bags": turn_bags,
        "radius_turns": radius_turns,
        "mag_turns": mag_turns,
        "edges": edges,
        "radius_edges": radius_edges,
        "mu": factors["mu"],
        "weight": factors["weight"],
        "turn_mu": turn_factors["mu"],
        "turn_weight": turn_factors["weight"],
    }


def fit_radial_drift(
    real_unit: list[tuple[float, float]],
    n_bins: int = _DRIFT_BINS,
) -> list[float | None]:
    """Return the mean radial step per radius bin for one real track.

    The ``(v_parallel, v_perp)`` model carries no dependence on where the
    animal is, so a walk built from it has no restoring force and drifts
    until it meets the wall. The real animal does have one, and this is
    it: the average change in radius, conditioned on the current radius.

    Args:
        real_unit: The real 10 Hz unit-disk track.
        n_bins: Radius bins across ``[0, 1]``.

    Returns:
        One mean radial step per bin; ``None`` where the track never goes.
    """
    sums = [0.0] * n_bins
    counts = [0] * n_bins
    for i in range(len(real_unit) - 1):
        before = math.hypot(*real_unit[i])
        after = math.hypot(*real_unit[i + 1])
        index = min(n_bins - 1, max(0, int(before * n_bins)))
        sums[index] += after - before
        counts[index] += 1
    return [
        sums[i] / counts[i] if counts[i] else None for i in range(n_bins)
    ]


def fit_radial_range(
    real_unit: list[tuple[float, float]],
    frac: float = _TAIL_FRAC,
) -> tuple[float, float]:
    """Return the low and high radius the real track keeps to.

    Args:
        real_unit: The real 10 Hz unit-disk track.
        frac: Share of samples allowed to fall outside each end.

    Returns:
        The ``frac`` and ``1 - frac`` quantiles of the sample radii.
    """
    radii = sorted(math.hypot(x, y) for x, y in real_unit)
    last = len(radii) - 1
    return radii[int(last * frac)], radii[int(last * (1.0 - frac))]


def _drift_at(
    drift: list[float | None],
    radius: float,
) -> float:
    """Return the mean radial step at ``radius``, seeking a neighbour bin.

    The outer bins are the important ones: the real animal may never go
    beyond radius ``(n - 1) / n``, but the walk can, and returning zero
    there would leave it with no restoring force exactly where it needs
    one most. Searching outward inherits the strongest inward pull the
    animal actually shows.
    """
    n_bins = len(drift)
    index = min(n_bins - 1, max(0, int(radius * n_bins)))
    if drift[index] is not None:
        return drift[index]
    for offset in range(1, n_bins):
        for candidate in (index - offset, index + offset):
            if 0 <= candidate < n_bins and drift[candidate] is not None:
                return drift[candidate]
    return 0.0


def draw_walk(
    real_unit: list[tuple[float, float]],
    rng: random.Random,
    n_steps: int,
) -> dict:
    """Generate one fictional track from a real track's fitted model.

    Args:
        real_unit: The real 10 Hz unit-disk track to fit and imitate.
        rng: Seeded RNG.
        n_steps: Body samples to generate, excluding the closing bridge.

    Returns:
        ``points``, the generated body, plus the ``bounces``,
        ``dead_steps``, ``drifts`` and ``thin_cells`` counters.
    """
    model = fit_step_model(real_unit)
    if model is None:
        raise ValueError("track too short to fit a step model")
    sizes = model["sizes"]
    flat_turns = model["flat_turns"]
    turn_bags = model["turn_bags"]
    radius_turns = model["radius_turns"]
    mag_turns = model["mag_turns"]
    edges = model["edges"]
    radius_edges = model["radius_edges"]
    mu = model["mu"]
    weight = model["weight"]
    turn_mu = model["turn_mu"]
    turn_weight = model["turn_weight"]
    normal = statistics.NormalDist()
    slow = rng.gauss(0.0, 1.0)
    turn_slow = rng.gauss(0.0, 1.0)
    drift = fit_radial_drift(real_unit)
    r_low, r_high = fit_radial_range(real_unit)
    start = rng.choice(real_unit)
    heading = rng.uniform(0.0, 2.0 * math.pi)
    unit = (math.cos(heading), math.sin(heading))
    points = [start]
    bounces = 0
    dead_steps = 0
    drifts = 0
    thin_cells = 0
    for _ in range(n_steps):
        # The latent carries the memory; the quantile map below turns it
        # back into a magnitude with exactly the animal's own spread, so
        # nothing about the step size is binned or resampled.
        slow = mu * slow + math.sqrt(1.0 - mu * mu) * rng.gauss(0.0, 1.0)
        latent = math.sqrt(1.0 - weight) * slow
        latent += math.sqrt(weight) * rng.gauss(0.0, 1.0)
        share = normal.cdf(latent)
        index = min(len(sizes) - 1, max(0, int(share * len(sizes))))
        size = sizes[index]
        here = points[-1]
        band = _bin_index(size, edges)
        reach = _bin_index(math.hypot(here[0], here[1]), radius_edges)
        turn_bag = turn_bags[band][reach]
        if len(turn_bag) < _MIN_CELL:
            thin_cells += 1
            # Fall back on the radius band before the magnitude band. The
            # radius is what carries the wall bias, so it is the last thing
            # to give up; the magnitude marginal would throw it away at
            # exactly the radius where it matters most.
            turn_bag = radius_turns[reach]
        if len(turn_bag) < _MIN_CELL:
            turn_bag = mag_turns[band]
        if len(turn_bag) < _MIN_CELL:
            turn_bag = flat_turns
        # The second latent carries the turn's own memory. Indexing the
        # sorted bag by its share rather than choosing a member leaves the
        # bin's distribution exactly as fitted and gives consecutive turns
        # the measured persistence.
        turn_slow = turn_mu * turn_slow
        turn_slow += math.sqrt(1.0 - turn_mu * turn_mu) * rng.gauss(0.0, 1.0)
        turn_latent = math.sqrt(1.0 - turn_weight) * turn_slow
        turn_latent += math.sqrt(turn_weight) * rng.gauss(0.0, 1.0)
        turn_share = normal.cdf(turn_latent)
        turn = turn_bag[
            min(len(turn_bag) - 1, int(turn_share * len(turn_bag)))
        ]
        v_par = size * math.cos(turn)
        v_perp = size * math.sin(turn)
        prev = points[-1]
        point = (
            prev[0] + v_par * unit[0] - v_perp * unit[1],
            prev[1] + v_par * unit[1] + v_perp * unit[0],
        )
        # The restoring force fires only outside the radius the real
        # animal keeps to. Applying it everywhere would be truer to the
        # empirical mean radial step, but that mean is non-zero almost
        # everywhere -- it is what holds the animal at its preferred
        # radius -- and adding it globally measurably distorts the turn
        # distribution, which is the one thing that separates a fly from
        # a fish. In the tail there is nothing to distort.
        reach = math.hypot(prev[0], prev[1])
        if reach > 1e-9 and (reach > r_high or reach < r_low):
            push = _drift_at(drift, reach)
            if push:
                drifts += 1
                point = (
                    point[0] + push * prev[0] / reach,
                    point[1] + push * prev[1] / reach,
                )
        radius = math.hypot(point[0], point[1])
        if radius > 1.0:
            scale = max(0.0, 2.0 - radius) / radius
            point = (point[0] * scale, point[1] * scale)
            bounces += 1
        moved = _unit((point[0] - prev[0], point[1] - prev[1]))
        if moved == (0.0, 0.0):
            # A zero step leaves no heading to turn from. Keep the last
            # one, which is what ``observables`` does with a degenerate
            # displacement. Counted so a frozen walk cannot go unnoticed.
            dead_steps += 1
        else:
            unit = moved
        points.append(point)
    return {
        "points": points,
        "bounces": bounces,
        "thin_cells": thin_cells,
        "dead_steps": dead_steps,
        "drifts": drifts,
    }




def bodies(
    species: str,
    seed: int = SEED,
) -> list[list[tuple[float, float]]]:
    """Generate one fictional body per curated animal.

    One output per input, so the curated pool's identity count carries
    over unchanged. The seed is per index, so the set is reproducible and
    a rebuild is byte-identical.

    Args:
        species: ``fly`` or ``fish``.
        seed: Base seed; the animal's index is added.

    Returns:
        One generated body per curated animal, in the pool's order.

    Raises:
        ValueError: If a curated track is too short to fit a step model.
    """
    tracks = load_curated(species)
    generated = []
    for index, track in enumerate(tracks):
        rng = random.Random(seed + index)
        generated.append(draw_walk(track, rng, len(track))["points"])
    return generated
