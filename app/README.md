# The piece

How the piece in `app/` works. The pitch and the specs are in the root
[`README.md`](../README.md); sources are in [`NOTICE`](../NOTICE).

## Open it

Double-click [`SkyArena.bat`](../SkyArena.bat) in the repo root. It stops any
leftover server on `127.0.0.1:5444`, starts one, and opens
http://127.0.0.1:5444/app/. The curated data ships with the repo; run
`scripts/setup.py` only to rebuild it.

## How it draws

The piece renders on a pixel grid of about 720 rows, scaled up by a whole
number of at least 2 device pixels. Every pixel comes from the locked 58-color
palette in [`palette.js`](palette.js), plus 45 muted colors only the planet
schemes use. Lines are straight and soft edged, with each edge pixel snapped to
a palette shade.

It opens on a PRESS START screen. Click, tap, or press Enter or Space to begin;
there is nothing to set up first.

## How the sky picks its teams

A **member** is one animal in one look, and there are four: the organic fly, the
organic fish, the cyber fly, and the cyber fish. A **team** is what one side of
the dome plays, and it is either one member or two.

Every new sky draws a matchup of one of three kinds. Seven skies in ten field a
team of one; the rest are collaborations, split evenly between the two kinds:

| Matchup | Share | Left side | Right side |
|---|---|---|---|
| Single | 70% | one member | one of the other three, so a team never faces itself |
| Look | 15% | the organic pair | the cyber pair |
| Species | 15% | the fly pair | the fish pair |

A side's team is drawn again on **every** sky, so Travel, Shake and the live feed
all bring new teams, and the same one can come up twice in a row. Only the
members actually drawn are fetched. Their frames are cached, and their tracks are
reloaded for each sky because the sky mutates them.

The star count is drawn in fours. It halves between the two sides and, when a
side fields a team of two, quarters again between its members.

The two counters read the animals each side has left. A team of one wears its
member's colours on both digits. A team of two wears one member's colours on each
digit, and which member takes the tens digit is drawn per sky — so the colours
say what a team is made of while the number is the team's total. A side is out
only once **both** of its members are gone.

## What is on screen

After the teams are drawn the full piece plays: the game button is on, and Live
is on with a magnitude threshold of 3.0. The Controls menu, bottom right,
switches each layer: Circle, Stars, Voronoi, Wiggle, Spokes, Sparkle, Cursor,
Left, Right, Interact, Color. The Left and Right rows carry a count bar for
their side. The Live menu, bottom left, holds the live toggle, the magnitude
bar, and the Travel and Shake buttons. The round button under the Live button
turns the game on or off: the animals, the star kills, and the two counters at
the sides of the dome.

Every fourth flowing dot on a cell edge receives a spoke from each of the two
stars beside it. Stars load from `/api/get_data`. Tracks load from
`/api/flies.bin` and `/api/fish.bin`. Live events come from
`/api/quakes/live`.

## Runtime getters

- [`utils/get_data.py`](utils/get_data.py) — JSON for capitals, stars, and
  quakes; optional fly and fish lists
- [`utils/data_lookup/quakes_live.py`](utils/data_lookup/quakes_live.py) — the
  rolling store behind `/api/quakes/live`, filled by a thread on EMSC's
  real-time push channel and a thread polling the USGS summary feed
- [`utils/data_lookup/tracks_bin.py`](utils/data_lookup/tracks_bin.py) — the
  Float32 track blob behind `/api/flies.bin` and `/api/fish.bin`; add
  `&set=fiction` for the fictional tracks the cyber look draws
- [`trails.js`](trails.js) — the comet and water trails for the animals
- [`planets.js`](planets.js) — the nine planet color schemes (spoke hues, star
  tones, rim glow), the weighted no-repeat pick for a new sky, and the halo
  painter
- [`utils/sprites/`](utils/sprites/) — fly and fish PNG frames in two sets,
  organic and neon (`GET /SPRITES/` from `scripts/serve.py`); the member decides
  which set draws
- `../data/curated/` — the curated files: `capitals.json`,
  `stars_catalog`, `quakes_21062026.json`, `fly.parquet`, `fish.parquet`,
  `fly_fiction.parquet`, `fish_fiction.parquet`

Fly and fish points are 10 Hz tracks on the unit disk: a bridge that turns the
end back to the first sample, then a rim clip. A team takes the rate of its own
species from `playback`, so a match between two flies reads `fly_point_hz`
twice. The arena proof PNGs stay in `data/raw/`. Call `get_data` with keyword
arguments:

```python
from app.utils.get_data import get_data

bundle = get_data(
    n_stars=108,
    lat=38.72,
    lon=-9.13,
    date="2026-06-21",
    n_flies=100,
    n_fish=100,
)
```
