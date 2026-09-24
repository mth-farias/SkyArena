/**
 * The locked palette, the anti-aliased pixel layer, and the frame quantizer.
 *
 * Every pixel on the arena canvas is one of PALETTE_HEX after quantizeCanvas
 * runs. Each channel is a multiple of 8, so the 58 base colors sit on a 15-bit
 * grid (5 bits per channel), like a 16-bit console. Lines are drawn with soft
 * edges, but each soft pixel is snapped to a palette shade on the spot, so the
 * edge stays inside the palette.
 */

/** Greys, dark to light. */
const NEUTRALS = [
  '#000000', '#101010', '#181820', '#282838', '#383848', '#505060',
  '#606078', '#808098', '#9898B0', '#B8B8C8', '#D0D0E0', '#E8E8F0',
  '#F8F8F8',
];

/** The brightest color in the palette. */
export const WHITE = '#F8F8F8';

/**
 * Hue families as [deep, dark, mid, light, pale]. Deep exists for the soft
 * edge of anti-aliased lines; spokes and stars draw with dark to pale.
 */
export const RAMPS = {
  teal: ['#082830', '#104858', '#18A0A0', '#58E8D0', '#B0F0E8'],
  sky: ['#082040', '#103878', '#28A0F0', '#98E8F8', '#D0F0F8'],
  blue: ['#101840', '#182880', '#3868E8', '#88A8F8', '#C8D0F8'],
  violet: ['#201048', '#402088', '#8050D8', '#B898F8', '#D8D0F8'],
  magenta: ['#401038', '#781868', '#C838A8', '#F890D0', '#F8C8E8'],
  red: ['#401018', '#801828', '#E03030', '#F88878', '#F8C8C0'],
  orange: ['#502008', '#A04010', '#F08018', '#F8B860', '#F8D8B8'],
  yellow: ['#504008', '#A08010', '#F8D820', '#F8F090', '#F8F8C8'],
  green: ['#082818', '#105028', '#38B838', '#98F070', '#D0F8B8'],
};

/** Grey counterpart of a hue ramp. */
export const GREY_RAMP = ['#181820', '#383848', '#606078', '#D0D0E0', WHITE];

/**
 * Dusty, warm-cast counterparts of the hue ramps, the look of a 90s TV. Only
 * the planet schemes use them; the flies, fish, and their glows stay on RAMPS.
 */
const MUTED = {
  teal: ['#182028', '#284040', '#408078', '#70B8A0', '#B0D0C0'],
  sky: ['#182030', '#304058', '#5088A8', '#A0C8C8', '#C8D8D0'],
  blue: ['#202030', '#384060', '#5870A0', '#90A0C0', '#C0C0D0'],
  violet: ['#282038', '#504068', '#8060A0', '#B098C8', '#C8C0D0'],
  magenta: ['#382030', '#683858', '#985878', '#D890B0', '#E8B8C0'],
  red: ['#382020', '#703838', '#A85050', '#D08878', '#E0B8A8'],
  orange: ['#402818', '#805038', '#B07840', '#C8A068', '#E0C0A0'],
  yellow: ['#403818', '#807038', '#B8A048', '#D8C888', '#E8E0B0'],
  green: ['#102018', '#284028', '#60A058', '#98C070', '#C8D8A0'],
};

/** The muted twin of each hue-ramp color, by hex; neutrals have none. */
export const MUTE_OF = new Map();
for (const [name, ramp] of Object.entries(RAMPS)) {
  ramp.forEach((hex, i) => MUTE_OF.set(hex, MUTED[name][i]));
}

/** Every color of the palette: greys, hue ramps, and muted ramps. */
export const PALETTE_HEX = NEUTRALS.concat(
    ...Object.values(RAMPS), ...Object.values(MUTED));

/** Position of each palette color in PALETTE_HEX. */
export const PALETTE_INDEX = new Map(PALETTE_HEX.map((hex, i) => [hex, i]));

/** Star tones as [full, mid, dim]: white, yellow, sky. */
export const STAR_TONES = [
  [WHITE, '#D0D0E0', '#9898B0'],
  [RAMPS.yellow[3], RAMPS.yellow[2], RAMPS.yellow[1]],
  [RAMPS.sky[3], RAMPS.sky[2], RAMPS.sky[1]],
];

/**
 * Draw one star as a square dot that twinkles.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {boolean} small true on the dim twinkle frame
 * @param {string[]} tone hex shades: the full beat of the twinkle, then the dim
 *     beat
 * @param {number} k grid density factor: 1 on the base grid, above 1 when art
 *     pixels are smaller, so the star keeps its size on screen
 */
export function drawStar(ctx, x, y, small, tone, k) {
  const core = Math.max(1, Math.round(k));
  const o = Math.floor(core / 2);
  ctx.fillStyle = small ? tone[1] : tone[0];
  ctx.fillRect(x - o, y - o, core, core);
}

/** Bits kept per channel when looking a color up in the nearest-color table. */
const KEY_BITS = 5;
const KEY_SIZE = 1 << (KEY_BITS * 3);

/** Split a `#RRGGBB` string into [r, g, b] bytes. */
function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Pack bytes as 0xAABBGGRR, opaque, to match a little-endian canvas view. */
function pack(r, g, b) {
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

/** The 5-5-5 table key of an 8-bit color. */
function keyOf(r, g, b) {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

/**
 * Build a table from a 5-5-5 bit color key to the nearest palette color.
 *
 * Entries hold the palette color packed as 0xAABBGGRR, the byte order of a
 * little-endian Uint32 view over canvas pixels. The distance weights green
 * over red over blue, close to how the eye reads brightness. Each palette
 * color maps to itself.
 * @return {Uint32Array}
 */
function buildTable() {
  const rgb = PALETTE_HEX.map(hexToRgb);
  const packed = rgb.map(([r, g, b]) => pack(r, g, b));
  const table = new Uint32Array(KEY_SIZE);
  for (let key = 0; key < KEY_SIZE; key++) {
    const r = ((key >> 10) & 31) * 8 + 4;
    const g = ((key >> 5) & 31) * 8 + 4;
    const b = (key & 31) * 8 + 4;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < rgb.length; i++) {
      const dr = r - rgb[i][0];
      const dg = g - rgb[i][1];
      const db = b - rgb[i][2];
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    table[key] = packed[best];
  }
  rgb.forEach(([r, g, b], i) => {
    table[keyOf(r, g, b)] = packed[i];
  });
  return table;
}

const TABLE = buildTable();

/**
 * Snap every pixel of a canvas to its nearest palette color, in place.
 *
 * Runs after the frame is drawn, so anti-aliased edges and translucent
 * blends collapse into palette colors and nothing off-palette reaches the
 * screen.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 */
export function quantizeCanvas(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const px = new Uint32Array(img.data.buffer);
  for (let i = 0; i < px.length; i++) {
    const v = px[i];
    px[i] = TABLE[
        (((v & 0xff) >> 3) << 10) |
        ((((v >> 8) & 0xff) >> 3) << 5) |
        (((v >> 16) & 0xff) >> 3)];
  }
  ctx.putImageData(img, 0, 0);
}

const COVER_LEVELS = 8;
/**
 * Soft edges are lifted a little, so a stroke keeps an even weight as it
 * drifts across the pixel grid.
 */
const COVER_GAMMA = 0.7;
const LEVEL_OF = Array.from({length: 65}, (_, i) =>
    Math.round(Math.pow(i / 64, COVER_GAMMA) * COVER_LEVELS));
/** Edge pixels this dark are dropped, so a line has no grey halo. */
const FRINGE_FLOOR = 22;

/**
 * Soft-edge colors: AA_LUT[p * 9 + level] is palette color p at level/8
 * coverage, blended toward black and snapped to the palette. Zero means the
 * pixel is too dark to draw.
 */
const AA_LUT = (() => {
  const lut = new Uint32Array(PALETTE_HEX.length * (COVER_LEVELS + 1));
  PALETTE_HEX.forEach((hex, p) => {
    const [r, g, b] = hexToRgb(hex);
    for (let level = 1; level <= COVER_LEVELS; level++) {
      const f = level / COVER_LEVELS;
      if (Math.max(r, g, b) * f < FRINGE_FLOOR) {
        continue;
      }
      lut[p * (COVER_LEVELS + 1) + level] =
          TABLE[keyOf(Math.round(r * f), Math.round(g * f), Math.round(b * f))];
    }
  });
  return lut;
})();

/**
 * Walk a straight line of a given width and report every pixel it touches.
 *
 * The line is measured from pixel centers, so a pixel's coverage is how far
 * its center sits inside the stroke, with a one-pixel soft edge.
 * @param {number} ax start x
 * @param {number} ay start y
 * @param {number} bx end x
 * @param {number} by end y
 * @param {number} width stroke width in pixels
 * @param {boolean} caps true to fade the two ends, false to run them on
 * @param {function(number, number, number, number)} emit called with the
 *     pixel x, y, a coverage level 1..8, and the progress 0..1 along the line
 */
function traceLine(ax, ay, bx, by, width, caps, emit) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const half = width / 2 + 0.5;
  if (len < 1e-6) {
    emit(Math.round(ax), Math.round(ay), COVER_LEVELS, 0);
    return;
  }
  const ux = dx / len;
  const uy = dy / len;
  const steep = Math.abs(dy) > Math.abs(dx);
  const m0 = steep ? ay : ax;
  const m1 = steep ? by : bx;
  const reach = half / (steep ? Math.abs(uy) : Math.abs(ux));
  const lo = Math.floor(Math.min(m0, m1) - half);
  const hi = Math.ceil(Math.max(m0, m1) + half);
  for (let m = lo; m <= hi; m++) {
    const t = Math.max(0, Math.min(1, (m - m0) / (m1 - m0)));
    const center = steep ? ax + dx * t : ay + dy * t;
    const n1 = Math.ceil(center + reach);
    for (let n = Math.floor(center - reach); n <= n1; n++) {
      const px = steep ? n : m;
      const py = steep ? m : n;
      const s = (px - ax) * ux + (py - ay) * uy;
      const d = Math.abs((px - ax) * uy - (py - ay) * ux);
      let cover = Math.min(1, half - d);
      if (caps) {
        cover = Math.min(cover, s + 0.5, len - s + 0.5);
      }
      if (cover <= 0) {
        continue;
      }
      const level = LEVEL_OF[Math.round(cover * 64)];
      if (level > 0) {
        emit(px, py, level, Math.max(0, Math.min(1, s / len)));
      }
    }
  }
}

/** Index of the depth bucket for progress u, given each bucket's upper end. */
function bucketOf(u, ends) {
  let b = 0;
  while (b < ends.length - 1 && u >= ends[b]) {
    b++;
  }
  return b;
}

/** 4x4 ordered-dither thresholds, 0 to 15. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * A transparent layer of palette pixels with soft-edged lines.
 *
 * Lines, dots, and arcs are written straight into a pixel buffer, each pixel
 * already snapped to the palette, and flush paints the layer onto the arena
 * canvas. Where strokes overlap, the pixel with more coverage wins.
 */
export class PixelBatch {
  constructor() {
    this.w = 0;
    this.h = 0;
    this.box = [0, 0, -1, -1];
  }

  /** Match the arena canvas size; call whenever it changes. */
  resizeTo(w, h) {
    this.w = w;
    this.h = h;
    this.layer = document.createElement('canvas');
    this.layer.width = w;
    this.layer.height = h;
    this.lctx = this.layer.getContext('2d');
    this.img = this.lctx.createImageData(w, h);
    this.px = new Uint32Array(this.img.data.buffer);
    this.cover = new Uint8Array(w * h);
    this.box = [w, h, -1, -1];
  }

  /** Widen the dirty box so flush repaints only what changed. */
  grow(x0, y0, x1, y1) {
    const b = this.box;
    b[0] = Math.min(b[0], x0);
    b[1] = Math.min(b[1], y0);
    b[2] = Math.max(b[2], x1);
    b[3] = Math.max(b[3], y1);
  }

  /**
   * Write one pixel at a coverage level in palette color p.
   * @param {number} x
   * @param {number} y
   * @param {number} level coverage 1..8
   * @param {number} p palette index
   */
  put(x, y, level, p) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) {
      return;
    }
    const i = y * this.w + x;
    if (level <= this.cover[i]) {
      return;
    }
    const v = AA_LUT[p * (COVER_LEVELS + 1) + level];
    if (v === 0) {
      return;
    }
    this.cover[i] = level;
    this.px[i] = v;
    this.grow(x, y, x, y);
  }

  /**
   * Draw a straight soft-edged line.
   * @param {number} x0
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   * @param {number} width stroke width in pixels
   * @param {function(number): string} colorAt palette hex for progress 0..1
   * @param {boolean=} caps false to run the ends on, for joined segments
   */
  line(x0, y0, x1, y1, width, colorAt, caps = true) {
    traceLine(x0, y0, x1, y1, width, caps, (x, y, level, u) => {
      this.put(x, y, level, PALETTE_INDEX.get(colorAt(u)));
    });
  }

  /**
   * Draw a straight line whose color steps along its length.
   * @param {number} x0
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   * @param {number} width
   * @param {number[]} ends upper end of each depth bucket, as a share
   * @param {number[]} cols palette index per bucket
   * @param {number[]=} cols2 a second set of colors that takes over a share
   *     `mix` of the pixels, chosen by ordered dither: an 8-bit crossfade
   * @param {number=} mix share of pixels, 0 to 1, that use `cols2`
   * @param {number=} cap highest coverage level to write; a low cap draws a
   *     faint line, used for glows
   */
  steppedLine(x0, y0, x1, y1, width, ends, cols, cols2 = null, mix = 0,
      cap = COVER_LEVELS) {
    const cut = Math.round(mix * 16);
    traceLine(x0, y0, x1, y1, width, true, (x, y, level, u) => {
      const c = cols2 && BAYER4[((y & 3) << 2) | (x & 3)] < cut ? cols2 : cols;
      this.put(x, y, Math.min(level, cap), c[bucketOf(u, ends)]);
    });
  }

  /** Draw a soft dot of a given radius in pixels. */
  dot(x, y, hex, radius) {
    const p = PALETTE_INDEX.get(hex);
    const reach = Math.ceil(radius + 1);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const cover = Math.min(1, radius + 0.5 - Math.hypot(dx, dy));
        if (cover > 0) {
          this.put(x + dx, y + dy, Math.round(cover * COVER_LEVELS), p);
        }
      }
    }
  }

  /** Draw an arc of a circle as short joined segments, angles in radians. */
  arc(cx, cy, r, a1, a2, hex, width) {
    const steps = Math.max(2, Math.ceil((a2 - a1) * r / 3));
    let px = cx + r * Math.cos(a1);
    let py = cy + r * Math.sin(a1);
    for (let s = 1; s <= steps; s++) {
      const a = a1 + (a2 - a1) * s / steps;
      const qx = cx + r * Math.cos(a);
      const qy = cy + r * Math.sin(a);
      this.line(px, py, qx, qy, width, () => hex, false);
      px = qx;
      py = qy;
    }
  }

  /** Paint the layer onto the arena canvas and clear it. */
  flush(ctx) {
    const [x0, y0, x1, y1] = this.box;
    if (x1 < x0 || !this.px) {
      return;
    }
    const bx = Math.max(0, x0);
    const by = Math.max(0, y0);
    const bw = Math.min(this.w - 1, x1) - bx + 1;
    const bh = Math.min(this.h - 1, y1) - by + 1;
    if (bw > 0 && bh > 0) {
      this.lctx.putImageData(this.img, 0, 0, bx, by, bw, bh);
      ctx.drawImage(this.layer, bx, by, bw, bh, bx, by, bw, bh);
      for (let y = by; y < by + bh; y++) {
        this.px.fill(0, y * this.w + bx, y * this.w + bx + bw);
        this.cover.fill(0, y * this.w + bx, y * this.w + bx + bw);
      }
    }
    this.box = [this.w, this.h, -1, -1];
  }
}
