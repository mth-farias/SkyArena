"""Orchestrate curated capitals, stars, quakes, flies, and fish."""

from __future__ import annotations

from datetime import datetime

from .data_lookup.capitals_location import capitals_location
from .data_lookup.fish_location import fish_location
from .data_lookup.flies_location import flies_location
from .data_lookup.quakes_location import quakes_location
from .data_lookup.stars_location import stars_location


def get_data(
    *,
    n_stars: int,
    lat: float,
    lon: float,
    date: str | datetime,
    n_flies: int,
    n_fish: int,
) -> dict:
    """Return one dict with every curated object type.

    Args:
        n_stars: Brightest stars above the horizon to keep.
        lat: Observer latitude in degrees.
        lon: Observer longitude in degrees.
        date: ``YYYY-MM-DD`` or a datetime (UTC).
        n_flies: Number of fly trajectories (0 skips flies).
        n_fish: Number of fish trajectories (0 skips fish).

    Returns:
        Keys ``capitals``, ``stars``, ``quakes``, ``flies``, ``fish``.
        Fly and fish ``points`` are unit-disk coordinates when counts
        are positive. The canvas loads stars from this JSON and
        fly/fish tracks from ``/api/flies.bin`` / ``/api/fish.bin``.
    """
    stars = []
    if int(n_stars) >= 1:
        stars = stars_location(n_stars, lat, lon, date)
    flies = []
    if int(n_flies) >= 1:
        flies = flies_location(n_flies)
    fish = []
    if int(n_fish) >= 1:
        fish = fish_location(n_fish)
    return {
        "capitals": capitals_location(),
        "stars": stars,
        "quakes": quakes_location(),
        "flies": flies,
        "fish": fish,
    }
