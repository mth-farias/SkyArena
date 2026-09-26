# SkyArena

**Flies versus fish, under a real night sky.**

Every sky in SkyArena is the sky above a real city, on a real date, drawn as
a 16-bit arcade cabinet would draw it: hard pixels, a locked palette, and a
PRESS START screen. Each star sends out spokes that carve the dome into
glowing cells. Among the stars swim two swarms taken from real laboratory
recordings, a school of zebrafish and a crowd of fruit flies. They drift
across the constellations.

Each animal that touches a star gives itself up: the star shatters in a burst
of light and the animal blinks out. Two counters, one on each side of the dome,
show how many flies and how many fish are left. When one swarm is wiped out,
the game ends and the sky travels to a new city.

The sky is never still. Press **Travel** and the dome dissolves and reforms
over another capital. Press **Shake** and it replays one of the earthquakes
from 21 June 2026. Leave **Live** on and the sky reacts to the real ones: when
the Earth shakes somewhere above your magnitude threshold, the whole dome
explodes and lands on the epicenter.

## Play it

1. Double-click [`SkyArena.bat`](SkyArena.bat). The piece opens at
   http://127.0.0.1:5444/app/.
2. Click, tap, or press Enter on the PRESS START screen.
3. Open **Controls** (bottom right) to switch layers, and **Live** (bottom
   left) for the earthquake threshold, Travel, and Shake. Both panels are
   glass: the sky shows through.
4. The round button under **Live** turns the game (the animals and their
   counters) on and off.

First time here? Follow [Setup](AGENTS.md#setup) in `AGENTS.md`.

## The specs

| | |
|---|---|
| Look | 720-row pixel grid scaled by whole numbers; every pixel from a locked 58-color palette; Press Start 2P for all text |
| Sky | Real star positions (CDS V/50) for the chosen city, date, and time; nine planet color schemes, one per new sky |
| Animals | Fly and fish tracks from idtracker.ai recordings, replayed at 10 Hz on the unit disk; the fly and the fish each have a 15-pixel sprite and a trail |
| Earthquakes | EMSC / SeismicPortal: a fixed set from 21 June 2026, plus a live feed that merges EMSC's real-time push channel with the USGS summary feed |
| Runs on | A canvas in the browser, no dependencies. A small Python server (`127.0.0.1:5444`, standard library only) serves the page and the data |
| Needs | Python 3.11+, a modern browser |

## What is in the box

- [`app/`](app/) — the piece. Start with [`app/README.md`](app/README.md).
- [`data/`](data/) — the curated data the piece reads. It ships with the repo.
- [`scripts/`](scripts/) — the server and the data pipeline.
- [`AGENTS.md`](AGENTS.md) — how to build on it with an AI assistant.
- [`NOTICE`](NOTICE) — data sources, the font, and third-party licences.

## License

MIT ([`LICENSE`](LICENSE)). Third-party notices: [`NOTICE`](NOTICE).
