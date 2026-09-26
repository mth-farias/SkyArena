/**
 * SkyArena: a real night sky drawn in 8-bit style, with flies, fish, and live
 * earthquakes. This file holds the drawing, the game rules, and the controls.
 */

import {buildMesh} from './mesh.js?v=1';
import {
  GREY_RAMP,
  PALETTE_INDEX,
  PixelBatch,
  RAMPS,
  STAR_TONES,
  WHITE,
  drawStar,
  quantizeCanvas,
} from './palette.js?v=1';
import {
  HaloLayer,
  PLANETS,
  pickPlanet,
  rampOf,
} from './planets.js?v=1';
import {
  buildOdometer as bioOdometer,
  drawTrail as bioTrail,
} from './trails.js?v=1';
import {
  buildOdometer as cyberOdometer,
  drawTrail as cyberTrail,
} from './utils/sprites/cyber-trails.js';

/** Background of the arena. */
const BG = '#000000';
/** Track samples per second when the data does not say. */
const DEFAULT_HZ = 10;
/** Color-off trail length, in track samples. */
const TRAIL = 5;
/** Numbers stored per track sample: x, y, and speed. */
const SPRITE_STRIDE = 3;
/** Frames in each sprite bank. */
const SPRITE_FRAMES = 6;
/**
 * Sprite art is square, facing east and down-right; the fish is a little
 * larger.
 */
const SPRITE_PX = {fly: 15, fish: 19};
/**
 * Blur levels laid on the aura, tight to wide. Each step out is twice as wide
 * and about half as strong, so the glow fades roughly exponentially and
 * dies away fast. Each entry is [level, opacity].
 */
const AURA_LEVELS = [[1, 1], [1, 1], [2, 0.5], [3, 0.25]];
/**
 * A fly flickers at this multiple of the slow-speed cutoff. The curated
 * tracks used to round coordinates to 3 decimals, which zeroed most of a
 * fly's per-sample steps; because the speed quantiles skip stationary
 * samples, that made the cutoff read about ten times too high. With the
 * rounding removed the honest cutoff is small, so the multiple is raised
 * to hold the flicker rate where it was: about 38% of samples.
 */
const FLY_Q1_SCALE = 9;
/** Seconds a sprite takes to turn toward its heading (smoothing). */
const FLY_HEADING_TAU = 0.55;
const FISH_HEADING_TAU = 0.22;
/** Rows the arena aims for; the scale is a whole number of device pixels. */
const TARGET_ROWS = 720;
/** Never draw an art pixel smaller than this many device pixels. */
const MIN_SCALE = 2;
/** Arena radius the size constants are tuned for, in art pixels. */
const REF_RADIUS = 388;

/** Gap between the flowing dots on an edge, in art pixels. */
const DOT_SPACING = 6.5;
/** How thin a wiggling edge gets at its ends, from 0 to 1. */
const ANCHOR_TAPER_FLOOR = 0.22;
/** How fast the dots flow along an edge, in art pixels per second. */
const DOT_FLOW_SPEED = 9;
/** Each edge flows at a random share of the base speed in this range. */
const SPEED_VARIATION_MIN = 0.45;
const SPEED_VARIATION_MAX = 1.9;
/** How far the Wiggle layer bends an edge, in art pixels. */
const WIGGLE_AMOUNT = 0.9;
/** Noise frequency along an edge, and how fast the wiggle drifts. */
const WIGGLE_SCALE = 0.35;
const WIGGLE_SPEED = 0.6;
/** Seconds the flow takes to reach the rim from the center. */
const RADIAL_FLOW_DELAY = 5.2;
/** Aurora noise: spatial frequency and drift speed. */
const AURORA_SCALE = 0.0026;
const AURORA_SPEED = 0.032;
/** Slices of the rim, each owned by its nearest star. */
const RIM_SAMPLE_STEPS = 720;
/** Twinkle beats per second. */
const TWINKLE_HZ = 4;
/** Where each depth shade ends, as a share of the spoke's length. */
const SPOKE_BUCKET_ENDS = [0.12, 0.35, 0.65, 1.01];
/** A spoke lands on every SPOKE_EVERY-th flowing dot. */
const SPOKE_EVERY = 4;
/** Hover strength at which a spoke lifts one shade, and two shades. */
const HOVER_LIFT_1 = 0.25;
const HOVER_LIFT_2 = 0.66;
/**
 * The rim glow is at full strength once this share of the stars is alive;
 * below it the glow fades out by dither, so a dying or empty sky goes dark.
 */
const HALO_FULL_ALIVE = 0.4;
/** How far aurora noise spreads a planet's hue families across the sky. */
const AURORA_STRETCH = 0.85;
/** Half the width of a hue crossfade, in hue-family units. */
const FADE_HALF = 0.25;
/** Dither levels a hue crossfade passes through. */
const FADE_STEPS = 6;
/** Palette ramp that colors a dying star, by what killed it. */
const KIND_RAMP = {
  fly: 'orange',
  fish: 'sky',
  explode: 'green',
  shake: 'violet',
  live: 'red',
};
/** How often, and how many times, boot retries a failed load. */
const BOOT_RETRY_MS = 350;
const BOOT_TRIES = 40;
/** How much bigger than normal a leaving animal swells. */
const LEAVE_SWELL = 0.8;
/** The loop draws at most this often; 30 fps is the target. */
const FRAME_MS = 1000 / 30;
/** A star's shatter lasts one second, whatever killed it. */
const DYING_ATTACK_S = 0.06;
const DYING_DECAY_S = 0.94;
/** A star explosion takes about this long, however many stars there are. */
const EXPLODE_TOTAL_S = 2.5;
/** Seconds between stars going off in an explosion chain. */
const EXPLODE_TICK_S = 0.05;
const CHAIN_TICK_S = 0.330;
/** Seconds the first sky takes to light up after PRESS START. */
const INTRO_DURATION_S = 6;
/** How close the cursor must be to light a spoke, in art pixels. */
const HOVER_RADIUS = 6;
/** Seconds a spoke takes to let go once the cursor leaves it. */
const HOVER_RELEASE = 3;
/**
 * Spokes an animal lit let go faster, so none stay lit once it has moved
 * on.
 */
const ANIMAL_RELEASE = 0.6;
/** How near an animal or the cursor must be to hit a star, by star size. */
const OBJECT_HIT_R_SCALE = 0.7;
const CURSOR_HIT_SCALE = 0.7;
/** Animals fly this much faster while the sky travels. */
const TRAVEL_SPEED_MUL = 1.5;
/** Most animals of each kind one sky can hold. */
const MAX_ANIMALS = 100;
/** Mean gap between the two sides' entering animals: 5 pairs a second. */
const ANIMAL_ENTER_TICK_S = 0.2;
/** Seconds between exit batches. */
const ANIMAL_EXIT_TICK_S = 0.08;
/** Animals of each kind that start to leave on every exit tick. */
const ANIMAL_EXIT_BATCH = 2;
/**
 * An animal that leaves flashes, swells, shrinks away and puffs, over this
 * long.
 */
const ANIMAL_LEAVE_SEC = 1.25;
/** Reach of the ring an animal's kill sends out, as a share of the arena. */
const OBJECT_HAT_REACH = 0.22;
/** Seconds the animals take to shrink when the sky shakes. */
const SHAKE_SHRINK_S = 0.4;
/** Seconds the sky stays dark between a Travel and the next sky. */
const MANUAL_SHUFFLE_DARK_S = 1.0;
/**
 * The four members: one animal in one look. A side plays a **team** of one or
 * two of these, and a look carries the sprites, the trail, the trajectories
 * and the counter colours together.
 */
const MEMBERS = [
  {id: 'bio-fly', look: 'bio', kind: 'fly'},
  {id: 'bio-fish', look: 'bio', kind: 'fish'},
  {id: 'cyber-fly', look: 'cyber', kind: 'fly'},
  {id: 'cyber-fish', look: 'cyber', kind: 'fish'},
];
/** The members sharing each look, and each species. */
const BIO_MEMBERS = MEMBERS.filter((m) => m.look === 'bio');
const CYBER_MEMBERS = MEMBERS.filter((m) => m.look === 'cyber');
const FLY_MEMBERS = MEMBERS.filter((m) => m.kind === 'fly');
const FISH_MEMBERS = MEMBERS.filter((m) => m.kind === 'fish');
/**
 * The three shapes a matchup takes, with their relative shares. `single` gives
 * each side one member, and never the same one twice. `look` puts both members
 * of one look against the other look. `species` puts both members of one
 * species against the other species.
 *
 * Seven skies in ten field a team of one; the rest are collaborations, split
 * evenly between the two kinds. Integer weights so the draw lands exactly on
 * the boundaries rather than a hair over from floating point.
 */
const MATCH_ODDS = [
  {kind: 'single', weight: 70},
  {kind: 'look', weight: 15},
  {kind: 'species', weight: 15},
];
const MATCH_WEIGHT_TOTAL = MATCH_ODDS.reduce((sum, o) => sum + o.weight, 0);
/** Side of the arena a team plays for. Left is index 0, right is index 1. */
const LEFT = 0;
const RIGHT = 1;

/** Where the first sky is seen from, and the date of its stars. */
const LISBON_LAT = 38.72;
const LISBON_LON = -9.13;
const STAR_DATE = '2026-06-21';
/** The red-hot glow of an explosion: strength, size, falloff, pulse. */
const EXPLOSION_GLOW = {
  peakAlpha: 0.45,
  outerReachPx: 220,
  falloffPower: 3,
  pulseSpeed: 5.5,
};
/** The kill ring: how long it lasts, how bright, and how wide. */
const HAT_DURATION_S = 0.32;
const HAT_PEAK = 0.12;
const HAT_SIGMA = 0.28;
/** Seed of the first sky's star count. */
const DRAW_SEED = 108;
/**
 * A sky draws a star count from a normal curve, kept inside the range. The
 * mean is the curve's centre, not the mean of what a sky draws: the floor at
 * STAR_MIN cuts more of the lower tail than the ceiling cuts the upper one,
 * so the counts a viewer sees average a little above STAR_MEAN.
 */
const STAR_MEAN = 60;
const NORMAL_SIGMA = 46;
const STAR_MIN = 4;
const STAR_MAX = 196;
/** Milliseconds the star-count slider waits before it builds a new sky. */
const STAR_SETTLE_MS = 120;
/**
 * Milliseconds between polls of the live quake feed. The server answers from
 * memory, so this is what the piece adds to a quake's trip to the screen.
 */
const LIVE_POLL_MS = 3000;
/**
 * How far back the server keeps events; matches EQ_WINDOW_S in
 * quakes_live.py.
 */
const LIVE_LOOKBACK_MS = 60 * 60 * 1000;

/** Compact 2D simplex noise, a public-domain algorithm, seeded. */
class SimplexNoise {
  constructor(seed = 1) {
    this.p = new Uint8Array(256);
    let s = seed >>> 0 || 1;
    const rand = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) % 1000) / 1000;
    };
    for (let i = 0; i < 256; i++) {
      this.p[i] = i;
    }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = this.p[i];
      this.p[i] = this.p[j];
      this.p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = this.p[i & 255];
    }
  }
  grad(hash, x, y) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
  }
  noise2D(xin, yin) {
    const F2 = 0.3660254037844386;
    const G2 = 0.21132486540518713;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    const n0 = t0 < 0 ? 0 :
      (t0 *= t0, t0 * t0 * this.grad(this.perm[ii + this.perm[jj]], x0, y0));
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    const n1 = t1 < 0 ? 0 :
      (t1 *= t1, t1 * t1 * this.grad(
          this.perm[ii + i1 + this.perm[jj + j1]], x1, y1));
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    const n2 = t2 < 0 ? 0 :
      (t2 *= t2, t2 * t2 * this.grad(
          this.perm[ii + 1 + this.perm[jj + 1]], x2, y2));
    return 70 * (n0 + n1 + n2);
  }
}

let noiseC = new SimplexNoise(42);

/** Clamp a number to the range 0 to 1. */
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** A small seeded generator: the same seed gives the same numbers. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

let nextUnit = mulberry32(DRAW_SEED);

/** The next number of a normal curve with mean 0 and spread 1. */
function nextGaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) {
    u = nextUnit();
  }
  while (v === 0) {
    v = nextUnit();
  }
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Reseed the clock-driven streams, so every sky draws anew.
 *
 * Called from loadSky before anything reads the streams. The two
 * sub-seeds are offset so the star draw shares no sequence with the
 * aurora noise.
 */
function reseedSky(seed) {
  const s = seed >>> 0;
  nextUnit = mulberry32(s);
  noiseC = new SimplexNoise(s + 2);
}

/**
 * Draw a star count near STAR_MEAN, in fours so it splits evenly however the
 * sky is divided: halves between the sides, and quarters when a side fields a
 * team of two.
 */
function nextStarCount() {
  while (true) {
    const x = STAR_MEAN + nextGaussian() * NORMAL_SIGMA;
    const n = Math.round(x / 4) * 4;
    if (n >= STAR_MIN && n <= STAR_MAX) {
      return n;
    }
  }
}

/**
 * Every number from 0 to n - 1, in an order drawn from the seeded stream.
 * @param {number} n how many to shuffle
 * @return {number[]} the shuffled numbers
 */
function shuffledIds(n) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    ids.push(i);
  }
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(nextUnit() * (i + 1));
    const swap = ids[i];
    ids[i] = ids[j];
    ids[j] = swap;
  }
  return ids;
}

/** Color of the Circle layer. */
const RING = GREY_RAMP[3];
const pixels = new PixelBatch();
/**
 * Art scale factor: 1 at the radius the size constants were tuned for, and
 * proportional to the dome above and below it, so every mark scales with the
 * sky it sits on.
 */
let gridK = 1;
let dotSpacing = DOT_SPACING;
let dotFlow = DOT_FLOW_SPEED;
let wiggleAmt = WIGGLE_AMOUNT;
let hoverR = HOVER_RADIUS;
const canvas = document.getElementById('dome');
/**
 * A second canvas over the arena at full device resolution. The aura under
 * each animal is smooth there, not snapped to the art grid or the palette.
 */
const auraCanvas = document.createElement('canvas');
auraCanvas.id = 'aura';
auraCanvas.style.cssText =
    'position:absolute;display:block;pointer-events:none';
canvas.after(auraCanvas);
const auraCtx = auraCanvas.getContext('2d');
let auraScale = 1;
/** True when the layer holds animals this frame, so the aura has work. */
let auraAnimals = false;
/**
 * Animals and their trails are drawn on their own art-grid layer, then laid on
 * the arena. The layer is also the shape the aura follows: it is blurred in
 * three steps (half, quarter, eighth size) and stretched up smoothly.
 */
const animalLayer = document.createElement('canvas');
const actx = animalLayer.getContext('2d');
const auraBlur = [];
const ctx = canvas.getContext(
    '2d', {alpha: false, willReadFrequently: true});

/** @type {{cx: number, cy: number, radius: number, w: number, h: number}} */
let view = {cx: 0, cy: 0, radius: 1, w: 0, h: 0};
let stars = [];
let mesh = {edges: [], rimArcs: [], cells: []};
let meshSeeds = [];
let meshEdges = [];
let meshRimArcs = [];
/** @type {Int32Array|null} */
let rimOwner = null;
/** @type {{bx: number, by: number, oi: number}[]} */
let rimDots = [];
/**
 * @typedef {{
 *   xy: Float32Array,
 *   offsets: Uint32Array,
 *   counts: Uint32Array,
 *   m: Float32Array,
 *   q1: number,
 *   median: number,
 *   q3: number,
 *   odometers: object[],
 *   lastBank: string[],
 *   lastHeading: (number|null)[],
 *   headClock: number[]
 * }} TrackPack
 */
/** @type {TrackPack|null} */
/**
 * One member on the field: the animal, the tracks it draws, and everything
 * that animal mutates while the sky runs.
 * @param {Object} team One entry of MEMBERS.
 * @return {Object} the member
 */
function makeMember(team) {
  return {
    team,
    /** Track pack of the member's species, from loadMemberPack. */
    pack: null,
    /** Eight-heading sprite frames of the member's kind and look. */
    sprites: null,
    /** Identities on screen, and the ones that have started to leave. */
    shown: new Set(),
    fadeStart: new Map(),
    /**
     * Every identity of the member's species, shuffled. The piece shows the
     * first `count` of these, so a new sky draws a different handful from the
     * whole set instead of always the same low-numbered ones.
     */
    order: [],
    count: 0,
    remaining: 0,
    hz: DEFAULT_HZ,
    clock: 0,
  };
}

/**
 * A side of the arena: the layer switch that shows it and the team it plays.
 * A team is one member or two.
 * @param {string} layer 'left' or 'right'
 * @param {Object[]} teams One entry of MEMBERS, or two.
 * @return {Object} the side
 */
function makeSide(layer, teams) {
  return {
    layer,
    members: teams.map(makeMember),
    /** Animals this side fields in total, which is what its slider sets. */
    want: 0,
    /**
     * Which member owns the tens digit and which the units, drawn once per
     * sky. `drawCounter` runs every frame, so this cannot be decided there.
     */
    digitOrder: [0, 1],
  };
}

/**
 * The shape of matchup a new sky gets, drawn by weight.
 * @return {string} one of the kinds in MATCH_ODDS
 */
function drawMatchKind() {
  let roll = Math.floor(Math.random() * MATCH_WEIGHT_TOTAL);
  for (const {kind, weight} of MATCH_ODDS) {
    if (roll < weight) {
      return kind;
    }
    roll -= weight;
  }
  return MATCH_ODDS[0].kind;
}

/**
 * Draw the matchup for a new sky: one of the three shapes, then the concrete
 * assignment inside it.
 *
 * A `single` takes one member from the four and a second from the remaining
 * three, so a team never faces itself. A `look` match hands one look to each
 * side and a `species` match one species to each, which are distinct by
 * definition. Which goes left is a coin toss.
 * @return {Object[]} the two sides, left first
 */
function drawMatchup() {
  const kind = drawMatchKind();
  const swap = Math.random() < 0.5;
  if (kind === 'look') {
    const pair = swap ? [CYBER_MEMBERS, BIO_MEMBERS] :
        [BIO_MEMBERS, CYBER_MEMBERS];
    return [makeSide('left', pair[0]), makeSide('right', pair[1])];
  }
  if (kind === 'species') {
    const pair = swap ? [FISH_MEMBERS, FLY_MEMBERS] :
        [FLY_MEMBERS, FISH_MEMBERS];
    return [makeSide('left', pair[0]), makeSide('right', pair[1])];
  }
  const pool = MEMBERS.slice();
  const first = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  const second = pool[Math.floor(Math.random() * pool.length)];
  return [makeSide('left', [first]), makeSide('right', [second])];
}

/** Both sides, left first. Rebuilt outright on every new sky. */
let sides = [makeSide('left', [MEMBERS[0]]), makeSide('right', [MEMBERS[1]])];
let skyCount = 60;
let lastMs = 0;
let animTime = 0;
let looping = false;
let domePath = new Path2D();

// The trail builders of each look. Both modules export the same two names,
// so only the lookup moves when a team's look is known and every call site
// stays as it was.
const TRAIL_BY_LOOK = {
  bio: {odometer: bioOdometer, trail: bioTrail},
  cyber: {odometer: cyberOdometer, trail: cyberTrail},
};

const layers = {
  circle: false,
  stars: false,
  voronoi: false,
  wiggle: false,
  spokes: false,
  sparkle: false,
  color: false,
  left: false,
  right: false,
};

const deadStarIds = new Set();
const dyingStars = new Map();
const spokeHover = new Map();
/** Who lit each hovered spoke last: 'cursor', 'fly' or 'fish'. */
const spokeKind = new Map();
let chainFn = null;
let nextChainAt = 0;
let chainInterval = CHAIN_TICK_S;
let chainVaries = false;
let explosionTouched = new Set();
let explosionActive = false;
let explosionKind = 'travel';
let revivalActive = false;
let locationChange = false;
let swapping = false;
let pendingLocation = null;
let shuffleDarkS = MANUAL_SHUFFLE_DARK_S;
let shuffleDeadAt = null;
let blackoutReadyAt = null;
let objectsGate = false;
let animalEnterAt = null;
let animalExitAt = null;
let animalNextAt = 0;
let animalExitTick = 0;
let explosionWorkTotal = 1;
let revivalWorkTotal = 1;
let revivalWorkLeft = 0;
let revivalUntil = 0;
let clockNow = 0;
let obsLat = LISBON_LAT;
let obsLon = LISBON_LON;
let placeName = 'Lisbon';
let placeCountry = 'Portugal';
let capitals = [];
let quakes = [];
let travelQueue = [];
let travelCount = 0;
let shakeIndex = 0;
let cursorOn = true;
let objectsOn = true;
let liveOn = true;
let gameOn = false;
let interactOn = true;
let magMin = 3;
let liveSeen = new Set();
let liveSinceMs = 0;
let quakeHud = null;
let mouseX = null;
let mouseY = null;
let animalsVisibleAtExit = false;
let lastDt = 1 / 30;
const hatBursts = [];
let shakeFrozen = false;
let shakeShrinkT0 = 0;
let exitChainStarted = false;
/** Key of the PLANETS entry that colors the sky now. */
let planetKey = 'earth';
const haloLayer = new HaloLayer();

/** Convert a unit-disk position to arena pixels. */
function toPixel(x, y) {
  return {
    px: view.cx + x * view.radius,
    py: view.cy + y * view.radius,
  };
}

/**
 * Size the canvas as a small pixel grid scaled up by a whole number.
 *
 * The scale is counted in device pixels, so every arena pixel covers the same
 * number of screen pixels at any zoom or display density. The canvas is
 * centered on a device-pixel boundary and --px carries the size of one arena
 * pixel in CSS pixels for the DOM around it.
 */
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const devW = Math.round(window.innerWidth * dpr);
  const devH = Math.round(window.innerHeight * dpr);
  const scale = Math.max(
      MIN_SCALE, Math.round(Math.min(devW, devH) / TARGET_ROWS));
  const w = Math.ceil(devW / scale);
  const h = Math.ceil(devH / scale);
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = (w * scale / dpr) + 'px';
  canvas.style.height = (h * scale / dpr) + 'px';
  canvas.style.left = (Math.floor((devW - w * scale) / 2) / dpr) + 'px';
  canvas.style.top = (Math.floor((devH - h * scale) / 2) / dpr) + 'px';
  auraCanvas.width = w * scale;
  auraCanvas.height = h * scale;
  auraCanvas.style.width = canvas.style.width;
  auraCanvas.style.height = canvas.style.height;
  auraCanvas.style.left = canvas.style.left;
  auraCanvas.style.top = canvas.style.top;
  auraScale = scale;
  animalLayer.width = w;
  animalLayer.height = h;
  actx.imageSmoothingEnabled = false;
  auraBlur.length = 0;
  for (let level = 1; level <= 3; level++) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w / 2 ** level));
    c.height = Math.max(1, Math.ceil(h / 2 ** level));
    auraBlur.push({canvas: c, ctx: c.getContext('2d')});
  }
  document.documentElement.style.setProperty('--px', (scale / dpr) + 'px');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  view = {
    cx: Math.floor(w / 2),
    cy: Math.floor(h / 2),
    radius: Math.floor(Math.min(w, h) * 0.485),
    w: w,
    h: h,
  };
  gridK = view.radius / REF_RADIUS;
  dotSpacing = DOT_SPACING * gridK;
  dotFlow = DOT_FLOW_SPEED * gridK;
  wiggleAmt = WIGGLE_AMOUNT * gridK;
  hoverR = HOVER_RADIUS * gridK;
  pixels.resizeTo(w, h);
  domePath = new Path2D();
  domePath.arc(view.cx, view.cy, view.radius, 0, Math.PI * 2);
  buildLocalMesh();
}

/** Convert a mouse event to arena pixel coordinates. */
function arenaPoint(ev) {
  const rect = canvas.getBoundingClientRect();
  return [
    (ev.clientX - rect.left) * canvas.width / rect.width,
    (ev.clientY - rect.top) * canvas.height / rect.height,
  ];
}

/** Blank the canvas; the boot overlay carries the message. */
function paintBlank() {
  resize();
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, view.w, view.h);
}

/** Wrap i into the range 0 to n - 1, also for negative i. */
function wrap(i, n) {
  return ((i % n) + n) % n;
}

/** Decode a track file from the server into a track pack. */
function parseTracks(buf) {
  const dv = new DataView(buf);
  const mag = String.fromCharCode(
      dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (mag !== 'SAW2') {
    throw new Error('bad track magic');
  }
  const nIds = dv.getUint32(4, true);
  const q1 = dv.getFloat32(8, true);
  const median = dv.getFloat32(12, true);
  const q3 = dv.getFloat32(16, true);
  const counts = new Uint32Array(nIds);
  let o = 20;
  for (let i = 0; i < nIds; i++) {
    counts[i] = dv.getUint32(o, true);
    o += 4;
  }
  const xy = new Float32Array(buf, o);
  const offsets = new Uint32Array(nIds);
  let k = 0;
  for (let i = 0; i < nIds; i++) {
    offsets[i] = k;
    k += counts[i] * SPRITE_STRIDE;
  }
  const odometers = [];
  const lastBank = [];
  const lastHeading = [];
  const headClock = [];
  for (let i = 0; i < nIds; i++) {
    lastBank.push('grow');
    lastHeading.push(null);
    headClock.push(0);
  }
  return {
    xy,
    offsets,
    counts,
    m: trackSlopes(xy, offsets, counts),
    q1,
    median,
    q3,
    odometers,
    lastBank,
    lastHeading,
    headClock,
  };
}

/** Slope of each track sample, for smooth curves between samples. */
function trackSlopes(xy, offsets, counts) {
  const m = new Float32Array(xy.length);
  const stride = SPRITE_STRIDE;
  for (let id = 0; id < counts.length; id++) {
    const n = counts[id];
    const base = offsets[id];
    if (n < 2) {
      continue;
    }
    for (let i = 0; i < n; i++) {
      const prev = wrap(i - 1, n);
      const next = wrap(i + 1, n);
      const o = base + i * stride;
      m[o] = (xy[base + next * stride] - xy[base + prev * stride]) / 2;
      m[o + 1] = (
        xy[base + next * stride + 1] - xy[base + prev * stride + 1]
      ) / 2;
    }
  }
  return m;
}

/** Position of track id at sample i, wrapping around the loop. */
function sampleXY(pack, id, i) {
  const n = pack.counts[id];
  const base = pack.offsets[id];
  const j = wrap(i, n);
  const o = base + j * SPRITE_STRIDE;
  return [pack.xy[o], pack.xy[o + 1]];
}

/** Slope of track id at sample i, wrapping around the loop. */
function sampleM(pack, id, i) {
  const n = pack.counts[id];
  const base = pack.offsets[id];
  const j = wrap(i, n);
  const o = base + j * SPRITE_STRIDE;
  return [pack.m[o], pack.m[o + 1]];
}

/** Speed of track id at sample i, wrapping around the loop. */
function sampleSpeed(pack, id, i) {
  const n = pack.counts[id];
  const base = pack.offsets[id];
  const j = wrap(i, n);
  return pack.xy[base + j * SPRITE_STRIDE + 2];
}

/** Smooth curve between two samples, from positions and slopes. */
function hermite(p0, m0, p1, m1, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return [
    h00 * p0[0] + h10 * m0[0] + h01 * p1[0] + h11 * m1[0],
    h00 * p0[1] + h10 * m0[1] + h01 * p1[1] + h11 * m1[1],
  ];
}

/** Blend two 2D points; t runs from 0 to 1. */
function lerp2(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Speed at which an animal switches to its flicker frames. */
function speedThreshold(kind, q1) {
  if (!(q1 > 0)) {
    return 0;
  }
  return kind === 'fly' ? q1 * FLY_Q1_SCALE : q1;
}

/** Blend two angles along the shorter way around. */
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) {
    d -= Math.PI * 2;
  }
  while (d < -Math.PI) {
    d += Math.PI * 2;
  }
  return a + d * t;
}

/** Turn an animal's stored heading toward `raw` over about `tau` seconds. */
function smoothHeading(pack, id, raw, clock, tau) {
  const prev = pack.lastHeading[id];
  if (prev == null) {
    pack.lastHeading[id] = raw;
    pack.headClock[id] = clock;
    return raw;
  }
  const dt = Math.max(0, clock - pack.headClock[id]);
  pack.headClock[id] = clock;
  const alpha = 1 - Math.exp(-dt / tau);
  const next = lerpAngle(prev, raw, alpha);
  pack.lastHeading[id] = next;
  return next;
}

/** Pick the sprite bank and frame for an animal's current speed. */
function spriteFrame(clock, hz, speed, prev, q1, lastBank) {
  if (shakeFrozen) {
    const u = Math.max(0, Math.min(1,
        (clockNow - shakeShrinkT0) / SHAKE_SHRINK_S));
    const n = Math.round(u * (SPRITE_FRAMES - 1));
    return {bank: 'shrink', n};
  }
  const travelFast = explosionActive && explosionKind === 'travel';
  if (travelFast || !(q1 > 0) || speed >= q1) {
    return {bank: 'flicker', n: Math.floor(clock * hz) % SPRITE_FRAMES};
  }
  const uu = Math.max(0, Math.min(1, speed / q1));
  const n = Math.round(uu * (SPRITE_FRAMES - 1));
  let bank = lastBank || 'grow';
  if (speed > prev) {
    bank = 'grow';
  } else if (speed < prev) {
    bank = 'shrink';
  }
  return {bank, n};
}

/** Index 0 to 7 of the heading in radians: 0 faces east, turning clockwise. */
function headingDir(heading) {
  return wrap(Math.round(heading / (Math.PI / 4)), 8);
}

/** Draw a sprite frame on whole pixels, turned to the nearest of 8 headings. */
function drawSprite(frame, px, py, heading, fx) {
  if (fx && fx.puff >= 0) {
    drawPuff(Math.round(px), Math.round(py), fx.puff);
    return;
  }
  const img = frame[headingDir(heading)];
  const s = fx ? fx.scale : 1;
  const w = Math.round(img.width * s);
  const h = Math.round(img.height * s);
  auraAnimals = true;
  // The middle pixel of the odd-sized art sits on the animal's position.
  actx.drawImage(fx && fx.white ? whiteOf(img) : img,
      Math.round(px) - Math.floor(w / 2),
      Math.round(py + (fx ? fx.dy : 0)) - Math.floor(h / 2),
      w, h);
}

/** Four little stars fly out diagonally and dither away. */
function drawPuff(x, y, u) {
  const r = Math.round((3 + 8 * u) * gridK);
  const arm = Math.max(1, Math.round(gridK));
  auraAnimals = true;
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const cx = x + sx * r;
    const cy = y + sy * r;
    if (bayer01(cx, cy) < u * u) {
      continue;
    }
    actx.fillStyle = WHITE;
    actx.fillRect(cx - arm, cy, 2 * arm + 1, 1);
    actx.fillRect(cx, cy - arm, 1, 2 * arm + 1);
    actx.fillStyle = RAMPS.yellow[3];
    actx.fillRect(cx, cy, 1, 1);
  }
}

const whiteCache = new Map();

/** A solid white copy of a sprite frame, for the flash of a leaving animal. */
function whiteOf(img) {
  let c = whiteCache.get(img);
  if (!c) {
    c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const cc = c.getContext('2d');
    cc.drawImage(img, 0, 0);
    cc.globalCompositeOperation = 'source-in';
    cc.fillStyle = WHITE;
    cc.fillRect(0, 0, c.width, c.height);
    whiteCache.set(img, c);
  }
  return c;
}

/** Position of an animal on its track at a clock time. */
function poseAt(pack, id, clock, hz) {
  const n = pack.counts[id];
  if (n < 2) {
    return sampleXY(pack, id, 0);
  }
  const u = clock * hz;
  const i = wrap(Math.floor(u), n);
  const t = u - Math.floor(u);
  const j = wrap(i + 1, n);
  return hermite(
      sampleXY(pack, id, i), sampleM(pack, id, i),
      sampleXY(pack, id, j), sampleM(pack, id, j), t);
}

/** Color-off trail colors: [line, head] palette shades. */
const TRAIL_SHADES = {
  fly: [RAMPS.orange[2], RAMPS.orange[3]],
  fish: [RAMPS.sky[2], RAMPS.sky[3]],
};

/** How many track-sample intervals the odometer of a track is cut into. */
const ODOMETER_STEPS_PER_SAMPLE = 4;

/** Color off: a pixel line behind the animal and a dot at its head. */
function drawLineTrail(member, id) {
  const pack = member.pack;
  const n = pack.counts[id];
  const [lineColor, headColor] = TRAIL_SHADES[member.team.kind];
  let prev = null;
  for (let k = Math.min(TRAIL, n - 1); k >= 0; k--) {
    const pos = poseAt(pack, id, member.clock - k / member.hz, member.hz);
    const p = toPixel(pos[0], pos[1]);
    if (prev) {
      pixels.line(prev.px, prev.py, p.px, p.py, gridK, () => lineColor, false);
    }
    prev = p;
  }
  const head = poseAt(pack, id, member.clock, member.hz);
  const p = toPixel(head[0], head[1]);
  pixels.dot(Math.round(p.px), Math.round(p.py), headColor, 3.1 * gridK);
  pixels.flush(ctx);
}

/** Color on: the comet or neon trail of the member's look. */
function drawAnimalTrail(member, id) {
  const pack = member.pack;
  const n = pack.counts[id];
  if (n < 1) {
    return;
  }
  if (!layers.color) {
    drawLineTrail(member, id);
    return;
  }
  const {odometer, trail} = TRAIL_BY_LOOK[member.team.look];
  const path = (clk) => {
    const p = poseAt(pack, id, clk, member.hz);
    return {x: view.cx + p[0] * view.radius, y: view.cy + p[1] * view.radius};
  };
  if (!pack.odometers[id]) {
    pack.odometers[id] = n < 2 ?
        {period: 1, dt: 1, d: new Float64Array(2), loop: 0} :
        odometer((t) => poseAt(pack, id, t, member.hz), n / member.hz,
            n * ODOMETER_STEPS_PER_SAMPLE);
  }
  trail(actx, member.team.kind, path, member.clock, pack.odometers[id],
      view.radius);
}

/** Draw an animal's sprite, turned to its heading. */
function drawAnimalSprite(member, id, fx) {
  const pack = member.pack;
  const kind = member.team.kind;
  const n = pack.counts[id];
  if (n < 1 || !member.sprites) {
    return;
  }
  let segI = -1;
  let p0;
  let m0;
  let p1;
  let m1;
  const pose = (clk) => {
    if (n === 1) {
      return {xy: sampleXY(pack, id, 0), slope: [1, 0], i: 0};
    }
    const u = clk * member.hz;
    const i = wrap(Math.floor(u), n);
    const t = u - Math.floor(u);
    if (i !== segI) {
      const j = wrap(i + 1, n);
      p0 = sampleXY(pack, id, i);
      m0 = sampleM(pack, id, i);
      p1 = sampleXY(pack, id, j);
      m1 = sampleM(pack, id, j);
      segI = i;
    }
    const slope = lerp2(m0, m1, t);
    return {xy: hermite(p0, m0, p1, m1, t), slope, i};
  };
  const head = pose(member.clock);
  const pixel = toPixel(head.xy[0], head.xy[1]);
  const speed = sampleSpeed(pack, id, head.i);
  const prev = sampleSpeed(pack, id, wrap(head.i - 1, n));
  const clip = spriteFrame(
      member.clock, member.hz, speed, prev, speedThreshold(kind, pack.q1),
      pack.lastBank[id]);
  pack.lastBank[id] = clip.bank === 'flicker' ? pack.lastBank[id] : clip.bank;
  const rawHead = Math.atan2(head.slope[1], head.slope[0]);
  const tau = kind === 'fly' ? FLY_HEADING_TAU : FISH_HEADING_TAU;
  const heading = smoothHeading(pack, id, rawHead, member.clock, tau);
  drawSprite(member.sprites[clip.bank][clip.n], pixel.px, pixel.py,
      heading, fx);
}

/**
 * How an animal looks while it leaves, after the defeats of Super Mario World:
 * a white hit-flash, a hop while it swells to nearly twice its size, a blink
 * that speeds up until it is gone, and a puff of little stars. Every rate
 * stays at or under 15 Hz, so the 30 fps loop shows each blink.
 * @param {number} t seconds since it started to leave
 * @return {{on: boolean, white: boolean, scale: number, dy: number,
 *     puff: number}} puff is 0 to 1 while the stars fly, else -1
 */
function leaveFx(t) {
  const fx = {on: true, white: false, scale: 1, dy: 0, puff: -1};
  if (t < 0.15) {
    fx.white = Math.floor(t * 15) % 2 === 0;
  } else if (t < 0.65) {
    const u = (t - 0.15) / 0.5;
    fx.scale = 1 + LEAVE_SWELL * (1 - (1 - u) * (1 - u));
    fx.dy = -Math.sin(Math.PI * u) * 4 * gridK;
    fx.on = (t * 6) % 1 < 0.85;
  } else if (t < 1.05) {
    const tau = t - 0.65;
    const phase = 5 * tau + 12.5 * tau * tau;
    const fr = phase - Math.floor(phase);
    fx.scale = 1 + LEAVE_SWELL;
    fx.on = fr < 0.6 - 0.5 * (tau / 0.4);
    fx.white = fr < 0.15;
  } else {
    fx.on = false;
    fx.puff = Math.min(1, (t - 1.05) / 0.2);
  }
  return fx;
}

/** Draw one animal: its trail, then its sprite. */
function drawAnimal(member, id, fade) {
  const a = fade == null ? 1 : fade;
  if (a <= 0) {
    return;
  }
  let fx = null;
  if (a < 1) {
    fx = leaveFx((1 - a) * ANIMAL_LEAVE_SEC);
    if (!fx.on && fx.puff < 0) {
      return;
    }
  }
  if (!fx || fx.on) {
    drawAnimalTrail(member, id);
  }
  if (layers.color) {
    drawAnimalSprite(member, id, fx);
  }
}

/** A steady pseudo-random number from 0 to 1 for an integer seed. */
function edgeRand(seed) {
  let s = (seed >>> 0) || 1;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  return ((s >>> 0) % 1000) / 1000;
}

/** The star indexes that own dot i, as an array. */
function ownersAt(list, i) {
  if (!list || !list.length) {
    return [];
  }
  const entry = list[Math.min(i, list.length - 1)];
  if (entry == null) {
    return [];
  }
  if (typeof entry === 'number') {
    return [entry];
  }
  return entry;
}

/**
 * Distance along a ray to a segment, or Infinity when the ray misses it.
 * @param {number} ox ray origin x
 * @param {number} oy ray origin y
 * @param {number} dx unit direction x
 * @param {number} dy unit direction y
 * @param {number[]} a segment start
 * @param {number[]} b segment end
 * @return {number}
 */
function raySegment(ox, oy, dx, dy, a, b) {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) {
    return Infinity;
  }
  const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den;
  const s = ((a[0] - ox) * dy - (a[1] - oy) * dx) / den;
  return t > 0 && s >= 0 && s <= 1 ? t : Infinity;
}

/** Cell polygon in arena pixels. */
function cellPolygon(cell) {
  return cell.pts.map((p) => {
    const q = toPixel(p[0], p[1]);
    return [q.px, q.py];
  });
}

/** Rays sampled around a star to find how far its cell reaches. */
const REACH_RAYS = 12;

/**
 * The mean distance from a star to the edge of its Voronoi cell.
 *
 * The shatter of a dying star flies out this far.
 * @param {object} seed a meshSeeds entry
 * @param {number[][]} poly the star's cell polygon, in arena pixels
 * @return {number} the mean reach in art pixels, or a default when no ray
 *     hits the cell
 */
function meanReach(seed, poly) {
  let sum = 0;
  let hits = 0;
  for (let k = 0; k < REACH_RAYS; k++) {
    const ang = (k / REACH_RAYS) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let len = Infinity;
    for (let i = 0; i < poly.length; i++) {
      len = Math.min(len, raySegment(
          seed.x0, seed.y0, dx, dy, poly[i], poly[(i + 1) % poly.length]));
    }
    if (len > 1 && len < Infinity) {
      sum += len;
      hits++;
    }
  }
  return hits ? sum / hits : 40 * gridK;
}

/** Build the per-star, per-edge, and per-rim-arc data the frame draws. */
function buildLocalMesh() {
  meshSeeds = stars.map((s, i) => {
    const p = toPixel(s.x, s.y);
    const tone = edgeRand(i * 7919 + 13);
    return {
      cid: String(i) + ':' + (s.name || ''),
      x0: Math.round(p.px),
      y0: Math.round(p.py),
      size: Math.max(0.8, 3.2 - Number(s.magnitude) * 0.35) * gridK,
      t: Math.min(1, Math.hypot(s.x, s.y)),
      mag: Number(s.magnitude),
      tone: tone < 0.5 ? 0 : tone < 0.8 ? 1 : 2,
      phase: edgeRand(i * 104729 + 5) * 4,
      aurora: 0,
      reach: 40 * gridK,
    };
  });
  for (const cell of mesh.cells) {
    const seed = meshSeeds[cell.star];
    if (seed) {
      seed.reach = meanReach(seed, cellPolygon(cell));
    }
  }
  meshEdges = mesh.edges.map((e, i) => {
    const a = toPixel(e.p1[0], e.p1[1]);
    const b = toPixel(e.p2[0], e.p2[1]);
    const p1 = [Math.round(a.px), Math.round(a.py)];
    const p2 = [Math.round(b.px), Math.round(b.py)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const speedMul = SPEED_VARIATION_MIN +
        edgeRand(i * 92821 + 7) *
        (SPEED_VARIATION_MAX - SPEED_VARIATION_MIN);
    return {
      p1, p2, len, t: e.t, sites: e.sites,
      dotOwners: e.dotOwners, speedMul,
    };
  });
  meshRimArcs = mesh.rimArcs.map((a, i) => {
    const len = view.radius * (a.a2 - a.a1);
    const speedMul = SPEED_VARIATION_MIN +
        edgeRand(i * 51329 + 11) *
        (SPEED_VARIATION_MAX - SPEED_VARIATION_MIN);
    return {
      a1: a.a1, a2: a.a2, len, t: a.t,
      dotOwners: a.dotOwners, speedMul,
    };
  });
  buildRimOwner();
}

/** Rebuild the Voronoi mesh for the current stars. */
function rebuildMesh() {
  // Hover state is keyed by spoke, and the spokes are about to change.
  spokeHover.clear();
  spokeKind.clear();
  const seeds = stars.map((s) => ({
    x: s.x,
    y: s.y,
    t: Math.hypot(s.x, s.y),
  }));
  mesh = buildMesh(seeds);
  buildLocalMesh();
}

/**
 * Record which star owns each slice of the dome outline.
 *
 * A star owns the stretch of rim it sits nearest to, so the tiling has no
 * gaps and no star claims its neighbour's arc. The flowing rim dots read
 * their owner from this table.
 */
function buildRimOwner() {
  const steps = RIM_SAMPLE_STEPS;
  const n = stars.length;
  rimOwner = new Int32Array(steps);
  if (!n) {
    rimOwner.fill(-1);
    return;
  }
  for (let s = 0; s < steps; s++) {
    const ang = (s / steps) * Math.PI * 2;
    const rx = Math.cos(ang);
    const ry = Math.sin(ang);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = stars[i].x - rx;
      const dy = stars[i].y - ry;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    rimOwner[s] = best;
  }
}

/**
 * Lay a ring of flowing dots around the dome outline.
 *
 * The dots slide as one, carrying each star's rim spokes with them. Both
 * the wiggle layer and the spoke layer read this list, so the spokes always
 * land exactly on a dot.
 * @param {number} time
 */
function updateRimDots(time) {
  rimDots.length = 0;
  if (!rimOwner || view.radius <= 0) {
    return;
  }
  const steps = RIM_SAMPLE_STEPS;
  // A multiple of SPOKE_EVERY, so the spokes stay evenly spaced
  // across the seam where the ring closes.
  const count = SPOKE_EVERY * Math.max(3, Math.round(
      (Math.PI * 2 * view.radius) / dotSpacing / SPOKE_EVERY));
  const stepAng = (Math.PI * 2) / count;
  const flow = flowOffset(time, 0, 1) / dotSpacing;
  const wraps = dotWraps(time, 0, 1);
  for (let i = 0; i < count; i++) {
    const ang = (i + flow) * stepAng;
    let s = Math.floor((ang / (Math.PI * 2)) * steps) % steps;
    if (s < 0) {
      s += steps;
    }
    const oi = rimOwner[s];
    if (oi < 0) {
      continue;
    }
    rimDots.push({
      bx: view.cx + view.radius * Math.cos(ang),
      by: view.cy + view.radius * Math.sin(ang),
      oi,
      id: i - wraps,
    });
  }
}

/**
 * How bright a dying star's spokes are, from 0 to 1, or null once it is gone.
 * @param {number} elapsed seconds since the star started to die
 */
function dyingBrightness(elapsed) {
  if (elapsed < DYING_ATTACK_S) {
    return elapsed / DYING_ATTACK_S;
  }
  if (elapsed < DYING_ATTACK_S + DYING_DECAY_S) {
    return 1 - (elapsed - DYING_ATTACK_S) / DYING_DECAY_S;
  }
  return null;
}

/** The id of every star in the sky. */
function visibleIds() {
  return meshSeeds.map((s) => s.cid);
}

/** True when every star is gone. */
function isFullyDead() {
  const ids = visibleIds();
  if (!ids.length) {
    return false;
  }
  for (const cid of ids) {
    if (!deadStarIds.has(cid) || dyingStars.has(cid)) {
      return false;
    }
  }
  return true;
}

/** True when no star is dead or dying. */
function isFullyAlive() {
  return deadStarIds.size === 0 && dyingStars.size === 0;
}

/** True when the star is neither dead nor dying. */
function starAlive(cid) {
  return !deadStarIds.has(cid) && !dyingStars.has(cid);
}

/** Start a star's death, colored by what caused it. */
function killStar(cid, kind) {
  if (deadStarIds.has(cid) || dyingStars.has(cid)) {
    return;
  }
  dyingStars.set(cid, {t0: clockNow, kind: kind});
}

/** Bring a dead or dying star back. */
function reviveStar(cid) {
  deadStarIds.delete(cid);
  dyingStars.delete(cid);
}

/**
 * A gap that varies around a mean, from 0.4 to 1.6 times it, so a run of
 * steps arrives unevenly but keeps the same overall pace.
 */
function variableInterval(mean) {
  return mean * (0.4 + 1.2 * Math.random());
}

/** Run `fn` every `interval` seconds until it returns true. */
function startChain(fn, interval, varies) {
  clockNow = performance.now() / 1000;
  chainFn = fn;
  chainInterval = interval;
  chainVaries = Boolean(varies);
  nextChainAt = clockNow;
}

/** Set off every star, in random order, colored by the cause. */
function startExplosion(source) {
  explosionActive = true;
  revivalActive = false;
  explosionKind = source === 'shake' ? 'shake' :
      source === 'live' ? 'live' : 'travel';
  if (source === 'shake' || source === 'live') {
    shakeFrozen = true;
    shakeShrinkT0 = clockNow;
  } else {
    shakeFrozen = false;
  }
  explosionTouched = new Set();
  const ids = visibleIds();
  explosionWorkTotal = Math.max(1, ids.filter((cid) => starAlive(cid)).length);
  const kind = source === 'shake' ? 'shake' :
      source === 'live' ? 'live' : 'explode';
  const step = () => {
    const pool = [];
    for (const cid of visibleIds()) {
      if (!explosionTouched.has(cid) && starAlive(cid)) {
        pool.push(cid);
      }
    }
    if (!pool.length) {
      return true;
    }
    const batch = Math.ceil(
        explosionWorkTotal * EXPLODE_TICK_S / EXPLODE_TOTAL_S);
    for (let n = 0; n < batch && pool.length; n++) {
      const at = Math.floor(Math.random() * pool.length);
      const pick = pool.splice(at, 1)[0];
      explosionTouched.add(pick);
      killStar(pick, kind);
    }
    return false;
  };
  startChain(step, EXPLODE_TICK_S);
}

/** Bring every dead star back in random order over `durationS`. */
function startRevival(durationS) {
  const pool = [...deadStarIds].concat([...dyingStars.keys()]);
  if (!pool.length) {
    return;
  }
  const interval = durationS ?
      Math.max(0.03, durationS / pool.length) : CHAIN_TICK_S;
  revivalActive = true;
  explosionActive = false;
  revivalWorkTotal = Math.max(1, pool.length);
  revivalWorkLeft = pool.length;
  revivalUntil = performance.now() / 1000 + (durationS || 0);
  const remaining = pool.slice();
  const step = () => {
    if (!remaining.length) {
      revivalWorkLeft = 0;
      return true;
    }
    const i = Math.floor(Math.random() * remaining.length);
    const pick = remaining.splice(i, 1)[0];
    reviveStar(pick);
    revivalWorkLeft = remaining.length;
    return false;
  };
  startChain(step, interval, true);
}

/** Start a new sky dark, then let its stars pop in. */
function startIntroRevival() {
  deadStarIds.clear();
  dyingStars.clear();
  for (const cid of visibleIds()) {
    deadStarIds.add(cid);
  }
  startRevival(INTRO_DURATION_S);
  syncTravelButtons();
}

/**
 * Show every star in the current mesh at once, with no revival.
 *
 * A manual star count is not a new sky, so it skips the reveal that
 * startIntroRevival choreographs: the mesh just changes.
 */
function showAllStars() {
  chainFn = null;
  revivalActive = false;
  deadStarIds.clear();
  dyingStars.clear();
  syncTravelButtons();
}

/**
 * Show every star at once when the viewer turns the Stars layer on.
 *
 * Only a new sky (travel, shake, live) plays the pop-in reveal; a switch the
 * viewer flips does not wait for it. A sky change already in flight is left
 * alone.
 */
function revealNow() {
  if (locationChange || swapping || explosionActive) {
    return;
  }
  showAllStars();
}

/** Explode the sky, then move it to `target`; false when it is busy. */
function startLocationShuffle(target, quakeMag, kind) {
  const src = kind || (quakeMag == null ? 'travel' : 'shake');
  if (src === 'live' && (locationChange || swapping) &&
      explosionKind === 'live') {
    return false;
  }
  if (src === 'live' && locationChange && explosionKind === 'travel') {
    locationChange = false;
    pendingLocation = null;
    chainFn = null;
    explosionActive = false;
  } else if (locationChange || swapping) {
    return false;
  }
  locationChange = true;
  pendingLocation = target;
  shuffleDarkS = quakeMag == null ? MANUAL_SHUFFLE_DARK_S : Number(quakeMag);
  shuffleDeadAt = null;
  blackoutReadyAt = null;
  exitChainStarted = false;
  animalEnterAt = null;
  animalExitAt = null;
  animalNextAt = 0;
  animalExitTick = 0;
  animalsVisibleAtExit = objectsOn && (layers.left || layers.right);
  if (src === 'live' || src === 'shake') {
    quakeHud = {
      mag: quakeMag,
      lat: target && target.lat,
      lon: target && target.lon,
    };
  } else {
    quakeHud = null;
  }
  updatePlace(target);
  startExplosion(src);
  syncTravelButtons();
  return true;
}

/** Set where the sky is seen from, and update the HUD. */
function updatePlace(loc) {
  if (!loc) {
    return;
  }
  obsLat = Number(loc.lat);
  obsLon = Number(loc.lon);
  placeName = loc.capital || loc.region || 'Sky';
  placeCountry = loc.country || '';
  paintHudText();
}

/** Index of the star under a point, or -1; `scale` shrinks the hit area. */
function findStarAt(mx, my, scale) {
  const sc = scale == null ? 1 : scale;
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < meshSeeds.length; i++) {
    const s = meshSeeds[i];
    const hitR = Math.max(2.5 * gridK, s.size + gridK) * sc;
    const dx = s.x0 - mx;
    const dy = s.y0 - my;
    const d2 = dx * dx + dy * dy;
    if (d2 <= hitR * hitR && d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/** Kill the star under an animal, if any; true when one died. */
function tryObjectKill(px, py, kind) {
  if (!objectsOn) {
    return false;
  }
  const hit = findStarAt(px, py, OBJECT_HIT_R_SCALE);
  if (hit < 0) {
    return false;
  }
  const cid = meshSeeds[hit].cid;
  if (!starAlive(cid)) {
    return false;
  }
  killStar(cid, kind);
  hatBursts.push({t0: clockNow, kind: kind});
  return true;
}

/** How much of an animal is left while it leaves: 1 staying, 0 gone. */
function animalFade(id, map) {
  const t0 = map.get(id);
  if (t0 == null) {
    return 1;
  }
  const u = (clockNow - t0) / ANIMAL_LEAVE_SEC;
  if (u >= 1) {
    return 0;
  }
  return 1 - u;
}

/**
 * The identities of the member's species this sky shows, in entry order.
 * @param {Object} member
 * @return {number[]} the chosen ids
 */
function wantedIds(member) {
  return member.order.slice(0, member.count);
}

/** Ids of the member's animals still waiting to enter. */
function pendingEnterIds(side, member) {
  if (!objectsOn || !layers[side.layer] || !member.pack) {
    return [];
  }
  return wantedIds(member).filter((id) => !member.shown.has(id));
}

/** Ids of the member's animals on screen and not leaving. */
function remainingShownIds(member) {
  const out = [];
  for (const id of member.shown) {
    if (!member.fadeStart.has(id)) {
      out.push(id);
    }
  }
  return out;
}

/**
 * Every member of both sides.
 * @param {Object[]} [list] the sides to walk, defaulting to the ones on screen
 * @return {Object[]}
 */
function eachMember(list = sides) {
  const out = [];
  for (const side of list) {
    out.push(...side.members);
  }
  return out;
}

/** Remove every animal at once, on both sides. */
function clearAnimals() {
  for (const member of eachMember()) {
    member.shown.clear();
    member.fadeStart.clear();
  }
  animalEnterAt = null;
  animalExitAt = null;
  animalNextAt = 0;
  animalExitTick = 0;
}

/** Start letting the animals in, one from each swarm at a time. */
function startAnimalEnter() {
  if (!objectsOn || locationChange || swapping) {
    return;
  }
  if (animalEnterAt != null || animalExitAt != null) {
    return;
  }
  animalEnterAt = clockNow;
  animalNextAt = clockNow;
  for (const member of eachMember()) {
    member.fadeStart.clear();
  }
}

/** Let in the animals whose turn has come. */
function tickAnimalEnter() {
  if (animalEnterAt == null) {
    return;
  }
  while (clockNow >= animalNextAt) {
    let any = false;
    for (const side of sides) {
      for (const member of side.members) {
        const waiting = pendingEnterIds(side, member);
        if (waiting.length) {
          member.shown.add(waiting[0]);
          any = true;
        }
      }
    }
    if (!any) {
      animalEnterAt = null;
      break;
    }
    animalNextAt += variableInterval(ANIMAL_ENTER_TICK_S);
  }
}

/** Start sending the animals out, in batches. */
function startAnimalExit() {
  if (exitChainStarted) {
    return;
  }
  exitChainStarted = true;
  animalEnterAt = null;
  animalExitAt = clockNow;
  animalExitTick = 0;
}

/** Send out the animals whose turn has come. */
function tickAnimalExit() {
  if (animalExitAt == null) {
    return;
  }
  while (clockNow >= animalExitAt + animalExitTick * ANIMAL_EXIT_TICK_S) {
    let any = false;
    for (const member of eachMember()) {
      const staying = remainingShownIds(member);
      if (staying.length) {
        any = true;
      }
      for (let n = 0; n < ANIMAL_EXIT_BATCH; n++) {
        if (staying[n] != null) {
          member.fadeStart.set(staying[n], clockNow);
        }
      }
    }
    if (!any) {
      animalExitAt = null;
      break;
    }
    animalExitTick += 1;
  }
}

/** True when every animal has left. */
function animalsFadedOut() {
  if (!animalsVisibleAtExit) {
    return true;
  }
  const members = eachMember();
  let shown = 0;
  for (const member of members) {
    shown += member.shown.size;
  }
  if (!shown) {
    return true;
  }
  for (const member of members) {
    for (const id of member.shown) {
      if (animalFade(id, member.fadeStart) > 0) {
        return false;
      }
    }
    if (remainingShownIds(member).length) {
      return false;
    }
  }
  return true;
}

/** Share of the stars still alive, from 0 to 1. */
function glowScaleAlive() {
  const ids = visibleIds();
  const n = Math.max(1, ids.length);
  let shown = 0;
  for (const cid of ids) {
    if (starAlive(cid)) {
      shown += 1;
    }
  }
  return shown / n;
}

/** How far the current explosion has spread, from 0 to 1. */
function glowScaleExplosion() {
  const n = Math.max(1, explosionWorkTotal);
  if (chainFn != null) {
    return Math.min(1, explosionTouched.size / n);
  }
  let left = 0;
  for (const cid of explosionTouched) {
    if (dyingStars.has(cid)) {
      left += 1;
    }
  }
  return Math.min(1, left / n);
}

/** Shade steps in an explosion halo, counting the empty one. */
const GLOW_LEVELS = 5;
/** Ramp shade of each glow level; level 0 is empty. */
const GLOW_SHADE = [0, 1, 2, 3, 3];
/** Distance between two rings of the halo, in art pixels at grid 1. */
const GLOW_RING_PERIOD = 16;
/** Halo rings step outward this many times a second. */
const GLOW_RING_HZ = 10;

let glowCanvas = null;
let glowCtx = null;
let glowImg = null;
let glowPx = null;
const rampWords = new Map();

/** A ramp as little-endian RGBA words, cached. */
function rampWordsOf(name) {
  let words = rampWords.get(name);
  if (!words) {
    words = RAMPS[name].map((hex) => {
      const n = parseInt(hex.slice(1), 16);
      return (0xff000000 | ((n & 255) << 16) | (n & 0xff00) |
          (n >> 16)) >>> 0;
    });
    rampWords.set(name, words);
  }
  return words;
}

/**
 * The halo of an explosion: concentric rings of the cause ramp that travel
 * outward from the rim, fading in dithered shade bands. Every pixel is a ramp
 * color, so the quantizer leaves it as is.
 */
function drawExplosionGlow(time, rampName) {
  const g = EXPLOSION_GLOW;
  const w = Math.round(view.w);
  const h = Math.round(view.h);
  if (!glowCanvas || glowCanvas.width !== w || glowCanvas.height !== h) {
    glowCanvas = document.createElement('canvas');
    glowCanvas.width = w;
    glowCanvas.height = h;
    glowCtx = glowCanvas.getContext('2d');
    glowImg = glowCtx.createImageData(w, h);
    glowPx = new Uint32Array(glowImg.data.buffer);
  }
  const words = rampWordsOf(rampName);
  const pulse = 0.6 + 0.4 * Math.sin(time * g.pulseSpeed);
  const amp = (0.55 + 0.45 * glowScaleExplosion()) * (0.85 + 0.15 * pulse);
  const inner = view.radius;
  const reach = g.outerReachPx * view.radius / REF_RADIUS *
      (0.7 + 0.3 * pulse) * 1.3;
  const outer = inner + reach;
  const period = GLOW_RING_PERIOD * Math.max(1, gridK);
  const phase = Math.floor(time * GLOW_RING_HZ) / GLOW_RING_HZ * 0.9;
  const x0 = Math.max(0, Math.floor(view.cx - outer));
  const x1 = Math.min(w - 1, Math.ceil(view.cx + outer));
  const y0 = Math.max(0, Math.floor(view.cy - outer));
  const y1 = Math.min(h - 1, Math.ceil(view.cy + outer));
  glowPx.fill(0);
  const inSq = inner * inner;
  const outSq = outer * outer;
  const top = GLOW_LEVELS - 1;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - view.cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - view.cx;
      const dSq = dx * dx + dy * dy;
      if (dSq < inSq || dSq > outSq) {
        continue;
      }
      const d = Math.sqrt(dSq) - inner;
      const fall = Math.pow(1 - d / reach, 1.1);
      const ring = 0.5 + 0.5 * Math.cos(6.2832 * (d / period - phase));
      const lv = Math.min(top, amp * fall * (0.55 + 0.45 * ring) * top * 1.4);
      const base = Math.floor(lv);
      const idx = base + (lv - base > bayer01(x, y) ? 1 : 0);
      if (idx > 0) {
        glowPx[y * w + x] = words[GLOW_SHADE[Math.min(top, idx)]];
      }
    }
  }
  glowCtx.putImageData(glowImg, 0, 0);
  ctx.drawImage(glowCanvas, 0, 0);
}

/** Draw the rim glow: the explosion halo, or the planet's halo. */
function drawGlow(time) {
  ctx.save();
  if (explosionActive) {
    drawExplosionGlow(time, KIND_RAMP[explosionKind === 'travel' ?
        'explode' : explosionKind]);
  } else {
    haloLayer.draw(
        ctx, view, planetKey, time, glowScaleAlive() / HALO_FULL_ALIVE);
  }
  ctx.restore();
}

/** The Mexican-hat curve: a bump with a dip around it. */
function mexicanHat(u) {
  const u2 = u * u;
  return (1 - u2) * Math.exp(-0.5 * u2);
}

/** Draw the soft rings that a kill sends across the sky. */
function drawHatBursts() {
  const now = clockNow;
  ctx.save();
  clipDome();
  const keep = [];
  for (const burst of hatBursts) {
    const u = (now - burst.t0) / HAT_DURATION_S;
    if (u >= 1) {
      continue;
    }
    keep.push(burst);
    const span = (burst.kind === 'fly' || burst.kind === 'fish') ?
        OBJECT_HAT_REACH : 1;
    const reach = view.radius * (0.12 + 0.88 * u) * span;
    const peak = HAT_PEAK * (1 - u);
    const grad = ctx.createRadialGradient(
        view.cx, view.cy, 0, view.cx, view.cy, reach);
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const hat = Math.max(0, mexicanHat(t / HAT_SIGMA));
      const a = peak * hat;
      let r;
      let g;
      let b;
      if (burst.kind === 'fish') {
        r = t < 0.5 ? 61 : 160;
        g = t < 0.5 ? 139 : 200;
        b = t < 0.5 ? 253 : 255;
      } else if (burst.kind === 'fly') {
        r = t < 0.5 ? 244 : 255;
        g = t < 0.5 ? 123 : 200;
        b = t < 0.5 ? 32 : 80;
      } else {
        r = t < 0.5 ? 245 : 180;
        g = t < 0.5 ? 245 : 180;
        b = t < 0.5 ? 250 : 185;
      }
      grad.addColorStop(t, 'rgba(' + r + ',' + g + ',' + b + ',' +
          a.toFixed(3) + ')');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, reach, 0, Math.PI * 2);
    ctx.fill();
  }
  hatBursts.length = 0;
  for (const burst of keep) {
    hatBursts.push(burst);
  }
  ctx.restore();
}

/** Advance the game by one frame: chains, deaths, animals, and shuffles. */
function tickSky() {
  while (chainFn != null && clockNow >= nextChainAt) {
    const done = chainFn();
    if (done) {
      chainFn = null;
    } else {
      nextChainAt += chainVaries ?
          variableInterval(chainInterval) : chainInterval;
    }
  }
  if (revivalActive && chainFn != null &&
      performance.now() / 1000 >= revivalUntil) {
    let guard = 8000;
    while (chainFn != null && guard > 0) {
      guard -= 1;
      if (chainFn()) {
        chainFn = null;
      }
    }
  }
  for (const [cid, rec] of [...dyingStars.entries()]) {
    if (dyingBrightness(clockNow - rec.t0) == null) {
      dyingStars.delete(cid);
      deadStarIds.add(cid);
    }
  }
  if (explosionActive && chainFn == null) {
    let dyingExplode = false;
    for (const cid of explosionTouched) {
      if (dyingStars.has(cid)) {
        dyingExplode = true;
        break;
      }
    }
    if (!dyingExplode) {
      explosionActive = false;
    }
  }
  if (revivalActive && chainFn == null) {
    revivalActive = false;
  }
  tickAnimalEnter();
  tickAnimalExit();
  if (locationChange && isFullyDead()) {
    if (shuffleDeadAt == null) {
      shuffleDeadAt = clockNow;
      startAnimalExit();
    }
    if (animalsFadedOut()) {
      if (blackoutReadyAt == null) {
        blackoutReadyAt = clockNow + shuffleDarkS;
      }
      if (clockNow >= blackoutReadyAt && !swapping) {
        const target = pendingLocation;
        locationChange = false;
        pendingLocation = null;
        blackoutReadyAt = null;
        shuffleDeadAt = null;
        swapLocation(target);
      }
    }
  }
  if (isFullyDead()) {
    objectsGate = false;
  } else if (objectsOn && !locationChange &&
      (layers.left || layers.right) && isFullyAlive()) {
    objectsGate = true;
    startAnimalEnter();
  }
  syncTravelButtons();
}

/**
 * Pick the planet that colors a new sky: by weight, seeded from the system
 * time, and never the planet shown before.
 * @param {string|null} previous key of the planet on screen now, if any
 */
function choosePlanet(previous) {
  planetKey = pickPlanet(previous, Date.now());
}

/** Load and show the sky of a new place. */
async function swapLocation(target) {
  if (!target || swapping) {
    return;
  }
  swapping = true;
  try {
    await loadSky();
    rebuildMesh();
    choosePlanet(planetKey);
    syncCountInputs();
    for (const member of eachMember()) {
      member.remaining = member.count;
    }
    shakeFrozen = false;
    exitChainStarted = false;
    clearAnimals();
    startIntroRevival();
  } catch (err) {
    // The sky on screen is still the last good one, because loadSky only
    // swaps in a sky once every fetch has landed. Leave it running and let
    // the viewer press Travel again.
    console.error('Could not load the next sky.', err);
  } finally {
    swapping = false;
    syncTravelButtons();
  }
}

/** Keep the capitals and quakes the server sent. */
function cacheLists(data) {
  if (Array.isArray(data.capitals) && data.capitals.length) {
    capitals = data.capitals;
  }
  if (Array.isArray(data.quakes) && data.quakes.length) {
    quakes = data.quakes;
  }
}

/** True when a place is Lisbon, where the first sky is seen from. */
function isLisbon(loc) {
  return Math.abs(Number(loc.lat) - LISBON_LAT) < 0.05 &&
      Math.abs(Number(loc.lon) - LISBON_LON) < 0.05;
}

/** Shuffle the capitals into a new travel queue. */
function refillTravel() {
  const pool = capitals.filter((c) => !isLisbon(c));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  travelQueue = pool;
}

/** The next capital to travel to, never the one on screen. */
function pickTravel() {
  if (!travelQueue.length) {
    refillTravel();
  }
  if (!travelQueue.length) {
    return {capital: 'Lisbon', country: 'Portugal', lat: LISBON_LAT,
      lon: LISBON_LON};
  }
  let pick = travelQueue.pop();
  if (travelQueue.length &&
      (Math.abs(pick.lat - obsLat) < 0.05 &&
       Math.abs(pick.lon - obsLon) < 0.05)) {
    const i = Math.floor(Math.random() * travelQueue.length);
    const alt = travelQueue[i];
    travelQueue[i] = pick;
    pick = alt;
  }
  travelCount += 1;
  return pick;
}

/** The next recorded quake at or above the threshold, in a loop. */
function nextShakeEvent() {
  const ok = quakes.filter((q) => Number(q.mag) >= magMin);
  if (!ok.length) {
    return null;
  }
  if (shakeIndex >= ok.length) {
    shakeIndex = 0;
  }
  const ev = ok[shakeIndex];
  shakeIndex += 1;
  return ev;
}

/** A quake as a place to travel to. The magnitude is the HUD's own line. */
function quakeTarget(ev) {
  return {
    lat: ev.lat,
    lon: ev.lon,
    capital: ev.region || 'Epicenter',
    country: '',
  };
}

/** True while a sky change is in progress. */
function busySky() {
  return explosionActive || revivalActive || locationChange || swapping;
}

/** Disable Travel and Shake while the sky is busy. */
function syncTravelButtons() {
  const travel = document.getElementById('travel-btn');
  const shake = document.getElementById('shake-btn');
  const off = busySky();
  if (travel) {
    travel.disabled = off;
  }
  if (shake) {
    shake.disabled = off;
  }
}

/**
 * Fade a spoke's hover strength up or down; returns it, 0 to 1.
 * @param {string} key the spoke
 * @param {Object|string|null} who 'cursor', or the member that lit it
 * @param {number} dt seconds since the last frame
 * @return {number}
 */
function updateSpokeHover(key, who, dt) {
  let v = spokeHover.get(key) || 0;
  if (who) {
    v = 1;
    spokeKind.set(key, who);
  } else {
    const release =
        spokeKind.get(key) === 'cursor' ? HOVER_RELEASE : ANIMAL_RELEASE;
    v -= dt / release;
  }
  v = Math.max(0, Math.min(1, v));
  if (v <= 0) {
    spokeHover.delete(key);
    spokeKind.delete(key);
  } else {
    spokeHover.set(key, v);
  }
  return v;
}

/** True when an animal's pixel is inside the arena, where it can be seen. */
function onScreen(p) {
  return Math.hypot(p.px - view.cx, p.py - view.cy) <= view.radius;
}

/** The points that light spokes; an animal on a star kills it. */
function hoverPoints() {
  const pts = [];
  if (cursorOn && mouseX != null) {
    pts.push([mouseX, mouseY, 'cursor']);
  }
  // Only animals that are staying interact. One that has started to leave
  // blinks and is on its way out, so it neither lights spokes nor kills.
  if (objectsOn && interactOn) {
    for (const side of sides) {
      if (!layers[side.layer]) {
        continue;
      }
      for (const member of side.members) {
        if (!member.pack) {
          continue;
        }
        for (const id of member.shown) {
          if (member.fadeStart.has(id)) {
            continue;
          }
          const pos = poseAt(member.pack, id, member.clock, member.hz);
          const p = toPixel(pos[0], pos[1]);
          if (!onScreen(p)) {
            continue;
          }
          pts.push([p.px, p.py, member]);
          if (tryObjectKill(p.px, p.py, member.team.kind)) {
            kamikaze(member, id);
          }
        }
      }
    }
  }
  return pts;
}

/**
 * Who lit the first point on a spoke — 'cursor', or the member that lit it —
 * or null when nothing is on it.
 *
 * The test runs against the spoke's own stretch, not the whole line through
 * it. Every spoke of a star starts at the same point, so a point at the
 * star's centre falls inside the hover radius of all of them at once and one
 * animal would light the star's whole fan. The inner hover radius, and the
 * tip past the flowing dot, are therefore not part of the spoke.
 */
function segmentHovered(ax, ay, bx, by, pts) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len <= hoverR) {
    return null;
  }
  const t0 = hoverR / len;
  const len2 = len * len;
  const span = hoverR * len;
  for (const p of pts) {
    const ex = p[0] - ax;
    const ey = p[1] - ay;
    const t = (ex * dx + ey * dy) / len2;
    if (t < t0 || t > 1) {
      continue;
    }
    if (Math.abs(ex * dy - ey * dx) <= span) {
      return p[2];
    }
  }
  return null;
}

/** Sample the aurora noise at each star for this frame. */
function updatePositions(time) {
  for (const p of meshSeeds) {
    const auroraLocal = time - p.t * (RADIAL_FLOW_DELAY * 0.6);
    p.aurora = noiseC.noise2D(
        p.x0 * AURORA_SCALE + auroraLocal * AURORA_SPEED,
        p.y0 * AURORA_SCALE - auroraLocal * AURORA_SPEED * 0.7);
  }
}

/** The mean aurora value of the stars that own an edge. */
function avgAurora(e) {
  const owners = ownersAt(e.dotOwners, 0);
  if (!owners.length) {
    return 0;
  }
  let sum = 0;
  let n = 0;
  for (const oi of owners) {
    const s = meshSeeds[oi];
    if (s) {
      sum += s.aurora;
      n++;
    }
  }
  return n ? sum / n : 0;
}

/** Clip drawing to the dome. */
function clipDome() {
  ctx.clip(domePath);
}

/** Palette ramp for an aurora value: a hue family, or grey without Color. */
function auroraRamp(aurora) {
  if (!(layers.color && layers.sparkle)) {
    return GREY_RAMP;
  }
  const families = PLANETS[planetKey].families;
  const n = families.length;
  const u = clamp01((aurora * AURORA_STRETCH + 1) / 2);
  return rampOf(families[Math.min(n - 1, Math.floor(u * n))]);
}

/**
 * The hue family a neighbor of `aurora` blends with near a family boundary.
 * Away from a boundary the star is one family; within FADE_HALF of it the
 * two families share the pixels by ordered dither in FADE_STEPS steps, so
 * the change is an 8-bit crossfade instead of a jump.
 *
 * @return {{ramp: string[], ramp2: string[]|null, mix: number}}
 */
function auroraFade(aurora) {
  if (!(layers.color && layers.sparkle)) {
    return {ramp: GREY_RAMP, ramp2: null, mix: 0};
  }
  const families = PLANETS[planetKey].families;
  const n = families.length;
  const f = clamp01((aurora * AURORA_STRETCH + 1) / 2) * n;
  const k = Math.round(f);
  if (k < 1 || k > n - 1 || Math.abs(f - k) >= FADE_HALF) {
    const i = Math.min(n - 1, Math.floor(f));
    return {ramp: rampOf(families[i]), ramp2: null, mix: 0};
  }
  const share = (f - k) / (2 * FADE_HALF) + 0.5;
  const mix = Math.round(share * FADE_STEPS) / FADE_STEPS;
  return {
    ramp: rampOf(families[k - 1]),
    ramp2: rampOf(families[k]),
    mix,
  };
}

/** Draw the cell edges and the rim. */
function drawVoronoi() {
  for (const e of meshEdges) {
    if (e.len < 1e-3) {
      continue;
    }
    const color = auroraRamp(avgAurora(e))[2];
    pixels.line(e.p1[0], e.p1[1], e.p2[0], e.p2[1], gridK, () => color);
  }
  for (const arc of meshRimArcs) {
    if (arc.len < 1e-3) {
      continue;
    }
    pixels.arc(view.cx, view.cy, view.radius, arc.a1, arc.a2,
        GREY_RAMP[2], gridK);
  }
  pixels.flush(ctx);
}

/**
 * How many times a flowing dot lattice has wrapped by now.
 *
 * Dots slide along an edge and the lattice snaps back one spacing each time
 * the flow wraps, which renumbers every dot by one. A dot's steady identity
 * is its index minus this count, so "every Nth dot" keeps the same dots
 * instead of jumping a spacing at each wrap.
 */
function dotWraps(time, t, speedMul) {
  const localTime = time - t * RADIAL_FLOW_DELAY;
  return Math.floor(localTime * dotFlow * speedMul / dotSpacing);
}

/** How far the flowing dots have slid along their edge. */
function flowOffset(time, t, speedMul) {
  const localTime = time - t * RADIAL_FLOW_DELAY;
  let flow = (localTime * dotFlow * speedMul) % dotSpacing;
  if (flow < 0) {
    flow += dotSpacing;
  }
  return flow;
}

/** Position of flowing dot i on an edge, or null past its end. */
function edgeDotAt(e, i, time) {
  const dx = (e.p2[0] - e.p1[0]) / e.len;
  const dy = (e.p2[1] - e.p1[1]) / e.len;
  const px = -dy;
  const py = dx;
  const flow = flowOffset(time, e.t, e.speedMul);
  const s = i * dotSpacing + flow;
  if (s > e.len) {
    return null;
  }
  const u = s / e.len;
  const taper = ANCHOR_TAPER_FLOOR +
      (1 - ANCHOR_TAPER_FLOOR) * Math.sin(Math.PI * u);
  const edgeSeed = e.p1[0] * 0.317 + e.p1[1] * 0.173;
  const ph = s * WIGGLE_SCALE + edgeSeed * 11 + time * WIGGLE_SPEED;
  const n = Math.sin(ph * 6.3) * 0.6 +
      Math.sin(ph * 2.1 + edgeSeed * 5) * 0.4;
  const wig = n * wiggleAmt * taper;
  return {
    bx: e.p1[0] + dx * s + px * wig,
    by: e.p1[1] + dy * s + py * wig,
    u,
  };
}

/** Draw the flowing dots. */
function drawWiggle(time) {
  for (const e of meshEdges) {
    if (e.len < 1e-3) {
      continue;
    }
    const color = auroraRamp(avgAurora(e))[2];
    const count = Math.max(1, Math.round(e.len / dotSpacing));
    for (let i = 0; i <= count; i++) {
      const dot = edgeDotAt(e, i, time);
      if (dot) {
        pixels.dot(Math.round(dot.bx), Math.round(dot.by), color,
            gridK * 0.55);
      }
    }
  }
  for (const dot of rimDots) {
    pixels.dot(Math.round(dot.bx), Math.round(dot.by), GREY_RAMP[2],
        gridK * 0.55);
  }
  pixels.flush(ctx);
}

/**
 * Spokes a member lights, in its own look. Bio runs warm for the fly and cold
 * for the fish. Cyber takes each animal's own ramp: the fly's tracks the trail
 * in `cyber-trails.js`, the fish's its scan bars. Each ramp runs dark to
 * bright, the order `spokeColors` indexes it in.
 */
const HOVER_TINT = {
  bio: {
    fly: {
      ramp: ['#A04010', '#F08018', '#F8B860', '#F8F090', '#F8F8C8'],
      glow: ['#A04010', '#A04010', '#A04010', '#A04010'].map(
          (hex) => PALETTE_INDEX.get(hex)),
    },
    fish: {
      ramp: ['#103878', '#18A0A0', '#28A0F0', '#98E8F8', '#D0F0F8'],
      glow: ['#103878', '#103878', '#103878', '#103878'].map(
          (hex) => PALETTE_INDEX.get(hex)),
    },
  },
  cyber: {
    fly: {
      ramp: ['#201048', '#402088', '#A04010', '#F08018', '#F8F8C8'],
      glow: ['#402088', '#402088', '#402088', '#402088'].map(
          (hex) => PALETTE_INDEX.get(hex)),
    },
    fish: {
      ramp: ['#8050D8', '#C838A8', '#18A0A0', '#58E8D0', '#B0F0E8'],
      glow: ['#201048', '#201048', '#201048', '#201048'].map(
          (hex) => PALETTE_INDEX.get(hex)),
    },
  },
};
/** The two diagonal steps one pixel out from a lit spoke. */
const GLOW_OFFSETS = [[1, 1], [-1, -1]];
/** How bright the glow beside a lit spoke gets, in coverage levels. */
const GLOW_CAP = 4;
/** Share of a lit spoke's pixels that take the animal's tone. */
const TINT_MIX = 0.3;

/**
 * Palette indexes for a ray's four depth shades.
 *
 * Without Sparkle every shade is the ramp's mid. A lift moves each shade up
 * the ramp; past the pale shade it turns white.
 */
function spokeColors(ramp, lift, top = WHITE) {
  return PLANETS[planetKey].levels.map((base) => {
    const level = (layers.sparkle ? base : 2) + lift;
    return level > 4 ? PALETTE_INDEX.get(top) :
      PALETTE_INDEX.get(ramp[Math.max(0, level)]);
  });
}

/**
 * How a star's spokes look this frame.
 * @param {object} seed a meshSeeds entry
 * @return {{dying: boolean, lift: number, ramp: string[]}|null} null when
 *     the star's spokes are gone
 */
function spokeStyle(seed) {
  if (deadStarIds.has(seed.cid) && !dyingStars.has(seed.cid)) {
    return null;
  }
  const dying = dyingStars.get(seed.cid);
  if (!dying) {
    return {dying: false, lift: 0, ...auroraFade(seed.aurora)};
  }
  const b = dyingBrightness(clockNow - dying.t0);
  if (b == null) {
    return null;
  }
  return {
    dying: true,
    lift: 0,
    t: clockNow - dying.t0,
    ramp: RAMPS[KIND_RAMP[dying.kind]] || GREY_RAMP,
  };
}

/** Draw one spoke from a star to a point, with hover lift and depth shade. */
function paintSpoke(seed, style, ex, ey, key, hoverPts) {
  if (style.dying) {
    paintDyingSpoke(seed, style, ex, ey);
    return;
  }
  const hb = updateSpokeHover(
      key, segmentHovered(seed.x0, seed.y0, ex, ey, hoverPts), lastDt);
  const boost = hb > HOVER_LIFT_2 ? 2 : hb > HOVER_LIFT_1 ? 1 : 0;
  // A spoke an animal lights takes that animal's temperature and a faint glow.
  const who = spokeKind.get(key);
  const tint = boost && who !== 'cursor' ?
      HOVER_TINT[who.team.look][who.team.kind] : null;
  const lift = style.lift + (tint ? 1 : boost);
  const cols = spokeColors(style.ramp, lift);
  let cols2 = style.ramp2 ? spokeColors(style.ramp2, lift) : null;
  let mix = style.mix;
  if (tint) {
    // Keep the spoke's own hue; only a fraction of its pixels take the tone.
    cols2 = spokeColors(tint.ramp, lift, tint.ramp[4]);
    mix = TINT_MIX;
  }
  pixels.steppedLine(
      seed.x0, seed.y0, ex, ey, gridK, SPOKE_BUCKET_ENDS, cols, cols2, mix);
  if (tint) {
    for (const [dx, dy] of GLOW_OFFSETS) {
      pixels.steppedLine(
          seed.x0 + dx, seed.y0 + dy, ex + dx, ey + dy, gridK,
          SPOKE_BUCKET_ENDS, tint.glow, null, 0, GLOW_CAP);
    }
  }
}

/**
 * Land a spoke on every SPOKE_EVERY-th flowing dot.
 *
 * Each dot on a cell edge belongs to the two stars either side of it, and
 * each of them draws a spoke to it. The rim ring works the same way for the
 * star that owns that stretch of rim. Dots are picked by steady identity, so
 * the spokes ride the flow instead of jumping when it wraps.
 */
function drawDotSpokes(time, styles, hoverPts) {
  for (let ei = 0; ei < meshEdges.length; ei++) {
    const e = meshEdges[ei];
    if (e.len < 1e-3) {
      continue;
    }
    const wraps = dotWraps(time, e.t, e.speedMul);
    const count = Math.max(1, Math.round(e.len / dotSpacing));
    for (let i = 0; i <= count; i++) {
      const id = i - wraps;
      if (wrap(id, SPOKE_EVERY) !== 0) {
        continue;
      }
      const dot = edgeDotAt(e, i, time);
      if (!dot) {
        continue;
      }
      const ex = dot.bx;
      const ey = dot.by;
      for (const oi of e.sites) {
        if (styles[oi]) {
          paintSpoke(meshSeeds[oi], styles[oi], ex, ey,
              oi + '_e' + ei + '_' + wrap(id, 64), hoverPts);
        }
      }
    }
  }
  for (const dot of rimDots) {
    if (wrap(dot.id, SPOKE_EVERY) === 0 && styles[dot.oi]) {
      paintSpoke(meshSeeds[dot.oi], styles[dot.oi],
          dot.bx, dot.by, dot.oi + '_r' + wrap(dot.id, 64), hoverPts);
    }
  }
}

/** Draw every star's spokes for this frame. */
function drawSpokes(time) {
  drawDotSpokes(time, meshSeeds.map(spokeStyle), hoverPoints());
  pixels.flush(ctx);
}

/** 4x4 ordered-dither thresholds, 0 to 15. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Ordered-dither threshold for a pixel, from 0 to 1. */
function bayer01(x, y) {
  return (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
}

/** Cheap steady pseudo-random number from an integer, from 0 to 1. */
function hash01(n) {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Shards a shattering star throws. */
const SHARD_COUNT = 18;
/** The mean reach the shard speeds were tuned for, in art pixels. */
const SHATTER_REF_REACH = 35;

/**
 * Pick a shade of the cause ramp: the asked shade or one either side of it,
 * by index, so neighbours glitter but never leave the tone.
 */
function toneShade(ramp, shade, i) {
  const off = ((Math.floor(i) % 3) + 3) % 3 - 1;
  return ramp[Math.max(0, Math.min(4, shade + off))];
}

/**
 * A dying star's spoke: a dashed run of the cause tone that turns to dither
 * from the tip inward. The dashes crawl outward, so a spark seems to travel
 * along the ray.
 */
function paintDyingSpoke(seed, style, ex, ey) {
  const t = style.t;
  const dx = ex - seed.x0;
  const dy = ey - seed.y0;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  const prog = clamp01((t - 0.25) / 0.6);
  const dash = Math.max(2, Math.round(3 * gridK));
  const shift = Math.floor(t * 25);
  const base = t < 0.5 ? 3 : 2;
  for (let s = Math.round(4 * gridK); s <= n; s++) {
    const u = s / n;
    const x = Math.round(seed.x0 + dx * u);
    const y = Math.round(seed.y0 + dy * u);
    if (bayer01(x, y) < clamp01(prog * 1.3 - (1 - u) * 0.3)) {
      continue;
    }
    ctx.fillStyle = toneShade(style.ramp, base, Math.floor(s / dash) - shift);
    ctx.fillRect(x, y, 1, 1);
  }
}

/**
 * Confetti shatter: a white flash and shards that fly out
 * along the spokes with short trails. Everything stays in the cause's ramp.
 */
function drawStarShatter(seed, dying) {
  const t = clockNow - dying.t0;
  const ramp = RAMPS[KIND_RAMP[dying.kind]] || GREY_RAMP;
  const f = Math.floor(t * 24);
  const x0 = Math.round(seed.x0);
  const y0 = Math.round(seed.y0);
  const g = Math.max(1, gridK);
  if (t < 0.06) {
    const r = Math.max(3, Math.round(5 * g));
    ctx.fillStyle = WHITE;
    for (let dy = -r; dy <= r; dy++) {
      const half = r - Math.abs(dy);
      ctx.fillRect(x0 - half, y0 + dy, 2 * half + 1, 1);
    }
  }
  const reach = seed.reach / SHATTER_REF_REACH;
  const sq = Math.max(2, Math.round(1.4 * g));
  for (let k = 0; k < SHARD_COUNT; k++) {
    const a = (k / SHARD_COUNT) * Math.PI * 2 + (hash01(k) - 0.5) * 0.35 +
        t * (k % 2 ? 0.9 : -0.9);
    const v = 85 + hash01(k + 40) * 70;
    const at = (tt) => (v * (1 - Math.exp(-4 * tt)) / 4) * reach;
    for (let tr = 3; tr >= 1; tr--) {
      const d = at(Math.max(0, t - tr * 0.035));
      ctx.fillStyle = toneShade(ramp, tr === 1 ? 2 : 1, k + f);
      ctx.fillRect(Math.round(x0 + Math.cos(a) * d),
          Math.round(y0 + Math.sin(a) * d), 1, 1);
    }
    const d = at(t);
    const x = Math.round(x0 + Math.cos(a) * d);
    const y = Math.round(y0 + Math.sin(a) * d);
    if (t > 0.7 && bayer01(x, y) < (t - 0.7) / 0.3) {
      continue;
    }
    const hot = (f + k) % 3 === 0;
    ctx.fillStyle = hot ? ramp[4] : toneShade(ramp, 3, k + f);
    ctx.fillRect(x, y, sq, sq);
  }
}

/** Draw the stars, and the shatter of the dying ones. */
function drawStars() {
  for (const seed of meshSeeds) {
    const dying = dyingStars.get(seed.cid);
    if (dying) {
      if (dyingBrightness(clockNow - dying.t0) != null) {
        drawStarShatter(seed, dying);
      }
      continue;
    }
    if (deadStarIds.has(seed.cid)) {
      continue;
    }
    const tone = layers.color && seed.tone > 0 ?
        PLANETS[planetKey].tones[seed.tone - 1] : STAR_TONES[0];
    const small = Math.floor(animTime * TWINKLE_HZ + seed.phase) % 4 === 2;
    drawStar(ctx, seed.x0, seed.y0, small, tone, gridK);
  }
}

/** A pixel crosshair at the mouse while the Cursor layer is on. */
function drawCrosshair() {
  const x = Math.round(mouseX);
  const y = Math.round(mouseY);
  const gap = Math.max(1, Math.round(gridK));
  const arm = Math.max(3, Math.round(4 * gridK));
  for (const [color, shift] of [[GREY_RAMP[0], 1], [WHITE, 0]]) {
    ctx.fillStyle = color;
    ctx.fillRect(x + gap + shift, y + shift, arm, 1);
    ctx.fillRect(x - gap - arm + 1 + shift, y + shift, arm, 1);
    ctx.fillRect(x + shift, y + gap + shift, 1, arm);
    ctx.fillRect(x + shift, y - gap - arm + 1 + shift, 1, arm);
  }
}

/** True when the aurora noise is in use. */
function noiseNeeded() {
  return layers.sparkle || layers.color;
}

/** True when any edge or spoke layer is on. */
function lookNeeded() {
  return layers.voronoi || layers.wiggle || layers.spokes;
}

/**
 * Paint a smooth glow that follows the outline of every animal and its trail.
 *
 * The animal layer is shrunk in steps, which blurs it, and stretched back up
 * with smoothing, so the glow is full resolution rather than pixel art. Then
 * the animals themselves are cut out, so the glow sits around them and does
 * not wash the sprite.
 */
function paintAura() {
  const w = auraCanvas.width;
  const h = auraCanvas.height;
  auraCtx.globalCompositeOperation = 'source-over';
  auraCtx.globalAlpha = 1;
  auraCtx.clearRect(0, 0, w, h);
  if (!auraAnimals) {
    return;
  }
  let from = animalLayer;
  for (const step of auraBlur) {
    step.ctx.clearRect(0, 0, step.canvas.width, step.canvas.height);
    step.ctx.imageSmoothingEnabled = true;
    step.ctx.drawImage(from, 0, 0, step.canvas.width, step.canvas.height);
    from = step.canvas;
  }
  auraCtx.imageSmoothingEnabled = true;
  auraCtx.imageSmoothingQuality = 'high';
  auraCtx.globalCompositeOperation = 'lighter';
  for (const [level, alpha] of AURA_LEVELS) {
    auraCtx.globalAlpha = alpha;
    auraCtx.drawImage(auraBlur[level - 1].canvas, 0, 0, w, h);
  }
  auraCtx.globalAlpha = 1;
  auraCtx.globalCompositeOperation = 'destination-out';
  auraCtx.imageSmoothingEnabled = false;
  auraCtx.drawImage(animalLayer, 0, 0, w, h);
}

/** Draw one frame. */
function draw(time) {
  actx.clearRect(0, 0, view.w, view.h);
  auraAnimals = false;
  if (noiseNeeded()) {
    updatePositions(time);
  }
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, view.w, view.h);
  drawHatBursts();
  if (layers.color) {
    drawGlow(time);
  }
  if (layers.circle) {
    pixels.arc(view.cx, view.cy, view.radius, 0, Math.PI * 2, RING, gridK);
    pixels.flush(ctx);
  }

  if (lookNeeded()) {
    updateRimDots(time);
    if (layers.voronoi) {
      drawVoronoi();
    }
    if (layers.wiggle) {
      drawWiggle(time);
    }
    if (layers.spokes) {
      drawSpokes(time);
    }
  } else if (cursorOn || objectsOn) {
    hoverPoints();
  }
  // With the game on, the stars show even while the Stars layer is off.
  if (layers.stars || gameOn) {
    drawStars();
  }
  for (const side of sides) {
    if (!layers[side.layer]) {
      continue;
    }
    for (const member of side.members) {
      if (!member.pack) {
        continue;
      }
      for (const id of member.shown) {
        drawAnimal(member, id, animalFade(id, member.fadeStart));
      }
    }
  }
  ctx.drawImage(animalLayer, 0, 0);
  drawCounters();
  if (cursorOn && mouseX != null) {
    drawCrosshair();
  }
  quantizeCanvas(ctx, view.w, view.h);
  paintAura();
}

/** Start the frame loop once; later calls do nothing. */
function startLoop() {
  if (looping) {
    return;
  }
  looping = true;
  lastMs = 0;
  requestAnimationFrame(tick);
}

/** Run one animation frame at the target frame rate. */
function tick(now) {
  if (lastMs === 0) {
    lastMs = now;
  }
  // Wait out the rest of the frame; a 60 Hz display draws every second tick.
  if (now - lastMs < FRAME_MS - 2) {
    requestAnimationFrame(tick);
    return;
  }
  const rawDt = Math.max(0, (now - lastMs) / 1000);
  lastMs = now;
  const dt = Math.min(0.05, rawDt);
  animTime += dt;
  paintHudText();
  const travelMul = (explosionActive && explosionKind === 'travel') ?
      TRAVEL_SPEED_MUL : 1;
  if (!shakeFrozen) {
    for (const member of eachMember()) {
      member.clock += dt * travelMul;
    }
  }
  lastDt = dt;
  clockNow = performance.now() / 1000;
  tickSky();
  draw(animTime);
  requestAnimationFrame(tick);
}

/**
 * Read the track rates from the server data. Each side takes the rate of its
 * own species, so a mirror match reads the one field twice.
 * @param {Object} data the server's sky payload
 */
function applyPlayback(data) {
  const pb = data.playback || {};
  const rate = {
    fly: Number(pb.fly_point_hz) || DEFAULT_HZ,
    fish: Number(pb.fish_point_hz) || DEFAULT_HZ,
  };
  for (const member of eachMember()) {
    member.hz = rate[member.team.kind];
  }
}

/** Resolve after `ms` milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Show a message on the boot screen, or hide the screen when `done`. */
function setBoot(message, done) {
  const boot = document.getElementById('boot');
  const msg = document.getElementById('boot-msg');
  if (done) {
    boot.hidden = true;
    return;
  }
  boot.hidden = false;
  if (message) {
    msg.textContent = message;
  }
}

/** Run `fn` until it succeeds, showing `label` between tries. */
async function loadWithRetry(label, fn) {
  let last = null;
  for (let i = 0; i < BOOT_TRIES; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      setBoot(label);
      await sleep(BOOT_RETRY_MS);
    }
  }
  throw last || new Error(label);
}

/** Fetch the stars of a sky from the server. */
async function loadStars(nStars) {
  const qs = new URLSearchParams({
    n_stars: String(Math.max(0, nStars)),
    n_flies: '0',
    n_fish: '0',
    lat: String(obsLat),
    lon: String(obsLon),
    date: STAR_DATE,
  });
  const response = await fetch('/api/get_data?' + qs.toString());
  if (!response.ok) {
    throw new Error('get_data failed');
  }
  return response.json();
}

/** Fetch and decode a track file from the server. */
async function loadTracks(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('tracks bin failed');
  }
  return parseTracks(await response.arrayBuffer());
}

/** Start loading one sprite image; returns the image and a promise. */
function loadOneSprite(url) {
  const img = new Image();
  img.src = url;
  const ready = img.decode ?
      img.decode() :
      new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
  return {img, ready};
}

/** Turn an east-facing image and a down-right one into all eight headings. */
function orientSprite(east, diagonal, size) {
  const out = [];
  for (let dir = 0; dir < 8; dir++) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.translate(size / 2, size / 2);
    g.rotate((dir >> 1) * Math.PI / 2);
    g.drawImage(dir % 2 ? diagonal : east, -size / 2, -size / 2);
    out.push(c);
  }
  return out;
}

/**
 * Load one animal's sprite frames and turn every frame to its eight headings.
 * @param {string} kind 'fly' or 'fish'
 * @param {string} folder '' for the organic set, 'cyber-' for the neon one
 * @return {Promise<Object>} the three banks, each a frame of eight headings
 */
async function loadSpriteSet(kind, folder) {
  const banks = ['grow', 'flicker', 'shrink'];
  const raw = {};
  const jobs = [];
  for (const bank of banks) {
    raw[bank] = [];
    for (let n = 1; n <= SPRITE_FRAMES; n++) {
      const east = loadOneSprite(`/SPRITES/${folder}${kind}/${bank}/${n}.png`);
      const diagonal =
          loadOneSprite(`/SPRITES/${folder}${kind}/${bank}/${n}_d.png`);
      raw[bank].push([east.img, diagonal.img]);
      jobs.push(east.ready, diagonal.ready);
    }
  }
  await Promise.all(jobs);
  const out = {};
  for (const bank of banks) {
    out[bank] = raw[bank].map(
        ([east, diagonal]) => orientSprite(east, diagonal, SPRITE_PX[kind]));
  }
  return out;
}

/** The sprite folder of a member: the neon set is prefixed, the organic is not. */
function spriteFolder(team) {
  return team.look === 'cyber' ? 'cyber-' : '';
}

/**
 * Sprite frames already loaded, by member id. A frame is a canvas of eight
 * headings and nothing ever draws into it, so one copy serves every sky and
 * every side at once.
 * @type {Map<string, Object>}
 */
const spriteCache = new Map();

/**
 * Load one member's sprite frames, or hand back the copy already loaded.
 * @param {Object} team One entry of MEMBERS.
 * @return {Promise<Object>} the member's three banks
 */
function loadMemberSprites(team) {
  if (!spriteCache.has(team.id)) {
    const started = loadSpriteSet(team.kind, spriteFolder(team)).catch(
        (err) => {
          spriteCache.delete(team.id);
          throw err;
        });
    spriteCache.set(team.id, started);
  }
  return spriteCache.get(team.id);
}

/**
 * Fetch one member's track pack. The cyber members draw the fictional tracks,
 * which the server keeps beside the recorded files.
 *
 * This is deliberately **not** cached: a pack carries per-animal state
 * (`odometers`, `lastBank`, `lastHeading`, `headClock`) that the sky mutates,
 * so two sides running the same member need a pack each or they would drag
 * each other's animals around. The bytes still come from the HTTP cache.
 * @param {Object} team One entry of MEMBERS.
 * @return {Promise<Object>} the track pack
 */
function loadMemberPack(team) {
  const animal = team.kind === 'fly' ? 'flies' : 'fish';
  let url = `/api/${animal}.bin?n=${MAX_ANIMALS}`;
  if (team.look === 'cyber') {
    url += '&set=fiction';
  }
  return loadTracks(url);
}

/**
 * Give every member of `list` its sprites and its own pack. Only the members
 * actually on the field are loaded, so a sky never fetches a member it is not
 * playing.
 * @param {Object[]} list the sides to load
 * @return {Promise<void>}
 */
async function loadSides(list) {
  await Promise.all(eachMember(list).map(async (member) => {
    const [sprites, pack] = await Promise.all([
      loadMemberSprites(member.team),
      loadMemberPack(member.team),
    ]);
    member.sprites = sprites;
    member.pack = pack;
  }));
}

/**
 * Draw a new sky: a star count, the stars, and the animal tracks. The two
 * sides each start at half the star count, so the two swarms together match
 * the stars.
 *
 * The new sky is built aside and only swapped in once every fetch has landed,
 * so a failure leaves the sky already on screen running rather than a
 * half-built one.
 */
async function loadSky() {
  const next = drawMatchup();
  await loadSides(next);
  reseedSky(Date.now());
  const count = nextStarCount();
  shuffleMembers(next);
  for (const side of next) {
    side.want = Math.floor(count / 2);
    side.digitOrder = Math.random() < 0.5 ? [0, 1] : [1, 0];
    dealCounts(side);
  }
  const data = await loadStars(count);
  if (data.stars && data.stars.length > count) {
    data.stars = data.stars.slice(0, count);
  }
  sides = next;
  skyCount = count;
  stars = data.stars || [];
  applyPlayback(data);
  cacheLists(data);
}

/**
 * Split one side's animals between its members, in whole numbers. The first
 * member takes the odd one when the total does not divide evenly.
 *
 * This only sets counts, so moving a slider adds and removes animals without
 * changing which ones are out. A new sky shuffles first, separately.
 * @param {Object} side
 */
function dealCounts(side) {
  const each = Math.floor(side.want / side.members.length);
  side.members.forEach((member, i) => {
    const share = i === 0 ? side.want - each * (side.members.length - 1) :
        each;
    member.count = Math.min(share, member.pack.counts.length);
    member.remaining = member.count;
  });
}

/**
 * Draw a fresh identity order for every member of `list`, which a new sky does.
 * @param {Object[]} list the sides to shuffle
 */
function shuffleMembers(list) {
  for (const member of eachMember(list)) {
    member.order = shuffledIds(member.pack.counts.length);
  }
}

/**
 * An animal spends itself on a star: it starts to leave and the count drops.
 * @param {Object} member the member the animal belongs to
 * @param {number} id the animal's identity in the track pack
 */
function kamikaze(member, id) {
  if (!member.shown.has(id) || member.fadeStart.has(id)) {
    return;
  }
  member.fadeStart.set(id, clockNow);
  member.shown.delete(id);
  member.remaining = Math.max(0, member.remaining - 1);
  maybeGameOver();
}

/**
 * How many animals a side has left, which is what its counter reads.
 * @param {Object} side
 * @return {number}
 */
function sideRemaining(side) {
  let total = 0;
  for (const member of side.members) {
    total += member.remaining;
  }
  return total;
}

/**
 * When a side has nothing left, send the sky to a new place. A side runs out
 * only once every member of it is gone, so a team of two has to be wiped
 * twice over.
 */
function maybeGameOver() {
  if (!gameOn) {
    return;
  }
  if (sides.every((side) => sideRemaining(side) > 0)) {
    return;
  }
  if (explosionKind === 'live' &&
      (explosionActive || locationChange || swapping)) {
    return;
  }
  startLocationShuffle(pickTravel(), null, 'travel');
}

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A number as two digits. */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/** The date and the time of day for the HUD, with the UTC offset. */
function formatClockLines(d) {
  const dateLine = `${WEEKDAY_ABBR[d.getDay()]} ${pad2(d.getDate())}/` +
      `${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const offAbs = Math.abs(offMin);
  const offStr = pad2(Math.floor(offAbs / 60)) + pad2(offAbs % 60);
  const timeLine = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:` +
      `${pad2(d.getSeconds())} (${sign}${offStr})`;
  return {dateLine, timeLine};
}

/** A position as degrees north or south and east or west. */
function formatLatLon(lat, lon) {
  const latAbs = Math.abs(lat).toFixed(4);
  const lonAbs = Math.abs(lon).toFixed(4);
  return `${latAbs}°${lat >= 0 ? 'N' : 'S'}, ` +
      `${lonAbs}°${lon >= 0 ? 'E' : 'W'}`;
}

/** Refresh the HUD text: place, position, quake, date, and time. */
function paintHudText() {
  const who = placeCountry ? placeName + ', ' + placeCountry : placeName;
  const placeEl = document.getElementById('placeLine');
  const latEl = document.getElementById('latlonLine');
  const quakeEl = document.getElementById('quakeLine');
  if (placeEl) {
    placeEl.textContent = who;
  }
  if (latEl) {
    latEl.textContent = formatLatLon(obsLat, obsLon);
  }
  if (quakeEl) {
    const quakeOn = Boolean(quakeHud) &&
        (explosionKind === 'live' || explosionKind === 'shake');
    quakeEl.textContent = quakeOn ?
        'M' + Number(quakeHud.mag).toFixed(1) : '';
    quakeEl.classList.toggle('hot', quakeOn && explosionActive);
  }
  const clockLines = formatClockLines(new Date());
  const dateEl = document.getElementById('dateLine');
  const timeEl = document.getElementById('timeLine');
  if (dateEl) {
    dateEl.textContent = clockLines.dateLine;
  }
  if (timeEl) {
    timeEl.textContent = clockLines.timeLine;
  }
}

const DIGIT_BITS = [
  [0x1f, 0x11, 0x11, 0x11, 0x1f],
  [0x04, 0x0c, 0x04, 0x04, 0x0e],
  [0x1f, 0x01, 0x1f, 0x10, 0x1f],
  [0x1f, 0x01, 0x0f, 0x01, 0x1f],
  [0x11, 0x11, 0x1f, 0x01, 0x01],
  [0x1f, 0x10, 0x1f, 0x01, 0x1f],
  [0x1f, 0x10, 0x1f, 0x11, 0x1f],
  [0x1f, 0x01, 0x02, 0x04, 0x04],
  [0x1f, 0x11, 0x1f, 0x11, 0x1f],
  [0x1f, 0x11, 0x1f, 0x01, 0x1f],
];

/** Seconds a changed number spends rolling, flashing and kicking. */
const COUNTER_ANIM_S = 0.45;
/** Vertical kick of a changed number, in digit cells, one entry per frame. */
const COUNTER_KICK = [0, -1, -2, -1.5, 0.5, 0];

/** Per-side counter state: what it last showed and when it last changed. */
const counterState = {
  left: {shown: null, from: null, t0: -9},
  right: {shown: null, from: null, t0: -9},
};

/**
 * The fixed look of each counter: one color per digit row, top to bottom,
 * taken as is from the sprite art of the animal it counts.
 */
const COUNTER_LOOK = {
  bio: {
    fly: {
      band: ['#f8d8b8', '#f8b860', '#f08018', '#a04010', '#801828'],
      near: '#502008',
      far: '#401018',
    },
    fish: {
      band: ['#c8d0f8', '#98e8f8', '#88a8f8', '#28a0f0', '#3868e8'],
      near: '#182880',
      far: '#101840',
    },
  },
  cyber: {
    // Every shade is a ramp entry from palette.js, matching the neon
    // sprite the counter stands for. The fly's band tracks the gradient of
    // its trail in `cyber-trails.js` — yellow, orange, then violet — and the
    // fish's runs teal into magenta and violet.
    fly: {
      band: ['#f8f8c8', '#f8d820', '#f08018', '#8050d8', '#402088'],
      near: '#402088',
      far: '#201048',
    },
    fish: {
      band: ['#b0f0e8', '#58e8d0', '#18a0a0', '#c838a8', '#8050d8'],
      near: '#082830',
      far: '#201048',
    },
  },
};

/** The colors one member's digits wear, from its own sprite's bands. */
function counterLook(member) {
  return COUNTER_LOOK[member.team.look][member.team.kind];
}

/** One digit as blocks; colorAt(row) picks each row's face color. */
function paintDigit(ch, x, y, cell, drop, colors, colorAt, white) {
  const bits = DIGIT_BITS[Number(ch)] || DIGIT_BITS[0];
  for (let pass = 0; pass < 3; pass++) {
    for (let row = 0; row < 5; row++) {
      ctx.fillStyle = pass === 0 ? colors.far :
          pass === 1 ? colors.near : (white ? WHITE : colorAt(row));
      const off = pass === 0 ? 2 * drop : pass === 1 ? drop : 0;
      for (let col = 0; col < 5; col++) {
        if (bits[row] & (1 << (4 - col))) {
          ctx.fillRect(x + col * cell + off, y + row * cell + off, cell, cell);
        }
      }
    }
  }
}

/**
 * A two-digit count, centered on (cx, cy). When the value changes, the
 * changed digits roll down like an odometer in quarter steps, the face flashes
 * white for two frames, the number kicks and sparks fly off, all stepped like
 * an old arcade score.
 * @param {Object} side the side the counter stands for
 * @param {number} value
 * @param {number} cx
 * @param {number} cy
 * @param {number} cell art pixels per digit block
 */
function drawCounter(side, value, cx, cy, cell) {
  const st = counterState[side.layer];
  const v = Math.min(99, Math.max(0, value | 0));
  if (st.shown !== v) {
    st.from = st.shown;
    st.shown = v;
    st.t0 = animTime;
  }
  const t = animTime - st.t0;
  // One member's colours per digit. A team of one wears its own colours on
  // both, so the pair of them is the same object twice — the digit order only
  // means anything once there are two members to order.
  const order = side.digitOrder;
  const only = side.members.length < 2;
  const colors = [0, 1].map(
      (d) => counterLook(side.members[only ? 0 : order[d]]));
  const drop = Math.max(2, Math.round(cell / 3));
  const text = String(v).padStart(2, '0');
  const old = st.from == null ? text : String(st.from).padStart(2, '0');
  const animating = t < COUNTER_ANIM_S;
  const frame = Math.floor(t * 30);
  const kick = animating && st.from != null ?
      COUNTER_KICK[Math.min(COUNTER_KICK.length - 1, Math.floor(t / 0.06))] : 0;
  const white = animating && (st.from == null ? t < 0.12 : t < 0.07);
  const zeroBlink = v === 0 && Math.floor(animTime * 4) % 2 === 0;
  const colorAt = (d) => (row) => {
    if (zeroBlink) {
      return RAMPS.red[row < 2 ? 3 : 2];
    }
    return colors[d].band[row];
  };
  const width = 2 * 5 * cell + cell;
  const x0 = Math.round(cx - width / 2);
  const y0 = Math.round(cy - 2.5 * cell + kick * cell);
  const run = 6 * cell;
  const u = Math.min(1, t / 0.2);
  const stepped = Math.floor(u * 4) / 4;
  for (let d = 0; d < 2; d++) {
    const dx = x0 + d * 6 * cell;
    const rolling = animating && st.from != null && old[d] !== text[d] &&
        u < 1;
    if (!rolling) {
      paintDigit(text[d], dx, y0, cell, drop, colors[d], colorAt(d), white);
      continue;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, y0 - 2 * drop, 5 * cell + 2 * drop + 1, 5 * cell + 4 * drop);
    ctx.clip();
    paintDigit(old[d], dx, y0 + Math.round(stepped * run), cell, drop,
        colors[d], colorAt(d), white);
    paintDigit(text[d], dx, y0 + Math.round((stepped - 1) * run), cell, drop,
        colors[d], colorAt(d), white);
    ctx.restore();
  }
  if (animating && st.from != null) {
    const seed = (side.layer === 'left' ? 1 : 2) * 100 + v;
    const band = colors[0].band;
    for (let k = 0; k < 14; k++) {
      const a = hash01(seed + k) * Math.PI * 2;
      const r = (2 + hash01(seed + k + 50) * 7) * cell * (t / COUNTER_ANIM_S);
      const px = Math.round(cx + Math.cos(a) * r * 1.4);
      const py = Math.round(cy + Math.sin(a) * r * 0.9);
      if (t > 0.3 && (k + frame) % 2) {
        continue;
      }
      ctx.fillStyle = band[k % band.length];
      const sq = Math.max(2, Math.round(cell / 3));
      ctx.fillRect(px, py, sq, sq);
    }
  }
}

/**
 * The counter of the animals each side has left, on that side of the arena
 * along its vertical middle, centered in the empty space out to the edge.
 * They hide while a sky is changing and come back full.
 */
function drawCounters() {
  if (!gameOn || explosionActive || locationChange || swapping) {
    for (const key of Object.keys(counterState)) {
      counterState[key].shown = null;
    }
    return;
  }
  const gapPx = view.cx - view.radius;
  const cell = Math.max(3, Math.min(Math.round(view.h / 60),
      Math.floor(gapPx * 0.8 / 11)));
  const mid = gapPx * 0.42;
  const at = {left: mid, right: view.w - mid};
  for (const side of sides) {
    drawCounter(side, sideRemaining(side), at[side.layer], view.cy, cell);
  }
}

function parseLiveQuakeMs(ev) {
  const raw = ev && ev.time;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && String(asNum) === raw.trim()) {
      return asNum < 1e12 ? asNum * 1000 : asNum;
    }
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

/**
 * Starts a fresh live watch, forgetting which quakes have been seen.
 *
 * Switching Live on, or moving the threshold, reacts to the events already
 * in the server's window, oldest first, then to each new one as it arrives.
 * Boot passes `fromNow`, so the piece opens in Lisbon rather than leaving at
 * once for a quake that struck before anyone was watching.
 *
 * @param {boolean} fromNow true to ignore the window and watch only ahead
 */
function armLiveBaseline(fromNow) {
  liveSeen = new Set();
  liveSinceMs = fromNow ? Date.now() : Date.now() - LIVE_LOOKBACK_MS;
}

/** Ask the server for live quakes, react to new ones, and poll again. */
async function pollLive() {
  if (liveOn) {
    try {
      const response = await fetch(
          '/api/quakes/live?minmagnitude=' + magMin);
      if (response.ok) {
        const events = await response.json();
        for (const ev of events) {
          const eid = String(ev.id);
          if (liveSeen.has(eid)) {
            continue;
          }
          liveSeen.add(eid);
          const t = parseLiveQuakeMs(ev);
          const liveBusy = explosionKind === 'live' &&
              (explosionActive || locationChange || swapping);
          if (t === null || t < liveSinceMs || liveBusy) {
            continue;
          }
          startLocationShuffle(quakeTarget(ev), Number(ev.mag), 'live');
          break;
        }
      }
    } catch (err) {
      /* next poll retries */
    }
  }
  window.setTimeout(pollLive, LIVE_POLL_MS);
}

/** Turn a layer on or off, and update its switch. */
function setLayer(id, on) {
  layers[id] = on;
  const el = document.getElementById('layer-' + id);
  if (el) {
    el.checked = on;
  }
}

/** Forget the smoothed headings, so sprites turn afresh. */
function clearHeadings(pack) {
  if (!pack || !pack.lastHeading) {
    return;
  }
  for (let i = 0; i < pack.lastHeading.length; i++) {
    pack.lastHeading[i] = null;
  }
}

/** True when a mouse event landed on a HUD panel, not the sky. */
function hudHit(ev) {
  const x = ev.clientX;
  const y = ev.clientY;
  const nodes = document.querySelectorAll('#hud-live, #hud-look, #boot');
  for (const node of nodes) {
    if (node.hidden) {
      continue;
    }
    const r = node.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return true;
    }
  }
  return false;
}

/** Wire up the layer switches in the Controls panel. */
function bindLayers() {
  const ids = [
    'circle', 'stars', 'voronoi', 'wiggle', 'spokes', 'sparkle',
    'left', 'right', 'color',
  ];
  for (const id of ids) {
    const el = document.getElementById('layer-' + id);
    layers[id] = el.checked;
    el.addEventListener('change', () => {
      layers[id] = el.checked;
      if (id === 'stars' && layers.stars) {
        revealNow();
      }
      if (id === 'color') {
        if (layers.color) {
          setLayer('circle', false);
          setLayer('voronoi', false);
          setLayer('wiggle', false);
          setLayer('spokes', true);
          setLayer('sparkle', true);
        } else {
          setLayer('circle', true);
        }
        for (const member of eachMember()) {
          clearHeadings(member.pack);
        }
      }
      if (id === 'wiggle' && layers.wiggle) {
        setLayer('voronoi', false);
      }
      if (id === 'left' || id === 'right') {
        const side = sides[id === 'left' ? LEFT : RIGHT];
        for (const member of side.members) {
          if (!layers[id]) {
            member.shown.clear();
            member.fadeStart.clear();
          }
        }
        if (layers[id] && objectsOn && !locationChange) {
          startAnimalEnter();
        }
      }
      startLoop();
    });
  }
}

/** Wire up the Live panel: the toggle, the threshold, Travel, and Shake. */
function bindLive() {
  const liveOpen = document.getElementById('live-open');
  const liveClose = document.getElementById('live-close');
  const liveMenu = document.getElementById('live-menu');
  const toggle = document.getElementById('toggle-live');
  const magEl = document.getElementById('mag-min');
  const magOut = document.getElementById('mag-min-out');
  const setOpen = (open) => {
    liveMenu.hidden = !open;
    liveOpen.setAttribute('aria-expanded', String(open));
  };
  toggle.checked = liveOn;
  liveOpen.classList.toggle('live-on', liveOn);
  magEl.value = String(magMin);
  magOut.textContent = magMin.toFixed(1);
  liveOpen.addEventListener('click', () => setOpen(liveMenu.hidden));
  liveClose.addEventListener('click', () => setOpen(false));
  toggle.addEventListener('change', () => {
    liveOn = toggle.checked;
    liveOpen.classList.toggle('live-on', liveOn);
    if (liveOn) {
      armLiveBaseline();
    }
    paintHudText();
  });
  magEl.addEventListener('input', () => {
    magMin = Number(magEl.value);
    magOut.textContent = magMin.toFixed(1);
    if (liveOn) {
      armLiveBaseline();
    }
  });
  document.getElementById('travel-btn').addEventListener('click', () => {
    if (busySky()) {
      return;
    }
    startLocationShuffle(pickTravel(), null, 'travel');
  });
  document.getElementById('shake-btn').addEventListener('click', () => {
    if (busySky()) {
      return;
    }
    const ev = nextShakeEvent();
    if (!ev) {
      return;
    }
    startLocationShuffle(quakeTarget(ev), Number(ev.mag), 'shake');
  });
  liveMenu.addEventListener('submit', (ev) => ev.preventDefault());
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !liveMenu.hidden) {
      setOpen(false);
    }
  });
}

/** Recount the animals still in play, for the two side counters. */
function recountAnimals() {
  for (const side of sides) {
    for (const member of side.members) {
      member.remaining = pendingEnterIds(side, member).length +
          remainingShownIds(member).length;
    }
  }
}

/**
 * Switch the game (both swarms) and the layers that come with them.
 *
 * @param {boolean} on
 * @param {boolean} revealStars true when the viewer flips the switch over a
 *     sky already showing, so every star appears at once and the animals
 *     enter now; false for a new sky, whose stars pop in by themselves and
 *     whose animals enter as the stars appear
 */
function setGame(on, revealStars) {
  gameOn = on;
  setLayer('circle', false);
  setLayer('stars', false);
  setLayer('voronoi', false);
  setLayer('wiggle', false);
  setLayer('spokes', on);
  setLayer('sparkle', on);
  setLayer('color', on);
  setLayer('left', on);
  setLayer('right', on);
  if (!on) {
    clearAnimals();
  } else if (revealStars) {
    revealNow();
    startAnimalEnter();
  }
  recountAnimals();
  const btn = document.getElementById('game-btn');
  btn.classList.toggle('game-on', gameOn);
  btn.setAttribute('aria-pressed', String(gameOn));
  startLoop();
}

/** Wire up the game button. */
function bindGame() {
  const btn = document.getElementById('game-btn');
  btn.classList.toggle('game-on', gameOn);
  btn.setAttribute('aria-pressed', String(gameOn));
  btn.addEventListener('click', () => setGame(!gameOn, true));
}

/** Wire up the cursor: hover, and click to kill or revive a star. */
function bindCursor() {
  const cursorEl = document.getElementById('toggle-cursor');
  cursorEl.checked = cursorOn;
  canvas.style.cursor = cursorOn ? 'none' : '';
  cursorEl.addEventListener('change', () => {
    cursorOn = cursorEl.checked;
    canvas.style.cursor = cursorOn ? 'none' : '';
    startLoop();
  });
  canvas.addEventListener('mousemove', (ev) => {
    if (!cursorOn || hudHit(ev)) {
      mouseX = null;
      mouseY = null;
      return;
    }
    [mouseX, mouseY] = arenaPoint(ev);
  });
  canvas.addEventListener('mouseleave', () => {
    mouseX = null;
    mouseY = null;
  });
  canvas.addEventListener('click', (ev) => {
    if (!cursorOn || hudHit(ev)) {
      return;
    }
    const [mx, my] = arenaPoint(ev);
    const hit = findStarAt(mx, my, CURSOR_HIT_SCALE);
    if (hit < 0) {
      return;
    }
    const cid = meshSeeds[hit].cid;
    if (deadStarIds.has(cid) || dyingStars.has(cid)) {
      reviveStar(cid);
    } else {
      killStar(cid, 'manual');
      hatBursts.push({t0: clockNow, kind: 'manual'});
    }
    startLoop();
  });
}

/** Wire up opening and closing the Controls panel. */
function bindPanels() {
  const lookOpen = document.getElementById('menu-open');
  const lookClose = document.getElementById('menu-close');
  const lookMenu = document.getElementById('menu');
  const setLook = (open) => {
    lookMenu.hidden = !open;
    lookOpen.setAttribute('aria-expanded', String(open));
  };
  lookOpen.addEventListener('click', () => setLook(lookMenu.hidden));
  lookClose.addEventListener('click', () => setLook(false));
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !lookMenu.hidden) {
      setLook(false);
    }
  });
}

/** Wire up the Interact switch. */
function bindInteract() {
  const el = document.getElementById('toggle-interact');
  el.checked = interactOn;
  el.addEventListener('change', () => {
    interactOn = el.checked;
  });
}

/** Add or send out animals to match the count sliders. */
function applyAnimalCounts() {
  startAnimalEnter();
  for (const side of sides) {
    dealCounts(side);
    for (const member of side.members) {
      const wanted = new Set(wantedIds(member));
      for (const id of wanted) {
        member.fadeStart.delete(id);
      }
      for (const id of [...member.shown]) {
        if (!wanted.has(id)) {
          member.fadeStart.set(id, clockNow);
          member.shown.delete(id);
        }
      }
    }
  }
  recountAnimals();
  startLoop();
}

/** Write the three count sliders from the current sky's state. */
function syncCountInputs() {
  const starsEl = document.getElementById('n-stars');
  const starsOut = document.getElementById('n-stars-out');
  for (const side of sides) {
    const el = document.getElementById('n-' + side.layer);
    const out = document.getElementById('n-' + side.layer + '-out');
    // A team of two can legitimately ask for twice what either member holds.
    let most = 0;
    for (const member of side.members) {
      most += member.pack ?
          Math.min(MAX_ANIMALS, member.pack.counts.length) : 0;
    }
    el.max = String(most);
    el.value = String(Math.min(side.want, most));
    out.textContent = el.value;
  }
  starsEl.value = String(skyCount);
  starsOut.textContent = starsEl.value;
}

let starApplySeq = 0;

/**
 * Apply a star count the user picked.
 *
 * Refetches the stars and rebuilds the mesh, leaving the animals
 * alone and leaving the random streams unseeded: a manual count is not
 * a new sky. A newer pick supersedes an in-flight one.
 */
async function applyStarCount(n) {
  const seq = ++starApplySeq;
  skyCount = Math.max(0, n - (n % 4));
  const data = await loadStars(skyCount);
  if (seq !== starApplySeq) {
    return;
  }
  stars = data.stars || [];
  if (stars.length < skyCount) {
    // Fewer stars were up than asked for. Round down to a multiple of four:
    // the sky splits between two sides and then between the members of a
    // team, so anything else leaves the last member short.
    skyCount = stars.length - (stars.length % 4);
  }
  rebuildMesh();
  cacheLists(data);
  showAllStars();
  syncCountInputs();
  startLoop();
}

/** Wire up the star count slider and the count slider of each side. */
function bindCounts() {
  const starsEl = document.getElementById('n-stars');
  const starsOut = document.getElementById('n-stars-out');
  syncCountInputs();
  for (const side of sides) {
    const el = document.getElementById('n-' + side.layer);
    const out = document.getElementById('n-' + side.layer + '-out');
    el.addEventListener('input', () => {
      side.want = Number(el.value);
      out.textContent = el.value;
      applyAnimalCounts();
    });
  }
  let settleTimer = 0;
  starsEl.addEventListener('input', () => {
    starsOut.textContent = starsEl.value;
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      applyStarCount(Number(starsEl.value));
    }, STAR_SETTLE_MS);
  });
}

/** Wire up every control. */
function bindMenu() {
  bindPanels();
  bindLayers();
  bindLive();
  bindGame();
  bindCursor();
  bindInteract();
}

/**
 * Show PRESS START and resolve once the viewer clicks, taps, or presses
 * Enter or Space. The click also serves as the user gesture browsers want
 * before any later audio.
 * @return {Promise<void>}
 */
function waitForStart() {
  const boot = document.getElementById('boot');
  setBoot('Press start');
  boot.classList.add('ready');
  return new Promise((resolve) => {
    const go = () => {
      window.removeEventListener('keydown', onKey);
      boot.removeEventListener('pointerdown', go);
      resolve();
    };
    const onKey = (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        go();
      }
    };
    window.addEventListener('keydown', onKey);
    boot.addEventListener('pointerdown', go);
  });
}

/**
 * Start the piece: draw the first matchup, load what it plays with, then wait
 * for PRESS START and begin.
 *
 * The draw comes first so the sky is built for the teams that are actually on
 * it, and every later sky does the same through `loadSky`.
 */
async function main() {
  bindMenu();
  resize();
  window.addEventListener('resize', () => {
    resize();
    startLoop();
  });
  try {
    setBoot('Loading...');
    await document.fonts.load('8px "Press Start 2P"').catch(() => null);
    await loadWithRetry('Loading sky...', () => loadSky());
    rebuildMesh();
    choosePlanet(null);
    bindCounts();
    updatePlace({
      capital: placeName,
      country: placeCountry,
      lat: obsLat,
      lon: obsLon,
    });
    armLiveBaseline(true);
    pollLive();
    startLoop();
    await waitForStart();
    setGame(true, false);
    startIntroRevival();
    setBoot('', true);
  } catch (err) {
    setBoot(
        'Could not load the sky or the animals. Run scripts/setup.py, then ' +
        'SkyArena.bat.');
    paintBlank();
    throw err;
  }
}

main();
