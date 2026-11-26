// Scripted input driver for deterministic checks. The bot only uses ordinary player inputs
// (held keys and fresh presses) and reads the public inspection state, exactly like a player.
import { FIXED_STEP } from '../src/sim/tuning.js';

export class Bot {
  constructor(game, label = 'bot') {
    this.g = game;
    this.label = label;
    this.log = [];
  }

  get p() {
    return this.g.player;
  }

  set(key, down) {
    this.g.setKey(key, down);
  }

  releaseAll() {
    this.g.releaseAll();
  }

  step(n = 1) {
    for (let i = 0; i < n; i++) this.g.step();
  }

  run(seconds) {
    this.step(Math.round(seconds / FIXED_STEP));
  }

  /** Fresh press held for `hold` seconds. */
  tap(key, hold = 0.06) {
    this.set(key, false);
    this.step(1);
    this.set(key, true);
    this.run(hold);
    this.set(key, false);
    this.step(1);
  }

  /** Step until `pred` is true; throws with context on timeout. */
  until(pred, timeout, each, what = 'condition') {
    let t = 0;
    const limit = Math.round(timeout / FIXED_STEP);
    let i = 0;
    while (!pred()) {
      if (each) each(i);
      this.g.step();
      t += FIXED_STEP;
      i += 1;
      if (i > limit) {
        const s = this.g.getState();
        throw new Error(`[${this.label}] timeout waiting for ${what} after ${timeout}s; player x=${s.player.x.toFixed(2)} y=${s.player.y.toFixed(2)} state=${s.state} vx=${s.player.vx.toFixed(2)} vy=${s.player.vy.toFixed(2)}`);
      }
    }
    return t;
  }

  /** Wait while grounded doing nothing. */
  wait(seconds) {
    this.releaseAll();
    this.run(seconds);
  }

  /** Walk toward x on the current surface and settle. */
  walkTo(x, tol = 0.12, timeout = 20) {
    const g = this.g;
    const pred = () => Math.abs(this.p.x - x) <= tol && Math.abs(this.p.vx) < 0.01;
    let guard = 0;
    while (!pred()) {
      if (guard++ * FIXED_STEP > timeout) throw new Error(`[${this.label}] walkTo ${x} timeout at ${this.p.x.toFixed(2)}`);
      const dir = this.p.x < x ? 1 : -1;
      // Predict stopping point under ground braking.
      const stop = this.p.x + dir * (this.p.vx * dir > 0 ? (this.p.vx * this.p.vx) / (2 * 38) : 0);
      const far = Math.abs(x - stop) > 0.04;
      g.setKey('left', dir < 0 ? far : false);
      g.setKey('right', dir > 0 ? far : false);
      g.step();
    }
    g.setKey('left', false);
    g.setKey('right', false);
    // Settle any residual velocity.
    this.until(() => Math.abs(this.p.vx) < 0.01, 1);
    g.setKey('left', false);
    g.setKey('right', false);
  }

  /** Hold a direction until the player passes x (no stops), then settle. */
  runTo(x, timeout = 12) {
    const g = this.g;
    const dir = x < this.p.x ? -1 : 1;
    g.setKey(dir < 0 ? 'left' : 'right', true);
    this.until(() => dir * (this.p.x - x) >= 0 && this.p.grounded, timeout, null, `runTo ${x}`);
    g.setKey(dir < 0 ? 'left' : 'right', false);
    this.until(() => Math.abs(this.p.vx) < 0.01 && this.p.grounded, 2, null, 'runTo settle');
  }

  /** Jump with a hold time and a horizontal direction held during the rise. */
  jump(hold = 0.3, dir = 0, settle = true) {
    const g = this.g;
    g.setKey('jump', false);
    this.step(1);
    g.setKey('left', dir < 0);
    g.setKey('right', dir > 0);
    g.setKey('jump', true);
    this.run(hold);
    g.setKey('jump', false);
    if (settle) this.until(() => this.p.grounded && this.p.vy <= 0, 3, null, 'landing');
    g.setKey('left', false);
    g.setKey('right', false);
  }

  /** Jump toward a target x from a standstill: hold direction until close, then release. */
  jumpTo(targetX, hold = 0.3, timeout = 3) {
    const g = this.g;
    g.setKey('left', false);
    g.setKey('right', false);
    if (this.p.grounded) this.until(() => Math.abs(this.p.vx) < 0.01, 2, null, 'jumpTo settle');
    g.setKey('jump', false);
    this.step(1);
    const dir = targetX < this.p.x ? -1 : 1;
    g.setKey(dir < 0 ? 'left' : 'right', true);
    g.setKey('jump', true);
    this.run(hold);
    g.setKey('jump', false);
    this.until(() => this.p.grounded || dir * (this.p.x - targetX) >= 0, timeout, null, 'jumpTo reach');
    g.setKey(dir < 0 ? 'left' : 'right', false);
    if (!this.p.grounded && dir * this.p.vx > 0.5) {
      // Kill the remaining horizontal speed so the landing does not coast past the target.
      g.setKey(dir < 0 ? 'right' : 'left', true);
      this.until(() => this.p.grounded || dir * this.p.vx <= 0.5, timeout, null, 'jumpTo brake');
      g.setKey(dir < 0 ? 'right' : 'left', false);
    }
    this.until(() => this.p.grounded && this.p.vy <= 0, 3, null, 'jumpTo landing');
    g.setKey('left', false);
    g.setKey('right', false);
  }

  /**
   * Wall-jump climb inside a shaft until the feet reach targetY. With exitDir ±1 the routine waits
   * for contact with the opposite wall at that height so the final wall jump lands toward the exit.
   */
  climb(targetY, timeout = 25, exitDir = 0) {
    const g = this.g;
    let jumpHeld = 0;
    let lastPress = -100;
    let side = 1;
    const arrived = () => this.p.y >= targetY && (exitDir === 0 || this.p.wallContact === -exitDir || this.p.grounded);
    const t = this.until(
      arrived,
      timeout,
      () => {
        const p = this.p;
        if (jumpHeld > 0) {
          jumpHeld -= 1;
          if (jumpHeld === 0) g.setKey('jump', false);
        }
        if (p.grounded) {
          // From the floor: jump toward the nearest wall.
          g.setKey('jump', false);
          g.setKey('left', side < 0);
          g.setKey('right', side > 0);
          if (g.steps - lastPress > 4) {
            g.setKey('jump', true);
            jumpHeld = 30;
            lastPress = g.steps;
          }
          return;
        }
        if (p.wallContact !== 0) {
          side = -p.wallContact; // leap away from the contacted wall
          g.setKey('left', side < 0);
          g.setKey('right', side > 0);
          if (jumpHeld === 0 && g.steps - lastPress > 4) {
            g.setKey('jump', true);
            jumpHeld = 30;
            lastPress = g.steps;
          }
        }
      },
      `climb to y=${targetY}`
    );
    if (exitDir && !this.p.grounded) {
      // Push off toward the exit with a full-height wall jump.
      if (!g.input.jump) {
        g.setKey('jump', false);
        g.step();
        g.setKey('jump', true);
      }
      g.setKey('left', exitDir < 0);
      g.setKey('right', exitDir > 0);
      this.run(0.3);
      g.setKey('jump', false);
      this.until(() => this.p.grounded, 4, null, 'climb exit landing');
    } else if (exitDir) {
      g.setKey('left', false);
      g.setKey('right', false);
      this.until(() => Math.abs(this.p.vx) < 0.01, 2);
    }
    g.setKey('jump', false);
    g.setKey('left', false);
    g.setKey('right', false);
    return t;
  }

  record(note) {
    const s = this.g.getState();
    this.log.push(`${note}: x=${s.player.x.toFixed(2)} y=${s.player.y.toFixed(2)} t=${s.time.toFixed(1)}`);
  }

  /** Turn to face `dir` with a negligible two-step tap. */
  face(dir) {
    const key = dir < 0 ? 'left' : 'right';
    this.g.setKey(key, true);
    this.step(2);
    this.g.setKey(key, false);
    this.until(() => Math.abs(this.p.vx) < 0.01, 1);
  }

  /** Wait until resonance energy is at least `n` (natural regeneration). */
  ensureEnergy(n, timeout = 12) {
    this.until(() => this.p.energy >= n, timeout, null, `energy >= ${n}`);
  }

  state() {
    return this.g.getState();
  }
}
