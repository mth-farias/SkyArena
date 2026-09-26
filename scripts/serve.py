#!/usr/bin/env python3
"""SkyArena viewer server: 127.0.0.1:5444, standard library only.

Run ``python scripts/serve.py`` to serve the piece in ``app/``, or
``SkyArena.bat`` on Windows. Add ``--open`` to launch the browser once the
server is listening, so it does not hit a closed port. Add ``--stop`` to stop
a viewer that is still running from an earlier start.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from viewer_lock import (
    HOST,
    MAGIC,
    PORT,
    clear_pid,
    pid_path,
    stop_viewer_servers,
)

_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".ttf": "font/ttf",
}

# Defaults for a request that leaves a field out: the first sky.
LISBON_LAT = 38.72
LISBON_LON = -9.13
STAR_DATE = "2026-06-21"
N_STARS = 108
# eLife 107602: each video is 10 minutes. The CSVs have no fps column.
PAPER_DURATION_S = 600.0
TARGET_HZ = 10.0
_FLY_CSV = Path("data/raw/flies/trajectories.csv")
_FISH_CSV = Path("data/raw/fish/trajectories.csv")


def repo_root() -> Path:
    """Return the repository root (parent of ``scripts/``)."""
    return Path(__file__).resolve().parents[1]


def _parquet_n_ids(path: Path) -> int:
    """Return the identity count from the wide ``xN`` parquet columns."""
    import pyarrow.parquet as pq

    names = pq.read_schema(path).names
    count = sum(1 for name in names if name.startswith("x"))
    if count < 1:
        raise ValueError(f"{path.name} has no xN columns")
    return count


def _csv_n_frames(path: Path) -> int:
    """Return the data-row count of an idtracker CSV, or 0 if missing."""
    if not path.is_file():
        return 0
    with path.open(encoding="utf-8", newline="") as handle:
        return max(0, sum(1 for _ in handle) - 1)


def _src_fps(csv_frames: int) -> float:
    """Infer the recording fps from a 10-minute paper video."""
    if csv_frames < 1:
        return 0.0
    return csv_frames / PAPER_DURATION_S


def write_pid(root: Path) -> None:
    """Record this process as the repo viewer."""
    path = pid_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{os.getpid()}\n{MAGIC}\n", encoding="utf-8")


class Handler(BaseHTTPRequestHandler):
    """Serve the piece, the star data, the live quakes, and the tracks."""

    root: Path
    site: Path
    site_url: str

    def log_message(self, fmt: str, *args: object) -> None:
        """Write access lines to stdout."""
        sys.stdout.write("%s - %s\n" % (self.address_string(), fmt % args))
        sys.stdout.flush()

    def _safe_file(self, folder: Path, rel: str) -> Path | None:
        """Return a file inside ``folder``, or None for anything else."""
        rel = rel.lstrip("/")
        if not rel or ".." in Path(rel).parts:
            return None
        candidate = (folder / rel).resolve()
        try:
            candidate.relative_to(folder.resolve())
        except ValueError:
            return None
        if candidate.is_file():
            return candidate
        return None

    def _send_bytes(self, body: bytes, ctype: str, status: int = 200) -> None:
        """Write a response that the browser must not cache."""
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, payload: object) -> None:
        """Write a JSON response."""
        body = json.dumps(payload).encode("utf-8")
        self._send_bytes(body, "application/json; charset=utf-8", status)

    def _send_file(self, target: Path | None) -> None:
        """Write a file, or a 404 when there is none."""
        if target is None:
            self.send_error(404, "not found")
            return
        ctype = _TYPES.get(target.suffix.lower(), "application/octet-stream")
        self._send_bytes(target.read_bytes(), ctype)

    def _playback(self) -> dict:
        """Return the source fps and the points per second of each species."""
        return {
            "fly_src_fps": _src_fps(_csv_n_frames(self.root / _FLY_CSV)),
            "fish_src_fps": _src_fps(_csv_n_frames(self.root / _FISH_CSV)),
            "fly_point_hz": TARGET_HZ,
            "fish_point_hz": TARGET_HZ,
        }

    def _send_get_data(self, query: str) -> None:
        """Return stars JSON (the tracks are ``/api/flies.bin``)."""
        qs = parse_qs(query)
        try:
            n_stars = int(qs.get("n_stars", [N_STARS])[0])
            lat = float(qs.get("lat", [LISBON_LAT])[0])
            lon = float(qs.get("lon", [LISBON_LON])[0])
            date = str(qs.get("date", [STAR_DATE])[0])
            n_flies = int(qs.get("n_flies", [0])[0])
            n_fish = int(qs.get("n_fish", [0])[0])
            from app.utils.get_data import get_data

            bundle = get_data(
                n_stars=n_stars,
                lat=lat,
                lon=lon,
                date=date,
                n_flies=n_flies,
                n_fish=n_fish,
            )
            bundle["playback"] = self._playback()
        except (FileNotFoundError, ImportError, ValueError) as err:
            self._send_json(500, {"error": str(err)})
            return
        self._send_json(200, bundle)

    def _send_quakes_live(self, query: str) -> None:
        """Return live quake events at or above ``minmagnitude``.

        The events come from a store that background threads keep filled, so
        this answers from memory and never waits on the network.
        """
        qs = parse_qs(query)
        try:
            min_mag = float(qs.get("minmagnitude", ["3"])[0])
            from app.utils.data_lookup.quakes_live import (
                fetch_live_earthquakes,
            )

            events = fetch_live_earthquakes(min_mag)
        except (OSError, ValueError, ImportError) as err:
            self._send_json(500, {"error": str(err)})
            return
        self._send_json(200, events)

    def _send_tracks_bin(self, species: str, query: str) -> None:
        """Return the packed Float32 tracks of one species.

        The ``set`` parameter chooses between the recorded tracks and the
        fictional ones, which the cyber look draws. It defaults to the
        recorded set, so a client that knows nothing about the look still
        gets exactly what it always got.
        """
        qs = parse_qs(query)
        stem = "fly" if species == "fly" else "fish"
        if qs.get("set", [""])[0] == "fiction":
            stem += "_fiction"
        path = self.root / "data" / "curated" / f"{stem}.parquet"
        try:
            n_ids = int(qs.get("n", [_parquet_n_ids(path)])[0])
            from app.utils.data_lookup.tracks_bin import pack_wide_parquet

            body = pack_wide_parquet(path, n_ids)
        except (FileNotFoundError, ImportError, ValueError) as err:
            self._send_json(500, {"error": str(err)})
            return
        self._send_bytes(body, "application/octet-stream")

    def do_GET(self) -> None:  # noqa: N802
        """Serve the data APIs and the static files for a GET request."""
        parsed = urlparse(self.path)
        raw = unquote(parsed.path)
        prefix = f"/{self.site.relative_to(self.root).as_posix()}"
        route = raw.rstrip("/")
        if route == "/api/get_data":
            self._send_get_data(parsed.query)
        elif route == "/api/quakes/live":
            self._send_quakes_live(parsed.query)
        elif route == "/api/flies.bin":
            self._send_tracks_bin("fly", parsed.query)
        elif route == "/api/fish.bin":
            self._send_tracks_bin("fish", parsed.query)
        elif raw.startswith("/SPRITES/"):
            target = self._safe_file(
                self.site / "utils" / "sprites", raw[len("/SPRITES/") :]
            )
            if target is not None and target.suffix.lower() != ".png":
                target = None
            self._send_file(target)
        elif raw in {"", "/"}:
            self.send_response(302)
            self.send_header("Location", prefix + "/")
            self.end_headers()
        elif raw in {prefix, prefix + "/"}:
            self._send_file(self.site / "index.html")
        elif raw.startswith(prefix + "/"):
            self._send_file(self._safe_file(self.site, raw[len(prefix) + 1 :]))
        else:
            self.send_error(404, "not found")


class Server(ThreadingHTTPServer):
    """Do not steal a foreign occupant of the port."""

    allow_reuse_address = False


def serve(root: Path, open_browser: bool = False) -> int:
    """Stop leftovers, bind the port, and serve ``app/`` until interrupted."""
    rc = stop_viewer_servers(root)
    if rc != 0:
        return rc
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    Handler.root = root
    Handler.site = root / "app"
    Handler.site_url = f"http://{HOST}:{PORT}/app/"
    if not Handler.site.is_dir():
        print("skyarena: missing app folder", file=sys.stderr)
        return 1
    try:
        httpd = Server((HOST, PORT), Handler)
    except OSError as exc:
        print(
            f"skyarena: {HOST}:{PORT} is in use ({exc})",
            file=sys.stderr,
        )
        print("skyarena: will not steal the port", file=sys.stderr)
        return 1
    write_pid(root)
    from app.utils.data_lookup.quakes_live import start_live_feed

    start_live_feed()
    print(Handler.site_url, flush=True)
    print(
        "skyarena: leave this window open. Ctrl+C to stop.",
        flush=True,
    )
    if open_browser:
        webbrowser.open(Handler.site_url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nskyarena: stopped", flush=True)
    finally:
        httpd.server_close()
        clear_pid(root)
    return 0


def main(argv: list[str] | None = None) -> int:
    """Run the viewer server, or stop the previous one with ``--stop``."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stop",
        action="store_true",
        help="Stop a viewer left running on the port, then exit",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        help="Open the piece in the browser once the server is listening",
    )
    args = parser.parse_args(argv)
    root = repo_root()
    if args.stop:
        return stop_viewer_servers(root)
    return serve(root, open_browser=args.open)


if __name__ == "__main__":
    raise SystemExit(main())
