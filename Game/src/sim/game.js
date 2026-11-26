// DEEPWAKE authoritative game: explicit state machine, fixed-step orchestration,
// checkpoint recovery, relay cinematics and the staged lift ending.
// Pure simulation (no DOM / Three.js) so the same code runs in Node tests and the browser.

import { TUNING as T, STATE, FIXED_STEP } from './tuning.js';
import { createLevel, regionAt } from './level.js';
import { createPlayer, updatePlayer, applyKnockback } from './player.js';
import * as W from './world.js';
import { updateEnemies, updateBolts } from './enemies.js';
import { rectsOverlap, pointInRect, moveToward } from './math.js';

const NO_INPUT = Object.freeze({ left: false, right: false, jump: false, dash: false, jumpPressed: false, dashPressed: false });

export class Game {
  constructor(level = createLevel()) {
    this.level = level;
    this.world = W.createWorld(level);
    this.player = createPlayer(level.spawn.x, level.spawn.y);
    this.state = STATE.TITLE;
    this.events = [];
    this.input = { left: false, right: false, jump: false, dash: false, pulse: false, interact: false, retry: false };
    this.prevInput = { ...this.input };
    this.snapshot = null;
    this.timer = 0;
    this.shutdownReason = null;
    this.pendingRelay = null;
    this.result = null;
    this.committed = false;
    this.archiveOpen = null;
    this.archiveTimer = 0;
    this.interaction = null;
    this.titleTime = 0;
    this.runId = 0;
    this.region = 'workshop';
    this.steps = 0;
  }

  // ------------------------------------------------------------------ input
  setKey(action, down) {
    if (action in this.input) this.input[action] = !!down;
  }

  releaseAll() {
    for (const k of Object.keys(this.input)) this.input[k] = false;
    for (const k of Object.keys(this.prevInput)) this.prevInput[k] = false;
  }

  edges() {
    const e = {};
    for (const k of Object.keys(this.input)) {
      e[k] = this.input[k];
      e[`${k}Pressed`] = this.input[k] && !this.prevInput[k];
    }
    return e;
  }

  // ------------------------------------------------------------------ flow
  begin() {
    if (this.state !== STATE.TITLE) return false;
    this.resetRun();
    this.state = STATE.PLAY;
    this.commitCheckpoint(this.level.stations[0]);
    this.events.push({ type: 'begin' });
    return true;
  }

  /** Restart Expedition: fresh world, all run state cleared. Records live outside the sim. */
  restartExpedition() {
    if (![STATE.PAUSED, STATE.COMPLETE, STATE.PLAY].includes(this.state)) return false;
    this.resetRun();
    this.state = STATE.PLAY;
    this.commitCheckpoint(this.level.stations[0]);
    this.events.push({ type: 'restart' });
    return true;
  }

  resetRun() {
    this.world = W.createWorld(this.level);
    this.player = createPlayer(this.level.spawn.x, this.level.spawn.y);
    this.snapshot = null;
    this.result = null;
    this.committed = false;
    this.runId += 1;
    this.timer = 0;
    this.pendingRelay = null;
    this.interaction = null;
    this.archiveOpen = null;
    this.archiveTimer = 0;
    this.shutdownReason = null;
    this.releaseAll();
    this.events.length = 0;
  }

  pause() {
    if (this.state !== STATE.PLAY) return false;
    this.state = STATE.PAUSED;
    this.releaseAll();
    this.events.push({ type: 'pause' });
    return true;
  }

  resume() {
    if (this.state !== STATE.PAUSED) return false;
    this.state = STATE.PLAY;
    this.releaseAll();
    this.events.push({ type: 'resume' });
    return true;
  }

  togglePause() {
    return this.state === STATE.PAUSED ? this.resume() : this.pause();
  }

  dismissArchive() {
    this.archiveOpen = null;
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ------------------------------------------------------------------ step
  step(dt = FIXED_STEP) {
    this.steps += 1;
    const inp = this.edges();
    switch (this.state) {
      case STATE.TITLE:
        this.titleTime += dt;
        break;
      case STATE.PLAY:
        this.stepPlay(dt, inp);
        break;
      case STATE.RELAY:
        this.stepRelay(dt);
        break;
      case STATE.SHUTDOWN:
        this.stepShutdown(dt);
        break;
      case STATE.REBOOT:
        this.stepReboot(dt);
        break;
      case STATE.LIFT:
        this.stepLift(dt);
        break;
      default:
        break;
    }
    this.prevInput = { ...this.input };
  }

  playerEnv(lockInput) {
    const { level, world, player } = this;
    return {
      getSolids: () => W.getSolids(level, world),
      events: this.events,
      lockInput,
      tryBreak: (solid) => this.tryBreakSeam(solid),
      onDashStep: () => W.dashOverlapCheck(level, world, player, this.events),
    };
  }

  tryBreakSeam(solid) {
    if (!solid || solid.kind !== 'seam') return false;
    const st = this.world.seams[solid.id];
    if (st.broken || !st.revealed) {
      if (!st.broken && !st.revealed && !this._thudAnnounced) {
        this._thudAnnounced = true;
        this.events.push({ type: 'seamThud', id: solid.id, x: (solid.x1 + solid.x2) / 2, y: (solid.y1 + solid.y2) / 2 });
      }
      return false;
    }
    st.broken = true;
    this.events.push({ type: 'seamBreak', id: solid.id, x: (solid.x1 + solid.x2) / 2, y: (solid.y1 + solid.y2) / 2 });
    return true;
  }

  enemyCtx() {
    const { level, world, player } = this;
    const solids = () => W.getSolids(level, world);
    return {
      player,
      events: this.events,
      playerNear: (x, y, range) => Math.hypot(player.x - x, player.y - y) <= range,
      canSee: (x1, y1, x2, y2) => W.hasLineOfSight(x1, y1, x2, y2, W.getPulseBlockers(level, world)),
      solidOverlap: (rect) => solids().some((s) => rectsOverlap(rect, s, 0.0)),
      groundBelow: (x, y) => solids().some((s) => x >= s.x1 && x <= s.x2 && s.y2 <= y + 0.05 && s.y2 >= y - 0.35),
      pointSolid: (x, y) => solids().some((s) => pointInRect(x, y, s)),
      fireBolt: (e, ax, ay) => {
        world.bolts.push({ x: e.x + ax * 0.5, y: e.y + ay * 0.5, vx: ax * T.drone.boltSpeed, vy: ay * T.drone.boltSpeed, life: T.drone.boltLife });
        this.events.push({ type: 'boltFire', id: e.id, x: e.x, y: e.y });
      },
      hurt: (src, kx) => this.hurt(src, kx),
    };
  }

  stepPlay(dt, inp) {
    const { world, player, level } = this;
    world.time += dt;
    this.region = regionAt(player.x);
    if (this.archiveOpen) {
      this.archiveTimer -= dt;
      if (this.archiveTimer <= 0) this.archiveOpen = null;
    }
    if (inp.retryPressed) {
      this.startShutdown('retry');
      return;
    }
    const power = W.computePower(level, world);
    const events = this.events;
    W.updateMovers(level, world, dt, player, power, events);
    W.updateShutters(level, world, dt, power, player, events);
    this._thudAnnounced = false;
    updatePlayer(player, dt, inp, this.playerEnv(false));
    W.updateVents(level, world, dt, player, events);
    updateEnemies(level, world, dt, this.enemyCtx());
    updateBolts(world, dt, this.enemyCtx());
    W.updatePulses(level, world, dt, power, events, { activateRelay: (id) => this.activateRelay(id) });
    if (this.state !== STATE.PLAY) return;
    W.checkContacts(level, world, player, (src, kx) => this.hurt(src, kx));
    if (this.state !== STATE.PLAY) return;

    this.interaction = W.findInteraction(level, world, player, power);
    if (inp.interactPressed) {
      if (this.archiveOpen) {
        this.archiveOpen = null; // dismiss first; never act through an open fragment
      } else if (this.interaction) {
        const r = W.performInteraction(level, world, player, this.interaction, events);
        if (r === 'archive') {
          this.archiveOpen = this.interaction.id;
          this.archiveTimer = 9;
        } else if (r === 'lift') {
          this.startLift();
          return;
        }
      }
    }
    if (inp.pulsePressed) W.emitPulse(level, world, player, events);
    W.updateStations(level, world, player, events, (s) => this.commitCheckpoint(s));
    const zone = W.checkZones(level, player);
    if (zone) {
      this.startShutdown(zone);
      return;
    }
    if (W.updateCrush(level, world, player, dt)) {
      events.push({ type: 'crush', x: player.x, y: player.y });
      this.startShutdown('crush');
    }
  }

  /** One ordinary hit: shield first, otherwise integrity. Never both. */
  hurt(source, kx) {
    const p = this.player;
    if (this.state !== STATE.PLAY || p.immunity > 0) return false;
    if (p.energy >= T.shield.cost) {
      p.energy -= T.shield.cost;
      p.regenDelay = T.pulse.regenDelay;
      p.immunity = T.shield.immunity;
      this.world.stats.shieldAbsorbs += 1;
      this.events.push({ type: 'shield', source, x: p.x, y: p.y });
      return true;
    }
    p.integrity -= 1;
    p.immunity = T.damage.immunity;
    this.world.stats.damageTaken += 1;
    applyKnockback(p, kx);
    this.events.push({ type: 'damage', source, x: p.x, y: p.y, integrity: p.integrity });
    if (p.integrity <= 0) this.startShutdown('damage');
    return true;
  }

  startShutdown(reason) {
    if (this.state !== STATE.PLAY) return;
    this.state = STATE.SHUTDOWN;
    this.shutdownReason = reason;
    this.timer = reason === 'retry' ? T.recovery.retryShutdownTime : T.recovery.shutdownTime;
    this.world.stats.recoveries += 1;
    this.player.dashing = 0;
    this.player.sliding = false;
    this.interaction = null;
    this.archiveOpen = null;
    this.releaseAll();
    this.events.push({ type: 'shutdown', reason });
  }

  stepShutdown(dt) {
    this.timer -= dt;
    if (this.shutdownReason !== 'deepWater' && this.shutdownReason !== 'fall') {
      updatePlayer(this.player, dt, NO_INPUT, this.playerEnv(true));
    }
    if (this.timer <= 0) {
      const snap = this.snapshot;
      if (snap) W.applySnapshot(this.world, snap, this.level);
      const p = this.player;
      const at = snap ? snap.respawn : this.level.spawn;
      const fresh = createPlayer(at.x, at.y);
      Object.assign(p, fresh, { facing: 1 });
      this.state = STATE.REBOOT;
      this.timer = T.recovery.rebootTime;
      this.events.push({ type: 'reboot', station: snap ? snap.station : null, x: at.x, y: at.y });
    }
  }

  stepReboot(dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.state = STATE.PLAY;
      this.player.immunity = T.recovery.contactImmunity;
      this.events.push({ type: 'rebooted' });
    }
  }

  activateRelay(id) {
    const st = this.world.relays[id];
    if (!st || st.active || this.state !== STATE.PLAY) return;
    const def = this.level.relays.find((r) => r.id === id);
    st.active = true;
    this.state = STATE.RELAY;
    this.timer = T.relayCinematic;
    this.pendingRelay = id;
    this.releaseAll();
    this.events.push({ type: 'relayActivate', id, x: def.x, y: def.y, opens: def.opens });
  }

  stepRelay(dt) {
    this.timer -= dt;
    const power = W.computePower(this.level, this.world);
    W.updateShutters(this.level, this.world, dt, power, this.player, this.events);
    updatePlayer(this.player, dt, NO_INPUT, this.playerEnv(true));
    if (this.timer <= 0) {
      const def = this.level.relays.find((r) => r.id === this.pendingRelay);
      const station = this.level.stations.find((s) => s.id === def.station);
      this.world.stations[station.id].active = true;
      this.world.checkpoint = station.id;
      this.player.integrity = T.integrityMax;
      this.player.energy = W.ENERGY_MAX;
      this.commitCheckpoint(station);
      this.state = STATE.PLAY;
      this.pendingRelay = null;
      this.player.immunity = 0.6;
      this.events.push({ type: 'relayDone', id: def.id, station: station.id });
    }
  }

  commitCheckpoint(station) {
    this.snapshot = W.makeSnapshot(this.world, station.id, station.x, station.y);
    this.events.push({ type: 'checkpoint', id: station.id, x: station.x, y: station.y });
  }

  // ------------------------------------------------------------------ ending
  liftReady() {
    const L = this.level;
    const p = this.player;
    const all = this.level.relays.every((r) => this.world.relays[r.id].active);
    const boarding = p.x >= L.lift.x1 && p.x <= L.lift.x2 && Math.abs(p.y - L.lift.boardY1) < 0.1 && p.grounded;
    return all && boarding && this.world.lift.phase === 'idle' && this.state === STATE.PLAY;
  }

  startLift() {
    if (!this.liftReady()) return false;
    if (!this.committed) {
      this.committed = true; // commit the run result exactly once; the clock stops with PLAY
      this.result = this.buildResult();
    }
    this.state = STATE.LIFT;
    this.timer = 0;
    this.world.lift.phase = 'barrier';
    this.world.lift.t = 0;
    this.releaseAll();
    this.events.push({ type: 'liftSequence', result: this.result });
    return true;
  }

  stepLift(dt) {
    const lf = this.world.lift;
    const L = this.level.lift;
    const p = this.player;
    lf.t += dt;
    switch (lf.phase) {
      case 'barrier':
        if (lf.t >= 0.9) {
          lf.phase = 'ascend';
          lf.t = 0;
          this.events.push({ type: 'liftAscend' });
        }
        break;
      case 'ascend': {
        const mover = this.level.movers.find((m) => m.id === L.mover);
        lf.y = moveToward(lf.y, mover.to, mover.speed * dt);
        if (lf.y >= mover.to - 1e-9) {
          lf.phase = 'arrive';
          lf.t = 0;
          this.events.push({ type: 'liftArrive' });
        }
        break;
      }
      case 'arrive':
        if (lf.t >= 1.2) {
          lf.phase = 'step';
          lf.t = 0;
          this.events.push({ type: 'liftStepOut' });
        }
        break;
      case 'step': {
        p.facing = 1;
        p.x = moveToward(p.x, L.terraceX, 2.6 * dt);
        if (p.x >= L.terraceX - 1e-9) {
          lf.phase = 'reveal';
          lf.t = 0;
          this.events.push({ type: 'liftTerrace' });
        }
        break;
      }
      case 'reveal':
        if (lf.t >= 2.4) {
          lf.phase = 'done';
          this.state = STATE.COMPLETE;
          this.events.push({ type: 'complete', result: this.result });
        }
        break;
      default:
        break;
    }
    const power = W.computePower(this.level, this.world);
    W.updateMovers(this.level, this.world, dt, p, power, this.events);
    if (lf.phase !== 'step') updatePlayer(p, dt, NO_INPUT, this.playerEnv(true));
    else {
      p.vx = 2.6;
      p.vy = 0;
      p.y = L.surfaceY;
      p.grounded = true;
      p.wasGrounded = true;
    }
  }

  buildResult() {
    const w = this.world;
    const L = this.level;
    return {
      time: w.time,
      recoveries: w.stats.recoveries,
      archives: L.archives.filter((a) => w.archives[a.id].collected).map((a) => a.id),
      caches: L.caches.filter((c) => w.caches[c.id].collected).length,
      machinesDisabled: W.countDisabled(w),
      relays: Object.fromEntries(L.relays.map((r) => [r.id, w.relays[r.id].active])),
      shieldAbsorbs: w.stats.shieldAbsorbs,
      damageTaken: w.stats.damageTaken,
      pulses: w.stats.pulses,
    };
  }

  // ------------------------------------------------------------------ inspection
  getState() {
    const w = this.world;
    const p = this.player;
    const relays = {};
    for (const r of this.level.relays) relays[r.id] = { active: w.relays[r.id].active };
    return {
      state: this.state,
      time: w.time,
      region: this.region,
      steps: this.steps,
      player: {
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        facing: p.facing,
        grounded: p.grounded,
        sliding: p.sliding,
        dashing: p.dashing,
        wallContact: p.wallContact,
        integrity: p.integrity,
        energy: p.energy,
        immunity: p.immunity,
        carrying: p.carrying,
        dashCooldown: p.dashCooldown,
        airDash: p.airDash,
      },
      relays,
      checkpoint: w.checkpoint,
      snapshotStation: this.snapshot ? this.snapshot.station : null,
      stations: { ...w.stations },
      sockets: JSON.parse(JSON.stringify(w.sockets)),
      switches: JSON.parse(JSON.stringify(w.switches)),
      cells: JSON.parse(JSON.stringify(w.cells)),
      seams: JSON.parse(JSON.stringify(w.seams)),
      archives: JSON.parse(JSON.stringify(w.archives)),
      caches: JSON.parse(JSON.stringify(w.caches)),
      shutters: Object.fromEntries(Object.entries(w.shutters).map(([k, v]) => [k, v.pos])),
      movers: Object.fromEntries(Object.entries(w.movers).map(([k, v]) => [k, { pos: v.pos }])),
      enemies: Object.fromEntries(Object.entries(w.enemies).map(([k, e]) => [k, { state: e.state, x: e.x, y: e.y, disabled: e.disabled, timer: e.timer }])),
      vents: Object.fromEntries(Object.entries(w.vents).map(([k, v]) => [k, v.stage])),
      bolts: w.bolts.length,
      stats: { ...w.stats },
      interaction: this.interaction,
      archiveOpen: this.archiveOpen,
      result: this.result,
      committed: this.committed,
      lift: { ...w.lift },
      pendingRelay: this.pendingRelay,
      shutdownReason: this.shutdownReason,
    };
  }
}

export { STATE };
