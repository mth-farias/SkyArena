# Track sprites

The fly (a drosophila) and the fish (a zebrafish) as PNG frames. Sources:
[`NOTICE`](../../../NOTICE).

Layout: `fly/` and `fish/`, each with `grow/`, `flicker/`, and `shrink/`.
Every fly frame `1.png` to `6.png` is 15x15 pixels (fish frames are 19x19) and
faces east; `1_d.png` to `6_d.png` is the same frame facing down-right. The
viewer turns both by whole quarter turns to reach all eight headings, so
nothing is resampled. Both animals are built on a main body 12 pixels long and
5 wide across the eyes, wings and tail excluded. `scripts/serve.py` serves
those PNGs at `GET /SPRITES/...`.

To redraw them, install Pillow and run `python organic_sprites.py` in this
folder. It reads its colors from [`../../palette.js`](../../palette.js)
through `pixel_sprites.py`, so every pixel stays inside the locked palette.
The trails that go with the sprites live in
[`../../trails.js`](../../trails.js). A neon look is kept in
`cyber-fly/`, `cyber-fish/`, `cyber-trails.js` and `cyber_sprites.py` here.

## Cyber look (not loaded)

`cyber-fly/` and `cyber-fish/` hold the neon wireframe fly and hologram fish.
`cyber_sprites.py` redraws them, and `cyber-trails.js` is the matching trail
code. To switch, point the sprite paths in `view.js` at the `cyber-` folders,
replace `trails.js` with `cyber-trails.js` (import `./palette.js`), and set
the counter colors in `COUNTER_LOOK` to the neon bands.
