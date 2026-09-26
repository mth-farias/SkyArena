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

## Cyber look

`cyber-fly/` and `cyber-fish/` hold the neon wireframe fly and hologram fish.
`cyber_sprites.py` redraws them, and `cyber-trails.js` is the matching trail
code. Every colour comes from [`../../palette.js`](../../palette.js), the same
locked palette the organic set uses — the neon look is a different set of
ramps, not a set of new colours.

The two animals differ in more than their shape. The fly is **violet
dominant**: its hull and wings sit on the violet ramp and only the lights and
the core keep the warm half, so no red survives anywhere on it. Its trail is
**not a line** — a run of fractal bursts with no master stroke through them,
thinning in length and colour with age, with warm sparkles shed between them.
The fish keeps its teal hologram and magenta tail, and its trail is still a
ladder of scan bars, sonar diamonds and data bits.

**It is loaded on demand.** A **member** is one animal in one look, and the sky
draws a team for each side of the dome before that sky loads. `view.js` fetches
only the members actually drawn — their animated frames and their tracks — and
caches the frames, which are never mutated. A look carries its sprites, its
trail, its trajectories and its counter colours together, because a neon animal
dragging an organic dust comet reads as a bug rather than a look.
