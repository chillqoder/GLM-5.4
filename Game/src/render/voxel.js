// Voxel geometry helpers: merged boxes with per-vertex colors or world-scaled UVs.
import * as THREE from '../../vendor/three.module.js';

// Each face: normal, 4 corners (0/1 in box space), CCW from outside.
const FACES = [
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: 'xy' },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uv: 'xy' },
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], uv: 'zy' },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], uv: 'zy' },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uv: 'xz' },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: 'xz' },
];
const FACE_INDEX = { front: 0, back: 1, right: 2, left: 3, top: 4, bottom: 5 };

export class GeoBuilder {
  constructor({ uvScale = 0.5, textured = false } = {}) {
    this.pos = [];
    this.norm = [];
    this.uv = [];
    this.col = [];
    this.textured = textured;
    this.uvScale = uvScale;
  }

  /**
   * Add an axis-aligned box. color: hex (or [r,g,b] 0..1). opts.faces: 'all' | array of names.
   * opts.shade: optional function (worldX, worldY) => brightness multiplier for vertex colors.
   */
  box(x1, y1, z1, x2, y2, z2, color = 0xffffff, opts = {}) {
    const faces = !opts.faces || opts.faces === 'all' ? FACES : opts.faces.map((f) => FACES[FACE_INDEX[f]]);
    const c = new THREE.Color(color);
    const s = this.uvScale;
    const lo = [x1, y1, z1];
    const size = [x2 - x1, y2 - y1, z2 - z1];
    for (const f of faces) {
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        const v = f.c[idx];
        const px = lo[0] + v[0] * size[0];
        const py = lo[1] + v[1] * size[1];
        const pz = lo[2] + v[2] * size[2];
        this.pos.push(px, py, pz);
        this.norm.push(f.n[0], f.n[1], f.n[2]);
        if (this.textured) {
          if (f.uv === 'xy') this.uv.push(px * s, py * s);
          else if (f.uv === 'zy') this.uv.push(pz * s, py * s);
          else this.uv.push(px * s, pz * s);
        }
        if (opts.shade) {
          const b = opts.shade(px, py, pz);
          this.col.push(c.r * b, c.g * b, c.b * b);
        } else {
          this.col.push(c.r, c.g, c.b);
        }
      }
    }
    return this;
  }

  /** Box from center + size. */
  cbox(cx, cy, cz, w, h, d, color, opts) {
    return this.box(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, color, opts);
  }

  get empty() {
    return this.pos.length === 0;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.textured) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

/** Build a merged voxel geometry from [cx, cy, cz, w, h, d, color] parts (center based). */
export function voxelGeometry(parts, opts = {}) {
  const b = new GeoBuilder(opts);
  for (const p of parts) b.cbox(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
  return b.build();
}

/** Shared, cached unlit materials for glowing accents. */
const basicCache = new Map();
export function glowMaterial(color) {
  let m = basicCache.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    basicCache.set(color, m);
  }
  return m;
}

let lambertVertex = null;
export function voxelMaterial() {
  if (!lambertVertex) lambertVertex = new THREE.MeshLambertMaterial({ vertexColors: true });
  return lambertVertex;
}

/** Mesh from voxel parts. */
export function voxelMesh(parts, material = voxelMaterial(), opts) {
  const m = new THREE.Mesh(voxelGeometry(parts, opts), material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Dispose every geometry under an Object3D (shared materials are left alone). */
export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
}
