"""Shared helpers for the sprite generators.

The generators ``organic_sprites.py`` and ``cyber_sprites.py`` draw the fly and
the fish. Both read their colors from the ramps in ``app/palette.js``, so the
art stays inside the locked palette.
"""

from __future__ import annotations

import re
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_PALETTE_JS = _HERE.parents[1] / "palette.js"


def load_ramps() -> dict[str, list[str]]:
    """Read the hue ramps from palette.js so the sprites share its colors."""
    text = _PALETTE_JS.read_text(encoding="utf-8")
    block = re.search(r"export const RAMPS = \{(.*?)\};", text, re.S)
    if block is None:
        raise RuntimeError("RAMPS not found in palette.js")
    return {
        name: re.findall(r"'(#[0-9A-Fa-f]{6})'", body)
        for name, body in re.findall(r"(\w+): \[(.*?)\]", block.group(1))
    }


def _hex_rgb(value: str) -> tuple[int, int, int]:
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))  # type: ignore
