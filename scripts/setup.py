"""Set up SkyArena: venv, dependencies, raw packs, curated data.

Run this once before you open the piece. It creates a repo ``.venv``,
installs ``pyarrow`` and ``gdown``, downloads the raw packs into
``data/raw/``, and curates the files the app reads into ``data/curated/``,
including the fictional tracks the cyber look draws. Every step skips work
that is already done.

Requires Python 3.11+ on PATH.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_VENV = _ROOT / ".venv"
_CURATE = _ROOT / "scripts" / "data"
_PACKAGES = ("pyarrow", "gdown")


def _venv_python() -> Path:
    """Return the interpreter inside the repo ``.venv``."""
    if sys.platform == "win32":
        return _VENV / "Scripts" / "python.exe"
    return _VENV / "bin" / "python"


def _ok(msg: str) -> None:
    """Print a terse progress line."""
    print(f"  [ok] {msg}", flush=True)


def _fail(msg: str) -> int:
    """Print a failure line and return a non-zero exit code."""
    print(f"  [fail] {msg}", file=sys.stderr, flush=True)
    return 1


def _run(cmd: list[str]) -> None:
    """Run a command, echoing it, and raise on failure."""
    print(f"  [..] {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, cwd=str(_ROOT), check=True)


def ensure_venv() -> Path:
    """Create the repo ``.venv`` when missing.

    Returns:
        Path to the venv interpreter.
    """
    py = _venv_python()
    if py.is_file():
        _ok("venv present")
        return py
    _run([sys.executable, "-m", "venv", str(_VENV)])
    return py


def install_deps(py: Path) -> None:
    """Install the runtime dependencies into the venv."""
    _run([str(py), "-m", "pip", "install", "--upgrade", "pip"])
    _run([str(py), "-m", "pip", "install", *_PACKAGES])


def download_raw() -> None:
    """Download the raw packs into ``data/raw/``, skipping present files."""
    sys.path.insert(0, str(_CURATE))
    from download_raw import download_all

    download_all()


def curate_all() -> None:
    """Write the curated files into ``data/curated/``."""
    sys.path.insert(0, str(_CURATE))
    from curate_capitals import curate as curate_capitals
    from curate_fiction import curate as curate_fiction
    from curate_fish import curate as curate_fish
    from curate_flies import curate as curate_flies
    from curate_quakes import curate as curate_quakes
    from curate_stars import curate as curate_stars

    for step in (curate_capitals, curate_stars, curate_quakes,
                 curate_flies, curate_fish):
        path = step()
        _ok(f"wrote {path.relative_to(_ROOT).as_posix()}")
    # The cyber look draws these instead of the recorded tracks. They are
    # generated from the curated animals, so they come last.
    for species in ("fly", "fish"):
        path = curate_fiction(species)
        _ok(f"wrote {path.relative_to(_ROOT).as_posix()}")


def main() -> int:
    """Run the full setup, re-executing inside the venv when needed."""
    py = ensure_venv()

    if Path(sys.executable).resolve() != py.resolve():
        install_deps(py)
        return subprocess.run(
            [str(py), str(Path(__file__).resolve())], cwd=str(_ROOT)
        ).returncode

    print("Setting up SkyArena", flush=True)
    try:
        download_raw()
        curate_all()
    except Exception as err:
        # Surface any pipeline failure to the participant verbatim.
        return _fail(str(err))
    print(
        "\nDone. Open the piece with SkyArena.bat (Windows) or "
        "`.venv/bin/python scripts/serve.py --open`.",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
