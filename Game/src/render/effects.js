// Transient effects: LOS-aware pulse ring, dash trail, fragments, shield facets, sparks, dust.
// Bounded pools; nothing accumulates across recoveries or restarts.
import * as THREE from '../../vendor/three.module.js';
import { PALETTE as C } from './textures.js';
import { getPulseBlockers } from '../sim/world.js';
import { segmentRectT } from '../sim/math.js';
import { TUNING as T } from '../sim/tuning.js';

const RING_DIRS = 72;

export class Effects {
  constructor(scene, halo, reducedMotion = false) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.reduced = reducedMotion;
    this.halo = halo;
    this.pulses = [];
    this.fragments = [];
    this.sparks = [];
    this.facets = [];
    this.dust = [];
    this.rings = [];
    this.shake = 0;
    this.buildPulseGeometry();
    this.buildFacets();
    scene.add(this.group);
    this.trailGeo = new THREE.BoxGeometry(0.6, 1.3, 0.3);
    this.fragGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    this.sparkGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    this.dustGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  }

  buildPulseGeometry() {
    const geo = new THREE.BufferGeometry();
    const n = RING_DIRS;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n * 4), 1));
    const idx = [];
    for (let i = 0; i < n; i++) {
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { color: { value: new THREE.Color(C.crystalCore) } },
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color, vA); }`,
    });
    this.pulseTemplate = { geo, mat };
    this.pulseMeshes = [];
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(geo.clone(), mat.clone());
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.pulseMeshes.push(mesh);
    }
  }

  buildFacets() {
    this.facetGeo = new THREE.PlaneGeometry(0.5, 0.5);
    this.facetMat = new THREE.MeshBasicMaterial({ color: C.crystalCore, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(this.facetGeo, this.facetMat.clone());
      m.visible = false;
      this.group.add(m);
      this.facets.push({ mesh: m, t: 0, ang: (i / 8) * Math.PI * 2, x: 0, y: 0 });
    }
  }

  setReducedMotion(v) {
    this.reduced = v;
  }

  // ------------------------------------------------------------- spawning
  spawnPulse(level, world, x, y) {
    const mesh = this.pulseMeshes.find((m) => !m.visible) || this.pulseMeshes[0];
    mesh.visible = true;
    mesh.position.set(x, y, 0.6);
    // Per-direction reach: the wave stops at the first thick obstruction.
    const blockers = getPulseBlockers(level, world);
    const reach = new Float32Array(RING_DIRS);
    for (let i = 0; i < RING_DIRS; i++) {
      const a = (i / RING_DIRS) * Math.PI * 2;
      let max = T.pulse.radius;
      const dx = Math.cos(a) * max;
      const dy = Math.sin(a) * max;
      for (const b of blockers) {
        const t = segmentRectT(x, y, x + dx, y + dy, b);
        if (t !== null && t < 1) max = Math.min(max, t * T.pulse.radius);
      }
      reach[i] = max;
    }
    this.pulses.push({ mesh, x, y, reach, t: 0, dur: T.pulse.duration });
    this.writeRing(this.pulses[this.pulses.length - 1]);
  }

  writeRing(p) {
    const pos = p.mesh.geometry.attributes.position;
    const alpha = p.mesh.geometry.attributes.alpha;
    const r = T.pulse.radius * Math.min(1, p.t / p.dur);
    const inner = Math.max(0, r - 0.28);
    const fade = 1 - p.t / p.dur;
    for (let i = 0; i < RING_DIRS; i++) {
      const a0 = (i / RING_DIRS) * Math.PI * 2;
      const a1 = ((i + 1) / RING_DIRS) * Math.PI * 2 + 0.004;
      const max = p.reach[i];
      const rOut = Math.min(r, max);
      const rIn = Math.min(inner, max);
      const vis = rOut > rIn ? 1 : 0;
      const b = i * 4;
      pos.setXYZ(b, p.x + Math.cos(a0) * rIn, p.y + Math.sin(a0) * rIn, 0);
      pos.setXYZ(b + 1, p.x + Math.cos(a1) * rIn, p.y + Math.sin(a1) * rIn, 0);
      pos.setXYZ(b + 2, p.x + Math.cos(a1) * rOut, p.y + Math.sin(a1) * rOut, 0);
      pos.setXYZ(b + 3, p.x + Math.cos(a0) * rOut, p.y + Math.sin(a0) * rOut, 0);
      const a = vis * (0.9 * fade + 0.1);
      alpha.setX(b, a);
      alpha.setX(b + 1, a);
      alpha.setX(b + 2, a);
      alpha.setX(b + 3, a);
    }
    pos.needsUpdate = true;
    alpha.needsUpdate = true;
  }

  spawnTrail(x, y, dir) {
    if (!this.trailPool) {
      this.trailPool = [];
      for (let i = 0; i < 8; i++) {
        const mesh = new THREE.Mesh(this.trailGeo, new THREE.MeshBasicMaterial({ color: 0xcfe9f5, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
        mesh.visible = false;
        this.group.add(mesh);
        this.trailPool.push({ mesh, t: 0 });
      }
      this.trailIndex = 0;
    }
    const e = this.trailPool[this.trailIndex++ % this.trailPool.length];
    e.mesh.visible = true;
    e.mesh.position.set(x, y + 0.75, 0.2);
    e.mesh.material.opacity = 0.35;
    e.t = 0.22;
  }

  spawnFragments(x, y, color, count = 10, dir = 0) {
    const n = this.reduced ? Math.min(4, count) : count;
    for (let i = 0; i < n; i++) {
      let f = this.fragments.find((e) => !e.mesh.visible);
      if (!f) {
        if (this.fragments.length >= 48) continue;
        const mesh = new THREE.Mesh(this.fragGeo, new THREE.MeshBasicMaterial({ color }));
        this.group.add(mesh);
        f = { mesh, vx: 0, vy: 0, t: 0, rot: 0 };
        this.fragments.push(f);
      }
      f.mesh.visible = true;
      f.mesh.material.color.setHex(color);
      f.mesh.position.set(x + (Math.random() - 0.5) * 0.5, y + (Math.random() - 0.5) * 0.8, 0.3);
      f.vx = (Math.random() - 0.5) * 6 + dir * 3;
      f.vy = 2 + Math.random() * 5;
      f.rot = Math.random() * 6;
      f.t = 0.7 + Math.random() * 0.4;
      f.mesh.scale.setScalar(0.6 + Math.random() * 1.2);
    }
  }

  spawnSparks(x, y, color, count = 6) {
    this.spawnFragments(x, y, color, this.reduced ? 3 : count, 0);
  }

  spawnShield(x, y) {
    for (const f of this.facets) {
      f.t = 0.4;
      f.x = x;
      f.y = y + 0.75;
    }
  }

  spawnDust(x, y, n = 4) {
    const count = this.reduced ? 2 : n;
    for (let i = 0; i < count; i++) {
      let d = this.dust.find((e) => !e.mesh.visible);
      if (!d) {
        if (this.dust.length >= 24) break;
        const mesh = new THREE.Mesh(this.dustGeo, new THREE.MeshBasicMaterial({ color: 0x8a94a0, transparent: true, opacity: 0.5, depthWrite: false }));
        this.group.add(mesh);
        d = { mesh, vx: 0, vy: 0, t: 0 };
        this.dust.push(d);
      }
      d.mesh.visible = true;
      d.mesh.position.set(x + (Math.random() - 0.5) * 0.5, y + 0.05, 0.4);
      d.vx = (Math.random() - 0.5) * 3;
      d.vy = 0.5 + Math.random() * 1.5;
      d.t = 0.4 + Math.random() * 0.3;
    }
  }

  spawnRing(x, y, color, maxR = 2.5, dur = 0.6) {
    let r = this.rings.find((e) => !e.mesh.visible);
    if (!r) {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.group.add(mesh);
      r = { mesh, t: 0, maxR, dur };
      this.rings.push(r);
    }
    r.mesh.visible = true;
    r.mesh.material.color.setHex(color);
    r.mesh.position.set(x, y, 0.5);
    r.t = dur;
    r.maxR = maxR;
    r.dur = dur;
  }

  addShake(amount) {
    if (!this.reduced) this.shake = Math.min(0.35, this.shake + amount);
  }

  /** Translate simulation events into effects. */
  handleEvents(events, level, world) {
    for (const e of events) {
      switch (e.type) {
        case 'pulse':
          this.spawnPulse(level, world, e.x, e.y);
          break;
        case 'pulseDenied':
          break;
        case 'dash':
          this.spawnTrail(e.x, e.y, e.dir);
          break;
        case 'seamBreak':
          this.spawnFragments(e.x, e.y, C.amber, 14, 0);
          this.addShake(0.08);
          break;
        case 'seamThud':
          this.spawnSparks(e.x, e.y, 0x9aa4ae, 4);
          break;
        case 'shield':
          this.spawnShield(e.x, e.y);
          this.spawnSparks(e.x, e.y + 0.75, C.crystalCore, 8);
          this.addShake(0.1);
          break;
        case 'damage':
          this.spawnSparks(e.x, e.y + 0.75, C.hazard, 10);
          this.addShake(0.22);
          break;
        case 'enemyStun':
          this.spawnSparks(e.x, e.y, C.crystalCore, 6);
          break;
        case 'enemyDisable':
          this.spawnFragments(e.x, e.y, e.enemy === 'sentinel' ? C.hazard : C.ivory, 16, 0);
          this.spawnSparks(e.x, e.y, C.amber, 8);
          this.addShake(0.12);
          break;
        case 'pulseDeflect':
          this.spawnSparks(e.x, e.y, C.amber, 8);
          break;
        case 'relayActivate':
          this.spawnRing(e.x, e.y, C.crystalCore, 4, 0.9);
          this.spawnSparks(e.x, e.y + 0.5, C.crystalCore, 14);
          break;
        case 'relayUnpowered':
          this.spawnSparks(e.x, e.y, 0x6a7a88, 5);
          break;
        case 'station':
          this.spawnRing(e.x, e.y + 1, C.teal, 2.2, 0.8);
          break;
        case 'archive':
          break;
        case 'land':
          if (e.impact > 6) this.spawnDust(e.x, e.y, e.impact > 14 ? 6 : 3);
          break;
        case 'wallJump':
          this.spawnDust(e.x, e.y + 0.2, 3);
          break;
        case 'boltImpact':
          this.spawnSparks(e.x, e.y, C.amber, 5);
          break;
        case 'crush':
        case 'shutdown':
          this.addShake(0.25);
          break;
        case 'vent_active':
          this.spawnDust(e.x, e.y, 3);
          break;
        case 'shutterOpen':
        case 'shutterClose':
          this.addShake(0.04);
          break;
        default:
          break;
      }
    }
  }

  update(dt, world, player, level) {
    // Pulse rings advance on their own deterministic timer (0.35 s), clipped per direction by LOS.
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt;
      this.writeRing(p);
      if (p.t >= p.dur) {
        p.mesh.visible = false;
        this.pulses.splice(i, 1);
      }
    }
    // Trail
    if (this.trailPool) {
      for (const t of this.trailPool) {
        if (!t.mesh.visible) continue;
        t.t -= dt;
        t.mesh.material.opacity = Math.max(0, t.t / 0.22) * 0.35;
        if (t.t <= 0) t.mesh.visible = false;
      }
    }
    // Fragments / sparks
    for (const f of this.fragments) {
      if (!f.mesh.visible) continue;
      f.t -= dt;
      f.vy -= 22 * dt;
      f.mesh.position.x += f.vx * dt;
      f.mesh.position.y += f.vy * dt;
      f.mesh.rotation.z += f.rot * dt;
      f.mesh.material.opacity = 1;
      f.mesh.scale.multiplyScalar(1 - dt * 0.6);
      if (f.t <= 0 || f.mesh.position.y < -14) f.mesh.visible = false;
    }
    for (const d of this.dust) {
      if (!d.mesh.visible) continue;
      d.t -= dt;
      d.mesh.position.x += d.vx * dt;
      d.mesh.position.y += d.vy * dt;
      d.mesh.material.opacity = Math.max(0, d.t) * 1.2;
      if (d.t <= 0) d.mesh.visible = false;
    }
    // Shield facets
    for (const f of this.facets) {
      if (f.t <= 0) {
        f.mesh.visible = false;
        continue;
      }
      f.t -= dt;
      const k = 1 - f.t / 0.4;
      f.mesh.visible = true;
      f.mesh.position.set(f.x + Math.cos(f.ang) * (0.9 + k * 0.6), f.y + Math.sin(f.ang) * (0.9 + k * 0.6), 0.7);
      f.mesh.rotation.z = f.ang + k * 1.5;
      f.mesh.scale.setScalar(1 - k * 0.6);
      f.mesh.material.opacity = (1 - k) * 0.9;
    }
    // Rings
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t -= dt;
      const k = 1 - r.t / r.dur;
      r.mesh.scale.setScalar(0.2 + k * r.maxR);
      r.mesh.material.opacity = Math.max(0, 1 - k) * 0.8;
      if (r.t <= 0) r.mesh.visible = false;
    }
    // Trail while dashing
    if (player.dashing > 0 && Math.floor(player.x * 20) % 2 === 0) this.spawnTrail(player.x, player.y, player.dashDir);
    this.shake = Math.max(0, this.shake - dt * 1.2);
  }

  clear() {
    for (const list of [this.trailPool || [], this.fragments, this.dust, this.facets, this.rings]) for (const e of list) e.mesh.visible = false;
    for (const m of this.pulseMeshes) m.visible = false;
    this.pulses.length = 0;
    this.shake = 0;
  }
}
