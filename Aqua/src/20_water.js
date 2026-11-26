// Water state shared by the GPU (surface, glass, caustics) and the CPU (bubbles, ripples).
// One wave model drives displacement, normals, refraction and the caustic light pattern.

const WAVE_COUNT = 8;
const CAUSTIC_WAVE_COUNT = 5;
const RIPPLE_MAX = 24;
const RIPPLE_LIFE = 3.0;
const RIPPLE_SPEED = 0.85;      // ring expansion (units / s)
const MENISCUS_HEIGHT = 0.022;
const MENISCUS_WIDTH = 0.09;

const WAVES = [];
(function initWaves() {
  const rng = new Rng(2024);
  const lambda = [2.7, 1.75, 1.25, 0.92, 0.66, 0.47, 0.19, 0.12];
  const ampScale = [1, 1, 1, 1, 1, 1, 0.075, 0.05];
  for (let i = 0; i < WAVE_COUNT; i++) {
    const k = TWO_PI / lambda[i];
    const omega = Math.sqrt(9.81 * k) * 0.9;        // deep-water dispersion, slowed for an indoor tank
    const ang = rng.range(0, TWO_PI);
    WAVES.push({
      dx: Math.cos(ang), dz: Math.sin(ang), k, omega,
      amp: 0.0058 * Math.pow(lambda[i], 1.05) * ampScale[i],
      phase: rng.range(0, TWO_PI),
      // light focusing is driven by the longer waves so the caustic net stays readable (~0.6 u cells)
      caustic: [1.6, 1.5, 1.3, 0.9, 0.35, 0, 0, 0][i],
    });
  }
})();

const waveUniforms = {
  uWaveA: { value: WAVES.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.omega)) },
  uWaveB: { value: WAVES.map((w) => new THREE.Vector4(w.amp, w.phase, w.caustic, 0)) },
};

// --- expanding rings where bubbles reach the surface ---------------------------------------
const RIPPLES = {
  items: [],
  vecs: Array.from({ length: RIPPLE_MAX }, () => new THREE.Vector4(0, 0, -100, 0)),
  uniforms: { uRipples: { value: null }, uRippleCount: { value: 0 } },
};
function spawnRipple(x, z, time, strength = 1) {
  // Aggregate arrivals that land together so the surface stays calm and the loop stays short.
  let best = null, bestD = 0.17;
  for (const r of RIPPLES.items) {
    if (time - r.start > 0.35) continue;
    const d = Math.hypot(r.x - x, r.z - z);
    if (d < bestD) { best = r; bestD = d; }
  }
  if (best) { best.strength = Math.min(1.5, best.strength + strength * 0.45); return; }
  if (RIPPLES.items.length >= RIPPLE_MAX) {
    let oldest = 0;
    for (let i = 1; i < RIPPLES.items.length; i++) if (RIPPLES.items[i].start < RIPPLES.items[oldest].start) oldest = i;
    RIPPLES.items.splice(oldest, 1);
  }
  RIPPLES.items.push({ x, z, start: time, strength });
}
function updateRipples(time) {
  RIPPLES.items = RIPPLES.items.filter((r) => time - r.start < RIPPLE_LIFE);
  for (let i = 0; i < RIPPLES.items.length; i++) {
    const r = RIPPLES.items[i];
    RIPPLES.vecs[i].set(r.x, r.z, r.start, r.strength);
  }
  RIPPLES.uniforms.uRipples.value = RIPPLES.vecs;
  RIPPLES.uniforms.uRippleCount.value = RIPPLES.items.length;
}
RIPPLES.uniforms.uRipples.value = RIPPLES.vecs;

// --- CPU mirror of the shader height field --------------------------------------------------
function waveHeightAt(x, z, t) {
  let h = 0;
  for (let i = 0; i < WAVE_COUNT; i++) {
    const w = WAVES[i];
    h += w.amp * Math.sin((w.dx * x + w.dz * z) * w.k - w.omega * t + w.phase);
  }
  for (let i = 0; i < RIPPLES.items.length; i++) {
    const r = RIPPLES.items[i];
    const age = t - r.start;
    const dist = Math.hypot(x - r.x, z - r.z);
    const q = (dist - age * RIPPLE_SPEED) / (0.05 + age * 0.09);
    h += 0.02 * r.strength * Math.exp(-q * q) * Math.exp(-age * 1.5) * Math.cos(q * Math.PI);
  }
  const edge = Math.min(Math.min(x - TANK.ixMin, TANK.ixMax - x), Math.min(z - TANK.izMin, TANK.izMax - z));
  h += MENISCUS_HEIGHT * smoothstep(MENISCUS_WIDTH, 0, edge);
  return TANK.waterLevel + h;          // absolute height (the shader adds the same h to the rest level)
}

// --- layout of everything that sits on the substrate -----------------------------------------
const LAYOUT = {
  castle: { x: -0.35, z: -0.95, rotY: 0.10 },
  filter: { x: 2.95, z: -1.25 },
  plants: {
    vallisneria: { x: -3.3, z: -1.35 },
    anubias: { x: -2.8, z: 1.15 },
    javafern: { x: -2.2, z: -0.2 },
    cabomba: { x: 2.65, z: 0.35 },
  },
  // Larger accent stones (indices are stable; the bottom snail climbs stone 2)
  stones: [
    { x: 1.15, z: -0.5, r: 0.34, squash: 0.72 },
    { x: 1.6, z: 1.55, r: 0.27, squash: 0.62 },
    { x: -1.0, z: 0.62, r: 0.17, squash: 0.82 },
    { x: 3.25, z: 1.45, r: 0.21, squash: 0.68 },
    { x: -3.55, z: 0.3, r: 0.23, squash: 0.7 },
  ],
};

// --- substrate height field (also the simplified collision surface for bottom animals) ------
const SUBSTRATE = {
  noise: makeNoise2D(77),
  mounds: [
    { x: LAYOUT.plants.vallisneria.x, z: LAYOUT.plants.vallisneria.z, r: 0.75, h: 0.10 },
    { x: LAYOUT.plants.anubias.x, z: LAYOUT.plants.anubias.z, r: 0.55, h: 0.07 },
    { x: LAYOUT.plants.javafern.x, z: LAYOUT.plants.javafern.z, r: 0.5, h: 0.06 },
    { x: LAYOUT.plants.cabomba.x, z: LAYOUT.plants.cabomba.z, r: 0.55, h: 0.07 },
    { x: LAYOUT.castle.x, z: LAYOUT.castle.z, r: 1.3, h: 0.09 },
    { x: LAYOUT.filter.x, z: LAYOUT.filter.z, r: 0.6, h: 0.04 },
    { x: -1.0, z: 0.62, r: 0.4, h: 0.05 },
    { x: 1.15, z: -0.5, r: 0.55, h: 0.06 },
  ],
};
function substrateHeight(x, z) {
  // Gently sloped toward the viewer, with fine unevenness and mounds around plantings.
  let h = 0.17 + 0.10 * smoothstep(2.0, -2.0, z);
  h += 0.022 * fbm(SUBSTRATE.noise, x * 1.1 + 10, z * 1.1 + 10, 3);
  for (let i = 0; i < SUBSTRATE.mounds.length; i++) {
    const m = SUBSTRATE.mounds[i];
    const dx = x - m.x, dz = z - m.z;
    h += m.h * Math.exp(-(dx * dx + dz * dz) / (m.r * m.r));
  }
  return h;
}
function substrateNormal(x, z, out) {
  const e = 0.03;
  const hx = substrateHeight(x + e, z) - substrateHeight(x - e, z);
  const hz = substrateHeight(x, z + e) - substrateHeight(x, z - e);
  return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
}

// --- the shared current: a gentle drift everywhere plus a localized updraft at the plume ---
const PLUME = new THREE.Vector3(LAYOUT.filter.x, 1.9, LAYOUT.filter.z);   // airlift outlet (updated by the filter)
const currentField = (function () {
  const tmp = new THREE.Vector3();
  return function currentField(x, y, z, t, out) {
    const sx = 0.035 * Math.sin(0.21 * t + z * 0.8) + 0.022 * Math.sin(0.13 * t + 1.7 + y * 0.5);
    const sz = 0.03 * Math.cos(0.17 * t + x * 0.6) + 0.016 * Math.cos(0.11 * t + 0.4);
    const dx = x - PLUME.x, dz = z - PLUME.z, dy = y - PLUME.y;
    const spread = 0.14 + 0.17 * Math.max(0, dy);
    const radial = Math.exp(-(dx * dx + dz * dz) / (spread * spread));
    const up = 0.95 * radial * smoothstep(-0.15, 0.45, dy);
    // weak inward entrainment near the base of the plume
    const d = Math.hypot(dx, dz);
    const pull = 0.06 * Math.exp(-(d * d) / 0.5) * (1 - smoothstep(-0.2, 0.9, dy)) * (d > 1e-4 ? 1 / d : 0);
    return out.set(sx - dx * pull, up, sz - dz * pull);
  };
})();

// GLSL twin of the CPU field (plants, particles and fins sample it on the GPU).
const CURRENT_GLSL = /* glsl */`
uniform vec3 uPlume;
vec3 currentField(vec3 p, float t) {
  float sx = 0.035 * sin(0.21 * t + p.z * 0.8) + 0.022 * sin(0.13 * t + 1.7 + p.y * 0.5);
  float sz = 0.03 * cos(0.17 * t + p.x * 0.6) + 0.016 * cos(0.11 * t + 0.4);
  vec2 dp = p.xz - uPlume.xz;
  float dy = p.y - uPlume.y;
  float spread = 0.14 + 0.17 * max(dy, 0.0);
  float radial = exp(-dot(dp, dp) / (spread * spread));
  float up = 0.95 * radial * smoothstep(-0.15, 0.45, dy);
  float d = length(dp);
  float pull = 0.06 * exp(-(d * d) / 0.5) * (1.0 - smoothstep(-0.2, 0.9, dy)) / max(d, 1e-3);
  return vec3(sx - dp.x * pull, up, sz - dp.y * pull);
}`;
