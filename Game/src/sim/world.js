// World state and object systems: power routing, movers, shutters, vents, echo pulses,
// interactions, stations and checkpoint snapshots. Plain data + pure functions.

import { TUNING as T } from './tuning.js';
import { deepClone, rectsOverlap, segmentRectT, pointInRect, moveToward, sign } from './math.js';
import { playerBox, displacePlayer } from './player.js';
import { createEnemy, resetEnemy, enemyBox, enemyCenter, enemyDamaging, stunEnemy, disableEnemy, ventStage } from './enemies.js';

export const ENERGY_MAX = T.pulse.energyMax;
export const CACHE_ENERGY = 25;

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------
export function createWorld(level) {
  const world = {
    time: 0,
    relays: {},
    sockets: {},
    switches: {},
    shutters: {},
    latches: {},
    seams: {},
    cells: {},
    archives: {},
    caches: {},
    stations: {},
    checkpoint: level.checkpointStart,
    enemies: {},
    movers: {},
    vents: {},
    bolts: [],
    pulses: [],
    markers: {},
    stats: { recoveries: 0, disables: 0, shieldAbsorbs: 0, damageTaken: 0, pulses: 0 },
    lift: { phase: 'idle', y: level.movers.find((m) => m.id === level.lift.mover).from, t: 0, walkX: 0 },
  };
  for (const r of level.relays) world.relays[r.id] = { active: false };
  for (const s of level.sockets) world.sockets[s.id] = { cell: null };
  for (const s of level.switches) world.switches[s.id] = { on: false };
  for (const s of level.shutters) {
    world.shutters[s.id] = { pos: 0, rect: { ...s.closed, kind: 'shutter', id: s.id, type: 'metal' } };
    world.latches[s.id] = false;
  }
  for (const s of level.seams) world.seams[s.id] = { broken: false, revealed: !s.veiled, highlight: 0 };
  for (const c of level.cells) world.cells[c.id] = { x: c.x, y: c.y, state: 'loose', socket: null };
  for (const a of level.archives) world.archives[a.id] = { collected: false, highlight: 0 };
  for (const c of level.caches) world.caches[c.id] = { collected: false };
  for (const s of level.stations) world.stations[s.id] = { active: false };
  for (const e of level.enemies) world.enemies[e.id] = createEnemy(e);
  for (const m of level.movers) {
    world.movers[m.id] = { pos: m.from, dx: 0, dy: 0, t: 0, running: false, rect: null };
    world.movers[m.id].rect = moverRect(m, world.movers[m.id]);
  }
  for (const v of level.vents) world.vents[v.id] = { t: v.offset ? -v.offset : 0, activated: false, stage: 'dormant' };
  for (const mk of level.pulseMarkers) world.markers[mk.id] = { highlight: 0 };
  return world;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
export function moverRect(m, st) {
  return m.axis === 'x'
    ? { x1: st.pos, y1: m.fixed, x2: st.pos + m.w, y2: m.fixed + m.h, kind: 'mover', id: m.id, type: m.type || 'metal' }
    : { x1: m.fixed, y1: st.pos, x2: m.fixed + m.w, y2: st.pos + m.h, kind: 'mover', id: m.id, type: m.type || 'metal' };
}

export function cellRect(id, c) {
  const w = T.cell.width / 2;
  return { x1: c.x - w, y1: c.y, x2: c.x + w, y2: c.y + T.cell.height, kind: 'cell', id, type: 'cell' };
}

export function socketPos(level, world, def) {
  if (def.mover) {
    const m = level.movers.find((mm) => mm.id === def.mover);
    return { x: def.x, y: world.movers[m.id].rect.y2 };
  }
  return { x: def.x, y: def.y };
}

/** All solids the player collides with this step. */
export function getSolids(level, world) {
  const out = [];
  for (const s of level.solids) out.push(s);
  for (const s of level.seams) if (!world.seams[s.id].broken) out.push(s);
  for (const sh of level.shutters) out.push(world.shutters[sh.id].rect);
  for (const m of level.movers) out.push(world.movers[m.id].rect);
  for (const c of level.cells) if (world.cells[c.id].state === 'loose') out.push(cellRect(c.id, world.cells[c.id]));
  return out;
}

/** Solids that block a pulse: thick opaque terrain and closed shutters. Crystal seams transmit. */
export function getPulseBlockers(level, world) {
  const out = [];
  for (const s of level.solids) out.push(s);
  for (const sh of level.shutters) if (world.shutters[sh.id].pos < 0.5) out.push(world.shutters[sh.id].rect);
  return out;
}

export function hasLineOfSight(x1, y1, x2, y2, blockers) {
  for (const b of blockers) {
    const t = segmentRectT(x1, y1, x2, y2, b);
    if (t !== null && t < 0.98) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Power routing
// ---------------------------------------------------------------------------
export function computePower(level, world) {
  const sources = {};
  for (const s of level.sockets) sources[`socket:${s.id}`] = world.sockets[s.id].cell !== null;
  for (const s of level.switches) sources[`switch:${s.id}`] = world.switches[s.id].on;
  for (const r of level.relays) sources[`relay:${r.id}`] = world.relays[r.id].active;
  const all = (list) => list.every((k) => sources[k]);
  return {
    sources,
    socketPowered: (id) => sources[`socket:${id}`],
    switchOn: (id) => sources[`switch:${id}`],
    relayActive: (id) => sources[`relay:${id}`],
    relayPowered: (id) => all(level.relays.find((r) => r.id === id).power),
    allRelaysActive: () => level.relays.every((r) => world.relays[r.id].active),
  };
}

// ---------------------------------------------------------------------------
// Movers
// ---------------------------------------------------------------------------
function pingpong(t, m) {
  const travel = Math.abs(m.to - m.from) / m.speed;
  const cycle = 2 * (m.pause + travel);
  const tc = t % cycle;
  if (tc < m.pause) return m.from;
  if (tc < m.pause + travel) return m.from + ((m.to - m.from) * (tc - m.pause)) / travel;
  if (tc < 2 * m.pause + travel) return m.to;
  return m.to - ((m.to - m.from) * (tc - 2 * m.pause - travel)) / travel;
}

export function updateMovers(level, world, dt, player, power, events) {
  const solidsStatic = getSolids(level, world);
  for (const m of level.movers) {
    const st = world.movers[m.id];
    const prevX = m.axis === 'x' ? st.pos : m.fixed;
    const prevY = m.axis === 'y' ? st.pos : m.fixed;
    const running = m.mode === 'scripted' ? true : m.power.every((k) => power.sources[k]);
    if (m.mode === 'pingpong') {
      if (running) {
        if (!st.running) {
          st.running = true;
          const travel = Math.abs(m.to - m.from) / m.speed;
          st.t = m.startAtB ? 2 * m.pause + travel : 0;
        }
        st.t += dt;
        st.pos = pingpong(st.t, m);
      } else {
        st.running = false;
        st.t = 0;
        st.pos = moveToward(st.pos, m.from, m.speed * dt);
      }
    } else if (m.mode === 'powered') {
      st.pos = moveToward(st.pos, running ? m.to : m.from, m.speed * dt);
    } else if (m.id === level.lift.mover) {
      st.pos = world.lift.y;
    }
    st.dx = (m.axis === 'x' ? st.pos : m.fixed) - prevX;
    st.dy = (m.axis === 'y' ? st.pos : m.fixed) - prevY;
    st.rect = moverRect(m, st);
  }
  // Carry riders and push anyone in the way, exactly once per step.
  const pb = playerBox(player);
  for (const m of level.movers) {
    const st = world.movers[m.id];
    if (st.dx === 0 && st.dy === 0) continue;
    const riding = player.grounded && player.groundSolid && player.groundSolid.kind === 'mover' && player.groundSolid.id === m.id;
    const others = solidsStatic.filter((s) => !(s.kind === 'mover' && s.id === m.id));
    if (riding) {
      displacePlayer(player, st.dx, st.dy, others, null);
    } else if (rectsOverlap(pb, st.rect, 0.0)) {
      if (st.dx !== 0) displacePlayer(player, st.dx + sign(st.dx) * 0.01, 0, others, null);
      if (st.dy !== 0) displacePlayer(player, 0, st.dy + sign(st.dy) * 0.01, others, null);
      events.push({ type: 'moverPush', id: m.id });
    }
  }
}

// ---------------------------------------------------------------------------
// Shutters
// ---------------------------------------------------------------------------
function lerpRect(a, b, t) {
  return { x1: a.x1 + (b.x1 - a.x1) * t, y1: a.y1 + (b.y1 - a.y1) * t, x2: a.x2 + (b.x2 - a.x2) * t, y2: a.y2 + (b.y2 - a.y2) * t };
}

export function updateShutters(level, world, dt, power, player, events) {
  const pb = playerBox(player);
  for (const sh of level.shutters) {
    const st = world.shutters[sh.id];
    let want = sh.power.some((k) => power.sources[k]);
    if (sh.latch && want) world.latches[sh.id] = true;
    if (sh.latch && world.latches[sh.id]) want = true;
    const travel = Math.max(0.1, Math.abs(sh.open.y1 - sh.closed.y1) + Math.abs(sh.open.x1 - sh.closed.x1));
    const step = (T.shutterSpeed * dt) / travel;
    if (want) {
      if (st.pos < 1) {
        st.pos = Math.min(1, st.pos + step);
        if (st.pos === 1) events.push({ type: 'shutterOpen', id: sh.id, x: sh.closed.x1, y: sh.closed.y1 });
      }
    } else if (st.pos > 0) {
      // Never close through ILO or a loose cell: hold until the volume is clear.
      const zone = {
        x1: Math.min(st.rect.x1, sh.closed.x1) - 0.02,
        y1: Math.min(st.rect.y1, sh.closed.y1) - 0.02,
        x2: Math.max(st.rect.x2, sh.closed.x2) + 0.02,
        y2: Math.max(st.rect.y2, sh.closed.y2) + 0.02,
      };
      let blocked = rectsOverlap(pb, zone, 0.0);
      for (const c of level.cells) {
        const cs = world.cells[c.id];
        if (cs.state !== 'loose') continue;
        if (rectsOverlap(cellRect(c.id, cs), zone, 0.0)) blocked = true;
      }
      if (!blocked) {
        st.pos = Math.max(0, st.pos - step);
        if (st.pos === 0) events.push({ type: 'shutterClose', id: sh.id, x: sh.closed.x1, y: sh.closed.y1 });
      }
    }
    const r = lerpRect(sh.closed, sh.open, st.pos);
    st.rect = { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, kind: 'shutter', id: sh.id, type: 'metal' };
  }
}

// ---------------------------------------------------------------------------
// Vents
// ---------------------------------------------------------------------------
export function updateVents(level, world, dt, player, events) {
  for (const v of level.vents) {
    const st = world.vents[v.id];
    if (!st.activated) {
      const cx = (v.x1 + v.x2) / 2;
      if (Math.hypot(player.x - cx, player.y - v.y) < T.vent.activateRange) {
        st.activated = true;
        st.t = v.offset ? -v.offset : 0;
      } else continue;
    }
    st.t += dt;
    const stage = ventStage(v, st.t);
    if (stage !== st.stage) {
      st.stage = stage;
      events.push({ type: `vent_${stage}`, id: v.id, x: (v.x1 + v.x2) / 2, y: v.y });
    }
  }
}

// ---------------------------------------------------------------------------
// Echo pulse
// ---------------------------------------------------------------------------
export function emitPulse(level, world, player, events) {
  if (player.carrying) return false;
  if (player.pulseCooldown > 0) return false;
  if (player.energy < T.pulse.cost) {
    events.push({ type: 'pulseDenied', x: player.x, y: player.y });
    return false;
  }
  player.energy -= T.pulse.cost;
  player.pulseCooldown = T.pulse.cooldown;
  player.regenDelay = T.pulse.regenDelay;
  player.pulseTimer = 0.4;
  world.stats.pulses += 1;
  const ox = player.x;
  const oy = player.y + T.player.height / 2;
  const blockers = getPulseBlockers(level, world);
  const targets = [];
  const consider = (kind, id, x, y, extra = {}) => {
    const d = Math.hypot(x - ox, y - oy);
    if (d > T.pulse.radius) return;
    if (!hasLineOfSight(ox, oy, x, y, blockers)) return;
    targets.push({ kind, id, dist: d, hit: false, ...extra });
  };
  for (const e of Object.values(world.enemies)) {
    if (e.disabled) continue;
    const c = enemyCenter(e);
    if (e.type === 'sentinel') c.x += (level.enemies.find((d) => d.id === e.id).dir || -1) * 0.15;
    consider('enemy', e.id, c.x, c.y);
  }
  for (const r of level.relays) consider('relay', r.id, r.x, r.y);
  for (const s of level.seams) if (!world.seams[s.id].broken) consider('seam', s.id, (s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2);
  for (const a of level.archives) consider('archive', a.id, a.x, a.y + 0.8);
  for (const mk of level.pulseMarkers) consider('marker', mk.id, mk.x, mk.y);
  for (const s of level.sockets) {
    const p = socketPos(level, world, s);
    consider('socket', s.id, p.x, p.y + 0.5);
  }
  for (const s of level.switches) consider('switch', s.id, s.x, s.y + 0.9);
  world.pulses.push({ x: ox, y: oy, r: 0, t: 0, targets, maxR: T.pulse.radius });
  events.push({ type: 'pulse', x: ox, y: oy });
  return true;
}

function applyPulseTarget(level, world, tg, power, events, hooks) {
  const hl = T.pulse.highlight;
  switch (tg.kind) {
    case 'enemy': {
      const e = world.enemies[tg.id];
      if (e.disabled) return;
      const def = level.enemies.find((d) => d.id === tg.id);
      if (e.type === 'sentinel') {
        const c = enemyCenter(e);
        if (e.state === 'venting') {
          disableEnemy(e);
          world.stats.disables += 1;
          events.push({ type: 'enemyDisable', id: e.id, enemy: 'sentinel', x: def.x, y: def.y });
        } else {
          events.push({ type: 'pulseDeflect', id: e.id, x: def.x + def.dir * 0.3, y: def.y });
        }
      } else if (stunEnemy(e)) {
        events.push({ type: 'enemyStun', id: e.id, enemy: e.type, ...enemyCenter(e) });
      }
      break;
    }
    case 'relay': {
      const r = level.relays.find((x) => x.id === tg.id);
      const st = world.relays[r.id];
      if (!st.active) {
        if (power.relayPowered(r.id)) hooks.activateRelay(r.id);
        else events.push({ type: 'relayUnpowered', id: r.id, x: r.x, y: r.y });
      } else events.push({ type: 'relayPing', id: r.id, x: r.x, y: r.y });
      break;
    }
    case 'seam': {
      const s = world.seams[tg.id];
      s.highlight = hl;
      s.revealed = true;
      events.push({ type: 'seamReveal', id: tg.id });
      break;
    }
    case 'archive':
      world.archives[tg.id].highlight = hl;
      events.push({ type: 'highlight', kind: 'archive', id: tg.id });
      break;
    case 'marker':
      world.markers[tg.id].highlight = hl;
      events.push({ type: 'highlight', kind: 'marker', id: tg.id });
      break;
    case 'socket':
    case 'switch':
      events.push({ type: 'highlight', kind: tg.kind, id: tg.id });
      break;
    default:
      break;
  }
}

export function updatePulses(level, world, dt, power, events, hooks) {
  const list = world.pulses;
  for (let i = list.length - 1; i >= 0; i--) {
    const pu = list[i];
    pu.t += dt;
    pu.r = pu.maxR * Math.min(1, pu.t / T.pulse.duration);
    for (const tg of pu.targets) {
      if (!tg.hit && tg.dist <= pu.r) {
        tg.hit = true;
        applyPulseTarget(level, world, tg, power, events, hooks);
      }
    }
    if (pu.t >= T.pulse.duration) list.splice(i, 1);
  }
  for (const s of Object.values(world.seams)) s.highlight = Math.max(0, s.highlight - dt);
  for (const a of Object.values(world.archives)) a.highlight = Math.max(0, a.highlight - dt);
  for (const m of Object.values(world.markers)) m.highlight = Math.max(0, m.highlight - dt);
}

/** Called every step while dashing: disable stunned machines that ILO passes through. */
export function dashOverlapCheck(level, world, player, events) {
  const pb = playerBox(player);
  for (const e of Object.values(world.enemies)) {
    if (e.disabled || e.state !== 'stunned') continue;
    if (rectsOverlap(pb, enemyBox(e), 0.08)) {
      disableEnemy(e);
      world.stats.disables += 1;
      events.push({ type: 'enemyDisable', id: e.id, enemy: e.type, ...enemyCenter(e) });
    }
  }
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------
export function findInteraction(level, world, player, power) {
  const cx = player.x;
  const cy = player.y + T.player.height / 2;
  const R = T.interactRange;
  if (player.carrying) {
    for (const s of level.sockets) {
      if (world.sockets[s.id].cell !== null) continue;
      const pos = socketPos(level, world, s);
      if (Math.hypot(pos.x - cx, pos.y + 0.5 - cy) <= R) {
        return { kind: 'insert', id: s.id, label: 'Insert Cell', x: pos.x, y: pos.y };
      }
    }
    return { kind: 'place', id: player.carrying, label: 'Place Cell' };
  }
  let best = null;
  const d2 = (x, y) => Math.hypot(x - cx, y - cy);
  for (const c of level.cells) {
    const st = world.cells[c.id];
    if (st.state !== 'loose') continue;
    const d = d2(st.x, st.y + 0.5);
    if (d <= R && (!best || d < best.d)) best = { kind: 'pickup', id: c.id, label: 'Pick Up Cell', x: st.x, y: st.y, d };
  }
  if (best) return best;
  for (const s of level.sockets) {
    const cid = world.sockets[s.id].cell;
    if (!cid || !s.removable) continue;
    const pos = socketPos(level, world, s);
    const d = d2(pos.x, pos.y + 0.5);
    if (d <= R && (!best || d < best.d)) best = { kind: 'remove', id: s.id, cell: cid, label: 'Remove Cell', x: pos.x, y: pos.y, d };
  }
  if (best) return best;
  for (const s of level.switches) {
    if (world.switches[s.id].on) continue;
    if (d2(s.x, s.y + 0.9) <= R) return { kind: 'switch', id: s.id, label: s.label === 'Route Latch' ? 'Latch Route' : 'Activate Power Switch', x: s.x, y: s.y };
  }
  for (const a of level.archives) {
    if (world.archives[a.id].collected) continue;
    if (d2(a.x, a.y + 0.8) <= R) return { kind: 'archive', id: a.id, label: 'Read Archive', x: a.x, y: a.y };
  }
  for (const c of level.caches) {
    if (world.caches[c.id].collected) continue;
    if (d2(c.x, c.y + 0.4) <= R) return { kind: 'cache', id: c.id, label: 'Salvage Cache', x: c.x, y: c.y };
  }
  const L = level.lift;
  if (d2(L.console.x, L.console.y + 0.9) <= T.consoleRange) {
    const missing = level.relays.filter((r) => !world.relays[r.id].active).map((r) => r.id);
    const boarding = player.x >= L.x1 + 0.2 && player.x <= L.x2 - 0.2 && Math.abs(player.y - L.boardY1) < 0.1 && player.grounded;
    if (missing.length === 0 && boarding) return { kind: 'lift', id: 'LIFT', label: 'Activate Lift', x: L.console.x, y: L.console.y };
    return {
      kind: 'liftLocked',
      id: 'LIFT',
      label: missing.length ? `Lift Unpowered · Relay ${missing.join(' / ')}` : 'Stand Inside the Lift',
      x: L.console.x,
      y: L.console.y,
    };
  }
  return null;
}

function canPlaceCell(level, world, x, y, player) {
  const rect = { x1: x - T.cell.width / 2, y1: y, x2: x + T.cell.width / 2, y2: y + T.cell.height };
  for (const s of getSolids(level, world)) {
    if (rectsOverlap(rect, s, 0.0)) return false;
  }
  for (const e of Object.values(world.enemies)) {
    if (!e.disabled && rectsOverlap(rect, enemyBox(e), 0.0)) return false;
  }
  for (const v of level.vents) if (rectsOverlap(rect, v.volume, 0.0)) return false;
  for (const e of level.enemies) if (e.type === 'sentinel' && rectsOverlap(rect, e.lane, 0.0)) return false;
  for (const z of level.deepZones) if (rectsOverlap(rect, z, 0.0)) return false;
  for (const sh of level.shutters) if (rectsOverlap(rect, sh.closed, 0.0)) return false;
  // Must rest on solid ground directly beneath.
  const support = getSolids(level, world).some(
    (s) => s.kind !== 'cell' && Math.abs(s.y2 - y) <= 0.05 && Math.min(s.x2, rect.x2) - Math.max(s.x1, rect.x1) >= 0.3
  );
  if (!support) return false;
  if (rectsOverlap(rect, playerBox(player), 0.0)) return false;
  return true;
}

/** Executes a fresh interact press. Returns 'lift' when the lift sequence should start. */
export function performInteraction(level, world, player, target, events) {
  switch (target.kind) {
    case 'insert': {
      const cid = player.carrying;
      const s = level.sockets.find((x) => x.id === target.id);
      const pos = socketPos(level, world, s);
      world.sockets[s.id].cell = cid;
      world.cells[cid] = { x: pos.x, y: pos.y, state: 'socketed', socket: s.id };
      player.carrying = null;
      player.actionTimer = 0.35;
      events.push({ type: 'insert', socket: s.id, cell: cid, x: pos.x, y: pos.y });
      return 'ok';
    }
    case 'pickup': {
      world.cells[target.id].state = 'carried';
      player.carrying = target.id;
      player.actionTimer = 0.3;
      events.push({ type: 'pickup', id: target.id });
      return 'ok';
    }
    case 'remove': {
      const cid = target.cell;
      world.sockets[target.id].cell = null;
      world.cells[cid].state = 'carried';
      player.carrying = cid;
      player.actionTimer = 0.3;
      events.push({ type: 'remove', socket: target.id, cell: cid, x: target.x, y: target.y });
      return 'ok';
    }
    case 'place': {
      const cid = player.carrying;
      const px = player.x + player.facing * T.cell.placeDistance;
      const py = player.y;
      if (canPlaceCell(level, world, px, py, player)) {
        world.cells[cid] = { x: px, y: py, state: 'loose', socket: null };
        player.carrying = null;
        player.actionTimer = 0.3;
        events.push({ type: 'place', id: cid, x: px, y: py });
      } else {
        events.push({ type: 'placeDenied', id: cid });
      }
      return 'ok';
    }
    case 'switch': {
      world.switches[target.id].on = true;
      player.actionTimer = 0.35;
      events.push({ type: 'switchOn', id: target.id, x: target.x, y: target.y });
      return 'ok';
    }
    case 'archive': {
      world.archives[target.id].collected = true;
      events.push({ type: 'archive', id: target.id });
      return 'archive';
    }
    case 'cache': {
      const before = player.energy;
      player.energy = Math.min(ENERGY_MAX, player.energy + CACHE_ENERGY);
      world.caches[target.id].collected = true;
      events.push({ type: 'cache', id: target.id, gained: player.energy - before, atFull: before >= ENERGY_MAX });
      return 'ok';
    }
    case 'lift':
      events.push({ type: 'liftStart' });
      return 'lift';
    case 'liftLocked':
      events.push({ type: 'liftDenied' });
      return 'ok';
    default:
      return 'ok';
  }
}

// ---------------------------------------------------------------------------
// Stations, zones, contacts, crush
// ---------------------------------------------------------------------------
export function updateStations(level, world, player, events, commit) {
  for (const s of level.stations) {
    const st = world.stations[s.id];
    if (st.active) continue;
    if (Math.abs(player.x - s.x) < 1.0 && Math.abs(player.y - s.y) < 0.5 && player.grounded) {
      st.active = true;
      world.checkpoint = s.id;
      player.integrity = T.integrityMax;
      player.energy = ENERGY_MAX;
      events.push({ type: 'station', id: s.id, x: s.x, y: s.y });
      commit(s);
    }
  }
}

/** Hazard and enemy contact. Calls hurt() at most once per step; returns true when a hit landed. */
export function checkContacts(level, world, player, hurt) {
  const pb = playerBox(player);
  for (const e of Object.values(world.enemies)) {
    if (!enemyDamaging(e)) continue;
    if (rectsOverlap(pb, enemyBox(e), 0.06)) {
      const kb = (p) => (Math.abs(p) < 0.05 ? -player.facing : sign(p));
      return hurt(e.type === 'skitter' ? 'skitter' : 'drone', kb(player.x - e.x) * T.damage.knockbackX);
    }
  }
  for (const v of level.vents) {
    if (world.vents[v.id].stage === 'active' && rectsOverlap(pb, v.volume, 0.06)) {
      const cx = (v.x1 + v.x2) / 2;
      return hurt('vent', sign(player.x - cx || -player.facing) * T.damage.knockbackX);
    }
  }
  for (const e of level.enemies) {
    if (e.type === 'sentinel' && world.enemies[e.id].state === 'firing' && rectsOverlap(pb, e.lane, 0.06)) {
      return hurt('beam', e.dir * T.damage.knockbackX);
    }
  }
  return false;
}

/** Falling out of the world or into deep water: returns a recovery reason or null. */
export function checkZones(level, player) {
  if (player.y < level.killY) return 'fall';
  for (const z of level.deepZones) {
    if (pointInRect(player.x, player.y + 0.3, z)) return 'deepWater';
  }
  return null;
}

/** Crush detection: sustained overlap with a mover that cannot be resolved. */
export function updateCrush(level, world, player, dt) {
  const pb = playerBox(player);
  let overlapped = false;
  for (const m of level.movers) {
    if (rectsOverlap(pb, world.movers[m.id].rect, 0.04)) {
      overlapped = true;
      break;
    }
  }
  if (overlapped) player.crushTimer += dt;
  else player.crushTimer = 0;
  return player.crushTimer >= T.recovery.crushTime;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------
export function makeSnapshot(world, stationId, x, y) {
  // Run time and recovery statistics are tracked separately and never rewound.
  const copy = deepClone({ ...world, bolts: [], pulses: [], time: 0 });
  return { station: stationId, respawn: { x, y }, world: copy };
}

export function applySnapshot(world, snapshot, level) {
  const time = world.time;
  const stats = world.stats;
  const lift = world.lift;
  for (const k of Object.keys(world)) delete world[k];
  Object.assign(world, deepClone(snapshot.world));
  world.time = time;
  world.stats = stats;
  world.lift = lift;
  world.bolts = [];
  world.pulses = [];
  for (const def of level.enemies) world.enemies[def.id] = resetEnemy(world.enemies[def.id], def);
  // Rects are derived; rebuild them so no stale reference survives.
  for (const m of level.movers) world.movers[m.id].rect = moverRect(m, world.movers[m.id]);
  for (const sh of level.shutters) {
    const st = world.shutters[sh.id];
    const r = lerpRect(sh.closed, sh.open, st.pos);
    st.rect = { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, kind: 'shutter', id: sh.id, type: 'metal' };
  }
}

export function countDisabled(world) {
  return Object.values(world.enemies).filter((e) => e.disabled).length;
}
