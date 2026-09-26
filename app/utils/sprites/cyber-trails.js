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

/**
 * Half the side of the buffer around the head, in art pixels. Sized for the
 * fly's bursts, which reach further than the fish's bars: a node at the very
 * tail, its widest jump and its longest antler measure 33.6 px together.
 */
const HALF = 40;
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

// Yellow at the head cooling through orange into violet: no red anywhere, and
// the cool half is the longer one.
const BURST_CORE = [
  R.yellow[4], R.yellow[2], R.orange[3], R.orange[2], R.orange[1],
  R.violet[3], R.violet[3], R.violet[2], R.violet[1], R.violet[0],
];
// The last generation of an antler draws from this, which is dimmer at every
// index than BURST_CORE, so a branch thins away to a dark point.
const BURST_TIP = [
  R.orange[2], R.orange[1], R.orange[1], R.orange[0], R.orange[0],
  R.violet[1], R.violet[1], R.violet[1], R.violet[0], R.violet[0],
];
const BURST_SPARK = [
  R.yellow[3], R.yellow[2], R.orange[3], R.orange[2], R.orange[1],
];

/** Seconds between bursts. Smaller packs them closer together. */
const BURST_DT = 0.22;
/** How far a burst's base may sit off the true path, in art pixels. */
const BURST_AMP = 2;
/** Shares of bursts left bare, and thrown far off so they do not line up. */
const BURST_GAP = 0.25;
const BURST_JUMP = 0.16;
const BURST_JUMP_SCALE = 2.6;
/** Antlers per burst, and half the fan they spread over, in radians. */
const BURST_ARMS = 3;
const BURST_SPREAD = 1.15;
const BURST_JITTER = 0.35;
/** Generations of fork per antler, its first length, and their falloff. */
const ANTLER_DEPTH = 3;
const ANTLER_LEN = 5;
const ANTLER_SPREAD = 0.62;
const ANTLER_SHORTEN = 0.55;
/** Share of an antler's length that age takes away by the tail of the trail. */
const ANTLER_TAPER = 0.72;
/** Sparkles shed per second, how many slots are skipped, and how they thin. */
const SPARK_RATE = 22;
const SPARK_SKIP = 0.35;
const SPARK_FADE = 1;
const SPARK_WIDE = 0.85;
/** How far off the trail a sparkle sits, and how much age pulls it back in. */
const SPARK_OFFSET = 2;
const SPARK_SCATTER = 3;
const SPARK_TIGHTEN = 0.6;
/** How far behind the head the field of bursts reaches, in art pixels. */
const BURST_REACH = 25;

/**
 * One fractal antler: a jagged span that forks into two shorter, dimmer spans,
 * ANTLER_DEPTH times over. Every stroke is a single pixel — this trail has no
 * thickness to narrow — so it thins by length and colour alone.
 */
function antler(sky, x, y, ux, uy, len, depth, seed, from) {
  if (depth <= 0 || len < 1.2) {
    return;
  }
  const last = BURST_CORE.length - 1;
  const kink = (hash(seed, depth * 7 + 3) * 2 - 1) * len * 0.34;
  const mx = x + ux * len * 0.5 - uy * kink;
  const my = y + uy * len * 0.5 + ux * kink;
  const ex = x + ux * len;
  const ey = y + uy * len;
  if (depth === 1) {
    sky.put(mx, my, BURST_TIP[Math.min(last, from)]);
    sky.put(ex, ey, BURST_TIP[Math.min(last, from + 1)]);
  } else {
    sky.line(x, y, mx, my, BURST_CORE[Math.min(last, from)]);
    sky.line(mx, my, ex, ey, BURST_CORE[Math.min(last, from + 1)]);
  }
  for (let c = 0; c < 2; c++) {
    const sign = c === 0 ? 1 : -1;
    const a = sign * ANTLER_SPREAD * (0.65 + 0.7 * hash(seed, depth * 13 + c));
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    antler(sky, ex, ey, ux * ca - uy * sa, ux * sa + uy * ca,
        len * ANTLER_SHORTEN, depth - 1, seed * 31 + c * 7 + 1, from + 2);
  }
}

/**
 * The bursts: one fan of fractal antlers per node of the recent path, with no
 * line joining one node to the next. Nodes are pinned to fixed times, so a
 * burst stays where it was struck and ages where it stands. Each is shortest
 * and dimmest by the time it reaches the tail.
 */
function bursts(sky, path, t, life) {
  const node = (k) => {
    const tk = k * BURST_DT;
    const p = path(tk);
    const d = dirAt(path, tk);
    const jump = hash(k, 4) < BURST_JUMP ? BURST_JUMP_SCALE : 1;
    const off = (hash(k, 1) * 2 - 1) * BURST_AMP * jump *
        (0.5 + 0.5 * hash(k, 2));
    return {x: p.x - d.y * off, y: p.y + d.x * off, nx: -d.y, ny: d.x};
  };
  const last = Math.floor(t / BURST_DT);
  for (let k = last; k > 0; k--) {
    const tk = k * BURST_DT;
    if (tk > t) {
      continue;
    }
    const age = (t - tk) / life;
    if (age < 0 || age >= 1) {
      continue;
    }
    // Some nodes stay bare, so the bursts read as separate strikes instead of
    // fusing into one mass. The newest always draws, keeping the trail with
    // the animal rather than floating behind it.
    if (k !== last && hash(k, 41) < BURST_GAP) {
      continue;
    }
    const a = node(k);
    const idx = Math.min(BURST_CORE.length - 1,
        Math.floor(age * BURST_CORE.length));
    // The fan spreads about the direction opposite the fly's travel, so it
    // trails behind rather than reaching ahead. Both vectors are unit length,
    // so rotating them leaves them so.
    const bx = -a.ny;
    const by = a.nx;
    const armLen = ANTLER_LEN * (1 - ANTLER_TAPER * age);
    for (let arm = 0; arm < BURST_ARMS; arm++) {
      const at = arm / (BURST_ARMS - 1) * 2 - 1;
      const ang = at * BURST_SPREAD + (hash(k, 50 + arm) - 0.5) * BURST_JITTER;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const len = armLen * (0.7 + 0.6 * hash(k, 60 + arm));
      antler(sky, a.x, a.y, bx * ca - by * sa, bx * sa + by * ca,
          len, ANTLER_DEPTH, k * 7 + arm, idx + 1);
    }
  }
}

/**
 * Sparkles: single dots shed beside the trail, the way the fish sheds its data
 * bits. Each is pinned to a time and keeps the offset it was shed at, so the
 * field thins down the trail instead of fanning out along it.
 */
function sparkles(sky, path, t, life) {
  const first = Math.floor((t - life) * SPARK_RATE);
  const last = Math.floor(t * SPARK_RATE);
  for (let i = first; i <= last; i++) {
    const ti = i / SPARK_RATE;
    const age = (t - ti) / life;
    if (age < 0 || age >= 1 || hash(i, 71) < SPARK_SKIP ||
        hash(i, 75) < age * SPARK_FADE) {
      continue;
    }
    const p = path(ti);
    const d = dirAt(path, ti);
    const side = hash(i, 72) < 0.5 ? -1 : 1;
    const reach = SPARK_OFFSET + SPARK_SCATTER * (1 - SPARK_TIGHTEN * age) *
        hash(i, 73);
    const x = p.x - d.x * 3 - d.y * side * reach;
    const y = p.y - d.y * 3 + d.x * side * reach;
    const colour = BURST_SPARK[Math.min(BURST_SPARK.length - 1,
        Math.floor(age * BURST_SPARK.length))];
    sky.put(x, y, colour);
    // A brand new dot is two pixels wide, and fewer of them are as it ages.
    if (hash(i, 74) > (1 - SPARK_WIDE) + age) {
      sky.put(x + 1, y, colour);
    }
  }
}

/**
 * Cyber ramification: a run of bursts with no master line through them, and
 * the warm sparkles they shed. Neither joins anything else, so the trail is a
 * scatter of lightning hanging in the sky, not a stroke dragged behind the fly.
 */
function flyTrail(sky, path, t) {
  const life = span(path, t, BURST_REACH);
  bursts(sky, path, t, life);
  sparkles(sky, path, t, life);
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
