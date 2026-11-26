// Voxel models: ILO (articulated), the three machines, and interactive props.
// All models are built facing +x; the renderer mirrors them with scale.x for facing.
import * as THREE from '../../vendor/three.module.js';
import { voxelMesh, voxelGeometry, voxelMaterial, glowMaterial } from './voxel.js';
import { PALETTE } from './textures.js';
import { makeGlyphTexture } from './textures.js';

const C = PALETTE;
const ease = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, rate * dt);
const lerp = (a, b, t) => a + (b - a) * t;
const GLOW_OFF = 0x1a1d22;

// Lens / core brightness variants (materials swapped, never allocated per frame).
const lensMats = {
  amber: glowMaterial(C.amber),
  amberDim: glowMaterial(0x6a4410),
  off: glowMaterial(GLOW_OFF),
  cyan: glowMaterial(C.cyan),
  cyanBright: glowMaterial(C.crystalCore),
  cyanDim: glowMaterial(0x1f5a62),
  red: glowMaterial(C.hazard),
  redBright: glowMaterial(0xffb08a),
  white: glowMaterial(0xfff4e0),
};

function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------------------
// ILO
// ---------------------------------------------------------------------------
export function createILO() {
  const root = new THREE.Group();
  const pelvis = pivot(root, 0, 0.7, 0);
  const torso = pivot(pelvis, 0, 0, 0);
  const mat = voxelMaterial();
  const m = (parent, parts, x = 0, y = 0, z = 0) => {
    const mesh = voxelMesh(parts, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  // Torso, chest module, head
  m(torso, [
    [0, 0.2, 0, 0.46, 0.4, 0.34, C.ivory],
    [0, 0.06, 0, 0.5, 0.12, 0.36, C.charcoal], // waist
    [0, 0.36, 0, 0.4, 0.1, 0.3, C.ivory],
    [-0.1, 0.22, -0.19, 0.22, 0.26, 0.04, C.charcoal], // back plate
  ]);
  const chest = new THREE.Mesh(voxelGeometry([[0, 0, 0, 0.13, 0.13, 0.06, 0xffffff]]), lensMats.cyan);
  chest.position.set(0.06, 0.24, 0.18);
  torso.add(chest);

  const head = pivot(torso, 0, 0.47, 0);
  m(head, [
    [0, 0.17, 0, 0.5, 0.3, 0.42, C.ivory], // main
    [0, 0.04, 0, 0.56, 0.08, 0.46, C.ivory], // chamfer rim
    [0, 0.33, 0, 0.42, 0.05, 0.36, C.ivory], // top cap
    [0.03, 0.17, 0.215, 0.32, 0.2, 0.03, C.charcoal], // face panel
    [0, 0.13, 0, 0.2, 0.06, 0.2, C.charcoal], // neck
  ]);
  const lens = new THREE.Mesh(voxelGeometry([[0, 0, 0, 0.11, 0.11, 0.05, 0xffffff]]), lensMats.amber);
  lens.position.set(0.1, 0.19, 0.24);
  head.add(lens);
  const antenna = pivot(head, -0.17, 0.36, -0.05);
  m(antenna, [[0, 0.1, 0, 0.03, 0.22, 0.03, C.charcoal]], 0, 0, 0);
  const antennaTip = new THREE.Mesh(voxelGeometry([[0, 0, 0, 0.06, 0.06, 0.06, 0xffffff]]), lensMats.amber);
  antennaTip.position.set(0, 0.22, 0);
  antenna.add(antennaTip);
  antenna.rotation.z = 0.35;

  // Cape from the far shoulder, behind the body.
  const cape = pivot(torso, -0.14, 0.38, -0.22);
  m(cape, [[-0.02, -0.27, 0, 0.3, 0.5, 0.03, C.rust], [-0.02, -0.5, 0, 0.26, 0.06, 0.03, 0x8a4020]]);

  // Limbs: near (+z) and far (-z)
  const limb = (parent, x, y, z, upper, lower, end, endOffset) => {
    const hip = pivot(parent, x, y, z);
    m(hip, [[0, -upper[1] / 2 + 0.02, 0, upper[0], upper[1], upper[2], C.charcoal]]);
    const knee = pivot(hip, 0, -upper[1], 0);
    m(knee, [[0, -lower[1] / 2 + 0.01, 0, lower[0], lower[1], lower[2], C.charcoal]]);
    m(knee, [[0, 0, 0, 0.15, 0.12, 0.15, C.bronze]]); // joint
    const ankle = pivot(knee, 0, -lower[1], 0);
    m(ankle, [[0, 0, 0, 0.14, 0.12, 0.14, C.bronze]]);
    m(ankle, [[endOffset[0], endOffset[1], endOffset[2], end[0], end[1], end[2], end[3]]]);
    return { hip, knee, ankle };
  };
  const legNear = limb(pelvis, 0, 0, 0.14, [0.17, 0.26, 0.16], [0.13, 0.28, 0.14], [0.34, 0.16, 0.36, C.ivory], [0.05, -0.22, 0]);
  const legFar = limb(pelvis, 0, 0, -0.14, [0.17, 0.26, 0.16], [0.13, 0.28, 0.14], [0.34, 0.16, 0.36, 0x9a9a98], [0.05, -0.22, 0]);
  const arm = (parent, z) => {
    const sh = pivot(parent, 0, 0.36, z);
    m(sh, [[0, 0, 0, 0.2, 0.16, 0.18, C.ivory]]); // shoulder pad
    m(sh, [[0, -0.14, 0, 0.12, 0.26, 0.12, C.charcoal]]);
    const el = pivot(sh, 0, -0.27, 0);
    m(el, [[0, -0.12, 0, 0.11, 0.24, 0.11, C.charcoal]]);
    const hand = pivot(el, 0, -0.26, 0);
    m(hand, [[0.02, -0.05, 0, 0.16, 0.15, 0.16, C.charcoal]]);
    return { sh, el, hand };
  };
  const armNear = arm(torso, 0.21);
  const armFar = arm(torso, -0.21);

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
  const rig = {
    root,
    pelvis,
    torso,
    head,
    lens,
    chest,
    antenna,
    cape,
    legNear,
    legFar,
    armNear,
    armFar,
    phase: 0,
    land: 0,
    recoil: 0,
    pulse: 0,
    collapse: 0, // 0 standing, 1 shut down
    flicker: 0,
    mats: lensMats,
    carryAnchor: pivot(torso, 0.46, 0.2, 0),
  };
  return rig;
}

/**
 * Procedural animation from simulation state. p: player; s: { state, carrying, dt, time }.
 * Poses are blended toward targets every frame and never touch collision.
 */
export function animateILO(rig, p, s) {
  const dt = s.dt;
  const t = s.time;
  const speed = Math.abs(p.vx);
  const runK = Math.min(1, speed / 6.5);
  const airborne = !p.grounded;
  const facing = p.facing || 1;
  rig.root.scale.x = facing;

  // ---- targets
  let tgt = {
    pelvisY: 0, torsoRX: 0, torsoRZ: 0, headRZ: 0, headRY: 0,
    hN: 0, hF: 0, kN: 0, kF: 0, aN: 0, aF: 0, aZN: 0.12, aZF: -0.12, eN: 0.2, eF: 0.2,
    sN: 0, sF: 0, shZN: 0, shZF: 0,
  };
  const idleBob = Math.sin(t * 2.1) * 0.012;
  let rate = 14;

  if (rig.collapse > 0.5) {
    tgt = { ...tgt, pelvisY: -0.36, torsoRZ: 0.95, headRZ: 0.5, kN: 1.9, kF: 1.7, hN: -0.9, hF: -0.7, aN: 0.6, aF: 0.4, sN: 0.5, sF: 0.3, torsoRX: 0 };
    rate = 6;
  } else if (p.dashing > 0) {
    tgt.torsoRZ = -0.55;
    tgt.hN = 0.7; tgt.hF = 0.9; tgt.kN = 0.3; tgt.kF = 0.5;
    tgt.aN = 2.4; tgt.aF = 2.2; tgt.eN = 0.1; tgt.eF = 0.1;
    tgt.pelvisY = -0.1;
    rate = 30;
  } else if (p.sliding) {
    tgt.torsoRZ = -0.2;
    tgt.hN = -0.7; tgt.hF = -0.5; tgt.kN = 1.1; tgt.kF = 0.9;
    tgt.aN = 2.9; tgt.aF = 1.2; tgt.eN = 0.4; tgt.eF = 0.6;
    tgt.pelvisY = -0.06;
    rate = 16;
  } else if (airborne) {
    const rising = p.vy > 1.5;
    tgt.hN = rising ? -0.5 : -0.2; tgt.hF = rising ? 0.35 : 0.1;
    tgt.kN = rising ? 1.2 : 0.6; tgt.kF = rising ? 0.4 : 0.9;
    tgt.aN = rising ? 2.6 : 2.2; tgt.aF = rising ? 2.3 : 2.6;
    tgt.eN = 0.3; tgt.eF = 0.3;
    tgt.shZN = 0.35; tgt.shZF = -0.35;
    tgt.torsoRZ = -0.06 - (p.vy < -8 ? 0.08 : 0);
    rate = 10;
  } else if (speed > 0.4) {
    rig.phase += speed * dt * 3.6;
    const A = lerp(0.3, 0.62, runK);
    const sw = Math.sin(rig.phase);
    tgt.hN = sw * A; tgt.hF = -sw * A;
    tgt.kN = Math.max(0, -Math.sin(rig.phase + 0.6)) * (0.6 + runK * 0.6);
    tgt.kF = Math.max(0, Math.sin(rig.phase + 0.6)) * (0.6 + runK * 0.6);
    tgt.aN = -sw * 0.55 * runK + 0.1; tgt.aF = sw * 0.55 * runK + 0.1;
    tgt.eN = 0.35 + runK * 0.35; tgt.eF = 0.35 + runK * 0.35;
    tgt.pelvisY = Math.abs(sw) * 0.03 * runK + idleBob * 0.5;
    tgt.torsoRZ = -0.05 - runK * 0.1;
    tgt.headRZ = runK * 0.08;
    rate = 16;
  } else {
    // idle scanning
    tgt.headRY = Math.sin(t * 0.8) * 0.4;
    tgt.headRZ = Math.sin(t * 1.7) * 0.03;
    tgt.pelvisY = idleBob;
    tgt.aN = 0.12; tgt.aF = 0.12;
    tgt.torsoRZ = Math.sin(t * 1.1) * 0.01;
    rate = 6;
  }

  if (s.carrying) {
    tgt.aN = -1.35; tgt.aF = -1.35; tgt.eN = 0.35; tgt.eF = 0.35;
    tgt.torsoRZ = 0.12; tgt.headRZ = 0.1;
    rig.carryAnchor.visible = true;
  } else {
    rig.carryAnchor.visible = false;
  }
  if (p.actionTimer > 0) {
    const k = Math.sin((p.actionTimer / 0.35) * Math.PI);
    tgt.aN = lerp(tgt.aN, -1.5, k); tgt.eN = lerp(tgt.eN, 0.2, k);
    tgt.torsoRZ += 0.1 * k;
  }
  if (rig.pulse > 0) {
    const k = Math.sin(rig.pulse / 0.4 * Math.PI);
    tgt.shZN = lerp(tgt.shZN, 1.2, k); tgt.shZF = lerp(tgt.shZF, -1.2, k);
    tgt.aN = lerp(tgt.aN, 0.3, k); tgt.aF = lerp(tgt.aF, 0.3, k);
  }
  if (s.state === 'relayActivation') {
    tgt.aN = 2.8; tgt.aF = 2.8; tgt.headRZ = 0.35; tgt.torsoRZ = -0.05;
  }
  if (s.state === 'liftSequence' || s.state === 'complete') {
    tgt.headRZ = 0.3; tgt.headRY = 0;
  }
  if (rig.land > 0) {
    const k = rig.land / 0.18;
    tgt.pelvisY -= 0.14 * k; tgt.kN += 0.9 * k; tgt.kF += 0.9 * k; tgt.hN -= 0.5 * k; tgt.hF -= 0.5 * k; tgt.torsoRZ += 0.15 * k;
  }
  if (rig.recoil > 0) {
    const k = rig.recoil / 0.35;
    tgt.torsoRZ += 0.35 * k; tgt.headRZ += 0.25 * k; tgt.aN = 2.2; tgt.aF = 2.4;
  }

  const k = Math.min(1, rate * dt);
  const L = (cur, target) => cur + (target - cur) * k;
  rig.pelvis.position.y = L(rig.pelvis.position.y, 0.7 + tgt.pelvisY);
  rig.torso.rotation.x = L(rig.torso.rotation.x, tgt.torsoRX);
  rig.torso.rotation.z = L(rig.torso.rotation.z, tgt.torsoRZ);
  rig.head.rotation.z = L(rig.head.rotation.z, tgt.headRZ);
  rig.head.rotation.y = L(rig.head.rotation.y, tgt.headRY);
  rig.legNear.hip.rotation.z = L(rig.legNear.hip.rotation.z, tgt.hN);
  rig.legFar.hip.rotation.z = L(rig.legFar.hip.rotation.z, tgt.hF);
  rig.legNear.knee.rotation.z = L(rig.legNear.knee.rotation.z, -tgt.kN);
  rig.legFar.knee.rotation.z = L(rig.legFar.knee.rotation.z, -tgt.kF);
  rig.armNear.sh.rotation.z = L(rig.armNear.sh.rotation.z, tgt.aN);
  rig.armFar.sh.rotation.z = L(rig.armFar.sh.rotation.z, tgt.aF);
  rig.armNear.el.rotation.z = L(rig.armNear.el.rotation.z, -tgt.eN);
  rig.armFar.el.rotation.z = L(rig.armFar.el.rotation.z, -tgt.eF);
  rig.armNear.sh.rotation.x = L(rig.armNear.sh.rotation.x, tgt.shZN);
  rig.armFar.sh.rotation.x = L(rig.armFar.sh.rotation.x, tgt.shZF);

  // Cosmetic secondary motion
  rig.antenna.rotation.z = 0.35 + Math.sin(t * 3.3) * 0.08 - p.vy * 0.012;
  rig.cape.rotation.z = 0.1 + Math.sin(t * 2.4) * 0.05 - p.vx * facing * 0.06 + Math.min(0.5, Math.max(-0.3, -p.vy * 0.03));
  rig.cape.rotation.x = Math.sin(t * 1.9) * 0.06;

  // Lens & chest glow follow state
  let lensMat = lensMats.amber;
  let chestMat = lensMats.cyan;
  if (rig.collapse > 0.5) {
    lensMat = lensMats.off;
    chestMat = lensMats.cyanDim;
  } else if (p.dashing > 0) {
    lensMat = lensMats.white;
  } else if (s.state === 'relayActivation' || rig.pulse > 0) {
    lensMat = lensMats.white;
    chestMat = lensMats.cyanBright;
  } else if (p.immunity > 0 && s.state === 'play') {
    const blink = Math.floor(t * 18) % 2 === 0;
    lensMat = blink ? lensMats.amber : lensMats.amberDim;
    chestMat = blink ? lensMats.cyan : lensMats.cyanDim;
  }
  rig.lens.material = lensMat;
  rig.chest.material = chestMat;
  // Damage flicker on the body (never on the lens)
  rig.flicker = Math.max(0, rig.flicker - dt);
  rig.torso.visible = !(rig.flicker > 0 && Math.floor(t * 30) % 2 === 0);

  rig.land = Math.max(0, rig.land - dt);
  rig.recoil = Math.max(0, rig.recoil - dt);
  rig.pulse = Math.max(0, rig.pulse - dt);
}

// ---------------------------------------------------------------------------
// Cable Skitter
// ---------------------------------------------------------------------------
export function createSkitter() {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0.34, 0);
  const mat = voxelMaterial();
  const m = (parent, parts) => {
    const mesh = voxelMesh(parts, mat);
    parent.add(mesh);
    return mesh;
  };
  m(body, [
    [0, 0, 0, 1.2, 0.42, 0.7, C.metalDark],
    [0.1, 0.22, 0, 0.9, 0.08, 0.5, C.bronze],
    [-0.5, 0.02, 0, 0.14, 0.3, 0.5, C.charcoal],
    [0.3, -0.1, 0.36, 0.4, 0.14, 0.04, C.rust],
  ]);
  const sensor = new THREE.Mesh(voxelGeometry([[0, 0, 0, 0.06, 0.1, 0.56, 0xffffff]]), lensMats.amberDim);
  sensor.position.set(0.6, 0.08, 0);
  body.add(sensor);
  const eye = new THREE.Mesh(voxelGeometry([[0, 0, 0, 0.1, 0.1, 0.1, 0xffffff]]), lensMats.red);
  eye.position.set(0.6, 0.2, 0);
  body.add(eye);
  const legs = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const hip = pivot(body, -0.42 + i * 0.42, -0.12, side * 0.34);
      m(hip, [[0, -0.1, side * 0.1, 0.05, 0.3, 0.05, C.charcoal]]);
      const knee = pivot(hip, 0, -0.22, side * 0.2);
      m(knee, [[0, -0.12, 0, 0.04, 0.28, 0.04, C.charcoal]]);
      m(knee, [[0, -0.24, 0, 0.12, 0.06, 0.1, C.bronze]]);
      legs.push({ hip, knee, side, i });
    }
  }
  // Trailing cable: a chain of small voxels that lags behind the body.
  const cable = new THREE.Group();
  const cableSegs = [];
  for (let i = 0; i < 12; i++) {
    const seg = new THREE.Mesh(voxelGeometry([[0, 0, 0, 0.09, 0.07, 0.09, C.charcoal]]), mat);
    cable.add(seg);
    cableSegs.push({ mesh: seg, x: 0, y: 0 });
  }
  root.add(cable);
  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return { root, body, legs, sensor, eye, cable, cableSegs, phase: 0, tilt: 0, crouch: 1, lastX: 0, sparks: 0 };
}

export function animateSkitter(rig, e, dt, time) {
  const dir = e.dir || 1;
  rig.root.scale.x = dir;
  rig.phase += dt * 9;
  const moving = e.state === 'patrol';
  const lunge = e.state === 'lunge' && e.phase === 'strike';
  const telegraph = e.state === 'lunge' && e.phase === 'telegraph';
  const stunned = e.state === 'stunned';
  const disabled = e.disabled;
  let targetCrouch = 1;
  let targetTilt = 0;
  let sensorMat = lensMats.amberDim;
  let eyeMat = lensMats.red;
  for (const l of rig.legs) {
    let hip = 0;
    let knee = 0;
    if (disabled) {
      hip = 0.9 * l.side; knee = 0.4;
    } else if (stunned) {
      hip = 1.3 * l.side; knee = 1.2;
    } else if (moving) {
      const sw = Math.sin(rig.phase + l.i * 2.1 + (l.side > 0 ? Math.PI : 0));
      hip = sw * 0.45 * l.side;
      knee = Math.max(0, -sw) * 0.5;
    } else if (lunge) {
      hip = -0.5 * l.side + l.i * 0.2; knee = 0.1;
    } else if (telegraph) {
      hip = 0.5 * l.side; knee = 0.9;
    }
    l.hip.rotation.z = ease(l.hip.rotation.z, hip, 12, dt);
    l.knee.rotation.z = ease(l.knee.rotation.z, knee, 12, dt);
  }
  if (disabled) {
    targetTilt = 1.35; targetCrouch = 0.5; sensorMat = lensMats.off; eyeMat = lensMats.off;
  } else if (stunned) {
    targetTilt = 0.25; targetCrouch = 0.75; sensorMat = lensMats.off; eyeMat = lensMats.off;
  } else if (telegraph) {
    targetCrouch = 0.65; sensorMat = lensMats.white; eyeMat = Math.floor(time * 16) % 2 ? lensMats.redBright : lensMats.red;
  } else if (lunge) {
    targetTilt = -0.25; targetCrouch = 0.95; sensorMat = lensMats.white; eyeMat = lensMats.redBright;
  } else if (e.state === 'alert') {
    sensorMat = Math.floor(time * 10) % 2 ? lensMats.amber : lensMats.off; eyeMat = lensMats.redBright;
  } else if (e.state === 'dormant') {
    sensorMat = lensMats.off; eyeMat = lensMats.off;
  }
  rig.crouch = ease(rig.crouch, targetCrouch, 14, dt);
  rig.tilt = ease(rig.tilt, targetTilt, disabled ? 4 : 10, dt);
  rig.body.scale.y = rig.crouch;
  rig.body.rotation.z = rig.tilt;
  rig.body.position.y = 0.34 * rig.crouch + (moving ? Math.abs(Math.sin(rig.phase)) * 0.02 : 0);
  rig.sensor.material = sensorMat;
  rig.eye.material = eyeMat;
  // Cable lag
  const segs = rig.cableSegs;
  const hx = e.x - dir * 0.6;
  segs[0].x = ease(segs[0].x, hx, 10, dt);
  segs[0].y = ease(segs[0].y, e.y + 0.05, 10, dt);
  for (let i = 1; i < segs.length; i++) {
    segs[i].x = ease(segs[i].x, segs[i - 1].x - dir * 0.12, 10 - i * 0.4, dt);
    segs[i].y = ease(segs[i].y, e.y + 0.03 + Math.sin(time * 3 + i) * 0.015, 8, dt);
  }
  for (let i = 0; i < segs.length; i++) segs[i].mesh.position.set(segs[i].x - e.x, segs[i].y - e.y, -0.3);
}

// ---------------------------------------------------------------------------
// Prism Drone
// ---------------------------------------------------------------------------
export function createDrone() {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const mat = voxelMaterial();
  const m = (parent, parts) => {
    const mesh = voxelMesh(parts, mat);
    parent.add(mesh);
    return mesh;
  };
  m(body, [
    [0, 0, 0, 0.4, 0.4, 0.4, C.metal],
    [0, 0.28, 0, 0.24, 0.18, 0.24, C.bronze],
    [0, -0.28, 0, 0.24, 0.18, 0.24, C.metalDark],
    [0.22, 0.1, 0.22, 0.1, 0.1, 0.1, C.bronze],
    [-0.22, 0.1, 0.22, 0.1, 0.1, 0.1, C.bronze],
    [0.22, 0.1, -0.22, 0.1, 0.1, 0.1, C.bronze],
    [-0.22, 0.1, -0.22, 0.1, 0.1, 0.1, C.bronze],
  ]);
  const lens = new THREE.Mesh(voxelGeometry([[0, 0, 0, 0.12, 0.12, 0.12, 0xffffff]]), lensMats.cyan);
  lens.position.set(0.22, -0.05, 0);
  body.add(lens);
  const plates = [];
  for (let i = 0; i < 3; i++) {
    const orbit = pivot(root, 0, 0, 0);
    const plate = m(orbit, [[0.6, 0, 0, 0.3, 0.06, 0.22, C.ivory]]);
    plates.push({ orbit, plate, phase: (i / 3) * Math.PI * 2, droop: 0 });
  }
  // Targeting line: thin translucent box, length set by aim state.
  const lineMat = new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0.55, depthWrite: false });
  const line = new THREE.Mesh(new THREE.BoxGeometry(1, 0.04, 0.04), lineMat);
  line.visible = false;
  root.add(line);
  root.traverse((o) => {
    if (o.isMesh && o !== line) o.castShadow = true;
  });
  return { root, body, lens, plates, line, lineMat, fall: null, shards: null, time: 0 };
}

export function animateDrone(rig, e, dt, time, def) {
  rig.time += dt;
  const stunned = e.state === 'stunned';
  const aiming = e.state === 'aim';
  const tracking = aiming && e.timer < 0.4;
  for (const pl of rig.plates) {
    pl.orbit.rotation.y = time * 2.2 + pl.phase;
    pl.droop = ease(pl.droop, stunned || e.disabled ? 1 : 0, 6, dt);
    pl.plate.position.y = -0.25 * pl.droop;
    pl.plate.rotation.z = 0.6 * pl.droop * (pl.phase % 2 ? 1 : -1);
  }
  rig.body.rotation.z = ease(rig.body.rotation.z, stunned ? 0.35 : Math.sin(time * 2) * 0.05, 6, dt);
  rig.body.rotation.x = ease(rig.body.rotation.x, stunned ? 0.2 : 0, 6, dt);
  let lensMat = lensMats.cyan;
  if (e.disabled || stunned) lensMat = lensMats.off;
  else if (aiming) lensMat = tracking ? lensMats.amber : (Math.floor(time * 14) % 2 ? lensMats.redBright : lensMats.amber);
  rig.lens.material = lensMat;
  // Aim line
  if (aiming) {
    const len = tracking ? Math.min(9, T_DRONE_RANGE) : T_DRONE_RANGE;
    rig.line.visible = true;
    rig.line.scale.x = len;
    rig.line.position.set(Math.cos(0) * 0, 0, 0);
    const ang = Math.atan2(e.aimY, e.aimX);
    rig.line.rotation.z = ang;
    rig.line.position.set((e.aimX * len) / 2 + e.aimX * 0.3, (e.aimY * len) / 2 + e.aimY * 0.3, 0);
    rig.lineMat.color.setHex(tracking ? C.cyan : C.amber);
    rig.lineMat.opacity = tracking ? 0.35 : 0.75;
  } else {
    rig.line.visible = false;
  }
  // Disabled: fall and shatter once (the shatter itself is spawned by the effects system).
  if (e.disabled && !rig.shards) {
    if (!rig.fall) rig.fall = { vy: 0, t: 0 };
  }
  if (rig.fall && !rig.shards) {
    rig.fall.vy -= 28 * dt;
    rig.fall.t += dt;
    rig.body.position.y += rig.fall.vy * dt;
    rig.body.rotation.z += dt * 6;
    if (rig.fall.t > 1.1) {
      rig.shards = true;
      rig.body.visible = false;
      for (const pl of rig.plates) pl.orbit.visible = false;
    }
  }
}
const T_DRONE_RANGE = 9;

// ---------------------------------------------------------------------------
// Shutter Sentinel
// ---------------------------------------------------------------------------
export function createSentinel(def) {
  const root = new THREE.Group();
  const mat = voxelMaterial();
  const m = (parent, parts) => {
    const mesh = voxelMesh(parts, mat);
    parent.add(mesh);
    return mesh;
  };
  // Frame (mounted on the housing face)
  m(root, [
    [def.dir * 0.3, 0, 0, 0.6, 4.4, 1.4, C.metalDark],
    [def.dir * 0.62, 2.1, 0, 0.1, 0.3, 1.0, C.bronze],
    [def.dir * 0.62, -2.1, 0, 0.1, 0.3, 1.0, C.bronze],
  ]);
  const core = new THREE.Mesh(voxelGeometry([[0, 0, 0, 0.5, 0.5, 0.5, 0xffffff]]), lensMats.red);
  core.position.set(def.dir * 0.7, 0, 0);
  root.add(core);
  const panelL = m(root, [[0, 1.05, 0.2, 0.22, 2.0, 1.2, C.metal]]);
  const panelR = m(root, [[0, -1.05, 0.2, 0.22, 2.0, 1.2, C.metal]]);
  panelL.position.set(def.dir * 0.8, 0, 0);
  panelR.position.set(def.dir * 0.8, 0, 0);
  const lamp = new THREE.Mesh(voxelGeometry([[0, 0, 0, 0.2, 0.2, 0.2, 0xffffff]]), lensMats.off);
  lamp.position.set(def.dir * 0.7, 2.1, 0.7);
  root.add(lamp);
  // Lane visuals: warning dashes + firing beam
  const laneLen = Math.abs(def.x - def.lane.x1);
  const dashMat = new THREE.MeshBasicMaterial({ color: C.hazard, transparent: true, opacity: 0.5, depthWrite: false });
  const dashes = new THREE.Group();
  for (let i = 0; i < Math.floor(laneLen / 0.6); i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.06), dashMat);
    d.position.set(def.dir * (0.9 + i * 0.6), 0, 0.3);
    dashes.add(d);
  }
  dashes.visible = false;
  root.add(dashes);
  const beamMat = new THREE.MeshBasicMaterial({ color: C.hazard, transparent: true, opacity: 0.85, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(laneLen, 0.8, 0.3), beamMat);
  beam.position.set(def.dir * (laneLen / 2), 0, 0.3);
  beam.visible = false;
  root.add(beam);
  const beamCore = new THREE.Mesh(new THREE.BoxGeometry(laneLen, 0.26, 0.34), lensMats.white);
  beamCore.position.copy(beam.position);
  beamCore.visible = false;
  root.add(beamCore);
  root.traverse((o) => {
    if (o.isMesh && o !== beam && o !== beamCore && !dashes.children.includes(o)) o.castShadow = true;
  });
  return { root, core, panelL, panelR, lamp, dashes, beam, beamCore, dashMat, open: 0, dir: def.dir };
}

export function animateSentinel(rig, e, dt, time) {
  const open = e.state === 'venting' || e.disabled ? 1 : 0;
  rig.open = ease(rig.open, e.disabled ? 0.6 : open, 8, dt);
  const off = rig.open * 1.05;
  rig.panelL.position.y = off;
  rig.panelR.position.y = -off;
  let coreMat = lensMats.red;
  let lampMat = lensMats.off;
  if (e.disabled) {
    coreMat = lensMats.off;
  } else if (e.state === 'venting') {
    coreMat = Math.floor(time * 10) % 2 ? lensMats.redBright : lensMats.white;
  } else if (e.state === 'warning') {
    lampMat = Math.floor(time * 12) % 2 ? lensMats.redBright : lensMats.red;
  } else if (e.state === 'firing') {
    coreMat = lensMats.white;
    lampMat = lensMats.redBright;
  }
  rig.core.material = coreMat;
  rig.lamp.material = lampMat;
  rig.dashes.visible = e.state === 'warning';
  rig.beam.visible = e.state === 'firing';
  rig.beamCore.visible = e.state === 'firing';
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export function createCell() {
  const g = new THREE.Group();
  const body = voxelMesh([
    [0, 0.5, 0, 0.7, 0.9, 0.5, C.amber],
    [0, 0.95, 0, 0.5, 0.1, 0.36, 0xd07a1a],
    [0, 0.05, 0, 0.6, 0.1, 0.42, C.bronze],
    [0, 1.04, 0, 0.34, 0.08, 0.12, C.charcoal], // handle
    [0, 0.5, 0, 0.72, 0.2, 0.52, 0xffc070],
  ]);
  g.add(body);
  const core = new THREE.Mesh(voxelGeometry([[0, 0.5, 0, 0.1, 0.56, 0.54, 0xffffff]]), lensMats.amber);
  g.add(core);
  g.userData.core = core;
  return g;
}

export function createSocket() {
  const g = new THREE.Group();
  g.add(voxelMesh([
    [0, 0.55, 0, 0.64, 1.1, 0.3, C.metalDark],
    [0, 0.2, 0.17, 0.4, 0.3, 0.06, C.bronze],
    [0, 1.12, 0, 0.5, 0.08, 0.26, C.bronze],
  ]));
  const slot = new THREE.Mesh(voxelGeometry([[0, 0.6, 0.17, 0.4, 0.6, 0.04, 0xffffff]]), lensMats.off);
  g.add(slot);
  const lamp = new THREE.Mesh(voxelGeometry([[0, 1.0, 0.18, 0.1, 0.1, 0.06, 0xffffff]]), lensMats.off);
  g.add(lamp);
  g.userData = { slot, lamp };
  return g;
}

export function createRelay() {
  const g = new THREE.Group();
  g.add(voxelMesh([
    [0, 0.25, 0, 0.9, 0.5, 0.7, C.metalDark],
    [0, 0.55, 0, 0.6, 0.16, 0.5, C.bronze],
  ]));
  const crystal = voxelMesh([
    [0, 1.4, 0, 0.3, 1.6, 0.3, C.crystal],
    [-0.28, 1.05, 0.05, 0.18, 0.9, 0.18, C.crystal],
    [0.26, 0.95, -0.04, 0.2, 0.7, 0.2, C.crystal],
  ], new THREE.MeshLambertMaterial({ color: 0x9adfe8, emissive: 0x1f6a72, transparent: true, opacity: 0.92 }));
  g.add(crystal);
  const core = new THREE.Mesh(voxelGeometry([[0, 1.4, 0, 0.12, 1.3, 0.32, 0xffffff]]), lensMats.cyanDim);
  g.add(core);
  g.userData = { core, crystal };
  return g;
}

export function createStation() {
  const g = new THREE.Group();
  g.add(voxelMesh([
    [0, 0.06, 0, 0.9, 0.12, 0.6, C.metalDark],
    [-0.25, 1.1, 0, 0.12, 2.0, 0.12, C.metal],
    [-0.25, 2.2, 0, 0.6, 0.14, 0.3, C.bronze],
  ]));
  const lamp = new THREE.Mesh(voxelGeometry([[-0.05, 2.0, 0, 0.34, 0.34, 0.34, 0xffffff]]), lensMats.cyanDim);
  g.add(lamp);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 6, 24), new THREE.MeshBasicMaterial({ color: C.teal, transparent: true, opacity: 0.5 }));
  ring.position.set(-0.25, 1.3, 0);
  g.add(ring);
  g.userData = { lamp, ring };
  return g;
}

export function createSwitch() {
  const g = new THREE.Group();
  g.add(voxelMesh([
    [0, 0.5, 0, 0.5, 1.0, 0.26, C.metalDark],
    [0, 1.02, 0, 0.6, 0.08, 0.3, C.bronze],
  ]));
  const lever = new THREE.Group();
  lever.position.set(0, 0.5, 0.16);
  lever.add(voxelMesh([[0, 0.28, 0, 0.08, 0.56, 0.08, C.charcoal], [0, 0.56, 0, 0.16, 0.14, 0.16, C.hazard]]));
  lever.rotation.z = 0.7;
  g.add(lever);
  const lamp = new THREE.Mesh(voxelGeometry([[0, 0.85, 0.14, 0.1, 0.1, 0.06, 0xffffff]]), lensMats.off);
  g.add(lamp);
  g.userData = { lever, lamp };
  return g;
}

export function createArchive() {
  const g = new THREE.Group();
  g.add(voxelMesh([
    [0, 0.3, 0, 0.5, 0.6, 0.4, C.metalDark],
    [0, 0.95, 0, 0.56, 0.7, 0.1, C.bronze],
  ]));
  const screen = new THREE.Mesh(voxelGeometry([[0, 0.95, 0.06, 0.44, 0.56, 0.04, 0xffffff]]), lensMats.cyan);
  g.add(screen);
  const glyph = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlyphTexture('archive'), color: C.crystalCore, transparent: true, opacity: 0.9, depthWrite: false }));
  glyph.scale.set(0.6, 0.6, 1);
  glyph.position.set(0, 1.6, 0.2);
  g.add(glyph);
  g.userData = { screen, glyph };
  return g;
}

export function createCache() {
  const g = new THREE.Group();
  g.add(voxelMesh([
    [0, 0.2, 0, 0.6, 0.4, 0.5, C.rust],
    [0.25, 0.5, 0.1, 0.3, 0.2, 0.3, C.bronze],
    [-0.2, 0.48, -0.05, 0.26, 0.16, 0.3, C.metalDark],
    [0.05, 0.66, 0, 0.16, 0.12, 0.16, C.amberDim],
  ]));
  return g;
}

export function createVent(w) {
  const g = new THREE.Group();
  const grate = voxelMesh([[0, 0.03, 0, w, 0.06, 1.2, C.metalDark]]);
  g.add(grate);
  const jetMat = new THREE.MeshBasicMaterial({ color: C.hazard, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
  const jet = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 1, 0.5), jetMat);
  jet.geometry.translate(0, 0.5, 0);
  g.add(jet);
  const glowMat = new THREE.MeshBasicMaterial({ color: C.hazard, transparent: true, opacity: 0, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 1.3), glowMat);
  glow.position.y = 0.1;
  g.add(glow);
  const particles = [];
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Mesh(voxelGeometry([[0, 0, 0, 0.08, 0.14, 0.08, 0xffffff]]), jetMat);
    p.visible = false;
    g.add(p);
    particles.push({ mesh: p, t: Math.random(), x: (Math.random() - 0.5) * w * 0.5, speed: 3 + Math.random() * 2 });
  }
  g.userData = { jet, jetMat, glow, glowMat, particles, height: 3.5 };
  return g;
}

export function animateVent(rig, stage, dt, time) {
  const u = rig.userData;
  const targetH = stage === 'active' ? u.height : stage === 'warning' ? 0.35 : 0;
  const cur = rig.userData.jet.scale.y || 0.001;
  const h = ease(cur, targetH, stage === 'active' ? 18 : 6, dt);
  u.jet.scale.y = Math.max(0.001, h);
  u.jetMat.opacity = stage === 'active' ? 0.55 : stage === 'warning' ? (Math.floor(time * 12) % 2 ? 0.35 : 0.15) : 0;
  u.glowMat.opacity = stage === 'active' ? 0.9 : stage === 'warning' ? (Math.floor(time * 8) % 2 ? 0.8 : 0.2) : 0;
  for (const p of u.particles) {
    const vis = stage === 'active';
    p.mesh.visible = vis;
    if (vis) {
      p.t += dt * p.speed / u.height;
      if (p.t > 1) p.t -= 1;
      p.mesh.position.set(p.x, 0.1 + p.t * u.height, 0.2);
    }
  }
}

export function createPlatform(w, h, depth = 1.8) {
  const g = new THREE.Group();
  g.add(voxelMesh([
    [w / 2, h / 2, 0, w, h, depth, C.metal],
    [w / 2, h - 0.04, depth / 2 + 0.01, w - 0.2, 0.06, 0.02, C.trim],
    [w / 2, 0.1, 0, w, 0.1, depth * 0.6, C.metalDark],
  ]));
  const strip = new THREE.Mesh(voxelGeometry([[w / 2, 0.08, depth / 2 + 0.02, w - 0.3, 0.08, 0.02, 0xffffff]]), lensMats.off);
  g.add(strip);
  g.userData = { strip };
  return g;
}

export function createLiftCar(w, h) {
  const g = createPlatform(w, h, 2.0);
  // Cables (cosmetic) rising from the car corners
  const cableMat = new THREE.MeshLambertMaterial({ color: 0x15181c });
  const cables = [];
  for (const cx of [0.3, w - 0.3]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.06, 30, 0.06), cableMat);
    c.position.set(cx, h + 15, -0.4);
    g.add(c);
    cables.push(c);
  }
  // Protective barrier (final lift): rises during boarding
  const barrier = new THREE.Group();
  barrier.add(voxelMesh([[w - 0.15, 1.0, 0, 0.1, 2.0, 1.6, C.metalDark], [w - 0.15, 2.0, 0, 0.1, 0.1, 1.6, C.amberDim]]));
  barrier.visible = false;
  g.add(barrier);
  g.userData = { ...g.userData, cables, barrier };
  return g;
}

export function createShutterMesh(closed) {
  const h = closed.y2 - closed.y1;
  const w = closed.x2 - closed.x1;
  const geo = new THREE.BoxGeometry(w, h, 0.9);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xc8c8c8 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.h = h;
  return mesh;
}

/** Deterministic crystal cluster description for scenery: [{x, z, w, h, tilt}] in local units. */
export function crystalCluster(seed, scale = 1) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [];
  const n = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    out.push({
      x: (rng() - 0.5) * 1.4 * scale,
      z: (rng() - 0.5) * 0.5,
      w: (0.12 + rng() * 0.2) * scale,
      h: (0.8 + rng() * 2.6) * scale,
      tilt: (rng() - 0.5) * 0.45,
    });
  }
  return out;
}

export { lensMats };
