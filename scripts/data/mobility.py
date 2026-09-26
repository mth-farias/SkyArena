"""Mobility measures and the identity ranking used to curate the packs.

Two recordings per species are pooled and only the more mobile half is
kept, so the piece never draws an animal that sits in one spot. The
measure is arena coverage: the share of the unit disc an animal visits.

Twenty-one of the 200 fly candidates sit below 0.05 coverage and the
lowest manages 0.006, which is what a motionless animal looks like in
this data. Coverage also separates the species cleanly, with fly medians
near 0.17 and fish near 0.56, so it reads as intended on both.

Sources: NOTICE (idtracker.ai).
"""

from __future__ import annotations

import math

# Grid resolution. A cell is about 3% of the arena diameter: coarse enough
# that a single crossing counts for something, fine enough to tell a
# wanderer from a resident.
CELLS = 32

_INSIDE: dict[int, int] = {}


def _cells_inside(cells: int) -> int:
    """Return how many grid cells lie inside the unit disc."""
    if cells not in _INSIDE:
        total = 0
        for i in range(-cells, cells + 1):
            for j in range(-cells, cells + 1):
                if (i + 0.5) ** 2 + (j + 0.5) ** 2 <= cells * cells:
                    total += 1
        _INSIDE[cells] = total
    return _INSIDE[cells]


def coverage(
    points: list[tuple[float, float]],
    cells: int = CELLS,
) -> float:
    """Return the share of the unit disc an animal visits.

    Args:
        points: Unit-disk polyline.
        cells: Grid cells across the diameter.

    Returns:
        Visited in-disc cells over total in-disc cells, from 0 to 1.
    """
    visited: set[tuple[int, int]] = set()
    for x, y in points:
        i = int(x * cells)
        j = int(y * cells)
        if i * i + j * j <= cells * cells:
            visited.add((i, j))
    return len(visited) / max(1, _cells_inside(cells))


def distance(points: list[tuple[float, float]]) -> float:
    """Return the arc length of a polyline."""
    return sum(
        math.hypot(
            points[i + 1][0] - points[i][0],
            points[i + 1][1] - points[i][1],
        )
        for i in range(len(points) - 1)
    )


def rank(tracks: list[list[tuple[float, float]]]) -> list[int]:
    """Return identity indices ordered by mobility, most mobile first.

    Ties break on distance and then on the original index, so the order is
    total. That matters: at the cut the two species are separated by less
    than 0.002 coverage, so an unspecified tie-break would make the
    selection depend on the sort implementation.

    Args:
        tracks: Unit-disk polylines, all candidates for one species.

    Returns:
        Indices into ``tracks``.
    """
    scores = [
        (coverage(track), distance(track), index)
        for index, track in enumerate(tracks)
    ]
    scores.sort(key=lambda item: (-item[0], -item[1], item[2]))
    return [index for _, _, index in scores]


def select(
    tracks: list[list[tuple[float, float]]],
    target: int,
) -> list[int]:
    """Return the indices of the ``target`` most mobile animals.

    Args:
        tracks: Unit-disk polylines, all candidates for one species.
        target: How many to keep.

    Returns:
        Chosen indices, most mobile first.

    Raises:
        ValueError: If there are fewer candidates than ``target``.
    """
    if target > len(tracks):
        raise ValueError(
            f"need {target} animals but only {len(tracks)} candidates"
        )
    return rank(tracks)[:target]
