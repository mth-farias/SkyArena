"""Neon fly (violet wireframe) and fish (teal hologram, magenta tail), 15x15.

Both animals share a main body 12 pixels long and 5 wide across the eyes,
wings and tail excluded.

Run ``python cyber_sprites.py`` to rewrite ``cyber-<kind>/<bank>/<n>.png``
(facing east) and ``<n>_d.png`` (facing down-right), for ``kind`` in
``fly``/``fish``, ``bank`` in ``grow``/``flicker``/``shrink`` and ``n`` = 1 to
6. The viewer turns both by whole quarter turns to reach all eight headings.
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
ORANGE, YELLOW = R["orange"], R["yellow"]
TEAL, MAGENTA, VIOLET = R["teal"], R["magenta"], R["violet"]
# The palette's darkest neutral, used for the dark hull of both animals.
HULL = "#181820"

SMIN = 0.72
GROW = (SMIN, 0.78, 0.85, 0.91, 0.96, 1.0)
WING_MAX, WING_MIN = 66.0, 40.0
FLAP = (WING_MAX, WING_MIN) * 3
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


def seg_dist(x, y, ax, ay, bx, by):
    """Returns the distance from (x, y) to the segment a-b."""
    dx, dy = bx - ax, by - ay
    t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(x - (ax + t * dx), y - (ay + t * dy))


def lerp_profile(table, x):
    """Looks up x in a piecewise-linear table that runs from high x to low x.

    Returns:
        The interpolated value, or None when x is outside the table.
    """
    if x > table[0][0] or x < table[-1][0]:
        return None
    for (x0, v0), (x1, v1) in zip(table, table[1:]):
        if x1 <= x <= x0:
            return v0 + (v1 - v0) * (x0 - x) / (x0 - x1)
    return None


# ------------------------------------------------------------ fly parts
def fly_zones(x, y):
    """Returns which body zone holds (x, y): head, thorax, abd or None.

    The zones together make the shared silhouette, 12 long and 5 wide.
    """
    if ell(x, y, 4.5, 0, 1.15, 2.5) <= 1:
        return "head"
    if ell(x, y, 1.0, 0, 2.6, 2.5) <= 1:
        return "thorax"
    if ell(x, y, -3.6, 0, 3.0, 1.75) <= 1:
        return "abd"
    return None


def wing_frame(x, y, phi, s):
    """Returns wing-local coordinates (a along, b across) for wing side s."""
    ux, uy = -math.cos(phi), s * math.sin(phi)
    cx, cy = 0.8, s * 1.4
    a = (x - cx) * ux + (y - cy) * uy
    b = -(x - cx) * uy + (y - cy) * ux
    return a, b


def wing_light(x, y, wing):
    """A thin bright bar with a dithered glow around it."""
    phi = math.radians(wing)
    for s in (-1, 1):
        a, b = wing_frame(x, y, phi, s)
        if -0.3 <= a <= 6.3:
            if abs(b) < 0.55:
                return "wing_line"
            if abs(b) < 1.5:
                return "wing_glow"
    return None


def wing_folded(x, y):
    """Returns "wing_closed" where the folded wings lie along the body."""
    for s in (-1, 1):
        if ell(x, y, -3.1, s * 1.0, 5.2, 0.62) <= 1:
            return "wing_closed"
    return None


# ---------------------------------------------------------------- flies
def fly_neon(x, y, pose):
    """Neon wireframe fly: dark body with glowing edges, light-bar wings.

    Args:
        x: Position along the body, in pixels; positive is toward the head.
        y: Position across the body, in pixels.
        pose: A (wing angle in degrees or None, tail-glow flag) pair.

    Returns:
        The name of the part at that point, or None for empty space.
    """
    wing, k = pose
    z = fly_zones(x, y)
    if z == "head":
        if abs(y) > 0.9 and x > 3.6:
            # Shaded eye: bright yellow, pale at the front, orange at the back.
            if x > 4.5 and abs(y) < 1.5:
                return "led_hi"
            if x < 4.5 and abs(y) > 1.5:
                return "led_sh"
            return "led"
        return "hull"
    if z == "thorax":
        if math.hypot(x - 1.0, y) < 0.75:
            return "core"
        return "hull"
    if wing is None:
        w = wing_folded(x, y)
        if w and z is None:
            return "wing_line"
    if z == "abd":
        return "hull_tip" if x < -5.6 and k else "hull"
    if wing is not None:
        return wing_light(x, y, wing)
    return None


# ----------------------------------------------------------------- fish
FISH_HW = [(7.4, 0.0), (6.9, 0.7), (6.0, 1.35), (5.0, 1.6), (4.5, 2.4),
           (1.0, 2.4), (0.5, 1.6), (-3.5, 1.4), (-4.2, 0.9)]
TAIL_X0, TAIL_X1 = -4.0, -7.6
HEAD_X = 2.5
BEND = 1.8


def fish_zone(x, y, wag):
    """Returns (zone, y) for the fish body, with y in the tail-bent frame."""
    yc = wag * BEND * max(0.0, (0.5 - x) / 8.0) ** 1.7
    y -= yc
    hw = lerp_profile(FISH_HW, x)
    if hw is not None and abs(y) <= hw:
        return ("head" if x > HEAD_X else "body"), y
    return None, y


# The forked tail seen from above.
TAIL_FORK = [(TAIL_X0, -0.9), (TAIL_X1, -3.5), (TAIL_X1, -1.2), (-6.0, 0.0),
             (TAIL_X1, 1.2), (TAIL_X1, 3.5), (TAIL_X0, 0.9)]


def tail_axis(x, y, poly_pts):
    """Returns "tail_stripe" or "tail" inside the tail polygon, else None."""
    if poly(x, y, poly_pts):
        d = min(seg_dist(x, y, TAIL_X0, t * 0.3, -7.4, t * 2.4)
                for t in (-1, 1))
        return "tail_stripe" if d < 0.55 else "tail"
    return None


def fish_neon(x, y, pose):
    """Neon hologram fish: dark hull, glowing edges, scan-line stripe.

    Args:
        x: Position along the body, in pixels; positive is toward the head.
        y: Position across the body, in pixels.
        pose: A (tail swing from -1 to 1, unused flag) pair.

    Returns:
        The name of the part at that point, or None for empty space.
    """
    wag, k = pose
    z, y = fish_zone(x, y, wag)
    if abs(x - 6.0) < 0.5 and abs(abs(y) - 1.0) < 0.5:
        return "led"
    if z in ("head", "body"):
        if abs(y) < 0.5 and x < 2.5:
            return "scan"
        return "hull"
    t = tail_axis(x, y, TAIL_FORK)
    if t:
        return "streak" if t == "tail_stripe" else "streak_glow"
    return None


# ---------------------------------------------------------------- styles
# Parts that count toward the measured body size, which excludes wings and
# tail.
FLY_BODY = {"led", "led_hi", "led_sh", "hull", "hull_tip", "core"}
FISH_BODY = {"led", "hull", "scan"}

# Each entry maps a kind to its shape function, fill colors, edge colors,
# dithered parts and body parts.
STYLES = {
    "fly": {
        "shape": fly_neon,
        "colors": {
            "hull": VIOLET[1], "hull_tip": VIOLET[1], "led": YELLOW[2],
            "led_hi": YELLOW[3], "led_sh": ORANGE[2], "core": ORANGE[4],
            "wing_line": ORANGE[2], "wing_glow": VIOLET[2],
            "wing_closed": VIOLET[1],
        },
        "edge": {
            "hull": ORANGE[2], "hull_tip": ORANGE[3], "led": YELLOW[2],
            "led_hi": YELLOW[3], "led_sh": ORANGE[2], "wing_line": VIOLET[4],
            "wing_glow": VIOLET[0],
        },
        "dither": {"wing_glow"},
        "body": FLY_BODY,
    },
    "fish": {
        "shape": fish_neon,
        "colors": {
            "hull": HULL, "led": VIOLET[2], "scan": TEAL[3],
            "streak": MAGENTA[2], "streak_glow": MAGENTA[1],
        },
        "edge": {
            "hull": TEAL[2], "scan": TEAL[2], "streak": MAGENTA[3],
            "streak_glow": MAGENTA[1], "led": VIOLET[2],
        },
        "dither": {"streak_glow"},
        "body": FISH_BODY,
    },
}


def sample_grid(shape, scale, pose, degrees, size=SIZE):
    """Samples a shape into a size-by-size grid of part names.

    Each pixel samples the shape on a fine grid and takes the most common
    part, which keeps the outline crisp.

    Args:
        shape: Function that names the part at a point.
        scale: Size multiplier for the animal.
        pose: Extra argument passed to shape.
        degrees: Rotation of the frame, clockwise.
        size: Width and height of the grid in pixels.

    Returns:
        A list of rows; each cell is a part name or None when empty.
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
    return grid


def render(style, scale, pose, degrees, size=SIZE):
    """Draws one sprite frame as a pixel-art image.

    Args:
        style: One entry of STYLES.
        scale: Size multiplier for the animal.
        pose: Extra argument passed to the style's shape function.
        degrees: Rotation of the frame, clockwise.
        size: Width and height of the image in pixels.

    Returns:
        An RGBA image with a transparent background.
    """
    grid = sample_grid(style["shape"], scale, pose, degrees, size)
    colors, edge, dither = style["colors"], style["edge"], style["dither"]
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
            if m in dither and (x + y) % 2 == 1 and not on_edge:
                continue
            pix[x, y] = (*_hex_rgb(hexv), 255)
    return img


def specs(kind):
    """Returns the (scale, pose) frames of each animation bank for a kind."""
    if kind == "fly":
        grow = [(s, (w, 0)) for s, w in zip(GROW, WING_GROW)]
        flick = [(1.0, (p, k % 2)) for k, p in enumerate(FLAP)]
    else:
        grow = [(s, (0.0, 0)) for s in GROW]
        flick = [(1.0, (w, k % 2)) for k, w in enumerate(FISH_WAG)]
    return {"grow": grow, "flicker": flick, "shrink": grow[::-1]}


def check_size(kind, style):
    """Prints the body size, which must be 12 long and 5 wide at the eyes."""
    pose = (WING_MAX, 0) if kind == "fly" else (0.0, 0)
    grid = sample_grid(style["shape"], 1.0, pose, 0)
    pts = [(x - 7, y - 7) for y, r in enumerate(grid) for x, m in enumerate(r)
           if m in style["body"]]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    length, width = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
    print(f"{kind}: body {length} long x {width} wide, x {min(xs)}..{max(xs)}")



def write_all():
    """Writes every frame of both animals next to this file."""
    for kind, style in STYLES.items():
        for bank, frames in specs(kind).items():
            d = OUT / f"cyber-{kind}" / bank
            d.mkdir(parents=True, exist_ok=True)
            size, k = (FISH_SIZE, FISH_SCALE) if kind == "fish" else (SIZE, 1)
            for n, (scale, pose) in enumerate(frames, start=1):
                render(style, scale * k, pose, 0, size).save(d / f"{n}.png")
                render(style, scale * k, pose, 45, size).save(d / f"{n}_d.png")


def main():
    """Checks the body size, then writes every frame of both animals."""
    for kind, style in STYLES.items():
        check_size(kind, style)
    write_all()


if __name__ == "__main__":
    main()
