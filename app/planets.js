/**
 * Planet color schemes: spoke hues, star tones, and the rim glow.
 *
 * Each planet lists the hue families the aurora noise walks through, the depth
 * levels a spoke uses, two extra star tones, and a rim halo that acts as the
 * planet's atmosphere or rings. Every color is one of the locked palette
 * colors, and the module checks that on load.
 */

import {MUTE_OF, PALETTE_INDEX, RAMPS} from './palette.js?v=1';

/**
 * Ramps that are not in RAMPS, as [deep, dark, mid, light, pale]. They are
 * mixes of palette colors, so they add nothing to the locked palette.
 */
const CUSTOM = {
  graphite: ['#101010', '#282838', '#505060', '#808098', '#B8B8C8'],
  steel: ['#181820', '#383848', '#606078', '#9898B0', '#D0D0E0'],
  silver: ['#282838', '#505060', '#808098', '#D0D0E0', '#F8F8F8'],
  cloud: ['#606078', '#9898B0', '#D0D0E0', '#E8E8F0', '#F8F8F8'],
  sand: ['#504008', '#A08010', '#F8B860', '#F8D8B8', '#F8F8C8'],
  cream: ['#504008', '#A08010', '#F8D8B8', '#F8F090', '#F8F8F8'],
  honey: ['#504008', '#A04010', '#F8B860', '#F8F090', '#F8F8C8'],
  tan: ['#502008', '#A04010', '#F8B860', '#F8D8B8', '#F8F8C8'],
  champagne: ['#502008', '#A08010', '#F8B860', '#F8D8B8', '#F8F8C8'],
  ochre: ['#502008', '#A04010', '#A08010', '#F8B860', '#F8F090'],
  oxide: ['#401018', '#801828', '#A04010', '#F08018', '#F8B860'],
  copper: ['#502008', '#A04010', '#F08018', '#F8B860', '#F8D8B8'],
  tholin: ['#401018', '#502008', '#801828', '#A04010', '#F8B860'],
  heart: ['#505060', '#9898B0', '#F8D8B8', '#F8F8C8', '#F8F8F8'],
  aqua: ['#082830', '#104858', '#58E8D0', '#98E8F8', '#D0F0F8'],
  ice: ['#104858', '#18A0A0', '#98E8F8', '#D0F0F8', '#F8F8F8'],
  seafoam: ['#105028', '#18A0A0', '#58E8D0', '#B0F0E8', '#D0F8B8'],
  deepsea: ['#082040', '#103878', '#3868E8', '#88A8F8', '#D0F0F8'],
  cirrus: ['#103878', '#88A8F8', '#D0F0F8', '#E8E8F0', '#F8F8F8'],
  hollow: ['#101840', '#402088', '#88A8F8', '#C8D0F8', '#F8F8F8'],
};

/**
 * The nine planets.
 *
 * families: hue ramps in aurora order; a name is a CUSTOM or RAMPS key.
 * levels: ramp level of a spoke's four depth buckets, near the star to far.
 * tones: [full, mid, dim] shades of the two colored star tones.
 * halo.ring: ramps around the rim, one turn; halo.shades: ramp level per
 *   band from the rim outward (-1 leaves a gap); halo.reach: band width in
 *   art pixels; halo.speed: turns of drift per second; halo.inner: the same
 *   idea for a glow just inside the rim.
 * weight: relative chance of being picked for a new sky.
 */
export const PLANETS = {
  mercury: {
    label: 'Mercury',
    weight: 1,
    families: ['graphite', 'steel', 'silver', 'copper', 'sand', 'hollow'],
    levels: [4, 3, 2, 1],
    tones: [
      ['#F8F090', '#F8B860', '#A08010'],
      ['#C8D0F8', '#88A8F8', '#3868E8'],
    ],
    halo: {
      ring: ['silver', 'silver', 'silver', 'yellow', 'orange', 'yellow',
        'silver', 'silver'],
      reach: 24, shades: [2, 1, 1, 0], steps: 4, speed: 0,
    },
  },
  venus: {
    label: 'Venus',
    weight: 1,
    families: ['yellow', 'honey', 'orange', 'red', 'magenta', 'red'],
    levels: [3, 3, 2, 1],
    tones: [
      ['#F8F8C8', '#F8F090', '#F8D820'],
      ['#F890D0', '#C838A8', '#781868'],
    ],
    halo: {
      ring: ['yellow', 'orange', 'red', 'magenta', 'red', 'orange'],
      reach: 50, shades: [2, 1, 1, 1, 0, 0], steps: 4, speed: 0.012,
      inner: {depth: 6, shades: [1, 0]},
    },
  },
  earth: {
    label: 'Earth',
    weight: 1.3,
    families: ['blue', 'blue', 'sky', 'teal', 'green', 'sand', 'cloud'],
    levels: [3, 3, 2, 1],
    tones: [
      ['#98E8F8', '#28A0F0', '#103878'],
      ['#98F070', '#38B838', '#105028'],
    ],
    halo: {
      ring: ['sky', 'green', 'magenta', 'green', 'sky', 'green', 'magenta',
        'green'],
      reach: 40, shades: [2, 2, 1, 1, 0], steps: 4, speed: 0,
      inner: {depth: 6, shades: [1, 0]},
    },
  },
  mars: {
    label: 'Mars',
    weight: 1,
    families: ['oxide', 'red', 'oxide', 'orange', 'sand', 'sky'],
    levels: [3, 3, 2, 1],
    tones: [
      ['#F8B860', '#F08018', '#A04010'],
      ['#98E8F8', '#28A0F0', '#103878'],
    ],
    halo: {
      ring: ['orange', 'orange', 'yellow', 'orange', 'sky', 'sky', 'orange',
        'red'],
      reach: 40, shades: [2, 2, 1, 1, 0], steps: 4, speed: 0,
      inner: {depth: 6, shades: [1, 0]},
    },
  },
  jupiter: {
    label: 'Jupiter',
    weight: 1,
    families: ['cream', 'tholin', 'cream', 'tan', 'red', 'cream', 'tholin'],
    levels: [3, 3, 2, 1],
    tones: [
      ['#F8F8C8', '#F8D8B8', '#F8B860'],
      ['#F88878', '#E03030', '#801828'],
    ],
    halo: {
      ring: ['cream', 'tholin', 'tan', 'cream', 'red', 'cream', 'tholin', 'tan',
        'cream', 'oxide', 'cream', 'tan'],
      reach: 44, shades: [2, 2, 1, 1, 1, 0], steps: 4, speed: 0.012,
      inner: {depth: 6, shades: [1, 0]},
    },
  },
  saturn: {
    label: 'Saturn',
    weight: 1,
    families: ['ochre', 'champagne', 'yellow', 'cream', 'champagne', 'violet'],
    levels: [3, 3, 2, 1],
    tones: [
      ['#F8F090', '#F8D820', '#A08010'],
      ['#B898F8', '#8050D8', '#402088'],
    ],
    halo: {
      ring: ['champagne', 'ochre', 'honey', 'ochre'],
      reach: 52, shades: [0, 1, 1, 1, 2, 2, -1, 1, 1, 1, -1, 1], steps: 2,
      speed: 0.005,
    },
  },
  uranus: {
    label: 'Uranus',
    weight: 1,
    families: ['deepsea', 'teal', 'aqua', 'seafoam', 'ice', 'aqua'],
    levels: [3, 3, 2, 1],
    tones: [
      ['#D0F0F8', '#98E8F8', '#28A0F0'],
      ['#B0F0E8', '#58E8D0', '#18A0A0'],
    ],
    halo: {
      ring: ['ice', 'aqua', 'sky', 'aqua'],
      reach: 46, shades: [2, 1, -1, 2, -1, -1, 1, -1, 1], steps: 2,
      speed: 0.004,
      inner: {depth: 6, shades: [1, 0]},
    },
  },
  neptune: {
    label: 'Neptune',
    weight: 1,
    families: ['deepsea', 'blue', 'sky', 'blue', 'violet', 'cirrus'],
    levels: [3, 3, 2, 1],
    tones: [
      ['#C8D0F8', '#88A8F8', '#3868E8'],
      ['#D0F0F8', '#98E8F8', '#28A0F0'],
    ],
    halo: {
      ring: ['blue', 'sky', 'blue', 'violet', 'magenta', 'violet'],
      reach: 50, shades: [2, 2, 1, 1, 1, 0], steps: 4, speed: 0.01,
      inner: {depth: 6, shades: [1, 0]},
    },
  },
  pluto: {
    label: 'Pluto',
    weight: 0.1,
    families: ['steel', 'tholin', 'tholin', 'oxide', 'heart', 'steel'],
    levels: [4, 3, 2, 1],
    tones: [
      ['#F8D8B8', '#F8B860', '#A04010'],
      ['#98E8F8', '#28A0F0', '#103878'],
    ],
    halo: {
      ring: ['sky', 'blue', 'sky', 'blue'],
      reach: 40, shades: [-1, 2, -1, 2, -1, -1, 1, -1, 1, -1, 1], steps: 2,
      speed: 0.006,
    },
  },
};

/** The muted twin of a palette hex, or the hex itself for a neutral. */
function mute(hex) {
  return MUTE_OF.get(hex) || hex;
}

/** Cache of the muted ramps, by family name. */
const MUTED_RAMPS = new Map();

// Planets read like a 90s TV: every hue color is swapped for its dusty twin.
for (const p of Object.values(PLANETS)) {
  p.tones = p.tones.map((tone) => tone.map(mute));
}

const PLANET_KEYS = Object.keys(PLANETS);

/**
 * The ramp for a family name.
 * @param {string} name a CUSTOM or RAMPS key
 * @return {string[]} [deep, dark, mid, light, pale] hex shades
 */
export function rampOf(name) {
  let ramp = MUTED_RAMPS.get(name);
  if (!ramp) {
    const raw = CUSTOM[name] || RAMPS[name];
    ramp = raw && raw.map(mute);
    MUTED_RAMPS.set(name, ramp);
  }
  return ramp;
}

/** Fail loudly if a planet uses a color outside the locked palette. */
function checkPalette() {
  const bad = [];
  const test = (hex) => {
    if (!PALETTE_INDEX.has(hex.toUpperCase())) {
      bad.push(hex);
    }
  };
  Object.keys(CUSTOM).forEach((name) => rampOf(name).forEach(test));
  for (const p of Object.values(PLANETS)) {
    p.tones.forEach((tone) => tone.forEach(test));
    for (const name of p.families.concat(p.halo.ring)) {
      if (!rampOf(name)) {
        bad.push('ramp ' + name);
      }
    }
  }
  if (bad.length) {
    throw new Error('planets.js: not in the palette: ' + bad.join(', '));
  }
}

checkPalette();

/** A small seeded generator: the same seed gives the same run of numbers. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick a planet by weight, never the one shown last.
 * @param {string|null} previous key of the planet on screen now, or null
 * @param {number} seed a number such as the system time in milliseconds
 * @return {string} a key of PLANETS
 */
export function pickPlanet(previous, seed) {
  const rand = seededRandom(seed);
  rand();
  const keys = PLANET_KEYS.filter((k) => k !== previous);
  const total = keys.reduce((sum, k) => sum + PLANETS[k].weight, 0);
  let r = rand() * total;
  for (const k of keys) {
    r -= PLANETS[k].weight;
    if (r < 0) {
      return k;
    }
  }
  return keys[keys.length - 1];
}

/** 4x4 ordered-dither thresholds, 0 to 15. */
const BAYER4 = [
  [0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
/** The widest halo band and inner glow any planet asks for, in art pixels. */
const REACH_MAX = 78;
const INNER_MAX = 8;
/** Steps in one full turn of the drift around the rim. */
const DRIFT_STEPS = 240;
/** Dither levels of the fade-in. */
const FADE_STEPS = 8;
/** The rim swells and shrinks this many times a second, in steps. */
const PULSE_HZ = 8;
/** Angular bins the swell is worked out in. */
const PULSE_BINS = 1440;
/** The halo is this much wider than its planet's `reach`, before the swell. */
const REACH_BASE = 1.15;
/** How far the swell moves the reach: it runs from base - amp to base + amp. */
const REACH_AMP = 0.3;
/** Cache of hex colors as packed pixels. */
const PACKED = new Map();

/** Threshold 0..1 of the 4x4 ordered dither at a pixel. */
function bayer(x, y) {
  return (BAYER4[y & 3][x & 3] + 0.5) / 16;
}

/** A hex color as a little-endian packed pixel. */
function packed(hex) {
  let v = PACKED.get(hex);
  if (v === undefined) {
    const n = Number.parseInt(hex.slice(1), 16);
    v = (0xff000000 | ((n & 255) << 16) | (((n >> 8) & 255) << 8) |
        ((n >> 16) & 255)) >>> 0;
    PACKED.set(hex, v);
  }
  return v;
}

/** A steady pseudo-random number 0..1 for two integers. */
function hash2(a, b) {
  let h = Math.imul(a + 374761393, 668265263) ^
      Math.imul(b + 1274126177, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * How far the rim reaches around the arena right now, as a factor per angular
 * bin. Three waves with unrelated speeds and turn counts ride around the rim
 * in different directions, so the glow swells here while it shrinks there and
 * the swell seems to orbit. A little per-step jitter keeps it from looking
 * like a clean sine.
 * @param {number} time seconds
 * @return {Float32Array} PULSE_BINS factors
 */
function swellAt(time) {
  const step = Math.floor(time * PULSE_HZ);
  const t = step / PULSE_HZ;
  const out = new Float32Array(PULSE_BINS);
  for (let b = 0; b < PULSE_BINS; b++) {
    const a = (b / PULSE_BINS) * 2 * Math.PI;
    const wave = 0.5 * Math.sin(2 * Math.PI * 0.13 * t + 3 * a) +
        0.3 * Math.sin(2 * Math.PI * 0.21 * t - 5 * a + 1.7) +
        0.2 * Math.sin(2 * Math.PI * 0.37 * t + 7 * a + 4.1);
    const jitter = (hash2(b >> 2, step) - 0.5) * 0.18;
    const w = Math.max(-1, Math.min(1, wave + jitter));
    out[b] = REACH_BASE + REACH_AMP * w;
  }
  return out;
}

/**
 * The planet's rim glow, painted as dithered palette bands around the arena.
 *
 * The pixels just outside and inside the rim are worked out once per canvas
 * size. Each redraw only re-colors them, and only when the drift, the fade,
 * or the planet changed.
 */
export class HaloLayer {
  constructor() {
    this.w = 0;
    this.h = 0;
    this.radius = 0;
    this.geom = null;
    this.key = '';
    this.canvas = document.createElement('canvas');
    this.g = this.canvas.getContext('2d');
    this.img = null;
    this.px = null;
  }

  /** Rebuild the pixel list when the canvas size or the arena changes. */
  prepare(view) {
    if (this.geom && this.w === view.w && this.h === view.h &&
        this.radius === view.radius && this.cx === view.cx &&
        this.cy === view.cy) {
      return;
    }
    this.w = view.w;
    this.h = view.h;
    this.radius = view.radius;
    this.cx = view.cx;
    this.cy = view.cy;
    this.canvas.width = view.w;
    this.canvas.height = view.h;
    this.img = this.g.createImageData(view.w, view.h);
    this.px = new Uint32Array(this.img.data.buffer);
    const out = view.radius + REACH_MAX;
    const at = [];
    const dist = [];
    const bin = [];
    const thresh = [];
    for (let y = Math.max(0, view.cy - out);
      y <= Math.min(view.h - 1, view.cy + out); y++) {
      for (let x = Math.max(0, view.cx - out);
        x <= Math.min(view.w - 1, view.cx + out); x++) {
        const dx = x - view.cx;
        const dy = y - view.cy;
        const d = Math.hypot(dx, dy) - view.radius;
        if (d > REACH_MAX || d <= -INNER_MAX) {
          continue;
        }
        at.push(y * view.w + x);
        thresh.push(bayer(x, y));
        dist.push(d);
        const u = Math.atan2(dy, dx) / (2 * Math.PI) + 0.5;
        bin.push(Math.min(PULSE_BINS - 1, Math.floor(u * PULSE_BINS)));
      }
    }
    this.geom = {
      at: Int32Array.from(at),
      dist: Float32Array.from(dist),
      bin: Uint16Array.from(bin),
      thresh: Float32Array.from(thresh),
    };
    this.key = '';
  }

  /**
   * Draw the glow.
   * @param {CanvasRenderingContext2D} ctx
   * @param {{cx: number, cy: number, radius: number, w: number, h: number}}
   *     view
   * @param {string} planetKey a key of PLANETS
   * @param {number} time seconds, drives the slow drift around the rim
   * @param {number} visibility 0 to 1; fewer pixels show below 1, so the
   *     glow fades in by dither
   */
  draw(ctx, view, planetKey, time, visibility) {
    const level = Math.round(Math.max(0, Math.min(1, visibility)) * FADE_STEPS);
    if (level === 0) {
      return;
    }
    this.prepare(view);
    const halo = PLANETS[planetKey].halo;
    const phase = (time * halo.speed) % 1;
    const step = Math.floor(phase * DRIFT_STEPS);
    const key = planetKey + '|' + step + '|' + level + '|' +
        Math.floor(time * PULSE_HZ);
    if (key !== this.key) {
      this.key = key;
      this.paint(halo, step / DRIFT_STEPS, level / FADE_STEPS, swellAt(time));
    }
    ctx.drawImage(this.canvas, 0, 0);
  }

  /** Color every halo pixel for one planet, drift phase, and fade. */
  paint(halo, phase, fade, swell) {
    const {at, dist, bin, thresh} = this.geom;
    const px = this.px;
    px.fill(0);
    const ring = halo.ring.map((name) => rampOf(name).map(packed));
    const n = ring.length;
    // Everything that depends only on the angle is worked out once per bin.
    const reachOf = new Float32Array(PULSE_BINS);
    const fromOf = new Array(PULSE_BINS);
    const toOf = new Array(PULSE_BINS);
    const mixOf = new Float32Array(PULSE_BINS);
    for (let b = 0; b < PULSE_BINS; b++) {
      reachOf[b] = halo.reach * swell[b];
      const u = (((b + 0.5) / PULSE_BINS + phase) % 1) * n - 0.5;
      const j = Math.floor(u);
      mixOf[b] = Math.round(
          Math.max(0, Math.min(1, (u - j - 0.5) * 2 + 0.5)) * 4) / 4;
      fromOf[b] = ring[((j % n) + n) % n];
      toOf[b] = ring[(((j + 1) % n) + n) % n];
    }
    const inner = halo.inner || null;
    const steps = halo.steps || 4;
    for (let k = 0; k < at.length; k++) {
      const d = dist[k];
      const isInner = d <= 0;
      const b = bin[k];
      const reach = reachOf[b];
      if (isInner ? (!inner || -d >= inner.depth) : d > reach) {
        continue;
      }
      const t = thresh[k];
      if (fade < 1 && t >= fade) {
        continue;
      }
      const bands = isInner ? inner.shades : halo.shades;
      const span = isInner ? inner.depth : reach;
      const p = (Math.abs(d) / span) * (bands.length + 1);
      const zone = Math.floor(p);
      const next = Math.round((p - zone) * steps) / steps > t ? 1 : 0;
      const shade = bands[zone + next];
      if (zone + next >= bands.length || shade < 0) {
        continue;
      }
      px[at[k]] = (mixOf[b] > t ? toOf[b] : fromOf[b])[shade];
    }
    this.g.putImageData(this.img, 0, 0);
  }
}
