// Stage 12 — one bottom-walking crab. Local frame: +Z forward (rostrum), +X right, +Y up.
// Eight legs are two-link IK chains: feet are planted in world space during stance and follow a
// lifted arc during swing, in alternating tetrapod groups. The body rides on the ground height.

const CRAB_BODY_H = 0.13;
const CRAB_STRIDE = 0.12;
const _cv = Array.from({ length: 8 }, () => new THREE.Vector3());
const _cq1 = new THREE.Quaternion();
const _cbox = new THREE.Box3();

function createCrab(parent, env) {
  const rng = new Rng(707);
  const group = new THREE.Group();
  group.name = 'crab';
  const shellTex = mottleTexture(256, 12, { lo: 0.5, hi: 1.0, tint: [1.0, 0.82, 0.72] });
  const shell = new THREE.MeshPhysicalMaterial({ color: 0xa2472a, map: shellTex, roughness: 0.48, metalness: 0.05, clearcoat: 0.4, clearcoatRoughness: 0.3 });
  const shellDark = new THREE.MeshPhysicalMaterial({ color: 0x6b2e1a, roughness: 0.55, metalness: 0.02, clearcoat: 0.25, clearcoatRoughness: 0.35 });
  const jointMat = new THREE.MeshStandardMaterial({ color: 0x3a1a10, roughness: 0.7 });
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x050507, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 });
  enhanceMaterial(shell, { id: 'crab-shell', caustics: 0.6 });
  enhanceMaterial(shellDark, { id: 'crab-shell-dark', caustics: 0.6 });
  enhanceMaterial(jointMat, { id: 'crab-joint', caustics: 0.4 });

  // --- carapace: low rounded dome with subtle radial ridges and a wider front --------------------
  const carapaceGeo = new THREE.SphereGeometry(1, 48, 24);
  {
    const p = carapaceGeo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const a = Math.atan2(v.z, v.x);
      const ridge = 1 + 0.03 * Math.sin(a * 6.0) * Math.max(0, v.y);
      const asym = 1 + 0.03 * Math.sin(a * 2.0 + 1.0);                 // small natural asymmetry
      p.setXYZ(i, v.x * 0.25 * ridge * asym, Math.max(v.y, -0.55) * 0.085 + 0.14, v.z * 0.2 * (1 + 0.08 * Math.max(0, v.z)) * ridge);
    }
    carapaceGeo.computeVertexNormals();
  }
  const carapace = new THREE.Mesh(carapaceGeo, shell);
  carapace.castShadow = true; carapace.receiveShadow = true;
  group.add(carapace);
  // rostrum teeth
  for (const sx of [-1, 1]) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 6), shellDark);
    tooth.position.set(sx * 0.07, 0.13, 0.2); tooth.rotation.x = Math.PI / 2;
    group.add(tooth);
  }

  // --- eyes and mouthparts -------------------------------------------------------------------------
  const eyeStalks = [];
  for (const side of [1, -1]) {
    const stalk = new THREE.Object3D();
    stalk.position.set(side * 0.055, 0.19, 0.165);
    const stalkMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.013, 0.08, 8).translate(0, 0.04, 0), shellDark);
    stalkMesh.castShadow = true;
    stalk.add(stalkMesh);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 12), eyeMat);
    eye.position.y = 0.085;
    stalk.add(eye);
    stalk.rotation.set(-0.25, 0, side * 0.12);
    group.add(stalk);
    eyeStalks.push({ stalk, side, phase: rng.range(0, 6) });
  }
  const mouthparts = [];
  for (const side of [1, -1]) {
    const mp = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.04, 0.012), shellDark);
    mp.position.set(side * 0.017, 0.1, 0.195); mp.rotation.y = side * 0.35;
    group.add(mp); mouthparts.push(mp);
  }

  // --- walking legs ------------------------------------------------------------------------------------
  const L1 = 0.21, L2 = 0.23;
  const upperGeo = new THREE.CylinderGeometry(0.013, 0.019, L1, 8).rotateZ(-Math.PI / 2).translate(L1 / 2, 0, 0);
  const lowerGeo = new THREE.CylinderGeometry(0.006, 0.013, L2, 8).rotateZ(-Math.PI / 2).translate(L2 / 2, 0, 0);
  const kneeGeo = new THREE.SphereGeometry(0.018, 10, 8);
  const tipGeo = new THREE.SphereGeometry(0.008, 8, 6);
  const legs = [];
  const legZ = [0.13, 0.045, -0.04, -0.125];
  for (const side of [1, -1]) for (let i = 0; i < 4; i++) {
    const hip = new THREE.Object3D();
    hip.position.set(side * 0.2, 0.1, legZ[i]);
    const upper = new THREE.Object3D(); hip.add(upper);
    const upperMesh = new THREE.Mesh(upperGeo, shellDark); upperMesh.castShadow = true; upper.add(upperMesh);
    const knee = new THREE.Object3D(); knee.position.x = L1; upper.add(knee);
    const kneeBall = new THREE.Mesh(kneeGeo, jointMat); knee.add(kneeBall);
    const lowerMesh = new THREE.Mesh(lowerGeo, shellDark); lowerMesh.castShadow = true; knee.add(lowerMesh);
    const tip = new THREE.Mesh(tipGeo, jointMat); tip.position.x = L2; knee.add(tip);
    group.add(hip);
    legs.push({
      side, hip, upper, knee, baseYaw: side > 0 ? 0 : Math.PI,
      group: ((i % 2 === 0) === (side > 0)) ? 0 : 1,
      home: new THREE.Vector3(side * 0.37, 0, legZ[i] * 1.9 - 0.03),
      foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), swinging: false, planted: false,
    });
  }

  // --- claws on articulated front arms -----------------------------------------------------------------
  const claws = [];
  const merusGeo = new THREE.CylinderGeometry(0.018, 0.024, 0.16, 10).rotateZ(-Math.PI / 2).translate(0.08, 0, 0);
  const carpusGeo = new THREE.CylinderGeometry(0.02, 0.018, 0.06, 10).rotateZ(-Math.PI / 2).translate(0.03, 0, 0);
  const handGeo = new THREE.SphereGeometry(1, 18, 12).scale(0.068, 0.036, 0.042).translate(0.06, 0, 0);
  const fingerGeo = new THREE.CylinderGeometry(0.004, 0.015, 0.08, 8).rotateZ(-Math.PI / 2).translate(0.04, 0, 0);
  for (const side of [1, -1]) {
    const shoulder = new THREE.Object3D();
    shoulder.position.set(side * 0.16, 0.1, 0.14);
    shoulder.rotation.y = side > 0 ? -0.6 : Math.PI + 0.6;
    const upper = new THREE.Object3D(); shoulder.add(upper);
    const merus = new THREE.Mesh(merusGeo, shell); merus.castShadow = true; upper.add(merus);
    const elbow = new THREE.Object3D(); elbow.position.x = 0.16; upper.add(elbow);
    elbow.add(new THREE.Mesh(kneeGeo, jointMat));
    const carpus = new THREE.Mesh(carpusGeo, shell); carpus.castShadow = true; elbow.add(carpus);
    const wrist = new THREE.Object3D(); wrist.position.x = 0.06; elbow.add(wrist);
    const hand = new THREE.Mesh(handGeo, shell); hand.castShadow = true; wrist.add(hand);
    const fixedFinger = new THREE.Mesh(fingerGeo, shellDark); fixedFinger.position.set(0.11, -0.012, 0); wrist.add(fixedFinger);
    const dactylPivot = new THREE.Object3D(); dactylPivot.position.set(0.105, 0.014, 0); wrist.add(dactylPivot);
    const dactyl = new THREE.Mesh(fingerGeo, shellDark); dactyl.rotation.z = 0.2; dactylPivot.add(dactyl);
    upper.rotation.z = -0.35; elbow.rotation.z = 0.6;
    group.add(shoulder);
    claws.push({ side, upper, elbow, dactylPivot, rest: { upper: -0.35, elbow: 0.6, dactyl: 0.2 } });
  }

  // --- route and behaviour -----------------------------------------------------------------------------
  const ROUTE = [
    { x: -1.9, z: 1.45, pause: [1.2, 2.6] },
    { x: 0.1, z: 1.25, pause: [2.5, 4.5], gesture: true },     // in front of the castle gateway
    { x: 1.0, z: 0.85, pause: [0.6, 1.6] },
    { x: 2.45, z: 1.05, pause: [2.0, 4.0], gesture: true },
    { x: 3.1, z: 0.95, pause: [1.5, 3.0], forward: true },
  ];
  const state = { wp: 1, dir: 1, pause: 0, yaw: 0, speed: 0, phase: 0, moveDir: new THREE.Vector3(1, 0, 0), gesture: null, gestureT: 0, lastYaw: 0 };
  group.position.set(ROUTE[0].x, groundHeightAt(ROUTE[0].x, ROUTE[0].z) + CRAB_BODY_H, ROUTE[0].z);
  // plant the feet at their home positions
  group.updateMatrixWorld(true);
  for (const leg of legs) {
    _cv[0].copy(leg.home).add(group.position);
    leg.foot.set(_cv[0].x, groundHeightAt(_cv[0].x, _cv[0].z), _cv[0].z);
  }

  const obstacles = [];
  function setObstacles(list) { obstacles.length = 0; obstacles.push(...list); }
  let snailProbe = null;   // () => Vector3 | null, set once the bottom snail exists

  function startGesture() {
    const claw = claws[rng.float() < 0.5 ? 0 : 1];
    state.gesture = { claw, t: 0, dur: rng.range(1.4, 2.2), open: rng.range(0.35, 0.6), lift: rng.range(0.25, 0.6) };
  }

  function update(dt) {
    const pos = group.position;
    let turning = 0;
    if (state.pause > 0) {
      state.pause -= dt;
      state.speed = damp(state.speed, 0, 6, dt);
    } else {
      const wp = ROUTE[state.wp];
      _cv[1].set(wp.x - pos.x, 0, wp.z - pos.z);
      const dist = _cv[1].length();
      if (dist < 0.05) {
        state.pause = rng.range(wp.pause[0], wp.pause[1]);
        if (wp.gesture && rng.float() < 0.8) startGesture();
        state.wp += state.dir;
        if (state.wp >= ROUTE.length || state.wp < 0) { state.dir *= -1; state.wp += 2 * state.dir; }
        state.wp = clamp(state.wp, 0, ROUTE.length - 1);
      } else {
        _cv[1].divideScalar(dist);
        state.moveDir.copy(_cv[1]);
        const desiredYaw = wp.forward ? Math.atan2(_cv[1].x, _cv[1].z) : 0;   // sideways by default: rostrum to the viewer
        const dy = angleDelta(state.yaw, desiredYaw);
        const step = clamp(dy, -1.3 * dt, 1.3 * dt);
        state.yaw += step;
        turning = Math.abs(step);
        const blocked = snailProbe && snailProbe() && _cv[2].copy(snailProbe()).sub(pos).length() < 0.45 && _cv[2].normalize().dot(_cv[1]) > 0.3;
        if (Math.abs(dy) > 0.15 || blocked) state.speed = damp(state.speed, 0, 8, dt);
        else state.speed = damp(state.speed, 0.13, 2.5, dt);
        if (state.speed > 0.004) {
          _cv[3].set(pos.x + _cv[1].x * state.speed * dt, 0, pos.z + _cv[1].z * state.speed * dt);
          let hit = false;
          for (const o of obstacles) {
            if (o.isBox3) { if (_cbox.copy(o).expandByScalar(0.22).containsPoint(_cv[3])) { hit = true; break; } }
            else if (_cv[4].set(_cv[3].x, o.center.y, _cv[3].z).distanceTo(o.center) < o.radius + 0.22) { hit = true; break; }
          }
          _cv[3].x = clamp(_cv[3].x, TANK.ixMin + 0.35, TANK.ixMax - 0.35);
          _cv[3].z = clamp(_cv[3].z, TANK.izMin + 0.3, TANK.izMax - 0.3);
          if (!hit) { pos.x = _cv[3].x; pos.z = _cv[3].z; state.blockedT = 0; }
          else { state.pause = Math.max(state.pause, 0.8); state.blockedT = (state.blockedT || 0) + dt; if (state.blockedT > 4) { state.blockedT = 0; state.wp = clamp(state.wp + state.dir, 0, ROUTE.length - 1); } }
        }
      }
    }
    group.rotation.y = state.yaw;
    pos.y = damp(pos.y, groundHeightAt(pos.x, pos.z) + CRAB_BODY_H, 10, dt);

    // gait phase: driven by distance travelled (plus turning), and finishing a swing when stopped
    const moving = state.speed > 0.004 || turning > 1e-4;
    let canStart = moving;
    if (moving) state.phase += (state.speed * dt) / CRAB_STRIDE + turning * 0.22 / CRAB_STRIDE;
    else {
      // let any leg that is mid-swing finish its step, then hold
      const anySwing = legs.some((l) => l.swinging);
      if (anySwing) {
        canStart = true;
        const frac = state.phase % 0.5;
        state.phase += Math.min(dt * 1.6, 0.5 - frac);
      }
    }
    updateLegs(canStart);
    // claw gesture
    if (state.gesture) {
      const g = state.gesture; g.t += dt;
      const k = Math.min(1, g.t / g.dur);
      const env = Math.sin(Math.PI * k);                     // rise, hold, release
      g.claw.upper.rotation.z = g.claw.rest.upper + g.lift * env;
      g.claw.elbow.rotation.z = g.claw.rest.elbow - 0.3 * env;
      g.claw.dactylPivot.rotation.z = g.open * env * (0.7 + 0.3 * Math.sin(g.t * 9));
      if (k >= 1) { g.claw.upper.rotation.z = g.claw.rest.upper; g.claw.elbow.rotation.z = g.claw.rest.elbow; g.claw.dactylPivot.rotation.z = 0; state.gesture = null; }
    } else {
      const idle = Math.sin(SIM.time * 0.8) * 0.03;
      for (const c of claws) { c.upper.rotation.z = c.rest.upper + idle * c.side; c.dactylPivot.rotation.z = 0.04 + 0.03 * Math.sin(SIM.time * 1.3 + c.side); }
    }
    // eyes and mouthparts
    for (const e of eyeStalks) {
      e.stalk.rotation.y = 0.3 * Math.sin(SIM.time * 1.7 + e.phase);
      e.stalk.rotation.x = -0.25 + 0.12 * Math.sin(SIM.time * 2.3 + e.phase * 2.0);
    }
    for (let i = 0; i < 2; i++) mouthparts[i].rotation.x = 0.15 * Math.sin(SIM.time * 6 + i * Math.PI);
  }

  function updateLegs(canStart) {
    const pos = group.position;
    const quat = group.quaternion;
    const half = state.phase % 1;
    const active = half < 0.5 ? 0 : 1;
    const tau = (half % 0.5) / 0.5;
    const speedK = clamp(state.speed / 0.13, 0, 1);
    for (const leg of legs) {
      if (leg.group === active && (canStart || leg.swinging)) {
        if (!leg.swinging) {
          leg.swinging = true;
          leg.from.copy(leg.foot);
          _cv[5].copy(leg.home).applyQuaternion(quat).add(pos);
          _cv[5].addScaledVector(state.moveDir, CRAB_STRIDE * 0.5 * speedK);
          _cv[5].x = clamp(_cv[5].x, TANK.ixMin + 0.05, TANK.ixMax - 0.05);
          _cv[5].z = clamp(_cv[5].z, TANK.izMin + 0.05, TANK.izMax - 0.05);
          leg.to.set(_cv[5].x, groundHeightAt(_cv[5].x, _cv[5].z), _cv[5].z);
        }
        const k = smoothstep(0, 1, tau);
        leg.foot.lerpVectors(leg.from, leg.to, k);
        leg.foot.y = lerp(leg.from.y, leg.to.y, k) + Math.sin(tau * Math.PI) * 0.035;
        if (tau >= 0.999) { leg.foot.copy(leg.to); leg.swinging = false; }
      } else {
        leg.swinging = false;     // stance: the foot stays planted where it landed
      }
      // two-link IK
      _cv[6].copy(leg.foot).sub(pos).applyQuaternion(_cq1.copy(quat).invert()).sub(leg.hip.position);
      const dx = leg.side > 0 ? _cv[6].x : -_cv[6].x;
      const theta = Math.atan2(_cv[6].z, dx);
      const d = Math.hypot(dx, _cv[6].z);
      let r = Math.hypot(d, _cv[6].y);
      r = clamp(r, 0.1, L1 + L2 - 0.012);
      const phi = Math.atan2(_cv[6].y, d);
      const A = Math.acos(clamp((L1 * L1 + r * r - L2 * L2) / (2 * L1 * r), -1, 1));
      const B = Math.acos(clamp((L1 * L1 + L2 * L2 - r * r) / (2 * L1 * L2), -1, 1));
      leg.hip.rotation.y = leg.baseYaw + (leg.side > 0 ? -theta : theta);
      leg.upper.rotation.z = phi + A;
      leg.knee.rotation.z = -(Math.PI - B);
    }
  }

  parent.add(group);
  SIM.add((dt) => update(dt));
  return { group, legs, claws, state, setObstacles, setSnailProbe(fn) { snailProbe = fn; }, update };
}
