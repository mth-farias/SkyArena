"""Pretty-print the 2026-06-21 FDSN day into a JSON list."""

from __future__ import annotations

import json
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_RAW = _REPO / "data" / "raw"
_SRC = _RAW / "quakes" / "earthquakes_21062026.json"
_DST = _REPO / "data" / "curated" / "quakes_21062026.json"


def _optional_float(value: object) -> float | None:
    """Return a float or None."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def events_from_fdsn(data: dict) -> list[dict]:
    """Map FDSN GeoJSON features to capitals-style records.

    Args:
        data: FDSN ``FeatureCollection``.

    Returns:
        One dict per event with id, time, mag, lat, lon, depth_km,
        region.
    """
    rows = []
    for feat in data.get("features") or []:
        if not isinstance(feat, dict):
            continue
        props = feat.get("properties") or {}
        geom = feat.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            continue
        lon, lat = coords[0], coords[1]
        depth = coords[2] if len(coords) > 2 else None
        eid = feat.get("id") or props.get("unid")
        time_str = props.get("time")
        if eid is None or time_str is None:
            continue
        rows.append(
            {
                "id": str(eid),
                "time": time_str,
                "mag": _optional_float(props.get("mag")),
                "lat": float(lat),
                "lon": float(lon),
                "depth_km": _optional_float(depth),
                "region": (
                    props.get("flynn_region")
                    or props.get("region")
                    or ""
                ),
            }
        )
    return rows


def curate() -> Path:
    """Write a pretty JSON list of every event (no magnitude cut).

    Returns:
        Path to the curated file.

    Raises:
        FileNotFoundError: If the raw pack is missing.
        ValueError: If the raw file is not an FDSN collection.
    """
    if not _SRC.is_file():
        raise FileNotFoundError(
            "raw pack missing: data/raw/"
            "quakes/earthquakes_21062026.json"
        )
    data = json.loads(_SRC.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or "features" not in data:
        raise ValueError("raw quakes file must be an FDSN FeatureCollection")
    rows = events_from_fdsn(data)
    _DST.parent.mkdir(parents=True, exist_ok=True)
    leftover = _DST.with_name("quakes.json")
    if leftover.is_file():
        leftover.unlink()
    _DST.write_text(
        json.dumps(rows, indent=2) + "\n",
        encoding="utf-8",
    )
    return _DST


def main() -> int:
    """CLI entry."""
    try:
        path = curate()
    except (FileNotFoundError, ValueError) as err:
        print(f"  [fail] {err}", file=sys.stderr)
        return 1
    print(f"  wrote {path.relative_to(_REPO).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
