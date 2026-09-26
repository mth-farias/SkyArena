# Data pipeline

Downloads the raw packs and turns them into the files the app reads.

Run it through `scripts/setup.py`. Do not run the modules here by hand unless
you are debugging.

| Path | What it does |
|---|---|
| `download_raw.py` | Fetches stars, quakes, flies, and fish into `data/raw/`. Skips files already present. |
| `curate_capitals.py` | `data/raw/capitals/locations.json` to `data/curated/capitals.json` |
| `curate_stars.py` | `data/raw/stars/catalog` to `data/curated/stars_catalog` |
| `curate_quakes.py` | `data/raw/quakes/` to `data/curated/quakes_21062026.json` |
| `curate_flies.py` | Both `data/raw/flies/` recordings to `data/curated/fly.parquet` |
| `curate_fish.py` | Both `data/raw/fish/` recordings to `data/curated/fish.parquet` |
| `mobility.py` | Arena coverage and the ranking that keeps the more mobile half |
| `fiction_tracks.py` | Generates a fictional animal from one curated animal's own fitted locomotion model |
| `curate_fiction.py` | Both `{species}_fiction.parquet` files, which the cyber look draws |
| `arena_extent.py` | Measures real track extents, writes proof PNGs to `data/raw/`, maps paths onto the unit disk |
| `locomotion_hmm.py` | The locomotion observation model that shapes the bridge closing each track |
| `fly_hmm_trajectory.py`, `fish_hmm_trajectory.py` | Parse the idtracker.ai CSVs |

`data/raw/` is gitignored except `raw/capitals/`, which is small and ships with the
repo. Sources are cited in [`NOTICE`](../NOTICE).
