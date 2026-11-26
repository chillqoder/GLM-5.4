// Level view: static terrain + scenery built from level data, and dynamic object views synced
// from the authoritative world state every frame. Rendering never determines collisions.
import * as THREE from '../../vendor/three.module.js';
import { GeoBuilder, voxelMesh, voxelGeometry, voxelMaterial, glowMaterial } from './voxel.js';
import { PALETTE as C, makeSignTexture, makeGlyphTexture, makeHaloTexture } from './textures.js';
import * as M from './models.js';
import { makeRng } from '../sim/math.js';

const Z_BACK = -2.5;
const Z_FRONT = 0;

export class LevelView {
  constructor(scene, level, textures, halo) {
    this.scene = scene;
    this.level = level;
    this.T = textures;
    this.halo = halo;
    this.group = new THREE.Group();
    this.parallax = [];
    this.dynamic = {};
    this.animated = [];
    this.markerSprites = {};
    this.conduitMats = {};
    this.buildTerrain();
    this.buildSeams();
    this.buildScenery();
    this.buildSigns();
    this.buildMarkers();
    this.buildConduits();
    this.buildDynamic();
    scene.add(this.group);
  }

  material(map, opts = {}) {
    return new THREE.MeshLambertMaterial({ map, vertexColors: true, ...opts });
  }

  // ------------------------------------------------------------- terrain
  buildTerrain() {
    const L = this.level;
    const T = this.T;
    const byType = { stone: new GeoBuilder({ textured: true, uvScale: 0.5 }), rock: new GeoBuilder({ textured: true, uvScale: 0.5 }), metal: new GeoBuilder({ textured: true, uvScale: 0.5 }) };
    for (const s of L.solids) {
      const b = byType[s.type] || byType.rock;
      const shade = (px, py) => Math.min(1.08, Math.max(0.55, 0.72 + ((py - s.y1) / Math.max(1, s.y2 - s.y1)) * 0.36));
      b.box(s.x1, s.y1, Z_BACK, s.x2, s.y2, Z_FRONT, 0xffffff, { shade });
    }
    const matStone = this.material(T.stone);
    const matRock = this.material(T.rock);
    const matMetal = this.material(T.metal);
    const mats = { stone: matStone, rock: matRock, metal: matMetal };
    for (const [type, b] of Object.entries(byType)) {
      if (b.empty) continue;
      const mesh = new THREE.Mesh(b.build(), mats[type]);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.group.add(mesh);
    }
    // Walkable edge trim: lighter strips along exposed tops.
    const trim = new GeoBuilder();
    for (const s of L.solids) {
      const intervals = [[s.x1, s.x2]];
      for (const o of L.solids) {
        if (o === s || Math.abs(o.y1 - s.y2) > 0.01) continue;
        const next = [];
        for (const [a, b] of intervals) {
          if (o.x2 <= a || o.x1 >= b) {
            next.push([a, b]);
            continue;
          }
          if (o.x1 > a) next.push([a, o.x1]);
          if (o.x2 < b) next.push([o.x2, b]);
        }
        intervals.splice(0, intervals.length, ...next);
      }
      const col = s.type === 'rock' ? 0x6b7c8c : C.trim;
      for (const [a, b] of intervals) if (b - a > 0.15) trim.box(a, s.y2 - 0.1, Z_FRONT, b, s.y2, Z_FRONT + 0.08, col);
    }
    const trimMesh = new THREE.Mesh(trim.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    trimMesh.receiveShadow = true;
    this.group.add(trimMesh);
    // Foreground silhouettes below floor level only (never over landing surfaces).
    const fg = new GeoBuilder();
    const rng = makeRng(7);
    for (const s of L.solids) {
      if (s.y2 > -0.5 && s.type !== 'rock') {
        const n = Math.floor((s.x2 - s.x1) / 3);
        for (let i = 0; i < n; i++) {
          const x = s.x1 + rng() * (s.x2 - s.x1);
          const h = 0.3 + rng() * 0.8;
          fg.box(x, s.y2 - h - 0.6, 1.6, x + 0.8 + rng() * 1.6, s.y2 - 0.6, 2.2, 0x0b1016);
        }
      }
    }
    const fgMesh = new THREE.Mesh(fg.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.group.add(fgMesh);
  }

  buildSeams() {
    this.seamViews = {};
    for (const s of this.level.seams) {
      const geo = new THREE.BoxGeometry(s.x2 - s.x1, s.y2 - s.y1, Z_FRONT - Z_BACK + 0.1);
      // World-scaled UVs for the seam texture
      const uv = geo.attributes.uv;
      const pos = geo.attributes.position;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (pos.getX(i) + (s.x1 + s.x2) / 2) * 0.5, (pos.getY(i) + (s.y1 + s.y2) / 2) * 0.5);
      }
      const mat = new THREE.MeshLambertMaterial({ map: s.veiled ? this.T.seamVeiled : this.T.seam, emissive: 0x000000 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, (Z_FRONT + Z_BACK) / 2 + 0.05);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(s.x2 - s.x1 + 0.3, s.y2 - s.y1 + 0.3), new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.position.set((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, Z_FRONT + 0.12);
      this.group.add(mesh, glow);
      this.seamViews[s.id] = { mesh, mat, glow, def: s };
    }
  }

  // ------------------------------------------------------------- scenery
  addParallax(obj, factor) {
    this.parallax.push({ obj, factor });
    this.group.add(obj);
  }

  buildScenery() {
    const T = this.T;
    const L = this.level;
    // Back wall per region with a subtle tint
    const wallGeo = new THREE.PlaneGeometry(1, 1);
    const wallTints = { workshop: 0x9a8f80, reservoir: 0x8fb8c4, foundry: 0xb09a80, ascent: 0x9aa4b0 };
    for (const r of L.regions) {
      const mat = new THREE.MeshLambertMaterial({ map: T.backWall.clone(), color: wallTints[r.id] || 0xffffff });
      mat.map.repeat.set((r.x2 - r.x1) / 2, 40);
      mat.map.needsUpdate = true;
      const wall = new THREE.Mesh(wallGeo, mat);
      wall.scale.set(r.x2 - r.x1, 80, 1);
      wall.position.set((r.x1 + r.x2) / 2, 12, -3.6);
      this.group.add(wall);
    }
    // Far silhouettes (parallax 0.55)
    const far = new THREE.Group();
    const farB = new GeoBuilder();
    const rng = makeRng(3);
    for (let x = -16; x < 212; x += 2.5) {
      const h = 6 + rng() * 16;
      farB.box(x, -14, -9.5, x + 1.4 + rng() * 2, -14 + h, -8.5, 0x0c131a);
      if (rng() < 0.4) farB.box(x - 0.5, 30 + rng() * 8, -9.5, x + 2, 50, -8.5, 0x0c131a);
    }
    far.add(new THREE.Mesh(farB.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
    this.addParallax(far, 0.55);

    // Mid silhouettes (parallax 0.3)
    const mid = new THREE.Group();
    const midB = new GeoBuilder();
    const rng2 = makeRng(5);
    for (let x = -12; x < 206; x += 4.5) {
      const h = 4 + rng2() * 10;
      midB.box(x, -13, -3.2, x + 1.2 + rng2() * 2.5, -13 + h, -2.9, 0x141c25);
      if (rng2() < 0.35) midB.box(x, 20 + rng2() * 10, -3.2, x + 2.5, 50, -2.9, 0x141c25);
    }
    mid.add(new THREE.Mesh(midB.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
    this.addParallax(mid, 0.3);

    const stoneMat = new THREE.MeshLambertMaterial({ map: T.stone.clone(), color: 0x8a8f96 });
    stoneMat.map.repeat.set(0.5, 0.5);
    const rockMat = new THREE.MeshLambertMaterial({ map: T.rock.clone(), color: 0x9aa4ae });
    rockMat.map.repeat.set(0.5, 0.5);
    const dark = voxelMaterial();

    // --- Workshop: columns, cables, benches, pipes, dust shafts
    const ws = new GeoBuilder();
    for (const x of [1.5, 21, 41, 57]) {
      ws.box(x - 0.6, 0, -1.9, x + 0.6, 9, -0.9, 0x6f7782);
      ws.box(x - 0.8, 0, -2.0, x + 0.8, 0.4, -0.8, 0x5c646e);
      ws.box(x - 0.8, 8.4, -2.0, x + 0.8, 9, -0.8, 0x5c646e);
    }
    for (let x = -6; x < 62; x += 4) {
      const len = 1.5 + rng() * 3;
      ws.box(x, 9 - len, -1.3, x + 0.06, 9, -1.3, 0x15181c); // hanging cables
      ws.box(x + 0.06, 9 - len, -1.3, x + 1.2, 9 - len + 0.06, -1.3, 0x15181c);
    }
    // benches
    for (const bx of [5.5, 47, 53]) {
      ws.box(bx - 1, 0.7, -2.1, bx + 1, 0.85, -1.2, 0x6b5a3c);
      ws.box(bx - 0.9, 0, -2.05, bx - 0.75, 0.7, -1.25, 0x3a3a3a);
      ws.box(bx + 0.75, 0, -2.05, bx + 0.9, 0.7, -1.25, 0x3a3a3a);
      ws.box(bx - 0.5, 0.85, -1.8, bx - 0.1, 1.0, -1.5, 0x8a6a3a);
      ws.box(bx + 0.2, 0.85, -1.9, bx + 0.6, 0.95, -1.6, 0x4a5058);
    }
    // pipes along the back
    ws.box(-8, 7.6, -2.45, 64, 7.9, -2.2, 0x5a4a30);
    for (let x = -6; x < 64; x += 6) ws.box(x, 7.5, -2.5, x + 0.3, 8.0, -2.15, 0x7a6a4a);
    this.group.add(new THREE.Mesh(ws.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    for (const dx of [12, 34, 52]) this.dustShaft(dx, 9, 6);

    // --- Reservoir: crystals, stalactites, pools, waterfall, bridges, veins
    const cryMat = new THREE.MeshLambertMaterial({ color: 0x7fd0dc, emissive: 0x1d5f6a, transparent: true, opacity: 0.9 });
    const cryCore = glowMaterial(0xbdf6ff);
    const clusterAt = (x, y, z, seed, scale) => {
      for (const c of M.crystalCluster(seed, scale)) {
        const geo = new THREE.BoxGeometry(c.w, c.h, c.w);
        const mesh = new THREE.Mesh(geo, cryMat);
        mesh.position.set(x + c.x, y + c.h / 2, z + c.z);
        mesh.rotation.z = c.tilt;
        this.group.add(mesh);
        const core = new THREE.Mesh(new THREE.BoxGeometry(c.w * 0.3, c.h * 0.7, c.w + 0.01), cryCore);
        core.position.copy(mesh.position);
        core.rotation.z = c.tilt;
        core.material = new THREE.MeshBasicMaterial({ color: 0xbdf6ff, transparent: true, opacity: 0.55 });
        this.group.add(core);
        this.animated.push({ type: 'crystal', mesh: core, phase: x * 0.7 + c.x });
      }
    };
    for (const [x, y, z, s, sc] of [[70.5, -4.5, -1.8, 1, 0.7], [78.6, -4.5, -1.9, 2, 0.6], [89.6, -4.5, -1.8, 3, 0.8], [96, -4.5, -2.0, 4, 0.6], [106, -4.5, -1.9, 5, 0.7], [110.5, -4.5, -1.8, 6, 0.5], [73, 7, -2.2, 7, 0.5], [97, 5, -2.1, 8, 0.5]]) clusterAt(x, y, z, s, sc);
    const bg = new GeoBuilder();
    for (const [x, s] of [[71, 11], [84, 12], [92, 13], [101, 14], [109, 15]]) clusterAt(x, -4.5, -3.1, s, 1.6);
    // stalactites
    for (const [x, h] of [[68, 4], [79, 3], [86, 5], [95, 2.5], [103, 3.5], [111, 4]]) {
      bg.box(x - 0.6, 12 - h, -2.0, x + 0.6, 12, -0.9, 0x2a343f);
      bg.box(x - 0.35, 12 - h - 0.8, -1.9, x + 0.35, 12 - h, -1.0, 0x2a343f);
      bg.box(x - 0.15, 12 - h - 1.4, -1.8, x + 0.15, 12 - h - 0.8, -1.1, 0x2a343f);
    }
    // background access bridges
    for (const [x1, x2, y] of [[90, 100, 3], [100, 110, 6.5]]) {
      bg.box(x1, y, -3.0, x2, y + 0.3, -2.2, 0x3b434d);
      bg.box(x1, y + 1.0, -2.3, x2, y + 1.1, -2.2, 0x5c6875);
      for (let x = x1; x <= x2; x += 2.5) bg.box(x, y + 0.3, -2.3, x + 0.08, y + 1.0, -2.2, 0x5c6875);
    }
    // mineral veins on the back wall
    const veins = new GeoBuilder();
    for (let i = 0; i < 40; i++) {
      const x = 66 + rng() * 46;
      const y = -4 + rng() * 14;
      veins.box(x, y, -3.55, x + 0.6 + rng() * 1.4, y + 0.06, -3.5, 0x3fb8c8);
    }
    this.group.add(new THREE.Mesh(bg.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    this.group.add(new THREE.Mesh(veins.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
    this.waterMeshes = [];
    for (const w of L.water) {
      const deep = !!w.deep;
      const mat = new THREE.MeshPhongMaterial({ map: (deep ? T.waterDeep : T.water).clone(), transparent: true, opacity: deep ? 0.9 : 0.75, shininess: 90, specular: 0x88ccdd, depthWrite: false });
      mat.map.repeat.set((w.x2 - w.x1) / 2, 1);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.x2 - w.x1, deep ? 0.06 : 0.04, deep ? 2.7 : 1.6), mat);
      mesh.position.set((w.x1 + w.x2) / 2, w.surface - 0.03, deep ? -1.1 : w.z);
      this.group.add(mesh);
      this.waterMeshes.push({ mesh, deep, speed: deep ? 0.05 : 0.12 });
      if (deep) {
        const bed = new THREE.Mesh(new THREE.BoxGeometry(w.x2 - w.x1, 5, 2.7), new THREE.MeshLambertMaterial({ color: 0x0c2a34, transparent: true, opacity: 0.75 }));
        bed.position.set((w.x1 + w.x2) / 2, w.surface - 2.5, -1.1);
        this.group.add(bed);
      }
    }
    // waterfall (background)
    const wfMat = new THREE.MeshBasicMaterial({ map: T.water.clone(), color: 0x9fdde8, transparent: true, opacity: 0.35, depthWrite: false });
    wfMat.map.repeat.set(0.5, 8);
    const wf = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 17), wfMat);
    wf.position.set(84.5, 3.5, -3.2);
    this.group.add(wf);
    this.waterfall = wfMat;

    // --- Foundry: presses, pistons, pipes, cooling channels, counterweight, suspended platforms
    const fd = new GeoBuilder();
    for (const px of [125.5, 131.5, 146.5, 156]) {
      fd.box(px - 1.6, -2.5, -3.2, px - 1.2, 14, -2.2, 0x3b434d);
      fd.box(px + 1.2, -2.5, -3.2, px + 1.6, 14, -2.2, 0x3b434d);
      fd.box(px - 1.6, 13.4, -3.2, px + 1.6, 14, -2.2, 0x3b434d);
      fd.box(px - 1.0, 11, -3.0, px + 1.0, 13.4, -2.4, 0x5c6875);
    }
    for (let x = 122; x < 166; x += 7) fd.box(x, 15.2, -2.6, x + 0.4, 15.8, -2.3, 0x7a6a4a);
    fd.box(122, 15.1, -2.7, 166, 15.4, -2.2, 0x5a4a30);
    for (const [x1, x2, y] of [[123, 140, 8], [141, 152, 12], [155, 166, 9.5]]) {
      fd.box(x1, y, -2.9, x2, y + 0.25, -2.3, 0x4a5460);
      for (let x = x1 + 0.5; x < x2; x += 3) fd.box(x, y + 0.25, -2.6, x + 0.06, y + 6, -2.55, 0x15181c);
    }
    this.group.add(new THREE.Mesh(fd.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    // cooling channels: glowing orange strips at the back
    const cool = new GeoBuilder();
    for (const [x1, x2, y] of [[122, 134, -1.5], [135, 150, -1.6], [153, 166, 6.2]]) cool.box(x1, y, -3.45, x2, y + 0.15, -3.4, 0xff6a20);
    this.group.add(new THREE.Mesh(cool.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 })));
    // pistons (cosmetic animation)
    this.pistons = [];
    for (const px of [125.5, 146.5]) {
      const piston = new THREE.Mesh(new THREE.BoxGeometry(0.9, 4, 0.8), new THREE.MeshLambertMaterial({ color: 0x7a838f }));
      piston.position.set(px, 9, -2.7);
      this.group.add(piston);
      this.pistons.push({ mesh: piston, phase: px });
    }
    // counterweight for the lift
    this.counterweight = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 0.8), new THREE.MeshLambertMaterial({ color: 0x2a2f36 }));
    this.counterweight.position.set(154.6, 0, -2.0);
    this.group.add(this.counterweight);
    this.counterCable = new THREE.Mesh(new THREE.BoxGeometry(0.05, 30, 0.05), new THREE.MeshBasicMaterial({ color: 0x15181c }));
    this.counterCable.position.set(154.6, 15, -2.0);
    this.group.add(this.counterCable);

    // --- Ascent: shaft machinery, pale opening, terrace ruins, sky
    const asc = new GeoBuilder();
    for (let y = 3; y < 44; y += 3.5) {
      asc.box(172.6, y, -2.4, 173.4, y + 0.3, -1.6, 0x4a5460);
      asc.box(186.1, y, -2.4, 186.9, y + 0.3, -1.6, 0x4a5460);
      asc.box(191.1, y + 1.5, -2.4, 191.9, y + 1.8, -1.6, 0x4a5460);
    }
    for (const [x, h] of [[194, 3.5], [197.5, 2.2], [200.5, 4.2]]) {
      asc.box(x - 0.4, 45, -2.0, x + 0.4, 45 + h, -1.2, 0x8a7a66);
      asc.box(x - 0.55, 45 + h, -2.1, x + 0.55, 45 + h + 0.3, -1.1, 0x6c604f);
      asc.box(x + 0.1, 45 + h - 0.6, -2.0, x + 0.5, 45 + h, -1.2, 0x8a7a66);
    }
    asc.box(191.5, 45.9, -2.2, 203, 46.0, -1.9, 0x6c604f);
    for (let x = 192; x < 203; x += 1.5) asc.box(x, 45, -2.15, x + 0.1, 45.9, -1.95, 0x6c604f);
    this.group.add(new THREE.Mesh(asc.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    // pale opening far above
    this.opening = new THREE.Mesh(new THREE.PlaneGeometry(7, 6), new THREE.MeshBasicMaterial({ color: 0xdfe9f2, transparent: true, opacity: 0.55, depthWrite: false }));
    this.opening.position.set(189.5, 49, -4);
    this.group.add(this.opening);
    this.openingHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.halo, color: 0xcfe3ee, transparent: true, opacity: 0.35, depthWrite: false }));
    this.openingHalo.scale.set(16, 12, 1);
    this.openingHalo.position.set(189.5, 48, -3.5);
    this.group.add(this.openingHalo);
    // sky above the terrace (warm dawn gradient)
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 4;
    skyCanvas.height = 64;
    const sctx = skyCanvas.getContext('2d');
    const grad = sctx.createLinearGradient(0, 64, 0, 0);
    grad.addColorStop(0, '#ffe2b8');
    grad.addColorStop(0.45, '#f2c9a0');
    grad.addColorStop(1, '#9fb6c9');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 4, 64);
    const skyTex = new THREE.CanvasTexture(skyCanvas);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(40, 22), new THREE.MeshBasicMaterial({ map: skyTex, transparent: true, opacity: 0, depthWrite: false }));
    this.sky.position.set(196, 56, -8);
    this.group.add(this.sky);
    // lamps
    this.lamps = [];
    for (const l of L.lamps) {
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.4), new THREE.MeshLambertMaterial({ color: 0x3b434d }));
      housing.position.set(l.x, l.y, -1.0);
      this.group.add(housing);
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: l.color }));
      bulb.position.set(l.x, l.y - 0.2, -0.95);
      this.group.add(bulb);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.halo, color: l.color, transparent: true, opacity: 0.35, depthWrite: false }));
      halo.scale.set(4, 4, 1);
      halo.position.set(l.x, l.y - 0.2, -0.9);
      this.group.add(halo);
      this.lamps.push({ ...l, halo, bulb });
    }
  }

  dustShaft(x, top, len) {
    const mat = new THREE.MeshBasicMaterial({ map: this.halo, color: 0xffe0b0, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, len), mat);
    m.position.set(x, top - len / 2, -1.0);
    this.group.add(m);
  }

  buildSigns() {
    for (const s of this.level.signs) {
      const { texture, width } = makeSignTexture(s.text);
      const h = 0.5;
      const w = width * h;
      const geo = new THREE.BoxGeometry(w, h, 0.08);
      // text on the front face only: use a material array
      const front = new THREE.MeshBasicMaterial({ map: texture });
      const side = new THREE.MeshLambertMaterial({ color: 0x1a1f26 });
      const mesh = new THREE.Mesh(geo, [side, side, side, side, front, side]);
      mesh.position.set(s.x, s.y, -0.8);
      this.group.add(mesh);
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), side);
      bracket.position.set(s.x, s.y + h / 2 + 0.25, -0.84);
      this.group.add(bracket);
    }
  }

  buildMarkers() {
    for (const mk of this.level.pulseMarkers) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlyphTexture(mk.hint), color: mk.hint === 'relay' ? C.amber : C.crystalCore, transparent: true, opacity: 0.18, depthWrite: false }));
      sp.scale.set(0.7, 0.7, 1);
      sp.position.set(mk.x, mk.y, -0.5);
      this.group.add(sp);
      this.markerSprites[mk.id] = { sprite: sp, base: mk.hint === 'relay' ? C.amber : C.crystalCore };
    }
  }

  buildConduits() {
    this.conduits = [];
    for (const cd of this.level.conduits) {
      const group = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0x3a2a14 });
      const lit = new THREE.MeshBasicMaterial({ color: C.amber });
      const pts = cd.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[i + 1];
        const len = Math.hypot(x2 - x1, y2 - y1);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(x1 === x2 ? 0.14 : len, y1 === y2 ? 0.14 : len, 0.14), mat);
        seg.position.set((x1 + x2) / 2, (y1 + y2) / 2, -2.9);
        group.add(seg);
      }
      this.group.add(group);
      this.conduits.push({ relay: cd.relay, group, mat, lit, on: false });
    }
  }

  // ------------------------------------------------------------- dynamic objects
  buildDynamic() {
    const L = this.level;
    const d = this.dynamic;
    d.shutters = {};
    for (const sh of L.shutters) {
      const mesh = M.createShutterMesh(sh.closed);
      mesh.material = new THREE.MeshLambertMaterial({ map: this.T.shutter });
      this.group.add(mesh);
      d.shutters[sh.id] = mesh;
    }
    d.movers = {};
    for (const mv of L.movers) {
      const g = mv.id === L.lift.mover ? M.createLiftCar(mv.w, mv.h) : mv.id === 'M_L' ? M.createLiftCar(mv.w, mv.h) : M.createPlatform(mv.w, mv.h);
      this.group.add(g);
      d.movers[mv.id] = g;
    }
    d.cells = {};
    for (const c of L.cells) {
      const g = M.createCell();
      this.group.add(g);
      d.cells[c.id] = g;
    }
    d.sockets = {};
    for (const s of L.sockets) {
      const g = M.createSocket();
      g.position.set(s.x, s.y, -0.3);
      this.group.add(g);
      d.sockets[s.id] = { g, def: s };
    }
    d.relays = {};
    for (const r of L.relays) {
      const g = M.createRelay();
      g.position.set(r.x, r.y - 1.2, -0.5);
      this.group.add(g);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.halo, color: C.crystalCore, transparent: true, opacity: 0.0, depthWrite: false }));
      halo.scale.set(6, 6, 1);
      halo.position.set(r.x, r.y + 0.3, -0.3);
      this.group.add(halo);
      d.relays[r.id] = { g, halo, def: r };
    }
    d.stations = {};
    for (const s of L.stations) {
      const g = M.createStation();
      g.position.set(s.x, s.y, -0.6);
      this.group.add(g);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.halo, color: C.teal, transparent: true, opacity: 0.0, depthWrite: false }));
      halo.scale.set(5, 5, 1);
      halo.position.set(s.x - 0.25, s.y + 1.8, -0.4);
      this.group.add(halo);
      d.stations[s.id] = { g, halo, def: s };
    }
    d.switches = {};
    for (const s of L.switches) {
      const g = M.createSwitch();
      g.position.set(s.x, s.y, -0.5);
      this.group.add(g);
      d.switches[s.id] = { g, def: s };
    }
    d.archives = {};
    for (const a of L.archives) {
      const g = M.createArchive();
      g.position.set(a.x, a.y, -0.9);
      this.group.add(g);
      d.archives[a.id] = { g, def: a };
    }
    d.caches = {};
    for (const c of L.caches) {
      const g = M.createCache();
      g.position.set(c.x, c.y, -0.6);
      this.group.add(g);
      d.caches[c.id] = { g, def: c };
    }
    d.vents = {};
    for (const v of L.vents) {
      const g = M.createVent(v.x2 - v.x1);
      g.position.set((v.x1 + v.x2) / 2 - (v.x2 - v.x1) / 2, v.y, -0.2);
      this.group.add(g);
      d.vents[v.id] = { g, def: v };
    }
    d.enemies = {};
    for (const e of L.enemies) {
      let rig;
      if (e.type === 'skitter') rig = M.createSkitter();
      else if (e.type === 'drone') rig = M.createDrone();
      else rig = M.createSentinel(e);
      this.group.add(rig.root);
      d.enemies[e.id] = { rig, def: e };
    }
    this.ilo = M.createILO();
    this.group.add(this.ilo.root);
  }

  /** Nearest light sources for the renderer's small pool of real lights. */
  lightSources(world, x) {
    const out = [];
    for (const l of this.lamps) out.push({ x: l.x, y: l.y - 0.3, color: l.color, intensity: 1.1, dist: Math.abs(l.x - x) });
    for (const [id, s] of Object.entries(world.stations)) {
      if (!s.active) continue;
      const def = this.dynamic.stations[id].def;
      out.push({ x: def.x, y: def.y + 1.6, color: C.teal, intensity: 1.4, dist: Math.abs(def.x - x) });
    }
    for (const r of this.level.relays) {
      const st = world.relays[r.id];
      out.push({ x: r.x, y: r.y + 0.3, color: st.active ? C.crystalCore : 0x2a6a72, intensity: st.active ? 1.6 : 0.5, dist: Math.abs(r.x - x) });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, 4);
  }

  /** Sync all dynamic views with the authoritative state. */
  update(world, player, dt, time, ctx) {
    const d = this.dynamic;
    const lens = M.lensMats;
    // Shutters
    for (const sh of this.level.shutters) {
      const r = world.shutters[sh.id].rect;
      const mesh = d.shutters[sh.id];
      mesh.position.set((r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2, -0.45);
      mesh.visible = world.shutters[sh.id].pos < 0.999;
    }
    // Movers
    for (const mv of this.level.movers) {
      const r = world.movers[mv.id].rect;
      const g = d.movers[mv.id];
      g.position.set(r.x1, r.y1, -0.9);
      const powered = mv.mode === 'pingpong' ? world.movers[mv.id].running : mv.mode === 'powered' ? world.movers[mv.id].pos !== mv.from : true;
      g.userData.strip.material = powered ? lens.amber : lens.amberDim;
      if (g.userData.barrier) g.userData.barrier.visible = world.lift.phase !== 'idle' && mv.id === this.level.lift.mover;
    }
    // Counterweight mirrors the lift car
    const carTop = world.movers.M_L.pos;
    this.counterweight.position.y = 1.2 - carTop * 0.9;
    // Cells
    for (const c of this.level.cells) {
      const st = world.cells[c.id];
      const g = d.cells[c.id];
      if (st.state === 'loose') {
        g.visible = true;
        g.position.set(st.x, st.y, 0.25);
        g.rotation.set(0, 0, 0);
        g.scale.set(1, 1, 1);
        this.ilo.carryAnchor.remove(g);
      } else if (st.state === 'carried') {
        g.visible = true;
        g.scale.set(0.8, 0.8, 0.8);
        if (g.parent !== this.ilo.carryAnchor) this.ilo.carryAnchor.add(g);
        g.position.set(0.1, -0.45, 0);
        g.rotation.set(0, 0, 0);
      } else {
        g.visible = true;
        g.scale.set(0.72, 0.72, 0.72);
        this.ilo.carryAnchor.remove(g);
        const sock = this.level.sockets.find((s) => s.id === st.socket);
        if (sock) {
          const pos = sock.mover ? { x: sock.x, y: world.movers[sock.mover].rect.y2 } : { x: sock.x, y: sock.y };
          g.position.set(pos.x, pos.y + 0.02, -0.18);
          g.rotation.set(0, 0, 0);
        }
      }
    }
    // Sockets
    for (const [id, { g, def }] of Object.entries(d.sockets)) {
      const powered = world.sockets[id].cell !== null;
      g.userData.slot.material = powered ? lens.amber : lens.off;
      g.userData.lamp.material = powered ? lens.amber : lens.off;
      if (def.mover) {
        const r = world.movers[def.mover].rect;
        g.position.set(def.x, r.y2, -0.3);
      }
    }
    // Relays
    for (const r of this.level.relays) {
      const v = d.relays[r.id];
      const st = world.relays[r.id];
      const powered = ctx.power.relayPowered(r.id);
      const hl = world.markers[`PM${['A', 'B', 'C'].indexOf(r.id) + 4}`]?.highlight > 0;
      const pulse = 0.5 + 0.5 * Math.sin(time * (st.active ? 6 : 2.2));
      v.g.userData.core.material = st.active ? lens.cyanBright : powered ? (pulse > 0.5 ? lens.cyan : lens.cyanDim) : lens.cyanDim;
      v.g.userData.crystal.material.emissive.setHex(st.active ? 0x3fb8c8 : powered ? 0x1f6a72 : 0x0e3a42);
      v.halo.material.opacity = st.active ? 0.35 + pulse * 0.2 : powered ? 0.08 : hl ? 0.12 : 0.0;
    }
    // Stations
    for (const [id, { g, halo, def }] of Object.entries(d.stations)) {
      const active = world.stations[id].active;
      g.userData.lamp.material = active ? lens.cyanBright : lens.cyanDim;
      halo.material.opacity = active ? 0.28 : 0;
      g.userData.ring.rotation.z = time * 0.8;
      g.userData.ring.material.opacity = active ? 0.5 : 0.12;
    }
    // Switches
    for (const [id, { g }] of Object.entries(d.switches)) {
      const on = world.switches[id].on;
      g.userData.lever.rotation.z = on ? -0.7 : 0.7;
      g.userData.lamp.material = on ? lens.amber : lens.off;
    }
    // Archives / caches
    for (const [id, { g, def }] of Object.entries(d.archives)) {
      const st = world.archives[id];
      g.visible = !st.collected;
      g.userData.screen.material = st.highlight > 0 ? lens.cyanBright : lens.cyan;
      g.userData.glyph.material.opacity = st.highlight > 0 ? 1 : 0.55 + 0.3 * Math.sin(time * 3);
    }
    for (const [id, { g }] of Object.entries(d.caches)) g.visible = !world.caches[id].collected;
    // Vents
    for (const [id, { g }] of Object.entries(d.vents)) M.animateVent(g, world.vents[id].stage, dt, time);
    // Seams
    for (const [id, v] of Object.entries(this.seamViews)) {
      const st = world.seams[id];
      v.mesh.visible = !st.broken;
      v.glow.visible = !st.broken;
      if (!st.broken) {
        const revealed = st.revealed;
        v.mat.map = revealed ? this.T.seam : this.T.seamVeiled;
        v.mat.emissive.setHex(revealed ? 0x3a2200 : 0x000000);
        v.glow.material.opacity = st.highlight > 0 ? 0.25 + 0.2 * Math.sin(time * 8) : 0;
      }
    }
    // Markers
    for (const [id, m] of Object.entries(this.markerSprites)) {
      const hl = world.markers[id]?.highlight > 0;
      m.sprite.material.opacity = hl ? 0.95 : 0.18;
    }
    // Conduits
    for (const cd of this.conduits) {
      const on = world.relays[cd.relay].active;
      if (on !== cd.on) {
        cd.on = on;
        for (const seg of cd.group.children) seg.material = on ? cd.lit : cd.mat;
      }
    }
    // Enemies
    for (const [id, { rig, def }] of Object.entries(d.enemies)) {
      const e = world.enemies[id];
      rig.root.visible = !e.disabled || (e.type === 'drone' && !rig.shards) || e.type !== 'drone';
      if (e.type === 'sentinel') {
        rig.root.position.set(def.x, def.y, 0.1);
        M.animateSentinel(rig, e, dt, time);
      } else if (e.type === 'skitter') {
        rig.root.position.set(e.x, e.y, 0.2);
        M.animateSkitter(rig, e, dt, time);
      } else {
        rig.root.position.set(e.x, e.y, 0.3);
        M.animateDrone(rig, e, dt, time, def);
      }
    }
    // Water / cosmetic animation
    for (const w of this.waterMeshes) w.mesh.material.map.offset.x = time * w.speed;
    if (this.waterfall) this.waterfall.map.offset.y = -time * 0.6;
    for (const a of this.animated) {
      if (a.type === 'crystal') a.mesh.material.opacity = 0.35 + 0.25 * Math.sin(time * 1.3 + a.phase);
    }
    for (const p of this.pistons) p.mesh.position.y = 9 + Math.sin(time * 0.9 + p.phase) * 1.6;
    for (const l of this.lamps) l.halo.material.opacity = 0.28 + 0.08 * Math.sin(time * 7 + l.x);
    // ILO
    const rig = this.ilo;
    rig.root.position.set(player.x, player.y, 0.25);
    M.animateILO(rig, player, { dt, time, state: ctx.state, carrying: !!player.carrying });
    if (ctx.events) {
      for (const ev of ctx.events) {
        if (ev.type === 'land' && ev.impact > 4) rig.land = 0.18;
        if (ev.type === 'damage') {
          rig.recoil = 0.35;
          rig.flicker = 0.3;
        }
        if (ev.type === 'pulse') rig.pulse = 0.4;
        if (ev.type === 'wallJump' || ev.type === 'jump') rig.land = 0;
      }
    }
    // Collapse follows shutdown/reboot presentation
    const st = ctx.state;
    if (st === 'shutdown') rig.collapse = Math.min(1, rig.collapse + dt * 3);
    else if (st === 'reboot') rig.collapse = Math.max(0, rig.collapse - dt * 1.4);
    else if (st === 'play' || st === 'paused' || st === 'title') {
      if (rig.collapse > 0 && st === 'play') rig.collapse = Math.max(0, rig.collapse - dt * 2);
    }
    // Parallax layers follow the camera partially
    const cam = ctx.cameraTarget;
    if (cam) {
      for (const p of this.parallax) p.obj.position.set(cam.x * p.factor, cam.y * p.factor * 0.5, 0);
    }
    // Dawn reveal during the ending
    const lift = world.lift;
    const revealK = lift.phase === 'reveal' ? Math.min(1, lift.t / 2.0) : lift.phase === 'done' ? 1 : 0;
    const riseK = lift.phase === 'ascend' ? Math.min(1, Math.max(0, (world.movers.M_FIN.pos - 19.6) / 25)) : lift.phase === 'idle' ? 0 : 1;
    this.sky.material.opacity = revealK * 0.95;
    this.opening.material.opacity = 0.35 + riseK * 0.4 + revealK * 0.25;
    this.openingHalo.material.opacity = 0.3 + riseK * 0.3 + revealK * 0.3;
    this.dawn = revealK;
    this.undergroundFade = riseK;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
}
