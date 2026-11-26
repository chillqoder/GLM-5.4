// Procedural 16×16 pixel textures and palette. Everything is generated at runtime; no external assets.
import * as THREE from '../../vendor/three.module.js';
import { makeRng } from '../sim/math.js';

export const PALETTE = {
  bg: 0x101923,
  rock: 0x384552,
  rockDark: 0x2a343f,
  stone: 0x46525f,
  stoneLight: 0x566472,
  metal: 0x5c6875,
  metalDark: 0x3b434d,
  trim: 0xa9bccf,
  ivory: 0xe6e0d2,
  charcoal: 0x22262c,
  amber: 0xffa030,
  amberDim: 0x8a5a1a,
  crystal: 0x78dce8,
  crystalCore: 0xd8fbff,
  teal: 0x5fe8d8,
  hazard: 0xff5a2a,
  rust: 0xb4562a,
  cyan: 0x7fe6ff,
  bronze: 0x8a6a3a,
};

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function finish(c, { nearest = true, repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = false;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

function noiseFill(ctx, size, base, variants, rng, speckle = 0) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = variants[Math.floor(rng() * variants.length)];
      ctx.fillStyle = hex(v);
      ctx.fillRect(x, y, 1, 1);
      if (speckle && rng() < speckle) {
        ctx.fillStyle = hex(base);
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

const shade = (color, f) => {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return (r << 16) | (g << 8) | b;
};

export function createTextures() {
  const T = {};
  // Stone blocks with mortar lines (workshop floors and steps).
  T.stone = (() => {
    const c = canvas(16);
    const ctx = c.getContext('2d');
    const rng = makeRng(11);
    noiseFill(ctx, 16, PALETTE.stone, [PALETTE.stone, shade(PALETTE.stone, 1.1), shade(PALETTE.stone, 0.9)], rng, 0.08);
    ctx.fillStyle = hex(shade(PALETTE.stone, 0.6));
    ctx.fillRect(0, 7, 16, 1);
    ctx.fillRect(0, 15, 16, 1);
    ctx.fillRect(3, 0, 1, 7);
    ctx.fillRect(11, 8, 1, 7);
    ctx.fillStyle = hex(shade(PALETTE.stone, 1.25));
    ctx.fillRect(0, 0, 16, 1);
    return finish(c);
  })();
  // Cool slate rock (cavern walls).
  T.rock = (() => {
    const c = canvas(16);
    const ctx = c.getContext('2d');
    const rng = makeRng(23);
    noiseFill(ctx, 16, PALETTE.rock, [PALETTE.rock, shade(PALETTE.rock, 0.92), shade(PALETTE.rock, 1.08), shade(PALETTE.rock, 0.85)], rng, 0.1);
    ctx.fillStyle = hex(shade(PALETTE.rock, 0.7));
    for (let i = 0; i < 5; i++) ctx.fillRect(Math.floor(rng() * 16), Math.floor(rng() * 16), 2 + Math.floor(rng() * 2), 1);
    return finish(c);
  })();
  T.rockDark = (() => {
    const c = canvas(16);
    const ctx = c.getContext('2d');
    const rng = makeRng(29);
    noiseFill(ctx, 16, PALETTE.rockDark, [PALETTE.rockDark, shade(PALETTE.rockDark, 0.9), shade(PALETTE.rockDark, 1.1)], rng, 0.12);
    return finish(c);
  })();
  // Oxidized steel plates with rivets.
  T.metal = (() => {
    const c = canvas(16);
    const ctx = c.getContext('2d');
    const rng = makeRng(37);
    noiseFill(ctx, 16, PALETTE.metal, [PALETTE.metal, shade(PALETTE.metal, 0.94), shade(PALETTE.metal, 1.06)], rng, 0.05);
    ctx.fillStyle = hex(shade(PALETTE.metal, 0.6));
    ctx.fillRect(0, 0, 16, 1);
    ctx.fillRect(0, 8, 16, 1);
    ctx.fillRect(0, 0, 1, 16);
    ctx.fillRect(8, 0, 1, 16);
    ctx.fillStyle = hex(shade(PALETTE.metal, 1.35));
    ctx.fillRect(2, 2, 1, 1);
    ctx.fillRect(13, 2, 1, 1);
    ctx.fillRect(2, 11, 1, 1);
    ctx.fillRect(13, 11, 1, 1);
    ctx.fillStyle = hex(PALETTE.rust);
    if (rng() < 0.8) ctx.fillRect(5, 13, 2, 1);
    if (rng() < 0.8) ctx.fillRect(11, 5, 1, 2);
    return finish(c);
  })();
  T.metalDark = (() => {
    const c = canvas(16);
    const ctx = c.getContext('2d');
    const rng = makeRng(41);
    noiseFill(ctx, 16, PALETTE.metalDark, [PALETTE.metalDark, shade(PALETTE.metalDark, 0.9), shade(PALETTE.metalDark, 1.12)], rng, 0.1);
    ctx.fillStyle = hex(shade(PALETTE.metalDark, 0.55));
    ctx.fillRect(0, 7, 16, 1);
    return finish(c);
  })();
  // Cracked amber crystal seam.
  T.seam = (() => {
    const c = canvas(16);
    const ctx = c.getContext('2d');
    const rng = makeRng(53);
    noiseFill(ctx, 16, PALETTE.amber, [PALETTE.amber, shade(PALETTE.amber, 0.8), shade(PALETTE.amber, 1.15), shade(PALETTE.amber, 0.65)], rng);
    ctx.fillStyle = hex(shade(PALETTE.amber, 0.3));
    ctx.fillRect(3, 0, 1, 6);
    ctx.fillRect(4, 6, 1, 5);
    ctx.fillRect(5, 11, 1, 5);
    ctx.fillRect(10, 0, 1, 4);
    ctx.fillRect(11, 4, 1, 7);
    ctx.fillRect(12, 11, 1, 5);
    ctx.fillRect(0, 9, 3, 1);
    ctx.fillRect(13, 3, 3, 1);
    ctx.fillStyle = hex(PALETTE.ivory);
    ctx.fillRect(7, 2, 1, 3);
    ctx.fillRect(2, 12, 1, 2);
    return finish(c);
  })();
  // Veiled seam before reveal: looks like slate with faint amber hairline cracks.
  T.seamVeiled = (() => {
    const c = canvas(16);
    const ctx = c.getContext('2d');
    const rng = makeRng(59);
    noiseFill(ctx, 16, PALETTE.rock, [PALETTE.rock, shade(PALETTE.rock, 0.92), shade(PALETTE.rock, 1.08)], rng, 0.1);
    ctx.fillStyle = hex(shade(PALETTE.amber, 0.55));
    ctx.fillRect(4, 0, 1, 7);
    ctx.fillRect(5, 7, 1, 5);
    ctx.fillRect(11, 3, 1, 8);
    ctx.fillRect(2, 13, 4, 1);
    return finish(c);
  })();
  T.crystal = (() => {
    const c = canvas(16);
    const ctx = c.getContext('2d');
    const rng = makeRng(61);
    noiseFill(ctx, 16, PALETTE.crystal, [PALETTE.crystal, shade(PALETTE.crystal, 0.75), shade(PALETTE.crystal, 1.12)], rng);
    ctx.fillStyle = hex(PALETTE.crystalCore);
    ctx.fillRect(6, 2, 2, 12);
    ctx.fillRect(2, 7, 2, 2);
    return finish(c);
  })();
  // Hazard stripes for shutters.
  T.shutter = (() => {
    const c = canvas(16);
    const ctx = c.getContext('2d');
    const rng = makeRng(71);
    noiseFill(ctx, 16, PALETTE.metalDark, [PALETTE.metalDark, shade(PALETTE.metalDark, 0.92)], rng, 0.05);
    for (let i = -16; i < 16; i += 8) {
      ctx.fillStyle = hex(PALETTE.amberDim);
      for (let k = 0; k < 16; k++) ctx.fillRect(((i + k) & 15), k, 3, 1);
    }
    ctx.fillStyle = hex(shade(PALETTE.metalDark, 1.4));
    ctx.fillRect(0, 0, 16, 1);
    ctx.fillRect(0, 15, 16, 1);
    return finish(c);
  })();
  T.grate = (() => {
    const c = canvas(16);
    const ctx = c.getContext('2d');
    ctx.fillStyle = hex(PALETTE.metalDark);
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = hex(shade(PALETTE.metalDark, 0.5));
    for (let x = 1; x < 16; x += 4) ctx.fillRect(x, 0, 2, 16);
    ctx.fillStyle = hex(shade(PALETTE.metalDark, 1.5));
    for (let x = 3; x < 16; x += 4) ctx.fillRect(x, 0, 1, 16);
    return finish(c);
  })();
  T.water = (() => {
    const c = canvas(16);
    const ctx = c.getContext('2d');
    const rng = makeRng(83);
    noiseFill(ctx, 16, 0x1d4a56, [0x1d4a56, 0x235c68, 0x173e48], rng);
    ctx.fillStyle = hex(0x4fb8c8);
    ctx.fillRect(1, 3, 5, 1);
    ctx.fillRect(9, 8, 6, 1);
    ctx.fillRect(4, 13, 4, 1);
    return finish(c);
  })();
  T.waterDeep = (() => {
    const c = canvas(16);
    const ctx = c.getContext('2d');
    const rng = makeRng(89);
    noiseFill(ctx, 16, 0x0e2a36, [0x0e2a36, 0x123644, 0x0a2230], rng);
    ctx.fillStyle = hex(0x2a7f90);
    ctx.fillRect(2, 5, 4, 1);
    ctx.fillRect(10, 11, 5, 1);
    return finish(c);
  })();
  T.backWall = (() => {
    const c = canvas(16);
    const ctx = c.getContext('2d');
    const rng = makeRng(97);
    noiseFill(ctx, 16, 0x1a2530, [0x1a2530, 0x1d2a36, 0x17212c, 0x202e3a], rng, 0.15);
    return finish(c);
  })();
  T.terrace = (() => {
    const c = canvas(16);
    const ctx = c.getContext('2d');
    const rng = makeRng(101);
    noiseFill(ctx, 16, 0x8a7a66, [0x8a7a66, 0x96866f, 0x7c6e5c], rng, 0.1);
    ctx.fillStyle = hex(0x6c604f);
    ctx.fillRect(0, 7, 16, 1);
    ctx.fillRect(0, 15, 16, 1);
    ctx.fillRect(5, 0, 1, 7);
    ctx.fillRect(11, 8, 1, 7);
    return finish(c);
  })();
  return T;
}

/** Text plaque texture (linear filtering for legibility). Returns { texture, width, height }. */
export function makeSignTexture(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = 'bold 24px "Courier New", Courier, monospace';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 32;
  const h = 48;
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#141a22';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#6f8296';
  g.lineWidth = 4;
  g.strokeRect(2, 2, w - 4, h - 4);
  g.fillStyle = '#e6e0d2';
  g.font = font;
  g.textBaseline = 'middle';
  g.fillText(text, 18, h / 2 + 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return { texture: t, width: w / h, height: 1 }; // aspect in world units (height = 1 unit)
}

/** Soft radial halo sprite for lamps and glows. */
export function makeHaloTexture() {
  const c = canvas(64);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Glyph textures for pulse markers and context icons. */
export function makeGlyphTexture(kind) {
  const c = canvas(32);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 32, 32);
  ctx.fillStyle = '#ffffff';
  if (kind === 'archive') {
    ctx.fillRect(10, 6, 12, 20);
    ctx.fillRect(13, 10, 6, 2);
    ctx.fillRect(13, 15, 6, 2);
    ctx.fillRect(13, 20, 4, 2);
  } else if (kind === 'relay') {
    ctx.fillRect(14, 4, 4, 10);
    ctx.fillRect(8, 14, 16, 4);
    ctx.fillRect(12, 18, 8, 10);
  } else {
    ctx.beginPath();
    ctx.arc(16, 16, 10, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
