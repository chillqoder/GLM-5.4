// Stage 11 — autonomous swimming. Each fish has its own state machine, wander targets,
// acceleration / turn-rate limits, predictive wall and obstacle avoidance, separation from the
// other fish, banking, and a tail beat coupled to swimming effort.

const FISH_AGENTS = [];
const _X_AXIS = new THREE.Vector3(1, 0, 0);
const _sv1 = new THREE.Vector3(), _sv2 = new THREE.Vector3(), _sv3 = new THREE.Vector3(), _sv4 = new THREE.Vector3(), _sv5 = new THREE.Vector3(), _sv6 = new THREE.Vector3(), _sv7 = new THREE.Vector3();
const _sq1 = new THREE.Quaternion(), _sq2 = new THREE.Quaternion();
const _sray = new THREE.Ray();
const _sbox = new THREE.Box3();
const _ssphere = new THREE.Sphere();

// Does the segment a → b (inflated by radius) pass through any solid volume?
function segmentBlocked(a, b, radius, obstacles) {
  _sv7.subVectors(b, a);
  const len = _sv7.length();
  if (len < 1e-6) return false;
  _sray.set(a, _sv7.divideScalar(len));
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (o.isBox3) {
      _sbox.copy(o).expandByScalar(radius);
      const hit = _sray.intersectBox(_sbox, _sv6);
      if (hit && hit.distanceTo(a) <= len) return true;
    } else {
      _ssphere.set(o.center ?? o, (o.radius ?? 0) + radius);
      if (_sray.intersectSphere(_ssphere, _sv6) && _sv6.distanceTo(a) <= len) return true;
    }
  }
  return false;
}

// Steering force that keeps a point out of every solid volume (inflated by radius).
function avoidanceForce(point, radius, obstacles, out) {
  out.set(0, 0, 0);
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (o.isBox3) {
      _sbox.copy(o).expandByScalar(radius);
      if (_sbox.containsPoint(point)) {
        // push out along the axis of least penetration
        const dx1 = point.x - _sbox.min.x, dx2 = _sbox.max.x - point.x;
        const dy1 = point.y - _sbox.min.y, dy2 = _sbox.max.y - point.y;
        const dz1 = point.z - _sbox.min.z, dz2 = _sbox.max.z - point.z;
        const m = Math.min(dx1, dx2, dy1, dy2, dz1, dz2);
        if (m === dx1) out.x -= 3; else if (m === dx2) out.x += 3; else if (m === dy1) out.y -= 3; else if (m === dy2) out.y += 3; else if (m === dz1) out.z -= 3; else out.z += 3;
      } else {
        _sv6.set(clamp(point.x, _sbox.min.x, _sbox.max.x), clamp(point.y, _sbox.min.y, _sbox.max.y), clamp(point.z, _sbox.min.z, _sbox.max.z));
        const d = point.distanceTo(_sv6);
        if (d < radius) out.addScaledVector(_sv7.subVectors(point, _sv6).normalize(), (radius - d) * 2.5);
      }
    } else {
      const c = o.center ?? o;
      const rr = (o.radius ?? 0) + radius;
      const d = point.distanceTo(c);
      if (d < rr) out.addScaledVector(_sv7.subVectors(point, c).normalize(), (rr - d) * 3.0 + 0.5);
    }
  }
  return out;
}

class FishAgent {
  constructor(model, cfg, obstacles) {
    this.model = model;
    this.cfg = cfg;
    this.obstacles = obstacles;
    this.root = model.root;
    this.vel = new THREE.Vector3(1, 0, 0);
    this.target = new THREE.Vector3();
    this.heading = new THREE.Quaternion();     // yaw + pitch only (no bank)
    this.state = 'cruise';
    this.stateTimer = cfg.rng ? 0 : 0;
    this.retargetTimer = 0;
    this.turn = 0;
    this.speed = 0;
    this.stuck = 0;
    this.rng = new Rng(cfg.seed);
    this.beat = this.rng.range(0, TWO_PI);
    this._bounds = new THREE.Box3();
    this._inner = new THREE.Box3();
    // start somewhere sensible inside the preferred zone
    const b = this.bounds();
    this.root.position.set(
      this.rng.range(lerp(b.min.x, b.max.x, 0.3), lerp(b.min.x, b.max.x, 0.7)),
      this.rng.range(lerp(b.min.y, b.max.y, cfg.zone[0]), lerp(b.min.y, b.max.y, cfg.zone[1])),
      this.rng.range(lerp(b.min.z, b.max.z, 0.3), lerp(b.min.z, b.max.z, 0.7)),
    );
    this.vel.set(this.rng.sign(), 0, this.rng.range(-0.4, 0.4)).normalize().multiplyScalar(cfg.cruise);
    quaternionFromForward(this.vel, UP, this.heading);
    this.root.quaternion.copy(this.heading);
    this.pickTarget(true);
    this.nextState(true);
    FISH_AGENTS.push(this);
    SIM.add((dt) => this.update(dt));
  }

  bounds() {
    const m = this.cfg.margin;
    const ground = 0.42 + m.bottom;
    return this._bounds.set(
      _sv1.set(TANK.ixMin + m.side, ground, TANK.izMin + m.side),
      _sv2.set(TANK.ixMax - m.side, TANK.waterLevel - 0.12 - m.top, TANK.izMax - m.side),
    );
  }

  pickTarget(initial = false) {
    const cfg = this.cfg, b = this.bounds();
    const from = this.root.position;
    const inner = this._inner.set(b.min.x + 0.3, b.min.y + 0.15, b.min.z + 0.3, b.max.x - 0.3, b.max.y - 0.15, b.max.z - 0.3);
    for (let tries = 0; tries < 12; tries++) {
      let x, z;
      const roll = this.rng.float();
      if (roll < cfg.biasCentral) {           // cross the open, well-lit middle
        x = this.rng.range(-1.3, 1.7); z = this.rng.range(0.1, 1.5);
      } else if (roll < cfg.biasCentral + (cfg.biasPoints ? cfg.biasPoints.length * 0.07 : 0) && cfg.biasPoints) {
        const p = cfg.biasPoints[this.rng.int(0, cfg.biasPoints.length - 1)];   // curious visits
        x = p[0] + this.rng.gauss() * 0.45; z = p[1] + this.rng.gauss() * 0.45;
      } else {
        x = this.rng.range(inner.min.x, inner.max.x); z = this.rng.range(inner.min.z, inner.max.z);
      }
      x = clamp(x, inner.min.x, inner.max.x); z = clamp(z, inner.min.z, inner.max.z);
      const y = this.rng.range(lerp(inner.min.y, inner.max.y, cfg.zone[0]), lerp(inner.min.y, inner.max.y, cfg.zone[1]));
      this.target.set(x, y, z);
      if (!segmentBlocked(from, this.target, cfg.radius + 0.1, this.obstacles)) break;
      if (tries === 11) {
        // fall back to a short hop toward the tank centre
        this.target.copy(from).lerp(_sv3.set(0, clamp(from.y, b.min.y, b.max.y), 0), 0.25);
      }
    }
    this.retargetTimer = this.rng.range(cfg.retarget[0], cfg.retarget[1]);
  }

  nextState(initial = false) {
    const cfg = this.cfg, r = this.rng.float();
    if (this.state === 'hover') this.state = r < cfg.burstChance ? 'burst' : 'cruise';
    else if (this.state === 'burst') this.state = 'cruise';
    else this.state = r < cfg.hoverChance ? 'hover' : (r < cfg.hoverChance + cfg.burstChance ? 'burst' : 'cruise');
    const d = cfg.durations[this.state];
    this.stateTimer = this.rng.range(d[0], d[1]) * (initial ? 0.5 : 1);
    if (this.state !== 'hover' && (this.target.distanceTo(this.root.position) < 0.4 || this.rng.float() < 0.5)) this.pickTarget();
  }

  update(dt) {
    const cfg = this.cfg, u = this.model.uniforms, pos = this.root.position;
    this.stateTimer -= dt; this.retargetTimer -= dt;
    if (this.stateTimer <= 0) this.nextState();
    if (this.retargetTimer <= 0) this.pickTarget();

    const desiredSpeed = this.state === 'hover' ? 0.03 : this.state === 'burst' ? cfg.burst : cfg.cruise;
    const des = _sv1.copy(this.target).sub(pos);
    if (des.lengthSq() > 1e-8) des.normalize();
    des.multiplyScalar(desiredSpeed);

    // predictive wall avoidance on a look-ahead point
    const look = _sv2.copy(pos).addScaledVector(this.vel, 1.2);
    const b = this.bounds();
    if (look.x < b.min.x) des.x += (b.min.x - look.x) * 9; else if (look.x > b.max.x) des.x -= (look.x - b.max.x) * 9;
    if (look.y < b.min.y) des.y += (b.min.y - look.y) * 9; else if (look.y > b.max.y) des.y -= (look.y - b.max.y) * 9;
    if (look.z < b.min.z) des.z += (b.min.z - look.z) * 9; else if (look.z > b.max.z) des.z -= (look.z - b.max.z) * 9;
    // obstacles
    avoidanceForce(look, cfg.radius, this.obstacles, _sv3);
    des.add(_sv3);
    // separation from the other fish
    for (let i = 0; i < FISH_AGENTS.length; i++) {
      const o = FISH_AGENTS[i];
      if (o === this) continue;
      const d = look.distanceTo(o.root.position);
      const want = (cfg.radius + o.cfg.radius) * 1.15;
      if (d < want) des.addScaledVector(_sv4.subVectors(look, o.root.position).normalize(), (want - d) * 1.6);
    }
    // limited acceleration
    const acc = _sv4.copy(des).sub(this.vel);
    const maxA = cfg.accel * dt;
    if (acc.lengthSq() > maxA * maxA) acc.setLength(maxA);
    this.vel.add(acc);
    let sp = this.vel.length();
    const maxSp = this.state === 'burst' ? cfg.burst * 1.1 : cfg.cruise * 1.35;
    if (sp > maxSp) { this.vel.multiplyScalar(maxSp / sp); sp = maxSp; }
    if (this.state === 'hover') { this.vel.multiplyScalar(Math.exp(-2.5 * dt)); sp = this.vel.length(); }
    else if (sp < 0.06 && this.state === 'cruise') { this.stuck += dt; if (this.stuck > 1.5) { this.pickTarget(); this.state = 'burst'; this.stateTimer = 0.4; this.stuck = 0; } }
    else this.stuck = 0;
    // limited climb rate keeps the pitch restrained
    const horiz = Math.hypot(this.vel.x, this.vel.z);
    const maxVy = horiz * 0.45 + 0.02;
    this.vel.y = clamp(this.vel.y, -maxVy, maxVy);
    this.speed = sp;

    // orientation: turn-rate limited slerp toward the velocity direction
    const fwd = _sv5.set(1, 0, 0).applyQuaternion(this.heading);
    const dir = sp > 1e-4 ? _sv6.copy(this.vel).normalize() : fwd;
    quaternionFromForward(dir, UP, _sq1);
    const angle = this.heading.angleTo(_sq1);
    const maxStep = cfg.turnRate * dt;
    if (angle > 1e-5) this.heading.slerp(_sq1, Math.min(1, maxStep / angle));
    // banking from the signed lateral turn
    const turnSig = clamp(fwd.x * dir.z - fwd.z * dir.x, -1, 1);
    this.turn = damp(this.turn, turnSig * clamp(sp / cfg.cruise, 0, 1.5), 4, dt);
    _sq2.setFromAxisAngle(_X_AXIS, -this.turn * cfg.bank);
    this.root.quaternion.copy(this.heading).multiply(_sq2);

    // integrate, then the hard safeguards
    pos.addScaledVector(this.vel, dt);
    const bb = this.bounds();
    pos.x = clamp(pos.x, bb.min.x, bb.max.x); pos.y = clamp(pos.y, bb.min.y, bb.max.y); pos.z = clamp(pos.z, bb.min.z, bb.max.z);
    avoidanceForce(pos, cfg.radius * 0.6, this.obstacles, _sv3);
    if (_sv3.lengthSq() > 0) pos.addScaledVector(_sv3, dt);
    for (let i = 0; i < FISH_AGENTS.length; i++) {
      const o = FISH_AGENTS[i];
      if (o === this) continue;
      const d = pos.distanceTo(o.root.position);
      const minD = (cfg.radius + o.cfg.radius) * 0.9;
      if (d < minD && d > 1e-4) pos.addScaledVector(_sv4.subVectors(pos, o.root.position).normalize(), (minD - d) * 0.5);
    }
    pos.x = clamp(pos.x, bb.min.x, bb.max.x); pos.y = clamp(pos.y, bb.min.y, bb.max.y); pos.z = clamp(pos.z, bb.min.z, bb.max.z);

    // animation follows effort
    const effort = clamp(sp / cfg.cruise, 0, 1.8);
    const freq = this.state === 'hover' ? 0.9 + 0.4 * Math.sin(SIM.time * 0.7 + cfg.seed) : 1.1 + 2.4 * Math.sqrt(effort);
    this.beat += dt * TWO_PI * freq;
    u.uBeat.value = this.beat;
    u.uAmp.value = damp(u.uAmp.value, this.state === 'hover' ? 0.14 : 0.2 + 0.8 * Math.min(1.4, effort), 3, dt);
    u.uTurn.value = this.turn * 0.6;
  }
}

const FISH_BEHAVIOUR = {
  guppy: {
    seed: 11, cruise: 0.78, burst: 1.9, accel: 2.4, turnRate: 2.8, bank: 0.4, radius: 0.3,
    margin: { side: 0.66, top: 0.3, bottom: 0.4 }, zone: [0.55, 0.95],
    hoverChance: 0.3, burstChance: 0.18, durations: { cruise: [1.5, 4.0], hover: [0.5, 1.3], burst: [0.35, 0.7] },
    retarget: [2.5, 6], biasCentral: 0.4, biasPoints: null,
  },
  clownfish: {
    seed: 22, cruise: 0.5, burst: 1.1, accel: 1.5, turnRate: 2.0, bank: 0.3, radius: 0.38,
    margin: { side: 0.75, top: 0.3, bottom: 0.35 }, zone: [0.35, 0.75],
    hoverChance: 0.25, burstChance: 0.08, durations: { cruise: [3, 7], hover: [1.2, 2.6], burst: [0.4, 0.8] },
    retarget: [4, 9], biasCentral: 0.3, biasPoints: [[-0.2, 0.7], [2.4, -0.3], [-2.2, 0.4], [0.9, -0.9]],
  },
  angelfish: {
    seed: 33, cruise: 0.42, burst: 0.8, accel: 0.9, turnRate: 1.3, bank: 0.18, radius: 0.7,
    margin: { side: 0.7, top: 0.85, bottom: 1.05 }, zone: [0.3, 0.85],
    hoverChance: 0.35, burstChance: 0.04, durations: { cruise: [4, 9], hover: [2, 4.5], burst: [0.5, 0.9] },
    retarget: [5, 11], biasCentral: 0.45, biasPoints: null,
  },
  betta: {
    seed: 44, cruise: 0.32, burst: 0.7, accel: 0.7, turnRate: 1.15, bank: 0.25, radius: 0.55,
    margin: { side: 0.72, top: 0.42, bottom: 0.5 }, zone: [0.55, 0.93],
    hoverChance: 0.4, burstChance: 0.05, durations: { cruise: [3, 7], hover: [1.5, 3.2], burst: [0.5, 1.0] },
    retarget: [5, 10], biasCentral: 0.4, biasPoints: null,
  },
};

function createFishSchool(parent, obstacles) {
  const agents = [];
  for (const kind of Object.keys(FISH_SPECS)) {
    const model = createFish(kind, 1);
    parent.add(model.root);
    agents.push(new FishAgent(model, FISH_BEHAVIOUR[kind], obstacles));
  }
  return agents;
}
