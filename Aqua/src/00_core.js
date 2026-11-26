// Living Glass Aquarium — core constants, math helpers and the simulation clock.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Tank dimensions (Y is up). Outer glass box is 8 × 5 × 4 (x, y, z), open top.
// ---------------------------------------------------------------------------
const TANK = {
  w: 8, h: 5, d: 4,          // outer width (x), height (y), depth (z)
  t: 0.08,                   // glass thickness
  waterLevel: 4.55,          // rest height of the water surface
};
TANK.xMin = -TANK.w / 2; TANK.xMax = TANK.w / 2;
TANK.zMin = -TANK.d / 2; TANK.zMax = TANK.d / 2;
TANK.yMin = 0;               // inner floor
// Inner faces of the glass (the volume that water, creatures and plants must stay inside)
TANK.ixMin = TANK.xMin + TANK.t; TANK.ixMax = TANK.xMax - TANK.t;
TANK.izMin = TANK.zMin + TANK.t; TANK.izMax = TANK.zMax - TANK.t;
TANK.cx = 0; TANK.cz = 0;

const WATER_IOR = 1.333;
const GLASS_IOR = 1.5;

// World layer = everything rendered into the scene-colour buffer.
// Optic layer = the refracting interfaces (water surface, glass panes) drawn in a second pass.
const LAYER_WORLD = 0;
const LAYER_OPTIC = 1;

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
const TWO_PI = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const saturate = (v) => clamp(v, 0, 1);
// Frame-rate independent exponential smoothing: moves `a` toward `b` with rate `lambda` per second.
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const remap = (v, a, b, c, d) => c + (d - c) * clamp((v - a) / (b - a), 0, 1);
const angleDelta = (a, b) => { let d = (b - a) % TWO_PI; if (d > Math.PI) d -= TWO_PI; if (d < -Math.PI) d += TWO_PI; return d; };

// Deterministic PRNG so the whole aquarium is reproducible.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  constructor(seed = 1) { this.next = mulberry32(seed); }
  float() { return this.next(); }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  gauss() { // approximated normal distribution in [-1, 1] (Irwin–Hall)
    return (this.next() + this.next() + this.next() + this.next() - 2) * 0.866;
  }
}

// Seeded 2D value noise in [-1, 1] plus a small fBm helper (used for the substrate and textures).
function makeNoise2D(seed) {
  const rng = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = new Float32Array(256);
  for (let i = 0; i < 256; i++) grad[i] = rng() * 2 - 1;
  const fade = (t) => t * t * (3 - 2 * t);
  return function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const v00 = grad[perm[perm[X] + Y]], v10 = grad[perm[perm[X + 1] + Y]];
    const v01 = grad[perm[perm[X] + Y + 1]], v11 = grad[perm[perm[X + 1] + Y + 1]];
    const u = fade(xf), v = fade(yf);
    return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v) * 1.6;
  };
}
function fbm(noise, x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, fx = x, fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += noise(fx, fy) * amp; norm += amp;
    amp *= gain; fx *= lacunarity; fy *= lacunarity;
  }
  return sum / norm;
}

// Catmull-Rom style 1D spline through [t, value] pairs (t ascending in 0..1). Smooth body profiles.
function sampleProfile(table, t) {
  const n = table.length;
  if (t <= table[0][0]) return table[0][1];
  if (t >= table[n - 1][0]) return table[n - 1][1];
  let i = 0;
  while (i < n - 2 && t > table[i + 1][0]) i++;
  const p0 = table[Math.max(0, i - 1)], p1 = table[i], p2 = table[i + 1], p3 = table[Math.min(n - 1, i + 2)];
  const u = (t - p1[0]) / (p2[0] - p1[0]);
  // Tangents scaled to the local parameter spacing so uneven tables behave.
  const m1 = (p2[1] - p0[1]) / Math.max(1e-6, p2[0] - p0[0]) * (p2[0] - p1[0]);
  const m2 = (p3[1] - p1[1]) / Math.max(1e-6, p3[0] - p1[0]) * (p2[0] - p1[0]);
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1[1] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2[1] + (u3 - u2) * m2;
}

// Orientation quaternion for a frame whose local +X is `forward`, local +Y as close to `up` as possible.
const _fwd = new THREE.Vector3(), _side = new THREE.Vector3(), _up = new THREE.Vector3(), _m4 = new THREE.Matrix4();
function quaternionFromForward(forward, up, out) {
  _fwd.copy(forward).normalize();
  if (_fwd.lengthSq() < 1e-8) _fwd.set(1, 0, 0);
  _side.crossVectors(up, _fwd);
  if (_side.lengthSq() < 1e-6) { _side.set(0, 0, 1).cross(_fwd); if (_side.lengthSq() < 1e-6) _side.set(0, 1, 0); }
  _side.normalize();
  _up.crossVectors(_fwd, _side).normalize();
  _m4.makeBasis(_fwd, _up, _side);
  return out.setFromRotationMatrix(_m4);
}

// ---------------------------------------------------------------------------
// Simulation clock. Everything animated registers an updater and reads SIM.time,
// so pausing freezes the whole world (fish, plants, bubbles, ripples, caustics…).
// ---------------------------------------------------------------------------
const SIM = {
  time: 0,
  paused: false,
  updaters: [],
  add(fn) { this.updaters.push(fn); return fn; },
  step(dt) {
    if (dt <= 0) return;
    this.time += dt;
    for (let i = 0; i < this.updaters.length; i++) this.updaters[i](dt, this.time);
  },
};

// Filled by the main chunk; the devtools chunk (dev builds only) inspects it.
const APP = {};

// Runs after everything is constructed: gives every system one consistent first state.
function warmUp(seconds = 0.5) {
  const n = 6;
  for (let i = 0; i < n; i++) SIM.step(seconds / n);
}
