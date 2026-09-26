"""Organic fly (drosophila) and zebrafish, 15x15.

Both animals share a main body 12 pixels long and 5 wide across the eyes,
wings and tail excluded.

Run ``python organic_sprites.py`` to rewrite ``<kind>/<bank>/<n>.png`` (facing
east) and ``<n>_d.png`` (facing down-right), for ``kind`` in ``fly``/``fish``,
``bank`` in ``grow``/``flicker``/``shrink`` and ``n`` = 1 to 6. The viewer turns
both by whole quarter turns to reach all eight headings.
"""

import math
from collections import Counter
from pathlib import Path

from PIL import Image
from pixel_sprites import _hex_rgb, load_ramps

OUT = Path(__file__).resolve().parent
SIZE = 15
# The fish is drawn a little larger than the fly, on a larger canvas.
FISH_SIZE = 19
FISH_SCALE = 1.25
SUPER = 8
R = load_ramps()
ORANGE, YELLOW, RED = R["orange"], R["yellow"], R["red"]
BLUE, SKY = R["blue"], R["sky"]
SILVER = "#D0D0E0"
SMOKE_HEX = "#606078"

SMIN = 0.72
GROW = (SMIN, 0.78, 0.85, 0.91, 0.96, 1.0)

# Wing angle from the body axis, in degrees; None folds the wings.
# Flapping never folds: the narrowest angle leaves a gap beside the abdomen.
WING_MAX, WING_MIN = 66.0, 40.0
FLAP = (WING_MAX, WING_MIN) * 3                # three beats per cycle
WING_GROW = (None, None, 40.0, 50.0, 58.0, WING_MAX)
FISH_WAG = tuple(math.sin(2 * math.pi * k / 6) for k in range(6))


def ell(x, y, cx, cy, rx, ry):
    """Returns how far (x, y) is from an ellipse; 1 or less means inside.

    Args:
        x: Point x.
        y: Point y.
        cx: Ellipse center x.
        cy: Ellipse center y.
        rx: Ellipse radius along x.
        ry: Ellipse radius along y.
    """
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2


def poly(x, y, pts):
    """Returns True when (x, y) lies inside the polygon given by pts."""
    inside = False
    j = len(pts) - 1
    for i, (xi, yi) in enumerate(pts):
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def lerp_profile(table, x):
    """Piecewise-linear lookup; table runs from high x to low x."""
    if x > table[0][0] or x < table[-1][0]:
        return None
    for (x0, v0), (x1, v1) in zip(table, table[1:]):
        if x1 <= x <= x0:
            t = (x0 - x) / (x0 - x1)
            return v0 + (v1 - v0) * t
    return None


# ------------------------------------------------------------------ fly
def fly(x, y, wing):
    """Top-down drosophila: red-eyed head, thorax, banded abdomen, wings.

    Args:
        x: Position along the body, in pixels; positive is toward the head.
        y: Position across the body, in pixels.
        wing: Wing angle from the body axis in degrees, or None if folded.

    Returns:
        The name of the body part at that point, or None for empty space.
    """
    folded = wing is None
    if ell(x, y, 4.1, 0, 1.6, 2.5) <= 1:
        for s in (-1, 1):
            if math.hypot(x - 4.2, y - s * 1.7) <= 1.15:
                return "eye"
        return "head"
    e = ell(x, y, 1.1, 0, 2.5, 2.4)
    if e <= 1:
        return "thorax_hi" if e < 0.3 else "thorax"
    if folded:
        for s in (-1, 1):
            if ell(x, y, -3.1, s * 1.0, 5.2, 0.62) <= 1:
                return "wing_closed"
    e = ell(x, y, -3.0, 0, 3.8, 1.75)
    if e <= 1:
        if int(math.floor((x + 30) / 1.4)) % 2 == 0:
            return "abd_dark"
        return "abd_hi" if abs(y) < 0.8 else "abd"
    if not folded:
        phi = math.radians(wing)
        length, hw = 6.0, 1.5
        for s in (-1, 1):
            ux, uy = -math.cos(phi), s * math.sin(phi)
            cx, cy = 0.8 + ux * length / 2, s * 1.4 + uy * length / 2
            a = (x - cx) * ux + (y - cy) * uy
            b = -(x - cx) * uy + (y - cy) * ux
            ee = (a / (length / 2)) ** 2 + (b / hw) ** 2
            if ee <= 1:
                if abs(b) < 0.3:
                    return "wing_vein"
                return "wing_edge" if ee > 0.6 else "wing"
    return None


# ----------------------------------------------------------------- fish
# Half-width of the body from nose to peduncle: a wide head, then a taper.
FISH_HW = [(7.4, 0.0), (6.9, 0.7), (6.0, 1.35), (5.0, 1.6), (4.5, 2.4),
           (1.0, 2.4), (0.5, 1.6), (-3.5, 1.4), (-4.2, 0.9)]
TAIL_X0, TAIL_X1 = -4.0, -7.6      # base and tip of the tail
TAIL = [(TAIL_X0, -0.9), (TAIL_X1, -3.5), (TAIL_X1, -1.2), (-6.0, 0.0),
        (TAIL_X1, 1.2), (TAIL_X1, 3.5), (TAIL_X0, 0.9)]
HEAD_X = 2.5                       # the head starts here
BEND = 1.8                         # sideways swing of the tip, in pixels


def seg_dist(x, y, ax, ay, bx, by):
    """Distance from (x, y) to the segment a-b."""
    dx, dy = bx - ax, by - ay
    t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(x - (ax + t * dx), y - (ay + t * dy))


def fish(x, y, wag):
    """Top-down zebrafish: wide head, striped taper, forked striped tail.

    Args:
        x: Position along the body, in pixels; positive is toward the head.
        y: Position across the body, in pixels.
        wag: Tail swing from -1 to 1.

    Returns:
        The name of the body part at that point, or None for empty space.
    """
    # The rear half swings with the tail, more toward the tip, so the
    # stripes curve into the tail instead of only the tips moving.
    yc = wag * BEND * max(0.0, (0.5 - x) / 8.0) ** 1.7
    y -= yc
    # Eyes: a dark pupil one row in from the head's edge. The pale rim outside
    # it keeps the head five rows wide across the eyes, the same as the fly,
    # and the black sky cannot swallow the pupil.
    if abs(x - 6.0) < 0.5 and abs(abs(y) - 1.0) < 0.5:
        return "eye"
    hw = lerp_profile(FISH_HW, x)
    if hw is not None and abs(y) <= hw:
        ay = abs(y)
        if x > HEAD_X:
            return "head"
        if ay < 0.5:
            if int(math.floor(x + 30)) % 3 == 0:
                return "stripe_hi"
            return "stripe"
        if ay < 1.5:
            return "inter"
        return "stripe"
    # Forked tail: a swallowtail with a dark stripe down each lobe.
    if poly(x, y, TAIL):
        d = min(seg_dist(x, y, TAIL_X0, t * 0.3, -7.4, t * 2.4)
                for t in (-1, 1))
        return "tail_stripe" if d < 0.55 else "tail"
    # Small pectoral fins, flaring a little with the swing.
    flare = 0.35 * abs(wag)
    for s in (-1, 1):
        if poly(x, y, [(3.0, s * 2.2), (0.0, s * (3.9 + flare)),
                       (1.4, s * 2.2)]):
            return "fin"
    return None


# ---------------------------------------------------------------- style
FLY_C = {
    "head": ORANGE[1], "eye": RED[2], "thorax": YELLOW[1],
    "thorax_hi": ORANGE[3], "abd": ORANGE[3], "abd_dark": ORANGE[0],
    "abd_hi": ORANGE[4], "wing": SILVER, "wing_edge": "#B8B8C8",
    "wing_vein": "#9898B0", "wing_closed": "#B8B8C8",
}
FLY_EDGE = {
    "head": ORANGE[0], "thorax": ORANGE[1], "thorax_hi": YELLOW[1],
    "abd": ORANGE[1], "abd_dark": ORANGE[0], "abd_hi": ORANGE[2],
    "wing": SMOKE_HEX, "wing_edge": SMOKE_HEX, "wing_vein": SMOKE_HEX,
    "wing_closed": SMOKE_HEX, "eye": RED[1],
}
FISH_C = {
    "head": BLUE[4], "eye": "#606078", "stripe": BLUE[2],
    "stripe_hi": SKY[2], "inter": SKY[3], "tail": SKY[3],
    "tail_stripe": BLUE[2], "fin": BLUE[3],
}
FISH_EDGE = {
    "head": BLUE[3], "stripe": BLUE[1], "stripe_hi": BLUE[1],
    "inter": SKY[2], "tail": SKY[2], "tail_stripe": BLUE[2],
    "fin": "#808098", "eye": "#606078",
}
# Marks drawn as a checkerboard so translucent parts look see-through.
DITHER = {"wing", "fin", "wing_edge"}
# What each animal is drawn from: its shape, its fill colors and its edges.
SPECIES = (("fly", fly, FLY_C, FLY_EDGE), ("fish", fish, FISH_C, FISH_EDGE))


def render(shape, colors, edge, scale, pose, degrees, size=SIZE):
    """Draws one sprite frame as a pixel-art image.

    Each pixel samples the shape on a fine grid and takes the most common
    part, which keeps the outline crisp without blurring colors.

    Args:
        shape: Function that names the part at a point, such as fly.
        colors: Maps each part name to its fill color.
        edge: Maps a part name to its color where it touches empty space.
        scale: Size multiplier for the animal.
        pose: Extra argument passed to shape, such as the wing angle.
        degrees: Rotation of the frame, clockwise.
        size: Width and height of the image in pixels.

    Returns:
        An RGBA image with a transparent background.
    """
    center = size / 2
    theta = math.radians(degrees)
    c, s = math.cos(theta), math.sin(theta)
    grid = []
    for py in range(size):
        row = []
        for px in range(size):
            votes = Counter()
            for v in range(SUPER):
                for u in range(SUPER):
                    dx = px + (u + 0.5) / SUPER - center
                    dy = py + (v + 0.5) / SUPER - center
                    lx = (dx * c + dy * s) / scale
                    ly = (-dx * s + dy * c) / scale
                    votes[shape(lx, ly, pose)] += 1
            if votes[None] * 2 >= SUPER * SUPER:
                row.append(None)
            else:
                row.append(max((m for m in votes if m is not None),
                               key=lambda m: votes[m]))
        grid.append(row)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pix = img.load()

    def open_at(x, y):
        return not (0 <= x < size and 0 <= y < size) or grid[y][x] is None

    for y in range(size):
        for x in range(size):
            m = grid[y][x]
            if m is None:
                continue
            hexv = colors[m]
            on_edge = any(open_at(x + dx, y + dy)
                          for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if on_edge and m in edge:
                hexv = edge[m]
            if m in DITHER and (x + y) % 2 == 1 and not on_edge:
                continue
            pix[x, y] = (*_hex_rgb(hexv), 255)
    return img


def specs(kind):
    """Returns the (scale, pose) frames of each animation bank for a kind."""
    if kind == "fly":
        grow = list(zip(GROW, WING_GROW))
        flick = [(1.0, p) for p in FLAP]
    else:
        grow = [(s, 0.0) for s in GROW]
        flick = [(1.0, p) for p in FISH_WAG]
    return {"grow": grow, "flicker": flick, "shrink": grow[::-1]}


def write_all():
    """Writes every frame of the fly and fish next to this file."""
    for kind, shape, colors, edge in SPECIES:
        banks = specs(kind)
        for bank, frames in banks.items():
            d = OUT / kind / bank
            d.mkdir(parents=True, exist_ok=True)
            size, k = (FISH_SIZE, FISH_SCALE) if kind == "fish" else (SIZE, 1)
            for n, (scale, pose) in enumerate(frames, start=1):
                render(shape, colors, edge, scale * k, pose, 0, size).save(
                    d / f"{n}.png")
                render(shape, colors, edge, scale * k, pose, 45, size).save(
                    d / f"{n}_d.png")


if __name__ == "__main__":
    write_all()
