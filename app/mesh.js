/**
 * Disk-clipped Voronoi mesh from unit-disk stars.
 *
 * Each cell starts as the whole unit disk (a fine regular polygon) and is cut
 * by the bisector between its star and every other star. The cells therefore
 * close by construction: they tile the disk, stay inside it, and each holds
 * its own star. Edges and rim arcs are read back from the cell outlines.
 */

/** Two stars this close in distance count as tied for a flowing dot. */
const TIE_RATIO = 1.01;
/** Gap between flowing dots along an edge, in unit-disk lengths. */
const DOT_SPACING = 0.01;
/**
 * Corners of the polygon that stands in for the rim. The polygon is
 * circumscribed, so every star inside the unit disk is inside it; with 256
 * corners it overshoots the rim by less than 0.01% of the radius.
 */
const RIM_CORNERS = 256;
const RIM_CORNER_RADIUS = 1 / Math.cos(Math.PI / RIM_CORNERS);
/** Edges shorter than this are dropped as degenerate. */
const MIN_EDGE = 1e-9;
/** Tag for a cell outline segment that lies on the rim, not on a bisector. */
const RIM = -1;

/**
 * Cut a convex polygon down to the side closer to star a than to star b.
 *
 * Every outline segment carries a tag: the index of the star whose bisector
 * made it, or RIM. tags[k] belongs to the segment from pts[k] to pts[k + 1].
 * @param {number[][]} pts polygon corners, counter-clockwise
 * @param {number[]} tags outline tags, one per corner
 * @param {number[]} a position of the kept star
 * @param {number[]} b position of the other star
 * @param {number} tag tag for the new segment on the bisector
 * @return {{pts: number[][], tags: number[]}}
 */
function clipToCloserSide(pts, tags, a, b, tag) {
  const nx = a[0] - b[0];
  const ny = a[1] - b[1];
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const side = (p) => (p[0] - mx) * nx + (p[1] - my) * ny;
  const outPts = [];
  const outTags = [];
  const count = pts.length;
  for (let k = 0; k < count; k++) {
    const cur = pts[k];
    const next = pts[(k + 1) % count];
    const fc = side(cur);
    const fn = side(next);
    if (fc >= 0) {
      outPts.push(cur);
      outTags.push(tags[k]);
      if (fn < 0) {
        const u = fc / (fc - fn);
        outPts.push([cur[0] + (next[0] - cur[0]) * u,
          cur[1] + (next[1] - cur[1]) * u]);
        outTags.push(tag);
      }
    } else if (fn >= 0) {
      const u = fc / (fc - fn);
      outPts.push([cur[0] + (next[0] - cur[0]) * u,
        cur[1] + (next[1] - cur[1]) * u]);
      outTags.push(tags[k]);
    }
  }
  return {pts: outPts, tags: outTags};
}

/**
 * Build the Voronoi cell of one star, clipped to the unit disk.
 * @param {number} si index of the star
 * @param {object[]} stars stars with x and y in the unit disk
 * @return {{pts: number[][], tags: number[]}|null} null when nothing is left
 */
function buildCell(si, stars) {
  const home = [stars[si].x, stars[si].y];
  let pts = [];
  let tags = [];
  for (let k = 0; k < RIM_CORNERS; k++) {
    const ang = 2 * Math.PI * k / RIM_CORNERS;
    pts.push([RIM_CORNER_RADIUS * Math.cos(ang),
      RIM_CORNER_RADIUS * Math.sin(ang)]);
    tags.push(RIM);
  }
  const others = [];
  for (let j = 0; j < stars.length; j++) {
    if (j !== si) {
      others.push([j, Math.hypot(stars[j].x - home[0], stars[j].y - home[1])]);
    }
  }
  others.sort((p, q) => p[1] - q[1]);
  for (const [j, dist] of others) {
    if (dist < 1e-12) {
      continue;
    }
    // A bisector sits half the distance away, so once every corner is
    // nearer than that, no farther star can cut the cell.
    let reach = 0;
    for (const p of pts) {
      reach = Math.max(reach, Math.hypot(p[0] - home[0], p[1] - home[1]));
    }
    if (dist / 2 > reach) {
      break;
    }
    ({pts, tags} = clipToCloserSide(
        pts, tags, home, [stars[j].x, stars[j].y], j));
    if (pts.length < 3) {
      return null;
    }
  }
  return {pts, tags};
}

/**
 * Build the whole mesh: cells, shared edges, and rim arcs.
 * @param {object[]} stars stars with x, y in the unit disk, and an optional t
 * @return {{edges: object[], rimArcs: object[], cells: object[]}}
 */
export function buildMesh(stars) {
  const n = stars.length;
  if (n < 3) {
    return {edges: [], rimArcs: [], cells: []};
  }

  const nearStars = (x, y) => {
    let best1 = -1;
    let best2 = -1;
    let d1 = Infinity;
    let d2 = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = stars[i].x - x;
      const dy = stars[i].y - y;
      const d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        best2 = best1;
        d1 = d;
        best1 = i;
      } else if (d < d2) {
        d2 = d;
        best2 = i;
      }
    }
    if (best2 >= 0 && d2 <= d1 * TIE_RATIO * TIE_RATIO) {
      return [best1, best2];
    }
    return [best1];
  };

  const ownersAlong = (p1, dx, dy, length) => {
    const count = Math.max(1, Math.round(length / DOT_SPACING));
    const owners = [];
    for (let i = 0; i <= count; i++) {
      const s = Math.min(i * DOT_SPACING, length);
      owners.push(nearStars(p1[0] + dx * s, p1[1] + dy * s));
    }
    return owners;
  };

  const tOf = (i) => {
    const s = stars[i];
    return s.t != null ? s.t : Math.hypot(s.x, s.y);
  };

  const outlines = [];
  for (let si = 0; si < n; si++) {
    outlines.push(buildCell(si, stars));
  }

  const edgeByPair = new Map();
  const rimArcs = [];
  const cells = [];
  for (let si = 0; si < n; si++) {
    const cell = outlines[si];
    if (!cell) {
      continue;
    }
    const {pts, tags} = cell;
    const count = pts.length;
    cells.push({pts, star: si});
    for (let k = 0; k < count; k++) {
      const tag = tags[k];
      const p1 = pts[k];
      const p2 = pts[(k + 1) % count];
      if (tag === RIM) {
        continue;
      }
      const key = si < tag ? si + ',' + tag : tag + ',' + si;
      if (!edgeByPair.has(key) &&
          Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) > MIN_EDGE) {
        edgeByPair.set(key, {a: Math.min(si, tag), b: Math.max(si, tag),
          p1, p2});
      }
    }
    // Every run of rim segments in the outline becomes one arc.
    for (let k = 0; k < count; k++) {
      if (tags[k] !== RIM || tags[(k + count - 1) % count] === RIM) {
        continue;
      }
      let end = k;
      while (tags[(end + 1) % count] === RIM && end + 1 < k + count) {
        end++;
      }
      const start = pts[k];
      const stop = pts[(end + 1) % count];
      const a1 = Math.atan2(start[1], start[0]);
      let a2 = Math.atan2(stop[1], stop[0]);
      if (a2 <= a1) {
        a2 += Math.PI * 2;
      }
      const arcLen = a2 - a1;
      if (arcLen < 1e-3) {
        continue;
      }
      const dotCount = Math.max(1, Math.round(arcLen / DOT_SPACING));
      const owners = [];
      for (let di = 0; di <= dotCount; di++) {
        const u = Math.min(1, (di * DOT_SPACING) / arcLen);
        const ang = a1 + arcLen * u;
        owners.push(nearStars(Math.cos(ang), Math.sin(ang)));
      }
      rimArcs.push({a1, a2, t: tOf(si), dotOwners: owners});
    }
  }

  const edges = [];
  for (const {a, b, p1, p2} of edgeByPair.values()) {
    const length = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const dx = (p2[0] - p1[0]) / length;
    const dy = (p2[1] - p1[1]) / length;
    const onRim = Math.hypot(p1[0], p1[1]) > 1 - 1e-6 ||
        Math.hypot(p2[0], p2[1]) > 1 - 1e-6;
    edges.push({
      p1, p2, sites: [a, b],
      t: onRim ? Math.max(tOf(a), tOf(b)) : (tOf(a) + tOf(b)) / 2,
      dotOwners: ownersAlong(p1, dx, dy, length),
    });
  }

  return {edges, rimArcs, cells};
}
