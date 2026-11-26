// Original enemies: Cable Skitter (ground), Prism Drone (air), Shutter Sentinel (wall-mounted).
// Each has an explicit state machine. Pure simulation.

import { TUNING as T } from './tuning.js';
import { rectsOverlap, sign, moveToward } from './math.js';
import { playerBox } from './player.js';

export function createEnemy(def) {
  const base = { id: def.id, type: def.type, state: 'dormant', timer: 0, disabled: false, activated: false };
  switch (def.type) {
    case 'skitter':
      return { ...base, x: def.x, y: def.y, dir: -1, phase: 'telegraph', patrol: def.patrol };
    case 'drone':
      return { ...base, x: (def.x1 + def.x2) / 2, y: def.y, baseY: def.y, dir: 1, aimX: 0, aimY: -1, t: 0 };
    case 'sentinel':
      return { ...base, x: def.x, y: def.y, dir: def.dir, state: 'closed' };
    default:
      throw new Error(`unknown enemy type ${def.type}`);
  }
}

/** Reset an enemy to its spawn state while keeping the committed disabled flag. */
export function resetEnemy(e, def) {
  const fresh = createEnemy(def);
  fresh.disabled = e.disabled;
  if (fresh.disabled) fresh.state = 'disabled';
  return fresh;
}

export function enemyBox(e) {
  if (e.type === 'skitter') {
    const K = T.skitter;
    return { x1: e.x - K.width / 2, y1: e.y, x2: e.x + K.width / 2, y2: e.y + K.height };
  }
  const s = T.drone.size / 2;
  return { x1: e.x - s, y1: e.y - s, x2: e.x + s, y2: e.y + s };
}

export function enemyCenter(e) {
  const b = enemyBox(e);
  return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
}

/** True when the machine can deal contact damage or attack. Wall-mounted sentinels never deal contact damage. */
export function enemyDamaging(e) {
  if (e.disabled || e.type === 'sentinel') return false;
  return e.state !== 'stunned' && e.state !== 'dormant';
}

export function stunEnemy(e) {
  if (e.disabled || e.type === 'sentinel') return false;
  e.state = 'stunned';
  e.timer = e.type === 'skitter' ? T.skitter.stun : T.drone.stun;
  return true;
}

export function disableEnemy(e) {
  if (e.disabled) return false;
  e.disabled = true;
  e.state = 'disabled';
  e.timer = 0;
  return true;
}

// ---------------------------------------------------------------------------
// Cable Skitter
// ---------------------------------------------------------------------------
function updateSkitter(e, dt, ctx, def) {
  const K = T.skitter;
  const p = ctx.player;
  const w = K.width / 2;
  if (!e.activated) {
    if (ctx.playerNear(e.x, e.y, K.activateRange)) {
      e.activated = true;
      e.state = 'patrol';
    }
    return;
  }
  e.timer -= dt;
  switch (e.state) {
    case 'patrol': {
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      if (Math.abs(dx) <= K.detectRange && Math.abs(dy) < 2.5 && ctx.canSee(e.x, e.y + 0.3, p.x, p.y + 0.75)) {
        e.state = 'alert';
        e.timer = K.alertTime;
        e.dir = sign(dx) || 1;
        ctx.events.push({ type: 'skitterAlert', id: e.id, x: e.x, y: e.y });
        break;
      }
      const nx = e.x + e.dir * K.speed * dt;
      let turn = false;
      if (e.dir < 0 && nx - w <= e.patrol[0]) turn = true;
      if (e.dir > 0 && nx + w >= e.patrol[1]) turn = true;
      const probe = { x1: nx - w, y1: e.y + 0.08, x2: nx + w, y2: e.y + K.height - 0.08 };
      if (ctx.solidOverlap(probe)) turn = true; // wall ahead
      const aheadX = e.x + e.dir * (w + 0.2);
      if (!ctx.groundBelow(aheadX, e.y)) turn = true; // exposed ledge ahead
      if (turn) e.dir = -e.dir;
      else e.x = nx;
      break;
    }
    case 'alert':
      if (e.timer <= 0) {
        e.state = 'lunge';
        e.phase = 'telegraph';
        e.timer = K.telegraph;
        ctx.events.push({ type: 'skitterTelegraph', id: e.id, x: e.x, y: e.y, dir: e.dir });
      }
      break;
    case 'lunge': {
      if (e.phase === 'telegraph') {
        if (e.timer <= 0) {
          e.phase = 'strike';
          e.timer = K.lungeTime;
          ctx.events.push({ type: 'skitterLunge', id: e.id, x: e.x, y: e.y, dir: e.dir });
        }
        break;
      }
      const nx = e.x + e.dir * K.lungeSpeed * dt;
      const probe = { x1: nx - w, y1: e.y + 0.08, x2: nx + w, y2: e.y + K.height - 0.08 };
      const aheadX = nx + e.dir * (w + 0.05);
      const outOfBounds = nx - w < e.patrol[0] - 1.5 || nx + w > e.patrol[1] + 1.5;
      if (e.timer <= 0 || outOfBounds || ctx.solidOverlap(probe) || !ctx.groundBelow(aheadX, e.y)) {
        e.state = 'recover';
        e.timer = K.recover;
      } else {
        e.x = nx;
      }
      break;
    }
    case 'recover':
      if (e.timer <= 0) e.state = 'patrol';
      break;
    case 'stunned':
      if (e.timer <= 0) e.state = 'patrol';
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Prism Drone
// ---------------------------------------------------------------------------
function updateDrone(e, dt, ctx, def) {
  const D = T.drone;
  const p = ctx.player;
  if (!e.activated) {
    if (ctx.playerNear(e.x, e.y, D.activateRange)) e.activated = true;
    else return;
  }
  const seesPlayer = () => {
    const dx = p.x - e.x;
    const dy = p.y + 0.75 - e.y;
    return Math.hypot(dx, dy) <= D.detectRange && ctx.canSee(e.x, e.y, p.x, p.y + 0.75);
  };
  const aimAtPlayer = () => {
    const dx = p.x - e.x;
    const dy = p.y + 0.75 - e.y;
    const len = Math.hypot(dx, dy) || 1;
    e.aimX = dx / len;
    e.aimY = dy / len;
  };
  switch (e.state) {
    case 'dormant':
    case 'patrol': {
      e.t += dt;
      e.x += e.dir * D.speed * dt;
      if (e.x >= def.x2) {
        e.x = def.x2;
        e.dir = -1;
      } else if (e.x <= def.x1) {
        e.x = def.x1;
        e.dir = 1;
      }
      e.y = e.baseY + Math.sin(e.t * 1.7) * (def.bob || 0);
      if (seesPlayer()) {
        e.state = 'aim';
        e.timer = 0;
        aimAtPlayer();
        ctx.events.push({ type: 'droneAim', id: e.id, x: e.x, y: e.y });
      }
      break;
    }
    case 'aim': {
      e.timer += dt;
      if (e.timer < D.aimTime * D.trackFraction) {
        if (!seesPlayer()) {
          e.state = 'patrol';
          ctx.events.push({ type: 'droneLost', id: e.id });
          break;
        }
        aimAtPlayer();
      }
      if (e.timer >= D.aimTime) {
        ctx.fireBolt(e, e.aimX, e.aimY);
        e.state = 'cooldown';
        e.timer = 0;
      }
      break;
    }
    case 'cooldown':
      e.timer += dt;
      if (e.timer >= D.cooldown) {
        if (seesPlayer()) {
          e.state = 'aim';
          e.timer = 0;
          aimAtPlayer();
          ctx.events.push({ type: 'droneAim', id: e.id, x: e.x, y: e.y });
        } else {
          e.state = 'patrol';
        }
      }
      break;
    case 'stunned':
      e.timer -= dt;
      e.y = moveToward(e.y, e.baseY - 0.5, 1.5 * dt);
      if (e.timer <= 0) e.state = 'patrol';
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Shutter Sentinel
// ---------------------------------------------------------------------------
function updateSentinel(e, dt, ctx, def) {
  const S = T.sentinel;
  if (!e.activated) {
    if (ctx.playerNear(def.x, def.y, S.activateRange)) {
      e.activated = true;
      e.state = 'closed';
      e.timer = S.closed;
    }
    return;
  }
  e.timer -= dt;
  if (e.timer > 0) return;
  switch (e.state) {
    case 'closed':
      e.state = 'warning';
      e.timer = S.warning;
      ctx.events.push({ type: 'beamWarning', id: e.id });
      break;
    case 'warning':
      e.state = 'firing';
      e.timer = S.firing;
      ctx.events.push({ type: 'beamFire', id: e.id });
      break;
    case 'firing':
      e.state = 'venting';
      e.timer = S.venting;
      ctx.events.push({ type: 'beamVent', id: e.id });
      break;
    case 'venting':
      e.state = 'closed';
      e.timer = S.closed;
      break;
    default:
      break;
  }
}

export function updateEnemies(level, world, dt, ctx) {
  for (const def of level.enemies) {
    const e = world.enemies[def.id];
    if (e.disabled) continue;
    if (e.type === 'skitter') updateSkitter(e, dt, ctx, def);
    else if (e.type === 'drone') updateDrone(e, dt, ctx, def);
    else if (e.type === 'sentinel') updateSentinel(e, dt, ctx, def);
  }
}

/** Prism Drone bolts: slow, bounded lifetime, stop on terrain and on ILO. */
export function updateBolts(world, dt, ctx) {
  const bolts = world.bolts;
  const p = ctx.player;
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    let remove = false;
    if (b.life <= 0) remove = true;
    else if (ctx.pointSolid(b.x, b.y)) {
      ctx.events.push({ type: 'boltImpact', x: b.x - b.vx * dt, y: b.y - b.vy * dt });
      remove = true;
    } else {
      const pb = playerBox(p);
      const bb = { x1: b.x - 0.22, y1: b.y - 0.22, x2: b.x + 0.22, y2: b.y + 0.22 };
      if (rectsOverlap(pb, bb, 0.02)) {
        ctx.hurt('bolt', sign(b.vx) || (p.x < b.x ? -1 : 1));
        remove = true;
      }
    }
    if (remove) bolts.splice(i, 1);
  }
}

export function ventStage(v, t) {
  const V = T.vent;
  if (t < 0) return 'dormant';
  const cycle = V.warning + V.active + V.dormant;
  const tc = t % cycle;
  if (tc < V.warning) return 'warning';
  if (tc < V.warning + V.active) return 'active';
  return 'dormant';
}
