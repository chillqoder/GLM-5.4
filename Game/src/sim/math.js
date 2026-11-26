// Pure math helpers for the authoritative simulation. No DOM, no Three.js.

export const SKIN = 0.01; // contact tolerance: treats "touching" as "not overlapping"
export const MAX_SNAP = 0.5; // largest embedding depth that is resolved by snapping out

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Move `v` toward `target` by at most `maxDelta`. */
export function moveToward(v, target, maxDelta) {
  if (v < target) return Math.min(v + maxDelta, target);
  if (v > target) return Math.max(v - maxDelta, target);
  return target;
}

/** Strict overlap test with a skin tolerance so that touching surfaces do not count. */
export function rectsOverlap(a, b, skin = SKIN) {
  return a.x1 < b.x2 - skin && a.x2 > b.x1 + skin && a.y1 < b.y2 - skin && a.y2 > b.y1 + skin;
}

export function pointInRect(x, y, r) {
  return x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
}

export function rectCenter(r) {
  return { x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 };
}

export function rectFromCenter(cx, cy, w, h) {
  return { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
}

export function expandRect(r, by) {
  return { x1: r.x1 - by, y1: r.y1 - by, x2: r.x2 + by, y2: r.y2 + by };
}

/**
 * Segment vs axis-aligned rectangle (slab method).
 * Returns the entry parameter t in [0, 1] (0 when the start point is inside), or null.
 */
export function segmentRectT(x1, y1, x2, y2, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let tmin = 0;
  let tmax = 1;
  if (Math.abs(dx) < 1e-9) {
    if (x1 < r.x1 || x1 > r.x2) return null;
  } else {
    let t1 = (r.x1 - x1) / dx;
    let t2 = (r.x2 - x1) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-9) {
    if (y1 < r.y1 || y1 > r.y2) return null;
  } else {
    let t1 = (r.y1 - y1) / dy;
    let t2 = (r.y2 - y1) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** Distance from a point to a rect (0 inside). */
export function pointRectDistance(px, py, r) {
  const dx = Math.max(r.x1 - px, 0, px - r.x2);
  const dy = Math.max(r.y1 - py, 0, py - r.y2);
  return Math.hypot(dx, dy);
}

/**
 * Swept AABB movement along one axis against a list of solids.
 * box: {x1,y1,x2,y2}. Moves by `delta` along `axis` ('x' | 'y').
 * Returns { hit, t, moved } where hit is the first solid contacted (or null), t in [0,1].
 * Overlap on the perpendicular axis uses a strict skin test so a surface the box
 * is already resting on never produces a false side/ceiling collision.
 */
export function sweepAxis(box, axis, delta, solids, skip = null) {
  let best = null;
  let bestT = Infinity;
  if (delta === 0) return { hit: null, t: 1, moved: 0 };
  for (const s of solids) {
    if (s === skip || s.ref === skip) continue;
    // Perpendicular overlap must be real (deeper than the skin).
    if (axis === 'y') {
      if (!(box.x1 < s.x2 - SKIN && box.x2 > s.x1 + SKIN)) continue;
    } else if (!(box.y1 < s.y2 - SKIN && box.y2 > s.y1 + SKIN)) continue;
    let t;
    // "gap" > 0: not yet touching; 0: touching; < 0: embedded.
    if (axis === 'y') {
      if (delta < 0) {
        const gap = box.y1 - s.y2;
        if (gap >= -SKIN) t = gap / -delta;
        else if (gap >= -MAX_SNAP) t = 0; // shallow embedding: snap out
        else continue; // deeply inside: not a landing candidate
      } else {
        const gap = s.y1 - box.y2;
        if (gap >= -SKIN) t = gap / delta;
        else if (gap >= -MAX_SNAP) t = 0;
        else continue;
      }
    } else if (delta < 0) {
      const gap = s.x2 - box.x1;
      if (gap >= -SKIN) t = gap / -delta;
      else if (gap >= -MAX_SNAP) t = 0;
      else continue;
    } else {
      const gap = s.x1 - box.x2;
      if (gap >= -SKIN) t = gap / delta;
      else if (gap >= -MAX_SNAP) t = 0;
      else continue;
    }
    if (t < 0) t = 0;
    if (t > 1) continue;
    if (t < bestT) {
      bestT = t;
      best = s;
    }
  }
  if (!best) return { hit: null, t: 1, moved: delta };
  return { hit: best, t: bestT, moved: delta * bestT };
}

/** Deep clone of plain JSON-like data (world snapshots). */
export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Deterministic small PRNG (mulberry32) for cosmetic variation only. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
