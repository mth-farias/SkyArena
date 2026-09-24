/**
 * Trails for the flies and the fish.
 *
 * Flies leave a comet trail of dust and embers and fish leave a water trail of
 * a V wake, ripple rings, and bubbles. Every trail is a pure function of the
 * animal's path and the clock, so nothing is stored per frame and a resize or
 * pause cannot break it. A trail draws palette colors only, one art pixel at a
 * time, into a small buffer around the head, and every trail reaches the same
 * distance behind the head (REACH), whatever the animal's speed.
 *
 * A second, neon look is kept in `utils/sprites/cyber-*`.
 */

import {RAMPS} from './palette.js?v=1';

const R = RAMPS;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Half the side of the buffer around the head, in art pixels. */
const HALF = 36;
/** How far behind the head every trail reaches, in art pixels. */
const REACH = 28;
/** Where a trail starts behind the head, in art pixels. */
const SKIP = 3;

/** f to the power 0.7 for f in [0, 1], the soft edge of a dab. */
const FALLOFF =
    Float32Array.from({length: 256}, (_, i) => Math.pow(i / 255, 0.7));

/** Integer hash to [0, 1): the same input always gives the same jitter. */
function hash(i, k) {
  let x = (Math.imul(i, 374761393) + Math.imul(k, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Unit direction of travel at time t. */
function dirAt(path, t) {
  const a = path(t - 0.02);
  const b = path(t + 0.02);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return {x: dx / l, y: dy / l};
}

/**
 * Path samples from the head backward until they are `maxArc` pixels behind
 * it or `span` seconds old. `s` is the age in seconds.
 */
function history(path, t, span, dt, maxArc) {
  const pts = [];
  let arc = 0;
  let prev = null;
  for (let s = 0; s <= span; s += dt) {
    const p = path(t - s);
    const d = dirAt(path, t - s);
    if (prev) {
      arc += Math.hypot(p.x - prev.x, p.y - prev.y);
    }
    pts.push({x: p.x, y: p.y, arc, s, tx: d.x, ty: d.y, nx: -d.y, ny: d.x});
    if (arc > maxArc) {
      break;
    }
    prev = p;
  }
  return pts;
}

/**
 * A small buffer that follows the head. Trail code works in canvas pixels;
 * the buffer shifts them into its own frame, drops the ones outside, and
 * keeps the last color written to each cell. Flushing draws every touched
 * cell once, one color at a time, which is far cheaper than uploading an
 * image for each of the many animals.
 */
class TrailBuffer {
  constructor() {
    this.size = HALF * 2;
    this.cells = new Int16Array(this.size * this.size);
    this.touched = new Int32Array(this.size * this.size);
    this.count = 0;
    this.field = new Float32Array(this.size * this.size);
    this.colorIds = new Map();
    this.colorHex = [];
    this.byColor = [];
    this.ox = 0;
    this.oy = 0;
    this.resetBounds();
  }

  /** Forgets which field cells were touched: the field is empty again. */
  resetBounds() {
    this.fx0 = this.fy0 = this.size;
    this.fx1 = this.fy1 = -1;
  }

  /** Centers the buffer on the head and clears it. */
  begin(head) {
    this.ox = Math.round(head.x) - HALF;
    this.oy = Math.round(head.y) - HALF;
    this.count = 0;
    this.resetBounds();
  }

  /** Write one pixel, in canvas coordinates. */
  put(x, y, hex) {
    this.set(Math.floor(x) - this.ox, Math.floor(y) - this.oy, hex);
  }

  /** Write one pixel, in buffer coordinates; pixels outside are dropped. */
  set(x, y, hex) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) {
      return;
    }
    let id = this.colorIds.get(hex);
    if (id === undefined) {
      id = this.colorHex.length;
      this.colorIds.set(hex, id);
      this.colorHex.push(hex);
      this.byColor.push([]);
    }
    const cell = y * this.size + x;
    if (this.cells[cell] === 0) {
      this.touched[this.count++] = cell;
    }
    this.cells[cell] = id + 1;
  }

  /** Adds a soft round dab to the intensity field (max blend). */
  splat(cx, cy, r, v0) {
    cx -= this.ox;
    cy -= this.oy;
    const n = this.size;
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(n - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(n - 1, Math.ceil(cy + r + 1));
    if (x0 < this.fx0) this.fx0 = x0;
    if (x1 > this.fx1) this.fx1 = x1;
    if (y0 < this.fy0) this.fy0 = y0;
    if (y1 > this.fy1) this.fy1 = y1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const f = 1 - Math.sqrt(dx * dx + dy * dy) / (r + 0.6);
        if (f <= 0) {
          continue;
        }
        const v = v0 * FALLOFF[(f * 255) | 0];
        const i = y * n + x;
        if (v > this.field[i]) {
          this.field[i] = v;
        }
      }
    }
  }

  /** Maps the field to `colors` (hottest first) and clears it. */
  resolve(colors, dither, cut) {
    const n = colors.length;
    const size = this.size;
    for (let y = Math.max(0, this.fy0); y <= this.fy1; y++) {
      for (let x = Math.max(0, this.fx0); x <= this.fx1; x++) {
        const i = y * size + x;
        const v = this.field[i];
        if (v <= 0) {
          continue;
        }
        this.field[i] = 0;
        const vv = v + (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * dither;
        if (vv < cut) {
          continue;
        }
        const shade = Math.floor((1 - vv) * n);
        this.set(x, y, colors[Math.min(n - 1, Math.max(0, shade))]);
      }
    }
  }

  /** Draws the buffer onto the arena canvas and empties it. */
  flush(ctx) {
    const size = this.size;
    for (let i = 0; i < this.count; i++) {
      const cell = this.touched[i];
      this.byColor[this.cells[cell] - 1].push(cell);
      this.cells[cell] = 0;
    }
    const prev = ctx.fillStyle;
    for (let c = 0; c < this.byColor.length; c++) {
      const list = this.byColor[c];
      if (list.length === 0) {
        continue;
      }
      ctx.fillStyle = this.colorHex[c];
      for (const cell of list) {
        ctx.fillRect(
            this.ox + (cell % size), this.oy + Math.floor(cell / size), 1, 1);
      }
      list.length = 0;
    }
    ctx.fillStyle = prev;
    this.count = 0;
  }
}

/**
 * Distance an animal has traveled along its looping track, in track units.
 * `pathAt(t)` gives the position in track units at time t; the track repeats
 * every `period` seconds. Structured marks (ripple rings) use it to sit every
 * few pixels of traveled distance.
 */
export function buildOdometer(pathAt, period, steps) {
  const dt = period / steps;
  const d = new Float64Array(steps + 1);
  let prev = pathAt(0);
  for (let i = 1; i <= steps; i++) {
    const p = pathAt(i * dt);
    d[i] = d[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return {period, dt, d, loop: d[steps]};
}

/** Distance traveled at time t, in track units. */
function odoAt(odo, t) {
  const cycles = Math.floor(t / odo.period);
  const f = (t - cycles * odo.period) / odo.dt;
  const i = Math.min(odo.d.length - 2, Math.floor(f));
  return cycles * odo.loop + odo.d[i] + (odo.d[i + 1] - odo.d[i]) * (f - i);
}

/** Time at which the animal had traveled `dist` track units. */
function odoTime(odo, dist) {
  const cycles = Math.floor(dist / odo.loop);
  const rem = dist - cycles * odo.loop;
  let lo = 0;
  let hi = odo.d.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (odo.d[mid] <= rem) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const frac = (rem - odo.d[lo]) / ((odo.d[hi] - odo.d[lo]) || 1);
  return cycles * odo.period + (lo + frac) * odo.dt;
}

/**
 * Seconds the head needs to cover `arc` art pixels, counted backward from now.
 * Time-based effects (embers, bubbles) use it as their life, so they end at
 * the same distance for a fast animal and a slow one. The cap keeps a nearly
 * stopped animal from stretching its trail.
 */
function span(path, t, arc) {
  let dist = 0;
  let prev = path(t);
  for (let s = 1 / 60; s <= 1.6; s += 1 / 60) {
    const p = path(t - s);
    dist += Math.hypot(p.x - prev.x, p.y - prev.y);
    if (dist >= arc) {
      return s;
    }
    prev = p;
  }
  return 1.6;
}

/**
 * Marks sit every `gap` art pixels of traveled distance, so they stay put in
 * the sky, are evenly spaced at any speed, and age by how far behind the head
 * they are. Returns {k, tm, behind} for marks between `from` and `to` pixels
 * behind the head: the mark index, the time the head was there, and the
 * distance behind. `scale` converts art pixels to track units.
 */
function marks(odo, scale, t, gap, from, to) {
  if (!(odo.loop > 1e-9)) {
    return [];
  }
  const D = odoAt(odo, t) * scale;
  const out = [];
  for (let k = Math.floor((D - from) / gap); k >= 0 && k * gap > D - to; k--) {
    out.push({k, tm: odoTime(odo, k * gap / scale), behind: D - k * gap});
  }
  return out;
}

// ------------------------------------------------------------------------ fly

// Warm and fairly bright: a butter-yellow core, then orange to deep red.
const FLY_ORG = [
  R.yellow[3], R.yellow[2], R.orange[3], R.orange[2], R.orange[1], R.red[1],
  R.red[0],
];
const FLY_EMBER = [
  R.yellow[2], R.orange[3], R.orange[2], R.orange[1], R.red[1], R.red[0],
];

/** Comet: a tapered, faintly sinuous dust tail with drifting embers. */
function flyTrail(sky, path, t) {
  const LEN = REACH - SKIP;
  const pts = history(path, t, 1.6, 1 / 90, REACH + 2);
  for (const p of pts) {
    const a = (p.arc - SKIP) / LEN;
    if (a < 0) {
      continue;
    }
    if (a > 1) {
      break;
    }
    const off = Math.sin(a * 11 - t * 10) * a * 1.4;
    const r = 0.5 + 2.1 * Math.pow(1 - a, 1.2);
    sky.splat(
        p.x + p.nx * off, p.y + p.ny * off, r, 0.95 * Math.pow(1 - a, 0.9));
  }
  sky.resolve(FLY_ORG, 0.12, 0.06);

  const RATE = 16;
  const LIFE = span(path, t, REACH - 3);
  for (let i = Math.floor((t - LIFE) * RATE); i <= Math.floor(t * RATE); i++) {
    const ti = i / RATE;
    const age = (t - ti) / LIFE;
    if (age < 0 || age >= 1 || hash(i, 1) < 0.3 ||
        hash(i, 100 + Math.floor(t * 12)) < 0.15) {
      continue;
    }
    const p = path(ti);
    const d = dirAt(path, ti);
    const side = (hash(i, 2) - 0.5) * 2;
    const spread = 1 + age * 5.5;
    const x = p.x - d.x * 3 - d.y * side * spread +
        (hash(i, 3) - 0.5) * 3 * age;
    const y = p.y - d.y * 3 + d.x * side * spread +
        (hash(i, 4) - 0.5) * 3 * age;
    const k = Math.floor(age * 6);
    sky.put(x, y, FLY_EMBER[k]);
    if (hash(i, 5) > 0.7 && age < 0.35) {
      sky.put(x + 1, y, FLY_EMBER[k]);
      sky.put(x, y + 1, FLY_EMBER[k]);
      sky.put(x + 1, y + 1, FLY_EMBER[Math.min(5, k + 1)]);
    }
  }
}

// ----------------------------------------------------------------------- fish

// Darker than near-white: the freshest ripple is light sky blue.
const WATER = [R.sky[3], R.sky[2], R.sky[1], R.sky[0]];

/**
 * Draw a ring of radius r as dots, in twelve arcs; `keep(k)` says whether arc
 * k is drawn, so a ring can be broken up.
 */
function ring(sky, cx, cy, r, hex, keep) {
  const n = Math.max(8, Math.ceil(r * 7));
  for (let k = 0; k < n; k++) {
    const th = (k / n) * Math.PI * 2;
    if (keep(Math.floor(th / (Math.PI / 6)))) {
      sky.put(cx + Math.cos(th) * r, cy + Math.sin(th) * r, hex);
    }
  }
}

/** Water: a soft V wake, broken ripple rings, and bubbles that pop. */
function fishTrail(sky, path, t, odo, scale) {
  const LEN = REACH - SKIP;
  const pts = history(path, t, 1.6, 1 / 90, REACH + 2);
  for (const p of pts) {
    const a = (p.arc - SKIP) / LEN;
    if (a < 0) {
      continue;
    }
    if (a > 1) {
      break;
    }
    const arm = (0.9 + a * 4.5) * (1 + 0.12 * Math.sin(a * 14 - t * 6));
    const fade = Math.pow(1 - a, 1.5);
    sky.splat(p.x + p.nx * arm, p.y + p.ny * arm, 0.5, 0.75 * fade);
    sky.splat(p.x - p.nx * arm, p.y - p.ny * arm, 0.5, 0.75 * fade);
    if (a < 0.4) {
      const off = Math.sin(a * 9 - t * 7) * a * 1.2;
      const fresh = 1 - a * 2.5;
      sky.splat(p.x + p.nx * off, p.y + p.ny * off, 0.4 + 0.9 * fresh,
          0.85 * Math.pow(fresh, 1.2));
    }
  }
  sky.resolve(WATER, 0.16, 0.1);

  // A ring reaches 6.7 px wide at the end of its life, so it is born closer in.
  const RING_ARC = REACH - 9.5;
  for (const m of marks(odo, scale, t, 4.5, 0, RING_ARC)) {
    const age = m.behind / RING_ARC;
    const p = path(m.tm);
    const d = dirAt(path, m.tm);
    const r = 1.2 + 5.5 * Math.pow(age, 0.75);
    const tone = WATER[Math.min(3, Math.floor(age * 4))];
    ring(sky, p.x - d.x * 2.5, p.y - d.y * 2.5, r, tone,
        (seg) => hash(m.k, seg) > 0.25 + 0.45 * age);
  }

  const B_RATE = 8;
  const B_LIFE = span(path, t, REACH - 4);
  const first = Math.floor((t - B_LIFE) * B_RATE);
  for (let i = first; i <= Math.floor(t * B_RATE); i++) {
    const ti = i / B_RATE;
    const age = (t - ti) / B_LIFE;
    if (age < 0 || age >= 1) {
      continue;
    }
    const p = path(ti);
    const d = dirAt(path, ti);
    const side = (hash(i, 2) - 0.5) * 2;
    const spread = 1.2 + age * 4.5;
    const x = p.x - d.x * 4 - d.y * side * spread + Math.sin(age * 9 + i) * 0.9;
    const y = p.y - d.y * 4 + d.x * side * spread + Math.cos(age * 8 + i) * 0.9;
    if (age > 0.86) {
      sky.put(x - 1, y, R.sky[1]);
      sky.put(x + 1, y, R.sky[1]);
      sky.put(x, y - 1, R.sky[1]);
      sky.put(x, y + 1, R.sky[1]);
    } else if (hash(i, 6) < 0.35) {
      sky.put(x, y, R.sky[3]);
      sky.put(x + 1, y, R.sky[2]);
      sky.put(x, y + 1, R.sky[2]);
      sky.put(x + 1, y + 1, R.sky[1]);
    } else {
      sky.put(x, y, age < 0.5 ? R.sky[3] : R.sky[2]);
    }
  }
}

const TRAILS = {fly: flyTrail, fish: fishTrail};

const buffer = new TrailBuffer();

/** Seconds of history the sampler covers behind the clock, and its step. */
const WINDOW_S = 1.75;
const SAMPLE_DT = 1 / 60;
const WINDOW_N = Math.ceil((WINDOW_S + 0.1) / SAMPLE_DT) + 1;
const sampleX = new Float64Array(WINDOW_N);
const sampleY = new Float64Array(WINDOW_N);
const sampleOk = new Uint8Array(WINDOW_N);

/**
 * Wraps the animal's path in a cache. The game's path is costly to evaluate
 * and a trail asks for it many times, so the wrapper computes it lazily on a
 * fixed 60 Hz grid around the clock and interpolates between the samples.
 */
function cachedPath(path, t) {
  const t0 = t - WINDOW_S;
  sampleOk.fill(0);
  const cell = (i) => {
    if (!sampleOk[i]) {
      const p = path(t0 + i * SAMPLE_DT);
      sampleX[i] = p.x;
      sampleY[i] = p.y;
      sampleOk[i] = 1;
    }
  };
  return (time) => {
    const f = Math.min(WINDOW_N - 1.001, Math.max(0, (time - t0) / SAMPLE_DT));
    const i = Math.floor(f);
    cell(i);
    cell(i + 1);
    const u = f - i;
    return {
      x: sampleX[i] + (sampleX[i + 1] - sampleX[i]) * u,
      y: sampleY[i] + (sampleY[i + 1] - sampleY[i]) * u,
    };
  };
}

/**
 * Draws one animal's trail onto `ctx`.
 *
 * `kind` is `fly` or `fish`, `path(t)` gives the animal's position in canvas
 * pixels at time t, `odo` is its odometer (see buildOdometer) and `scale` is
 * canvas pixels per track unit.
 */
export function drawTrail(ctx, kind, path, t, odo, scale) {
  const cached = cachedPath(path, t);
  buffer.begin(cached(t));
  TRAILS[kind](buffer, cached, t, odo, scale);
  buffer.flush(ctx);
}
