// Camera rig: smooth follow with look-ahead, vertical dead zone, chamber bounds,
// restrained relay look, lift follow and clamped shake. Never affects collision.
import * as THREE from '../../vendor/three.module.js';

export class CameraRig {
  constructor(camera, bounds) {
    this.camera = camera;
    this.bounds = bounds;
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.yaw = 0.2;
    this.pitch = 0.17;
    this.dist = 42;
    this.shakeX = 0;
    this.shakeY = 0;
    this.reduced = false;
    this.look = null; // { x, y, k } restrained look target
    this._v = new THREE.Vector3();
    this.first = true;
  }

  setViewport(viewW, viewH) {
    this.viewW = viewW;
    this.viewH = viewH;
  }

  setReducedMotion(v) {
    this.reduced = v;
  }

  snapTo(x, y) {
    this.x = x;
    this.y = y;
    this.first = false;
  }

  /** Desired framing center for the current state. */
  compute(game, dt) {
    const p = game.player;
    const st = game.state;
    const b = this.bounds;
    let tx = p.x + (p.facing || 1) * 2.0 + p.vx * 0.14;
    let ty = p.y + 1.2;
    let rateX = 6;
    let rateY = 4;
    if (st === 'title') {
      tx = 9.5 + Math.sin(game.titleTime * 0.15) * 1.2;
      ty = 2.6;
      rateX = 2;
      rateY = 2;
    } else if (st === 'liftSequence') {
      const car = game.world.movers[game.level.lift.mover];
      tx = p.x + 3.5;
      ty = (car.rect.y1 + car.rect.y2) / 2 + 2.5;
      rateX = 3;
      rateY = 4;
    } else if (st === 'complete') {
      tx = 197;
      ty = 47.5;
      rateX = 1.5;
      rateY = 1.5;
    } else if (st === 'relayActivation' && game.pendingRelay) {
      const r = game.level.relays.find((x) => x.id === game.pendingRelay);
      const k = Math.sin(Math.min(1, 1 - game.timer / 2.4) * Math.PI); // 0 → 1 → 0 over the cinematic
      tx = r.x + 6 * k;
      ty = r.y + 2.5 + 1.5 * k;
      rateX = 3;
      rateY = 2.5;
    }
    // Clamp so the camera never exposes voids beyond the authored course.
    const hw = (this.viewW || 24) / 2 - 1;
    const hh = (this.viewH || 14) / 2 - 1;
    tx = Math.min(Math.max(tx, b.x1 + hw), b.x2 - hw);
    ty = Math.min(Math.max(ty, b.y1 + hh), b.y2 - hh);

    if (this.first) {
      this.x = tx;
      this.y = ty;
      this.first = false;
    }
    // Vertical dead zone: follow only when ILO leaves a band around the current center.
    const band = st === 'play' ? 1.6 : 0;
    const dy = ty - this.y;
    const wantY = Math.abs(dy) > band ? ty - Math.sign(dy) * band : this.y;
    const kx = Math.min(1, rateX * dt);
    const ky = Math.min(1, rateY * dt);
    this.x += (tx - this.x) * kx;
    this.y += (wantY - this.y) * ky;
    this.targetX = this.x;
    this.targetY = this.y;
  }

  apply(shake, time) {
    const sx = this.reduced ? 0 : Math.sin(time * 37) * shake;
    const sy = this.reduced ? 0 : Math.cos(time * 43) * shake * 0.7;
    const cx = this.x + sx;
    const cy = this.y + sy;
    const ox = Math.sin(this.yaw) * this.dist;
    const oy = Math.sin(this.pitch) * this.dist;
    const oz = Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist;
    this.camera.position.set(cx + ox, cy + oy, oz);
    this.camera.lookAt(cx, cy, 0);
  }
}
