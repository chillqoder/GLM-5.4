// ILO: authoritative movement, wall movement, dash and swept AABB collision.
// Pure simulation: no DOM, no Three.js. Position is the center of the feet.

import { clamp, moveToward, sweepAxis } from './math.js';
import { TUNING as T } from './tuning.js';

const P = T.player;
export const HALF_W = P.width / 2;

export function createPlayer(x, y) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    wasGrounded: false,
    groundSolid: null,
    groundType: 'rock',
    coyote: 0,
    jumpBuffer: 0,
    jumpHoldTime: 0,
    jumpCutDone: true,
    wallContact: 0, // -1 left, 0 none, +1 right (contact made this step)
    wallSolid: null,
    lastWallSide: 0,
    wallCoyote: 0,
    wallLock: 0,
    sliding: false,
    wasSliding: false,
    dashing: 0,
    dashDir: 1,
    dashCooldown: 0,
    airDash: true,
    pulseCooldown: 0,
    regenDelay: 0,
    energy: T.pulse.energyMax,
    integrity: T.integrityMax,
    immunity: 0,
    carrying: null,
    crushTimer: 0,
    // Cosmetic timers consumed by the renderer/audio (never affect simulation).
    landTimer: 0,
    recoilTimer: 0,
    actionTimer: 0,
    pulseTimer: 0,
    stepDistance: 0,
    lastImpact: 0,
  };
}

export function playerBox(p) {
  return { x1: p.x - HALF_W, y1: p.y, x2: p.x + HALF_W, y2: p.y + P.height };
}

export function playerCenter(p) {
  return { x: p.x, y: p.y + P.height / 2 };
}

/** Move the player by (dx, dy) with swept collision, used for mover carry/push. */
export function displacePlayer(p, dx, dy, solids, skip) {
  const box = playerBox(p);
  const sx = sweepAxis(box, 'x', dx, solids, skip);
  p.x += sx.moved;
  if (sx.hit) p.x = dx > 0 ? sx.hit.x1 - HALF_W : sx.hit.x2 + HALF_W;
  const box2 = playerBox(p);
  const sy = sweepAxis(box2, 'y', dy, solids, skip);
  p.y += sy.moved;
  if (sy.hit) {
    p.y = dy > 0 ? sy.hit.y1 - P.height : sy.hit.y2;
    if (dy < 0) {
      p.grounded = true;
      p.groundSolid = sy.hit;
    }
    if (dy > 0) p.vy = Math.min(p.vy, 0);
  }
  return { blockedX: !!sx.hit, blockedY: !!sy.hit };
}

export function applyKnockback(p, kx) {
  p.vx = clamp(kx, -T.damage.knockbackX, T.damage.knockbackX);
  p.vy = T.damage.knockbackY;
  p.grounded = false;
  p.dashing = 0;
  p.sliding = false;
  p.recoilTimer = 0.35;
}

/**
 * One fixed simulation step for ILO.
 * inp: { left, right, jump, dash, jumpPressed, dashPressed }
 * env: { getSolids(), events, lockInput, tryBreak(solid) -> boolean, onDashStep() }
 */
export function updatePlayer(p, dt, inp, env) {
  const D = T.dash;
  const events = env.events;
  p.wasGrounded = p.grounded;
  p.wasSliding = p.sliding;

  // Timers
  p.coyote = Math.max(0, p.coyote - dt);
  p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
  p.wallCoyote = Math.max(0, p.wallCoyote - dt);
  p.wallLock = Math.max(0, p.wallLock - dt);
  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  p.pulseCooldown = Math.max(0, p.pulseCooldown - dt);
  p.immunity = Math.max(0, p.immunity - dt);
  p.landTimer = Math.max(0, p.landTimer - dt);
  p.recoilTimer = Math.max(0, p.recoilTimer - dt);
  p.actionTimer = Math.max(0, p.actionTimer - dt);
  p.pulseTimer = Math.max(0, p.pulseTimer - dt);
  p.regenDelay = Math.max(0, p.regenDelay - dt);
  if (p.regenDelay <= 0 && p.energy < T.pulse.energyMax) {
    p.energy = Math.min(T.pulse.energyMax, p.energy + T.pulse.regen * dt);
  }

  const locked = env.lockInput === true;
  const L = locked ? false : !!inp.left;
  const R = locked ? false : !!inp.right;
  const J = locked ? false : !!inp.jump;
  const dir = (R ? 1 : 0) - (L ? 1 : 0);
  if (!locked && inp.jumpPressed) p.jumpBuffer = P.jumpBuffer;

  if (p.dashing <= 0) {
    if (dir > 0) p.facing = 1;
    else if (dir < 0) p.facing = -1;
  }

  // Dash start (fresh press, cooldown elapsed, grounded or air dash available).
  if (!locked && inp.dashPressed && !p.carrying && p.dashCooldown <= 0 && p.dashing <= 0 && (p.grounded || p.airDash)) {
    p.dashing = D.duration;
    p.dashDir = p.facing;
    p.dashCooldown = D.cooldown;
    if (!p.grounded) p.airDash = false;
    p.vy = 0;
    p.sliding = false;
    p.wallLock = 0;
    events.push({ type: 'dash', x: p.x, y: p.y, dir: p.dashDir });
  }

  // Horizontal control
  const maxSpeed = p.carrying ? P.carrySpeed : P.maxSpeed;
  if (p.dashing > 0) {
    p.vx = p.dashDir * D.speed;
    p.vy = 0;
  } else if (p.wallLock > 0) {
    // Steering locked briefly after a wall jump so the separation is visible.
  } else {
    const accel = p.grounded ? P.groundAccel : P.airAccel;
    const brake = p.grounded ? P.groundBrake : P.airBrake;
    if (dir !== 0) {
      if (p.vx * dir < 0) p.vx = moveToward(p.vx, 0, (accel + brake) * dt);
      else if (Math.abs(p.vx) < maxSpeed) p.vx = clamp(p.vx + dir * accel * dt, -maxSpeed, maxSpeed);
      else p.vx = moveToward(p.vx, dir * maxSpeed, brake * dt);
    } else {
      p.vx = moveToward(p.vx, 0, brake * dt);
    }
  }

  // Jumps (buffered): ground jump with coyote time, otherwise wall jump.
  if (p.jumpBuffer > 0) {
    if (p.grounded || p.coyote > 0) {
      p.vy = P.jumpSpeed;
      p.grounded = false;
      p.coyote = 0;
      p.jumpBuffer = 0;
      p.jumpHoldTime = 0;
      p.jumpCutDone = false;
      events.push({ type: 'jump', x: p.x, y: p.y });
    } else if (p.wallCoyote > 0 && !p.carrying) {
      const side = p.wallContact || p.lastWallSide;
      p.vy = P.wallJumpY;
      p.vx = -side * P.wallJumpX;
      p.wallLock = P.wallLock;
      p.wallCoyote = 0;
      p.jumpBuffer = 0;
      p.jumpHoldTime = 0;
      p.jumpCutDone = false;
      p.airDash = true;
      p.facing = -side;
      events.push({ type: 'wallJump', x: p.x, y: p.y, dir: -side });
    }
  }
  // Variable jump height: releasing early cuts the rise (after a minimum hold).
  if (!p.jumpCutDone) {
    p.jumpHoldTime += dt;
    if (p.vy <= 0) p.jumpCutDone = true;
    else if (!J && p.jumpHoldTime >= P.minJumpTime) {
      p.vy *= P.jumpCut;
      p.jumpCutDone = true;
    }
  }

  // Gravity / dash timer
  if (p.dashing > 0) {
    p.dashing -= dt;
    if (p.dashing <= 0) {
      p.dashing = 0;
      p.vx = p.dashDir * D.exitSpeed;
    }
  } else {
    p.vy -= P.gravity * dt;
    if (p.vy < -P.fallLimit) p.vy = -P.fallLimit;
  }

  // Swept integration: Y then X.
  const getSolids = env.getSolids;
  let solids = getSolids();
  const prevVy = p.vy;
  p.grounded = false;
  p.groundSolid = null;
  let box = playerBox(p);
  const dy = p.vy * dt;
  const sy = sweepAxis(box, 'y', dy, solids);
  if (sy.hit) {
    if (dy < 0) {
      p.y = sy.hit.y2;
      p.grounded = true;
      p.groundSolid = sy.hit;
      p.groundType = sy.hit.type || 'rock';
    } else {
      p.y = sy.hit.y1 - P.height;
    }
    p.vy = 0;
  } else {
    p.y += dy;
  }

  box = playerBox(p);
  const dx = p.vx * dt;
  let sx = sweepAxis(box, 'x', dx, solids);
  // A dash shatters cracked seams instead of stopping.
  let guard = 0;
  while (p.dashing > 0 && sx.hit && guard++ < 4 && env.tryBreak(sx.hit)) {
    solids = getSolids();
    sx = sweepAxis(box, 'x', dx, solids);
  }
  p.wallContact = 0;
  p.wallSolid = null;
  if (sx.hit) {
    p.x = dx > 0 ? sx.hit.x1 - HALF_W : sx.hit.x2 + HALF_W;
    p.wallContact = dx > 0 ? 1 : -1;
    p.wallSolid = sx.hit;
    p.lastWallSide = p.wallContact;
    if (p.dashing > 0) {
      p.dashing = 0;
      p.vx = 0;
      events.push({ type: 'dashStop', x: p.x, y: p.y });
    } else {
      p.vx = 0;
    }
  } else {
    p.x += dx;
  }

  if (p.dashing > 0) env.onDashStep();

  // Wall bookkeeping
  if (p.wallContact !== 0 && p.dashing <= 0) p.wallCoyote = P.wallCoyote;
  const towardWall = (p.wallContact === 1 && R) || (p.wallContact === -1 && L);
  p.sliding = !p.grounded && p.wallContact !== 0 && towardWall && p.vy <= 0 && !p.carrying && p.dashing <= 0;
  if (p.sliding && p.vy < -P.wallSlideLimit) p.vy = -P.wallSlideLimit;
  if (p.sliding && !p.wasSliding) events.push({ type: 'slideStart' });
  if (!p.sliding && p.wasSliding) events.push({ type: 'slideEnd' });

  if (p.grounded) {
    p.coyote = P.coyote;
    p.airDash = true;
    p.jumpCutDone = true;
    if (!p.wasGrounded) {
      p.landTimer = 0.18;
      p.lastImpact = -prevVy;
      events.push({ type: 'land', x: p.x, y: p.y, impact: -prevVy, surface: p.groundType });
    }
    // Footsteps by distance travelled.
    if (Math.abs(p.vx) > 1.2) {
      p.stepDistance += Math.abs(p.vx) * dt;
      if (p.stepDistance >= P.stepLength) {
        p.stepDistance = 0;
        events.push({ type: 'step', surface: p.groundType, x: p.x, y: p.y });
      }
    } else {
      p.stepDistance = P.stepLength * 0.6;
    }
  }
}
