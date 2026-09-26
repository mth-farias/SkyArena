"""Live earthquake events, merged from a push channel and a polled feed.

EMSC's SockJS channel pushes each event as EMSC publishes it, so a quake
reaches the piece about as soon as anywhere publishes it. USGS summary feeds
are polled alongside it as reconciliation: the push channel can drop, and
USGS runs an independent network that often holds an event EMSC has not
published yet.

Neither source carries every magnitude from every region, so the two are
merged rather than ranked. Events keep their source in the ``id``, which
keeps the two numbering schemes apart.
"""

from __future__ import annotations

import json
import random
import string
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

EMSC_PUSH_URL = "https://www.seismicportal.eu/standing_order"
USGS_FEED_URL = (
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"
)
EQ_WINDOW_S = 60 * 60
EQ_STORE_MAX = 4000
USGS_POLL_S = 30
_HTTP_TIMEOUT_S = 30
_RETRY_S = 10
_UA = "SkyArena/1"


def _epoch(value: object) -> float:
    """Return POSIX seconds for an ISO timestamp, or 0 when unreadable."""
    if not isinstance(value, str):
        return 0.0
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _iso_from_ms(milliseconds: object) -> str:
    """Return an ISO UTC timestamp for a millisecond epoch value."""
    moment = datetime.fromtimestamp(float(milliseconds) / 1000.0, timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _get_json(url: str) -> object:
    """Fetch ``url`` and decode it as JSON.

    Raises:
        OSError: The request failed.
        ValueError: The body is not JSON, which is how USGS reports that it
            rate-limited the caller: it serves an HTML page instead.
    """
    request = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as response:
        return json.loads(response.read())


def _emsc_event(message: object) -> dict | None:
    """Convert one pushed EMSC message to the shared event shape."""
    if not isinstance(message, dict):
        return None
    data = message.get("data") or {}
    props = data.get("properties") or {}
    when, mag = props.get("time"), props.get("mag")
    lat, lon = props.get("lat"), props.get("lon")
    eid = props.get("unid") or data.get("id") or props.get("source_id")
    if None in (when, mag, lat, lon, eid):
        return None
    return {
        "id": "emsc:" + str(eid),
        "time": str(when),
        "mag": float(mag),
        "lat": float(lat),
        "lon": float(lon),
        "depth_km": props.get("depth"),
        "region": props.get("flynn_region") or "",
    }


def _usgs_event(feature: object) -> dict | None:
    """Convert one USGS GeoJSON feature to the shared event shape."""
    if not isinstance(feature, dict):
        return None
    props = feature.get("properties") or {}
    coords = (feature.get("geometry") or {}).get("coordinates") or []
    when, mag = props.get("time"), props.get("mag")
    eid = feature.get("id")
    if when is None or mag is None or eid is None or len(coords) < 2:
        return None
    return {
        "id": "usgs:" + str(eid),
        "time": _iso_from_ms(when),
        "mag": float(mag),
        "lat": float(coords[1]),
        "lon": float(coords[0]),
        "depth_km": coords[2] if len(coords) > 2 else None,
        "region": props.get("place") or "",
    }


def _push_events(payload: str) -> list[dict]:
    """Decode a SockJS ``a[...]`` frame into event dicts."""
    try:
        frames = json.loads(payload)
    except ValueError:
        return []
    if not isinstance(frames, list):
        return []
    events = []
    for frame in frames:
        try:
            event = _emsc_event(json.loads(frame))
        except (TypeError, ValueError):
            continue
        if event is not None:
            events.append(event)
    return events


def _usgs_events(document: object) -> list[dict]:
    """Decode a USGS summary feed into event dicts."""
    if not isinstance(document, dict):
        return []
    events = []
    for feature in document.get("features") or []:
        event = _usgs_event(feature)
        if event is not None:
            events.append(event)
    return events


class _Store:
    """A rolling window of live events, safe to share across threads."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._events: dict[str, dict] = {}

    def add(self, events: list[dict]) -> None:
        """Merge ``events`` in, then drop anything outside the window."""
        if not events:
            return
        cutoff = time.time() - EQ_WINDOW_S
        with self._lock:
            merged = dict(self._events)
            for event in events:
                merged[event["id"]] = event
            kept = {
                key: item
                for key, item in merged.items()
                if _epoch(item["time"]) >= cutoff
            }
            if len(kept) > EQ_STORE_MAX:
                newest = sorted(
                    kept.items(),
                    key=lambda item: _epoch(item[1]["time"]),
                    reverse=True,
                )
                kept = dict(newest[:EQ_STORE_MAX])
            self._events = kept

    def since(self, min_magnitude: float) -> list[dict]:
        """Return stored events at or above ``min_magnitude``, oldest first."""
        with self._lock:
            events = [
                item
                for item in self._events.values()
                if item["mag"] >= min_magnitude
            ]
        events.sort(key=lambda item: _epoch(item["time"]))
        return events


def _emsc_push_loop(store: _Store, stop: threading.Event) -> None:
    """Hold a SockJS session open and store every event EMSC pushes.

    The session is long-polled: each POST returns the next message, a
    heartbeat after about 25 seconds, or an ``o`` open frame. Only the open
    frame comes back instantly, so only it needs a pause to stay polite.
    """
    while not stop.is_set():
        server = random.randint(0, 999)
        session = "".join(random.choices(string.ascii_lowercase, k=8))
        url = f"{EMSC_PUSH_URL}/{server:03d}/{session}/xhr"
        try:
            while not stop.is_set():
                request = urllib.request.Request(
                    url, headers={"User-Agent": _UA}, method="POST"
                )
                with urllib.request.urlopen(
                    request, timeout=_HTTP_TIMEOUT_S
                ) as response:
                    body = response.read().decode("utf-8", "replace").strip()
                if body[:1] == "a":
                    store.add(_push_events(body[1:]))
                elif body[:1] != "h":
                    stop.wait(0.5)
        except (OSError, ValueError):
            # A dropped session or a malformed frame. Fall through and open
            # a fresh session: this feed is a bonus, and the piece is built
            # to run with the USGS poll alone.
            pass
        stop.wait(_RETRY_S)


def _usgs_poll_loop(store: _Store, stop: threading.Event) -> None:
    """Poll the USGS daily summary feed and store what it returns."""
    while not stop.is_set():
        try:
            store.add(_usgs_events(_get_json(USGS_FEED_URL)))
        except (OSError, ValueError):
            # Offline, or USGS answered with HTML instead of GeoJSON. The
            # store keeps what it already has and the next poll retries.
            pass
        stop.wait(USGS_POLL_S)


_START_LOCK = threading.Lock()
_STORE = _Store()
_STOP = threading.Event()
_STARTED = False


def start_live_feed() -> None:
    """Start the push and poll threads once, on the first call."""
    global _STARTED
    with _START_LOCK:
        if _STARTED:
            return
        _STARTED = True
        for loop in (_emsc_push_loop, _usgs_poll_loop):
            threading.Thread(
                target=loop, args=(_STORE, _STOP), daemon=True
            ).start()


def fetch_live_earthquakes(min_magnitude: float) -> list[dict]:
    """Return worldwide events at or above ``min_magnitude``.

    Starts the feed on the first call, then answers from the store, so a
    request never waits on the network.

    Args:
        min_magnitude: Magnitude cutoff.

    Returns:
        Event dicts with ``id``, ``time``, ``mag``, ``lat``, ``lon``,
        ``depth_km``, and ``region``, oldest first. Empty until a source
        answers.
    """
    start_live_feed()
    return _STORE.since(min_magnitude)
