"""Look up the N brightest Yale BSC stars above a site and date.

Reads the CDS V/50 catalog copied to ``data/curated/stars_catalog``. Alt/az
math follows SkyQuake ``stars.py`` (no scipy). Blank J2000/V rows are
skipped at lookup, not by rewriting the file.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from pathlib import Path

_REPO = Path(__file__).resolve().parents[3]
_STARS_PATH = _REPO / "data" / "curated" / "stars_catalog"


def _slice(line: str, start: int, end: int) -> str:
    """Return a 1-based inclusive CDS byte slice."""
    return line[start - 1 : end]


def _parse_catalog_line(line: str) -> tuple[str, float, float, float] | None:
    """Parse one V/50 catalog record, or None if astrometry is blank."""
    line = line.rstrip("\r\n")
    if len(line) < 107:
        return None
    rah = _slice(line, 76, 77).strip()
    ram = _slice(line, 78, 79).strip()
    ras = _slice(line, 80, 83).strip()
    sign = _slice(line, 84, 84)
    ded = _slice(line, 85, 86).strip()
    dem = _slice(line, 87, 88).strip()
    des = _slice(line, 89, 90).strip()
    vmag = _slice(line, 103, 107).strip()
    if not (rah and ram and ras and ded and dem and des and vmag):
        return None
    try:
        ra_hours = int(rah) + int(ram) / 60.0 + float(ras) / 3600.0
        dec_deg = int(ded) + int(dem) / 60.0 + int(des) / 3600.0
        if sign == "-":
            dec_deg = -dec_deg
        mag = float(vmag)
    except ValueError:
        return None
    name = _slice(line, 5, 14).strip()
    if not name:
        name = _slice(line, 1, 4).strip()
    return name, ra_hours, dec_deg, mag


def _load_catalog(path: Path) -> list[tuple[str, float, float, float]]:
    """Load usable stars from a CDS V/50 ``catalog`` file."""
    text = path.read_text(encoding="latin-1")
    rows = []
    for line in text.splitlines():
        parsed = _parse_catalog_line(line)
        if parsed is not None:
            rows.append(parsed)
    return rows


def _parse_when(date: str | datetime) -> datetime:
    """Parse a UTC calendar day (noon) or a datetime."""
    if isinstance(date, datetime):
        if date.tzinfo is None:
            return date.replace(tzinfo=timezone.utc)
        return date.astimezone(timezone.utc)
    text = str(date).strip()
    if "T" in text:
        raw = text.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    day = datetime.strptime(text[:10], "%Y-%m-%d")
    return day.replace(hour=12, tzinfo=timezone.utc)


def _julian_date(dt: datetime) -> float:
    """UTC datetime to Julian Date."""
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (dt - epoch).total_seconds() / 86400.0 + 2440587.5


def _gmst_degrees(julian_date: float) -> float:
    """Greenwich mean sidereal time in degrees."""
    t = (julian_date - 2451545.0) / 36525.0
    gmst = (
        280.46061837
        + 360.98564736629 * (julian_date - 2451545.0)
        + 0.000387933 * t * t
        - (t ** 3) / 38710000
    )
    return gmst % 360


def ra_dec_to_alt_az(
    ra_hours: float,
    dec_deg: float,
    lat_deg: float,
    lon_deg: float,
    when: datetime,
) -> tuple[float, float]:
    """Return altitude degrees and azimuth radians (0 = north)."""
    jd = _julian_date(when)
    local_sidereal = (_gmst_degrees(jd) + lon_deg) % 360
    hour_angle_deg = (local_sidereal - ra_hours * 15) % 360
    to_rad = math.pi / 180
    dec = dec_deg * to_rad
    lat = lat_deg * to_rad
    hour_angle = hour_angle_deg * to_rad
    sin_alt = math.sin(dec) * math.sin(lat) + math.cos(dec) * math.cos(
        lat
    ) * math.cos(hour_angle)
    sin_alt = max(-1.0, min(1.0, sin_alt))
    alt = math.asin(sin_alt)
    cos_alt = math.cos(alt)
    if abs(cos_alt) < 1e-9:
        az = 0.0
    else:
        cos_az = (math.sin(dec) - math.sin(alt) * math.sin(lat)) / (
            cos_alt * math.cos(lat)
        )
        cos_az = max(-1.0, min(1.0, cos_az))
        az = math.acos(cos_az)
        if math.sin(hour_angle) > 0:
            az = 2 * math.pi - az
    return alt * (180 / math.pi), az


def project_to_dome(alt_deg: float, az_rad: float) -> tuple[float, float]:
    """Map altitude and azimuth onto the unit disk.

    Zenith (alt 90) is the origin; the horizon (alt 0) is the rim.
    Matches SkyQuake ``stars.py`` ``_project_to_dome``.
    """
    t = (90.0 - alt_deg) / 90.0
    x = t * math.sin(az_rad)
    y = -t * math.cos(az_rad)
    return x, y


def stars_location(n: int, lat: float, lon: float, date: str | datetime):
    """Return the ``n`` brightest stars above the horizon.

    Args:
        n: How many stars to keep (lowest magnitude first).
        lat: Observer latitude in degrees.
        lon: Observer longitude in degrees.
        date: Calendar day ``YYYY-MM-DD`` (noon UTC) or a datetime.

    Returns:
        A list of dicts with name, magnitude, alt_deg, az_rad, x, y.

    Raises:
        FileNotFoundError: If ``data/curated/stars_catalog`` is missing.
        ValueError: If ``n`` is not a positive integer.
    """
    if int(n) < 1:
        raise ValueError("n must be a positive integer")
    if not _STARS_PATH.is_file():
        raise FileNotFoundError(
            "missing data/curated/stars_catalog; run /fly-setup"
        )
    when = _parse_when(date)
    catalog = _load_catalog(_STARS_PATH)
    candidates = []
    for name, ra_hours, dec_deg, mag in catalog:
        alt_deg, az_rad = ra_dec_to_alt_az(
            ra_hours, dec_deg, lat, lon, when
        )
        if alt_deg <= 0:
            continue
        x, y = project_to_dome(alt_deg, az_rad)
        candidates.append(
            {
                "name": name,
                "magnitude": mag,
                "alt_deg": alt_deg,
                "az_rad": az_rad,
                "x": x,
                "y": y,
            }
        )
    candidates.sort(key=lambda row: row["magnitude"])
    return candidates[: int(n)]
