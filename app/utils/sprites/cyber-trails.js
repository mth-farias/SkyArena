/**
 * Trails for the flies and the fish.
 *
 * Flies leave a cyber comet of light packets and fish leave a ladder of scan
 * bars, sonar diamonds, and data bits. Every trail is a pure function of the
 * animal's path and the clock, so nothing is stored per frame and a resize or
 * pause cannot break it. A trail draws palette colors only, one art pixel at a
 * time, into a small buffer around the head, and every trail reaches the same
 * distance behind the head (REACH), whatever the animal's speed.
 */

import {RAMPS} from '../../palette.js';

const R = RAMPS;

/** Half the side of the buffer around the head, in art pixels. */
const HALF = 36;
/** How far behind the head every trail reaches, in art pixels. */
const REACH = 28;
/** Where a trail starts behind the head, in art pixels. */
const SKIP = 3;

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
    this.colorIds = new Map();
    this.colorHex = [];
    this.byColor = [];
    this.ox = 0;
    this.oy = 0;
  }

  /** Centers the buffer on the head and clears it. */
  begin(head) {
    this.ox = Math.round(head.x) - HALF;
    this.oy = Math.round(head.y) - HALF;
    this.count = 0;
  }

  put(x, y, hex) {
    this.set(Math.floor(x) - this.ox, Math.floor(y) - this.oy, hex);
  }

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

  line(x0, y0, x1, y1, hex) {
    x0 = Math.floor(x0);
    y0 = Math.floor(y0);
    x1 = Math.floor(x1);
    y1 = Math.floor(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.put(x0, y0, hex);
      if (x0 === x1 && y0 === y1) {
        return;
      }
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
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
        ctx.fillRect(this.ox + (cell % size), this.oy + Math.floor(cell / size), 1, 1);
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
 * every `period` seconds. Structured marks (rungs, diamonds) use it to sit
 * every few pixels of traveled distance.
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
 * Time-based effects (packets, sparks, bits) use it as their life, so they
 * end at the same distance for a fast animal and a slow one. The cap keeps a
 * nearly stopped animal from stretching its trail.
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

// Yellow head cooling to orange: no red in the trail.
const PLUME = [R.yellow[4], R.yellow[3], R.yellow[3], R.yellow[2], R.yellow[2], R.orange[3], R.orange[2], R.orange[2], R.orange[1]];
const SPARK = [R.yellow[3], R.yellow[2], R.orange[3], R.orange[2], R.orange[1]];

/** Cyber comet: a chain of hard-edged light packets that shrink and cool in steps. */
function flyTrail(sky, path, t) {
  const STEP = 0.05;
  const head = path(t);
  const life = span(path, t, REACH - SKIP);
  const i0 = Math.floor(t / STEP);
  for (let i = i0; i > i0 - Math.ceil(life / STEP) - 1; i--) {
    const age = t - (i + 1) * STEP;
    const aN = Math.max(age, 0) / life;
    if (aN >= 1) {
      continue;
    }
    const core = PLUME[Math.min(PLUME.length - 1, Math.floor(aN * PLUME.length))];
    const shrink = STEP * Math.min(0.5, aN * 0.7);
    for (let tau = i * STEP + shrink; tau <= Math.min(t, (i + 1) * STEP); tau += 1 / 90) {
      const p = path(tau);
      if (Math.hypot(p.x - head.x, p.y - head.y) < SKIP) {
        continue;
      }
      const d = dirAt(path, tau);
      const nx = -d.y;
      const ny = d.x;
      sky.put(p.x, p.y, core);
      if (aN < 0.72) {
        const c = aN < 0.36 ? R.orange[2] : R.orange[1];
        sky.put(p.x + Math.round(nx), p.y + Math.round(ny), c);
        sky.put(p.x - Math.round(nx), p.y - Math.round(ny), c);
      }
      if (aN < 0.6 && i % 2 === 0) {
        sky.put(p.x + Math.round(nx * 2), p.y + Math.round(ny * 2), R.yellow[1]);
        sky.put(p.x - Math.round(nx * 2), p.y - Math.round(ny * 2), R.yellow[1]);
      }
    }
  }
  // Grid-snapped sparks that stay where they were shed and cool in 10 Hz steps.
  const RATE = 14;
  const sparkLife = span(path, t, REACH - 4);
  for (let i = Math.floor((t - sparkLife) * RATE); i <= Math.floor(t * RATE); i++) {
    const ti = i / RATE;
    if (hash(i, 1) < 0.4) {
      continue;
    }
    const aN = Math.floor((t - ti) * 10) / 10 / sparkLife;
    if (aN >= 1) {
      continue;
    }
    const idx = Math.min(4, Math.floor(aN * 5));
    const p = path(ti);
    const d = dirAt(path, ti);
    const side = Math.round((hash(i, 2) - 0.5) * 10);
    const x = 2 * Math.round((p.x - d.x * 4 - d.y * side) / 2);
    const y = 2 * Math.round((p.y - d.y * 4 + d.x * side) / 2);
    sky.put(x, y, SPARK[idx]);
    if (hash(i, 3) > 0.65 && idx < 3) {
      sky.put(x + 1, y, SPARK[idx + 1]);
    }
  }
}

// ----------------------------------------------------------------------- fish

// The freshest rungs are near-white teal, then full-bright teal; a dark teal halo sits beside each rung.
const BAR = [R.teal[4], R.teal[4], ...Array(6).fill(R.teal[3]), ...Array(4).fill(R.teal[2]), ...Array(2).fill(R.teal[1])];
const BIT = [R.magenta[3], R.magenta[3], R.magenta[2], R.magenta[2], R.magenta[1]];

/** Cyber water: a ladder of glowing scan bars, sonar diamonds, and magenta data bits. */
function fishTrail(sky, path, t, odo, scale) {
  for (const m of marks(odo, scale, t, 4, SKIP, REACH)) {
    const aN = (m.behind - SKIP) / (REACH - SKIP);
    if (aN > 0.57 && m.k % 2 === 1) {
      continue;
    }
    const p = path(m.tm);
    const d = dirAt(path, m.tm);
    const x = p.x;
    const y = p.y;
    const nx = -d.y;
    const ny = d.x;
    const hl = 2 + Math.floor(aN * 2.8);
    for (const s of [-1, 1]) {
      sky.line(x - nx * hl + d.x * s, y - ny * hl + d.y * s, x + nx * hl + d.x * s, y + ny * hl + d.y * s, R.teal[1]);
    }
    sky.line(x - nx * hl, y - ny * hl, x + nx * hl, y + ny * hl, BAR[Math.min(BAR.length - 1, Math.floor(aN * BAR.length))]);
    const tip = aN < 0.57 ? R.magenta[3] : R.magenta[2];
    sky.put(x - nx * hl, y - ny * hl, tip);
    sky.put(x + nx * hl, y + ny * hl, tip);
  }
  // A diamond reaches 7 px wide at the end of its life, so it is born closer in.
  const P_ARC = REACH - 9;
  for (const m of marks(odo, scale, t, 6.5, 0, P_ARC)) {
    const age = m.behind / P_ARC;
    const p = path(m.tm);
    const d = dirAt(path, m.tm);
    const cx = Math.floor(p.x - d.x * 2);
    const cy = Math.floor(p.y - d.y * 2);
    const r = 1 + Math.floor(age * 5);
    const c = age < 0.35 ? R.teal[3] : age < 0.7 ? R.teal[2] : R.teal[1];
    for (const [rr, col] of [[r + 1, R.teal[0]], [r, c]]) {
      for (let dx = -rr; dx <= rr; dx++) {
        const dy = rr - Math.abs(dx);
        const tipPix = rr === r && (dx === 0 || dy === 0);
        const px = tipPix ? R.magenta[age < 0.6 ? 3 : 2] : col;
        sky.put(cx + dx, cy + dy, px);
        sky.put(cx + dx, cy - dy, px);
      }
    }
  }
  const B_RATE = 20;
  const B_LIFE = span(path, t, REACH - 4);
  for (let i = Math.floor((t - B_LIFE) * B_RATE); i <= Math.floor(t * B_RATE); i++) {
    const ti = i / B_RATE;
    const age = Math.floor((t - ti) * 8) / 8 / B_LIFE;
    if (age >= 1 || hash(i, 1) < 0.45) {
      continue;
    }
    const step = Math.min(4, Math.floor(age * 5));
    const p = path(ti);
    const d = dirAt(path, ti);
    const side = hash(i, 2) < 0.5 ? -1 : 1;
    const reach = 2 + step * 2 + Math.floor(hash(i, 3) * 3);
    sky.put(p.x - d.x * 4 - d.y * side * reach, p.y - d.y * 4 + d.x * side * reach, BIT[step]);
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
