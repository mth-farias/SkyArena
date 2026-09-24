# Runtime getters

`get_data.py` is the public entry. Lookups live in `data_lookup/` so each object
type stays in its own module. Fly and fish parquet points are on the unit disk.
The arena proof PNGs live in `data/raw/`, not here.

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

| Module | Curated file |
|--------|----------------|
| `data_lookup/capitals_location.py` | `data/curated/capitals.json` |
| `data_lookup/stars_location.py` | `data/curated/stars_catalog` |
| `data_lookup/quakes_location.py` | `data/curated/quakes_21062026.json` |
| `data_lookup/flies_location.py` | `data/curated/fly.parquet` |
| `data_lookup/fish_location.py` | `data/curated/fish.parquet` |
| `sprites/` | fly and fish PNG frames (`GET /SPRITES/`) |
