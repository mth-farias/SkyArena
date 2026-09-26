"""Download the raw packs into ``data/raw/``.

Capitals are git-tracked and are not fetched. Stars come from CDS V/50,
quakes from SeismicPortal FDSN, and fly/fish CSVs from Google Drive.
Existing target files are skipped.

Sources: NOTICE.
"""

from __future__ import annotations

import gzip
import shutil
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_RAW = _REPO / "data" / "raw"
_DATA = _RAW
_USER_AGENT = "SkyArena/1"
_TIMEOUT = 120
_PIP_INDEX = "https://pypi.org/simple"
_CDS = "https://cdsarc.cds.unistra.fr/ftp/cats/V/50/"
_FDSN = (
    "https://www.seismicportal.eu/fdsnws/event/1/query"
    "?start=2026-06-21T00:00:00"
    "&end=2026-06-22T00:00:00"
    "&format=json"
    "&orderby=time-asc"
    "&limit=20000"
)
_DRIVE_FLIES = "17Cn8rT8Fk9QLcAnU8yokScMdqTk8QA5u"
_DRIVE_FISH = "1eVZWK89DHTkyQNL5B0Euj9ezGvqzTvyl"
_DRIVE_FLIES_B = "1_jgQwYAjPllZKTMnyuQvqKskJ5WMLkpY"
_DRIVE_FISH_B = "1ceP9Zg_189yNyOYa-El6hL1l3_J36L7U"


class DownloadError(RuntimeError):
    """A participant-facing download failure."""


def _ok(msg: str) -> None:
    """Print a progress line."""
    print(f"  [ok] {msg}", flush=True)


def _skip(path: Path) -> bool:
    """Return True when the target already exists."""
    if path.is_file():
        _ok(f"skip (present): {path.as_posix()}")
        return True
    return False


def _curl_bin() -> str | None:
    """Return curl on PATH (Windows prefers curl.exe)."""
    if sys.platform == "win32":
        found = shutil.which("curl.exe")
        if found:
            return found
    return shutil.which("curl")


def _curl_download(url: str, dest: Path) -> None:
    """Fetch ``url`` with curl (CDS SSL fallback on this host)."""
    curl = _curl_bin()
    if not curl:
        raise DownloadError(
            "SSL download failed and curl is not on PATH"
        )
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            curl,
            "-fsSL",
            "--user-agent",
            _USER_AGENT,
            "-o",
            str(dest),
            url,
        ],
        check=False,
    )
    if proc.returncode != 0:
        raise DownloadError(
            f"curl failed ({proc.returncode}) for {url}"
        )


def _urllib_download(url: str, dest: Path) -> None:
    """Fetch ``url`` with urllib and a workshop User-Agent."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": _USER_AGENT},
    )
    tmp = dest.with_name(dest.name + ".part")
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            with tmp.open("wb") as out:
                while True:
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
        tmp.replace(dest)
    except (ssl.SSLError, urllib.error.URLError) as err:
        if tmp.is_file():
            tmp.unlink()
        cause = err.reason if isinstance(err, urllib.error.URLError) else err
        if isinstance(cause, ssl.SSLError) or isinstance(err, ssl.SSLError):
            _curl_download(url, dest)
            return
        raise DownloadError(f"download failed: {url}") from err


def _looks_html(path: Path) -> bool:
    """Return True if the file starts like HTML (Drive interstitial)."""
    head = path.read_bytes()[:512].lstrip().lower()
    return head.startswith(b"<") or b"<!doctype" in head[:32]


def _ensure_gdown() -> None:
    """Install gdown into the current interpreter if missing."""
    try:
        import gdown  # noqa: F401
    except ImportError:
        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "gdown",
                "-i",
                _PIP_INDEX,
            ],
            check=False,
        )
        if proc.returncode != 0:
            raise DownloadError("could not pip-install gdown in .venv")


def _gdown_download(file_id: str, dest: Path) -> None:
    """Fetch a Drive file with gdown after an HTML interstitial."""
    _ensure_gdown()
    import gdown

    dest.parent.mkdir(parents=True, exist_ok=True)
    out = gdown.download(id=file_id, output=str(dest), quiet=False)
    if not out or not dest.is_file():
        raise DownloadError(
            "Google Drive download failed. Share the file as "
            "anyone-with-link and re-run."
        )


def _drive_url(file_id: str) -> str:
    """Return the direct Drive export URL."""
    return (
        "https://drive.google.com/uc?export=download&id="
        f"{file_id}&confirm=t"
    )


def _pick_trajectories(names: list[str]) -> str:
    """Choose ``trajectories.csv`` inside a zip.

    Args:
        names: Zip member paths.

    Returns:
        The member to extract.

    Raises:
        DownloadError: If no unique trajectories.csv is found.
    """
    posix = [n.replace("\\", "/") for n in names]
    preferred = [
        n
        for n in posix
        if n.endswith("validated_csv/trajectories.csv") and not n.endswith("/")
    ]
    if preferred:
        return preferred[0]
    cands = [
        n
        for n in posix
        if n.rsplit("/", 1)[-1] == "trajectories.csv" and not n.endswith("/")
    ]
    if len(cands) == 1:
        return cands[0]
    raise DownloadError(
        "zip has no unique trajectories.csv "
        "(expected validated_csv/trajectories.csv)"
    )


def _unwrap_to_csv(blob: Path, dest: Path) -> None:
    """Write a CSV from a bare file or a zip of idtracker output."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    head = blob.read_bytes()[:2]
    if head == b"PK":
        with zipfile.ZipFile(blob) as zf:
            pick = _pick_trajectories(zf.namelist())
            dest.write_bytes(zf.read(pick))
        blob.unlink(missing_ok=True)
        return
    if blob.resolve() != dest.resolve():
        blob.replace(dest)


def download_drive_csv(file_id: str, dest: Path, label: str) -> None:
    """Download a Drive CSV (or zip) to ``dest``.

    Args:
        file_id: Google Drive file id.
        dest: Final ``trajectories.csv`` path.
        label: Short name for logs.
    """
    if _skip(dest):
        return
    tmp = dest.with_name(dest.name + ".download")
    try:
        _urllib_download(_drive_url(file_id), tmp)
        if _looks_html(tmp):
            tmp.unlink()
            _gdown_download(file_id, tmp)
            if tmp.is_file() and _looks_html(tmp):
                tmp.unlink(missing_ok=True)
                raise DownloadError(
                    f"{label}: Drive returned HTML. Share as "
                    "anyone-with-link and re-run."
                )
        _unwrap_to_csv(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)
    if not dest.is_file():
        raise DownloadError(f"{label}: missing {dest.as_posix()}")
    _ok(f"downloaded {label}")


def download_stars() -> None:
    """Fetch CDS V/50 ReadMe and catalog (gunzip)."""
    readme = _DATA / "stars" / "ReadMe"
    catalog = _DATA / "stars" / "catalog"
    if readme.is_file() and catalog.is_file():
        _ok("skip (present): stars ReadMe + catalog")
        return
    if not readme.is_file():
        _urllib_download(_CDS + "ReadMe", readme)
    if not catalog.is_file():
        gz_path = _DATA / "stars" / "catalog.gz"
        _urllib_download(_CDS + "catalog.gz", gz_path)
        catalog.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(gz_path, "rb") as src:
            catalog.write_bytes(src.read())
        gz_path.unlink(missing_ok=True)
    _ok("downloaded CDS V/50 stars")


def download_quakes() -> None:
    """Fetch the 2026-06-21 FDSN FeatureCollection."""
    dest = _DATA / "quakes" / "earthquakes_21062026.json"
    if _skip(dest):
        return
    _urllib_download(_FDSN, dest)
    _ok("downloaded FDSN quakes")


def download_flies() -> None:
    """Fetch the Drosophila validated CSV from Drive."""
    dest = _DATA / "flies" / "trajectories.csv"
    download_drive_csv(_DRIVE_FLIES, dest, "flies")


def download_fish() -> None:
    """Fetch the zebrafish validated CSV from Drive."""
    dest = _DATA / "fish" / "trajectories.csv"
    download_drive_csv(_DRIVE_FISH, dest, "fish")


def download_flies_b() -> None:
    """Fetch the second Drosophila validated CSV from Drive.

    Curation pools this with the first pack and keeps the more mobile
    half, so both are needed to rebuild ``data/curated/``.
    """
    dest = _DATA / "flies" / "trajectories_b.csv"
    download_drive_csv(_DRIVE_FLIES_B, dest, "flies-b")


def download_fish_b() -> None:
    """Fetch the second zebrafish validated CSV from Drive."""
    dest = _DATA / "fish" / "trajectories_b.csv"
    download_drive_csv(_DRIVE_FISH_B, dest, "fish-b")


def download_all() -> None:
    """Download stars, quakes, and both packs of each species."""
    download_stars()
    download_quakes()
    download_flies()
    download_fish()
    download_flies_b()
    download_fish_b()


def main() -> int:
    """CLI: fetch all four network packs."""
    try:
        download_all()
    except DownloadError as err:
        print(f"  [fail] {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
