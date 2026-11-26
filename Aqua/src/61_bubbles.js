// --- bubbles ------------------------------------------------------------------------------------
// Instanced pool; inactive slots simply have radius 0 (degenerate, never rasterised).
const BUBBLE_VS = /* glsl */`
uniform float uTime;
attribute vec3 aInstPos;
attribute float aInstRad;
attribute float aInstSeed;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  float wob = sin(uTime * 11.0 + aInstSeed * 37.0);
  vec3 p = position * aInstRad;
  p.x *= 1.0 + 0.07 * wob;
  p.z *= 1.0 - 0.07 * wob;
  vec3 wp = aInstPos + p;
  vN = normalize(position);
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const BUBBLE_FS = /* glsl */`
uniform samplerCube uEnvCube;
uniform vec3 uKeyDir;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 2.4);                      // thin film: bright curved rim, clear centre
  vec3 env = textureLod(uEnvCube, reflect(-v, n), 2.2).rgb;
  float spec = pow(clamp(dot(n, normalize(uKeyDir + v)), 0.0, 1.0), 140.0);   // key-light glint
  float spec2 = pow(clamp(dot(n, normalize(-uKeyDir * vec3(1.0, -1.0, 1.0) + v)), 0.0, 1.0), 40.0) * 0.45;  // refracted glint
  vec3 col = env * rim * 1.8 + vec3(0.72, 0.88, 1.0) * rim * 0.55 + vec3(1.0, 0.98, 0.95) * (spec * 2.2 + spec2);
  float alpha = clamp(rim * 0.95 + spec + spec2 * 0.7 + 0.08, 0.0, 1.0);
  gl_FragColor = vec4(col + vec3(0.02, 0.05, 0.07), alpha);
}`;

class BubbleSystem {
  constructor(parent, env, lights, count = 256) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.rad = new Float32Array(count);
    this.age = new Float32Array(count);
    this.seed = new Float32Array(count);
    this.active = new Uint8Array(count);
    this.alive = 0;
    this.rng = new Rng(99);
    this.emitAcc = 0;
    this.nextEmit = 0.08;
    this.rate = 15;                  // bubbles per second
    this.source = new THREE.Vector3(0, 2, 0);
    this.dir = new THREE.Vector3(-1, 0.2, 0);
    this._cur = new THREE.Vector3();

    const base = new THREE.SphereGeometry(1, 12, 9);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('normal', base.attributes.normal);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aRad = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
    const aSeed = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    for (let i = 0; i < count; i++) aSeed.setX(i, this.rng.float());
    geo.setAttribute('aInstPos', this.aPos);
    geo.setAttribute('aInstRad', this.aRad);
    geo.setAttribute('aInstSeed', aSeed);
    geo.instanceCount = count;

    const mat = new THREE.ShaderMaterial({
      uniforms: { ...SIM_UNIFORMS, uEnvCube: { value: env.cube }, uKeyDir: { value: lights.keyDir } },
      vertexShader: BUBBLE_VS,
      fragmentShader: BUBBLE_FS,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'bubbles';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    parent.add(this.mesh);
    SIM.add((dt, t) => this.update(dt, t));
  }

  setSource(origin, dir, rate) {
    this.source.copy(origin);
    this.dir.copy(dir).normalize();
    if (rate) this.rate = rate;
  }

  spawn() {
    let slot = -1;
    for (let i = 0; i < this.count; i++) { if (!this.active[i]) { slot = i; break; } }
    if (slot < 0) return;
    const r = this.rng.float() < 0.1 ? this.rng.range(0.04, 0.058) : this.rng.range(0.014, 0.034);
    const i3 = slot * 3;
    this.pos[i3] = this.source.x + this.rng.gauss() * 0.02;
    this.pos[i3 + 1] = this.source.y + this.rng.gauss() * 0.02;
    this.pos[i3 + 2] = this.source.z + this.rng.gauss() * 0.02;
    const kick = this.rng.range(0.35, 0.6);
    this.vel[i3] = this.dir.x * kick + this.rng.gauss() * 0.12;
    this.vel[i3 + 1] = this.dir.y * kick + this.rng.gauss() * 0.08;
    this.vel[i3 + 2] = this.dir.z * kick + this.rng.gauss() * 0.12;
    this.rad[slot] = r; this.age[slot] = 0; this.seed[slot] = this.rng.float(); this.active[slot] = 1;
    this.alive++;
  }

  update(dt, t) {
    // irregular emission: random inter-arrival times, occasional double releases
    this.emitAcc += dt;
    while (this.emitAcc >= this.nextEmit) {
      this.emitAcc -= this.nextEmit;
      this.nextEmit = this.rng.range(0.025, 1.6 / this.rate);
      this.spawn();
      if (this.rng.float() < 0.18) this.spawn();
    }
    const y0 = this.source.y, H = TANK.waterLevel - y0;
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;
      const i3 = i * 3;
      const r = this.rad[i];
      this.age[i] += dt;
      const x = this.pos[i3], y = this.pos[i3 + 1], z = this.pos[i3 + 2];
      // buoyancy: terminal rise grows with radius; the shared updraft accelerates the plume core
      const vTerm = 0.55 + 9.0 * r;
      currentField(x, y, z, t, this._cur);
      this.vel[i3 + 1] = damp(this.vel[i3 + 1], vTerm + this._cur.y, 3.0, dt);
      // lateral: initial kick decays, wobble widens with height, plus the ambient current
      const hFrac = clamp((y - y0) / H, 0, 1);
      const w = 0.05 + 0.16 * hFrac;
      const ph = this.seed[i] * 20.0;
      const om = 5.0 + 6.0 * this.seed[i];
      const wobX = Math.sin(this.age[i] * om + ph) * w, wobZ = Math.cos(this.age[i] * om * 1.17 + ph) * w;
      this.vel[i3] = damp(this.vel[i3], wobX + this._cur.x, 2.2, dt);
      this.vel[i3 + 2] = damp(this.vel[i3 + 2], wobZ + this._cur.z, 2.2, dt);
      let nx = x + this.vel[i3] * dt, ny = y + this.vel[i3 + 1] * dt, nz = z + this.vel[i3 + 2] * dt;
      const nr = r + dt * 0.0035;          // expand subtly on the way up, never shrink
      // the animated surface is the end of the journey
      const surf = waveHeightAt(nx, nz, t);
      if (ny + r * 0.5 >= surf) {
        this.active[i] = 0; this.alive--;
        spawnRipple(nx, nz, t, clamp(r / 0.03, 0.4, 1.8));
        this.aRad.setX(i, 0);
        continue;
      }
      // stay inside the glass
      nx = clamp(nx, TANK.ixMin + r, TANK.ixMax - r);
      nz = clamp(nz, TANK.izMin + r, TANK.izMax - r);
      this.pos[i3] = nx; this.pos[i3 + 1] = ny; this.pos[i3 + 2] = nz;
      this.rad[i] = nr;
      this.aPos.setXYZ(i, nx, ny, nz);
      this.aRad.setX(i, nr);
    }
    this.aPos.needsUpdate = true;
    this.aRad.needsUpdate = true;
  }
}
