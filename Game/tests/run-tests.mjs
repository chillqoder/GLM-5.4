// DEEPWAKE deterministic checks. Runs the authoritative simulation headlessly in Node.
// Usage: npm test   (or: node tests/run-tests.mjs)
import { Game } from '../src/sim/game.js';
import { createLevel, validateLevel } from '../src/sim/level.js';
import { STATE, TUNING as T, FIXED_STEP as DT } from '../src/sim/tuning.js';
import * as W from '../src/sim/world.js';
import { Bot } from './bot.mjs';
import * as R from './route.mjs';
import { validateRecords, applyResult, qualifies, emptyRecords, formatTime, RecordStore, validateSettings } from '../src/records.js';

// ---------------------------------------------------------------- harness
const results = [];
let current = '';
export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
export function approx(actual, expected, tol, msg) {
  if (!(Math.abs(actual - expected) <= tol)) throw new Error(`${msg || 'approx'}: expected ${expected} ±${tol}, got ${Number(actual).toFixed(4)}`);
}
export function between(v, lo, hi, msg) {
  if (!(v >= lo && v <= hi)) throw new Error(`${msg || 'between'}: expected [${lo}, ${hi}], got ${Number(v).toFixed(4)}`);
}
function suite(name) {
  current = name;
  console.log(`\n${name}`);
}
function test(name, fn) {
  try {
    fn();
    results.push({ suite: current, name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ suite: current, name, ok: false, error: e.message });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
const fresh = () => {
  const g = new Game();
  g.begin();
  return g;
};
const steps = (g, n) => {
  for (let i = 0; i < n; i++) g.step();
};
const seconds = (g, s) => steps(g, Math.round(s / DT));
/** Test-only setup: place the player somewhere (the main-route playthroughs never use this). */
const place = (g, x, y) => {
  Object.assign(g.player, { x, y, vx: 0, vy: 0, grounded: false, dashing: 0, sliding: false, immunity: 0 });
  steps(g, 2);
};
const run_ = (g, keys, s) => {
  for (const k of keys) g.setKey(k, true);
  seconds(g, s);
  for (const k of keys) g.setKey(k, false);
  g.releaseAll();
  seconds(g, 1);
};
const tapKey = (g, key, hold = 0.06) => {
  g.setKey(key, false);
  g.step();
  g.setKey(key, true);
  seconds(g, hold);
  g.setKey(key, false);
  g.step();
};

// ---------------------------------------------------------------- level
suite('Level data');
test('authored level passes validation (thickness, spawn, stations, references, sentinel cover)', () => {
  const problems = validateLevel(createLevel());
  assert(problems.length === 0, problems.join('; '));
});
test('route spans roughly 180–240 units across multiple elevations', () => {
  const L = createLevel();
  const xs = L.solids.map((s) => s.x2);
  const ys = L.solids.map((s) => s.y2);
  const span = Math.max(...xs) - Math.min(...L.solids.map((s) => s.x1));
  between(span, 180, 240, 'route span');
  assert(Math.max(...ys) - Math.min(...L.solids.map((s) => s.y1)) > 40, 'vertical extent');
});
test('exactly three archives, one per region; three caches; three relays; four stations', () => {
  const L = createLevel();
  assert(L.archives.length === 3 && L.caches.length === 3 && L.relays.length === 3 && L.stations.length === 4, 'counts');
  const regions = new Set(L.archives.map((a) => (a.x < 65.1 ? 'workshop' : a.x < 121 ? 'reservoir' : 'foundry')));
  assert(regions.size === 3, 'archives are not one per region');
});

// ---------------------------------------------------------------- movement
suite('Movement');
test('held jump rises ≈2.6 units; tap rises 1.2–1.5 units', () => {
  const g = fresh();
  g.setKey('jump', true);
  let maxY = 0;
  for (let i = 0; i < 120; i++) {
    g.step();
    maxY = Math.max(maxY, g.player.y);
  }
  g.setKey('jump', false);
  between(maxY, 2.5, 2.7, 'held jump');
  for (const hold of [1, 6, 8, 12]) {
    const g2 = fresh();
    g2.setKey('jump', true);
    let m = 0;
    for (let i = 0; i < 120; i++) {
      if (i === hold) g2.setKey('jump', false);
      g2.step();
      m = Math.max(m, g2.player.y);
    }
    between(m, 1.2, 1.5, `tap jump (${hold} steps)`);
  }
});
test('ground acceleration reaches max speed quickly; braking stops quickly; air control is weaker', () => {
  const g = fresh();
  g.setKey('right', true);
  let t = 0;
  while (g.player.vx < T.player.maxSpeed - 1e-6 && t < 1) {
    g.step();
    t += DT;
  }
  assert(t <= 0.2, `accel time ${t}`);
  g.setKey('right', false);
  let tb = 0;
  while (Math.abs(g.player.vx) > 1e-6 && tb < 1) {
    g.step();
    tb += DT;
  }
  assert(tb <= 0.25, `brake time ${tb}`);
  // air: from rest in the air, 0.1 s of input gives less speed than on the ground
  const ga = fresh();
  ga.setKey('jump', true);
  seconds(ga, 0.3);
  ga.setKey('jump', false);
  ga.setKey('right', true);
  seconds(ga, 0.1);
  const airV = ga.player.vx;
  const gg = fresh();
  gg.setKey('right', true);
  seconds(gg, 0.1);
  const groundV = gg.player.vx;
  assert(airV < groundV, `air ${airV} should be < ground ${groundV}`);
  approx(airV, T.player.airAccel * 0.1, 0.05, 'air accel');
});
test('coyote time: jump within 110 ms after a ledge works; at 160 ms it does not', () => {
  const run = (delay) => {
    const g = fresh();
    place(g, 23.2, 2); // raised platform ends at x=24
    g.setKey('right', true);
    let leftAt = null;
    for (let i = 0; i < 400; i++) {
      g.step();
      if (leftAt === null && !g.player.grounded) leftAt = i;
      if (leftAt !== null && i === leftAt + Math.round(delay / DT)) {
        g.setKey('jump', true);
      }
      if (leftAt !== null && i === leftAt + Math.round(delay / DT) + 3) {
        g.setKey('jump', false);
        g.setKey('right', false);
        return g.player.vy;
      }
    }
    return 0;
  };
  assert(run(0.06) > 5, 'coyote jump did not happen');
  assert(run(0.16) <= 0, 'jumped too late');
});
test('jump buffer: a press 100 ms before landing triggers a jump on landing', () => {
  const g = fresh();
  g.setKey('jump', true);
  seconds(g, 0.3);
  g.setKey('jump', false);
  // wait until falling close to the ground, then press ~0.1 s before landing
  while (!(g.player.vy < 0 && g.player.y < 0.9)) g.step();
  g.setKey('jump', true);
  let jumped = false;
  for (let i = 0; i < 60; i++) {
    g.step();
    if (g.player.grounded) g.setKey('jump', false);
    if (g.player.vy > 5) jumped = true;
  }
  assert(jumped, 'buffered jump did not fire');
});
test('no double jump: a mid-air press does not relaunch', () => {
  const g = fresh();
  g.setKey('jump', true);
  seconds(g, 0.3);
  g.setKey('jump', false);
  seconds(g, 0.1);
  const before = g.player.vy;
  g.setKey('jump', true);
  seconds(g, 0.05);
  assert(g.player.vy <= before + 1, 'vy increased on a second press');
});
test('ceiling resolution: jumps under the alcove stop at the ceiling without passing through', () => {
  const g = fresh();
  place(g, 36, -2.3);
  g.setKey('jump', true);
  let maxY = -99;
  for (let i = 0; i < 120; i++) {
    g.step();
    maxY = Math.max(maxY, g.player.y);
  }
  approx(maxY, -1.8, 0.01, 'ceiling stop');
  assert(g.player.y === -2.3, 'did not land back');
});
test('fall speed is capped at 24 u/s', () => {
  const g = fresh();
  place(g, 189.5, 20);
  g.player.y = 40;
  let maxV = 0;
  for (let i = 0; i < 120; i++) {
    g.step();
    maxV = Math.min(maxV, g.player.vy);
  }
  between(-maxV, 23.9, 24.1, 'fall limit');
});

// ---------------------------------------------------------------- walls
suite('Walls');
function inShaft() {
  const g = fresh();
  place(g, 74.5, -4.5); // reservoir shaft: walls at 73 and 76.5
  return g;
}
test('wall slide caps fall speed at 3 u/s and only starts airborne while holding toward the wall', () => {
  const g = inShaft();
  g.setKey('right', true);
  g.setKey('jump', true);
  seconds(g, 0.4);
  g.setKey('jump', false);
  seconds(g, 0.5);
  assert(g.player.sliding, 'not sliding');
  approx(g.player.vy, -3, 0.05, 'slide speed');
  const g2 = fresh();
  place(g2, 9.0, 0); // step 1 face at x=10 spans the body height
  g2.setKey('right', true);
  seconds(g2, 0.3); // grounded, pushing into the wall
  assert(g2.player.grounded && !g2.player.sliding, 'grounded side contact started a slide');
  assert(g2.player.wallContact === 1, 'expected side contact');
});
test('wall jump launches up and away at 7 / 12.5 with a brief steering lock', () => {
  const g = inShaft();
  g.setKey('right', true);
  g.setKey('jump', true);
  seconds(g, 0.4);
  g.setKey('jump', false);
  seconds(g, 0.4);
  assert(g.player.sliding, 'setup: not sliding');
  g.setKey('jump', true);
  g.step();
  g.step();
  approx(g.player.vy, T.player.wallJumpY - T.player.gravity * 2 * DT, 0.05, 'wall jump vy');
  approx(g.player.vx, -T.player.wallJumpX, 0.2, 'wall jump vx');
  // keep holding toward the old wall: the lock prevents an immediate reversal
  seconds(g, 0.05);
  assert(g.player.vx < -5, `steering lock failed (vx=${g.player.vx})`);
  seconds(g, 0.2);
  assert(g.player.vx > -7.1 && g.player.vx < 0.01 + 7, 'velocity after lock');
});
test('a successful wall jump refreshes the air dash', () => {
  const g = inShaft();
  g.setKey('right', true);
  g.setKey('jump', true);
  seconds(g, 0.12);
  g.setKey('jump', false);
  g.setKey('dash', true);
  g.step();
  g.setKey('dash', false);
  assert(g.player.airDash === false, 'air dash not consumed');
  seconds(g, 0.2);
  assert(g.player.sliding, `not sliding for setup (y=${g.player.y.toFixed(2)} wall=${g.player.wallContact})`);
  g.setKey('jump', true);
  seconds(g, 0.05);
  assert(g.player.airDash === true, 'wall jump did not refresh the dash');
});

// ---------------------------------------------------------------- dash
suite('Dash');
test('dash: 15 u/s for 0.16 s (≈2.4 units), exit speed 7, cooldown 0.45 s', () => {
  const g = fresh();
  place(g, 2, 0);
  g.setKey('dash', true);
  g.step();
  g.setKey('dash', false);
  assert(g.player.dashing > 0, 'dash did not start');
  approx(g.player.vx, T.dash.speed, 0.01, 'dash speed');
  const x0 = g.player.x;
  let n = 0;
  while (g.player.dashing > 0) {
    g.step();
    n++;
  }
  approx(n * DT, T.dash.duration, 0.011, 'dash duration');
  approx(g.player.x - x0, T.dash.speed * T.dash.duration, 0.2, 'dash distance');
  approx(g.player.vx, T.dash.exitSpeed, 0.01, 'exit speed');
  // immediately pressing again does nothing until the cooldown elapses
  g.setKey('dash', true);
  seconds(g, 0.3);
  g.setKey('dash', false);
  assert(g.player.dashing === 0, 'dash ignored cooldown');
  seconds(g, 0.2);
  g.setKey('dash', true);
  g.step();
  assert(g.player.dashing > 0, 'dash did not return after cooldown');
});
test('one air dash per airborne sequence; a ground landing refreshes it', () => {
  const g = fresh();
  place(g, 2, 0);
  g.setKey('jump', true);
  seconds(g, 0.1);
  g.setKey('jump', false);
  g.setKey('dash', true);
  g.step();
  g.setKey('dash', false);
  seconds(g, 0.3);
  g.setKey('dash', true);
  seconds(g, 0.1);
  g.setKey('dash', false);
  assert(g.player.dashing === 0, 'second air dash allowed');
  while (!g.player.grounded) g.step();
  g.setKey('jump', true);
  seconds(g, 0.1);
  g.setKey('jump', false);
  g.setKey('dash', true);
  g.step();
  g.setKey('dash', false);
  assert(g.player.dashing > 0, 'dash not refreshed by landing');
});
test('swept collision: a dash into a wall stops exactly at the wall face', () => {
  const g = fresh();
  place(g, 7.5, 0);
  g.setKey('right', true);
  g.setKey('dash', true);
  seconds(g, 0.5);
  g.setKey('dash', false);
  g.setKey('right', false);
  seconds(g, 0.2);
  approx(g.player.x, 10 - 0.375, 0.001, 'stopped at step face');
});
test('a dash into an unrevealed veiled seam does nothing; after a pulse reveal it shatters', () => {
  const g = fresh();
  place(g, 92.0, -4.5);
  g.setKey('dash', true);
  seconds(g, 0.4);
  g.setKey('dash', false);
  assert(!g.world.seams.seam_passage.broken, 'veiled seam broke without reveal');
  seconds(g, 0.5);
  tapKey(g, 'pulse');
  seconds(g, 0.5);
  assert(g.world.seams.seam_passage.revealed, 'seam not revealed');
  place(g, 92.6, -4.5);
  g.setKey('dash', true);
  seconds(g, 0.4);
  g.setKey('dash', false);
  assert(g.world.seams.seam_passage.broken, 'revealed seam did not break');
});
test('dashing a stunned Skitter disables it once; dashing an active Skitter is harmful', () => {
  const g = fresh();
  place(g, 43, 0);
  tapKey(g, 'pulse');
  seconds(g, 0.4);
  assert(g.world.enemies.K1.state === 'stunned', 'K1 not stunned');
  g.setKey('right', true);
  g.setKey('dash', true);
  seconds(g, 0.05);
  g.setKey('dash', false);
  seconds(g, 0.6);
  g.setKey('right', false);
  assert(g.world.enemies.K1.disabled, 'K1 not disabled');
  assert(g.world.stats.disables === 1 && g.player.integrity === 3 && g.world.stats.shieldAbsorbs === 0, 'took damage or miscounted');
  const g2 = fresh();
  place(g2, 43, 0);
  seconds(g2, 0.05);
  g2.setKey('right', true);
  g2.setKey('dash', true);
  seconds(g2, 0.5);
  g2.setKey('dash', false);
  g2.setKey('right', false);
  assert(g2.world.stats.shieldAbsorbs + g2.world.stats.damageTaken > 0, 'active skitter did not hurt');
  assert(!g2.world.enemies.K1.disabled, 'active skitter got disabled');
});

// ---------------------------------------------------------------- pulse
suite('Echo pulse & energy');
test('pulse costs 35, cooldown 0.7 s, regeneration starts after 1.5 s at 20/s', () => {
  const g = fresh();
  g.setKey('pulse', true);
  g.step();
  const t0 = g.world.time;
  approx(g.player.energy, 65, 0.01, 'cost');
  while (g.world.time < t0 + 0.5) g.step();
  g.setKey('pulse', false);
  g.step();
  g.setKey('pulse', true);
  seconds(g, 0.05);
  approx(g.player.energy, 65, 0.01, 'cooldown not respected');
  while (g.world.time < t0 + 1.45) g.step();
  approx(g.player.energy, 65, 0.01, 'regen started too early');
  while (g.world.time < t0 + 2.45) g.step();
  approx(g.player.energy, 65 + 20 * 0.95, 0.3, 'regen rate');
});
test('insufficient energy: one quiet cue, no consumption, no spam while held', () => {
  const g = fresh();
  g.player.energy = 10;
  g.setKey('pulse', true);
  seconds(g, 1.0);
  const denied = g.drainEvents().filter((e) => e.type === 'pulseDenied').length;
  assert(denied === 1, `expected one denial cue, got ${denied}`);
  approx(g.player.energy, 30, 1.0, 'energy consumed while denied'); // 10 + natural regen
  assert(g.world.pulses.length === 0, 'a pulse was emitted');
});
test('radius ≈6: a machine at 5.5 is stunned, at 6.5 it is not', () => {
  const g = fresh();
  place(g, 46 - 5.5, 0);
  tapKey(g, 'pulse');
  seconds(g, 0.5);
  assert(g.world.enemies.K1.state === 'stunned', 'target at 5.5 not reached');
  const g2 = fresh();
  place(g2, 46 - 6.5, 0);
  tapKey(g2, 'pulse');
  seconds(g2, 0.5);
  assert(g2.world.enemies.K1.state !== 'stunned', 'target at 6.5 reached');
});
test('thick walls block the pulse; an opened shutter transmits it', () => {
  const g = fresh();
  place(g, 56.2, 0); // left of the closed shutter SH_A; relay A node is at x=60.3
  tapKey(g, 'pulse');
  const targets = g.world.pulses[0].targets.map((t) => `${t.kind}:${t.id}`);
  assert(!targets.includes('relay:A'), 'pulse passed a closed shutter');
  g.setKey('pulse', false);
  seconds(g, 1);
  g.world.sockets.S_A.cell = 'C1'; // powers the shutter; relay A will activate when reached
  g.world.cells.C1 = { x: 55.5, y: 0, state: 'socketed', socket: 'S_A' };
  while (g.world.shutters.SH_A.pos < 1) g.step();
  place(g, 56.2, 0);
  g.setKey('pulse', true);
  g.step();
  const t2 = g.world.pulses[0].targets.map((t) => `${t.kind}:${t.id}`);
  assert(t2.includes('relay:A'), 'pulse blocked by an open shutter');
  seconds(g, 0.5);
  assert(g.world.relays.A.active, 'relay A did not activate through the open shutter');
});
test('each entity responds at most once per pulse', () => {
  const g = fresh();
  place(g, 43, 0);
  tapKey(g, 'pulse');
  seconds(g, 1.5);
  const stuns = g.drainEvents().filter((e) => e.type === 'enemyStun' && e.id === 'K1').length;
  assert(stuns === 1, `K1 responded ${stuns} times`);
});
test('revealed markings stay highlighted for ≈5 seconds', () => {
  const g = fresh();
  place(g, 14.5, 2);
  tapKey(g, 'pulse');
  seconds(g, 1);
  between(g.world.seams.seam_train.highlight, 4, 5, 'highlight');
  seconds(g, 4.2);
  assert(g.world.seams.seam_train.highlight === 0, 'highlight did not fade');
});

// ---------------------------------------------------------------- damage
suite('Damage, shield, recovery');
test('shield: ≥50 energy absorbs a hit without integrity loss and grants 0.8 s immunity', () => {
  const g = fresh();
  g.hurt('test', 5);
  approx(g.player.energy, 50, 0.01, 'shield cost');
  assert(g.player.integrity === 3, 'integrity lost with shield');
  approx(g.player.immunity, 0.8, 0.02, 'shield immunity');
  assert(g.hurt('test', 5) === false, 'damage applied during immunity');
});
test('below 50 energy a hit removes exactly one integrity and grants 1.2 s immunity', () => {
  const g = fresh();
  g.player.energy = 49;
  g.hurt('test', 5);
  assert(g.player.integrity === 2, 'integrity');
  approx(g.player.energy, 49, 0.01, 'energy spent without shield');
  approx(g.player.immunity, 1.2, 0.02, 'immunity');
  for (let i = 0; i < 60; i++) g.hurt('test', 5);
  assert(g.player.integrity === 2, 'repeated overlap damaged through immunity');
});
test('zero integrity triggers shutdown → reboot at the checkpoint with full integrity', () => {
  const g = fresh();
  g.player.energy = 0;
  g.hurt('a', 0);
  seconds(g, 1.3);
  g.player.energy = 0;
  g.player.immunity = 0;
  g.hurt('b', 0);
  seconds(g, 1.3);
  g.player.energy = 0;
  g.player.immunity = 0;
  g.hurt('c', 0);
  assert(g.state === STATE.SHUTDOWN, 'shutdown did not start');
  const rec = g.world.stats.recoveries;
  g.hurt('d', 0);
  assert(g.world.stats.recoveries === rec, 'overlapping hit started another recovery');
  seconds(g, 2.5);
  assert(g.state === STATE.PLAY, `state ${g.state}`);
  assert(g.player.integrity === 3 && g.player.energy === 100, 'not restored');
  assert(g.world.stats.recoveries === 1, 'recovery counted twice');
});
test('knockback resolves safely against walls (no embedding)', () => {
  const g = fresh();
  place(g, 9.7, 0);
  g.player.energy = 0;
  g.hurt('test', 10);
  seconds(g, 0.5);
  const box = { x1: g.player.x - 0.375, y1: g.player.y, x2: g.player.x + 0.375, y2: g.player.y + 1.5 };
  for (const s of g.level.solids) {
    const pen = Math.min(box.x2, s.x2) - Math.max(box.x1, s.x1);
    const peny = Math.min(box.y2, s.y2) - Math.max(box.y1, s.y1);
    assert(!(pen > 0.02 && peny > 0.02), 'player embedded in terrain after knockback');
  }
});
test('deep water and falling out of the world trigger checkpoint recovery (no shield)', () => {
  const g = fresh();
  place(g, 84, -5.6);
  assert(g.state === STATE.SHUTDOWN && g.shutdownReason === 'deepWater', `state ${g.state} ${g.shutdownReason}`);
  assert(g.player.integrity === 3, 'deep water cost integrity');
  seconds(g, 2.5);
  assert(g.state === STATE.PLAY && g.player.integrity === 3, 'not recovered');
  g.player.y = -30;
  seconds(g, 0.1);
  assert(g.state === STATE.SHUTDOWN && g.shutdownReason === 'fall', 'fall recovery');
});
test('a confirmed machinery crush triggers recovery', () => {
  const g = fresh();
  // Test setup: the counterweight lift is powered (cell in its socket) and at the top; ILO stands in the pit.
  g.world.sockets.S_L.cell = 'C2';
  g.world.cells.C2 = { x: 152.6, y: 2.7, state: 'socketed', socket: 'S_L' };
  seconds(g, 3);
  approx(g.world.movers.M_L.pos, 2.7, 0.01, 'lift at top');
  place(g, 151.5, -3.3);
  g.world.sockets.S_L.cell = null; // power removed: the car descends onto ILO
  let reason = null;
  for (let i = 0; i < 600 && reason === null; i++) {
    g.step();
    if (g.state === STATE.SHUTDOWN) reason = g.shutdownReason;
  }
  assert(reason === 'crush', `crush reason ${reason}`);
});

// ---------------------------------------------------------------- enemies
suite('Enemies & hazards');
test('Cable Skitter: alert → 0.5 s telegraph → lunge; turns at exposed ledges; needs line of sight', () => {
  const g = fresh();
  place(g, 43.5, 0);
  const e = g.world.enemies.K1;
  seconds(g, 0.2);
  assert(e.state === 'alert', `state ${e.state}`);
  seconds(g, 0.5);
  assert(e.state === 'lunge' && e.phase === 'telegraph', `expected telegraph, got ${e.state}/${e.phase}`);
  const x0 = e.x;
  seconds(g, 0.1); // 0.8 s total: 0.35 alert + 0.45 of the 0.5 s telegraph
  assert(e.phase === 'telegraph' && e.x === x0, 'telegraph shorter than 0.5 s or moved early');
  seconds(g, 0.15);
  assert(e.phase === 'strike' || e.state === 'recover', 'lunge did not start');
  assert(e.dir === -1, 'lunge direction'); // ILO is to the left
  // LOS: behind the closed shutter the Skitter keeps patrolling
  const g2 = fresh();
  place(g2, 56.2, 0); // K1 is at 46, the closed shutter at 57 is between... place K1 right of the shutter instead
  g2.world.enemies.K1.x = 58.5;
  g2.world.enemies.K1.patrol = [58, 59.5];
  seconds(g2, 1.0);
  assert(g2.world.enemies.K1.state !== 'alert' && g2.world.enemies.K1.state !== 'lunge', 'saw through a shutter');
  // ledge check: patrol never leaves its surface
  const g3 = fresh();
  g3.world.enemies.K1.patrol = [44, 49];
  seconds(g3, 6);
  between(g3.world.enemies.K1.y, -0.01, 0.01, 'skitter left its surface');
});
test('a stunned Skitter deals no contact damage and cannot attack', () => {
  const g = fresh();
  place(g, 43, 0);
  tapKey(g, 'pulse');
  seconds(g, 0.4);
  place(g, g.world.enemies.K1.x, 0);
  seconds(g, 1.0);
  assert(g.player.integrity === 3 && g.world.stats.shieldAbsorbs === 0, 'stunned machine dealt damage');
});
test('Prism Drone: 0.8 s aim line, one slow bolt that stops on terrain or on ILO', () => {
  const g = fresh();
  place(g, 100.5, -4.5);
  const e = g.world.enemies.D_R;
  seconds(g, 0.1);
  assert(e.state === 'aim', `state ${e.state}`);
  seconds(g, 0.6);
  assert(e.state === 'aim' && g.world.bolts.length === 0, 'fired before 0.8 s');
  g.player.x = 103.8; // step aside after the lock: the bolt continues along the locked line
  let fired = false;
  for (let i = 0; i < 30 && !fired; i++) {
    g.step();
    fired = g.world.bolts.length === 1;
  }
  assert(fired, 'bolt not fired');
  const b = g.world.bolts[0];
  approx(Math.hypot(b.vx, b.vy), T.drone.boltSpeed, 0.01, 'bolt speed');
  between(e.timer, 0, 0.3, 'cooldown started');
  const lockX = b.vx;
  seconds(g, 0.5); // ILO moves under the shot: the bolt does not track
  if (g.world.bolts[0]) approx(g.world.bolts[0].vx, lockX, 1e-9, 'bolt tracked ILO');
  seconds(g, 3.5);
  assert(g.world.bolts.length === 0, 'bolt did not stop on terrain');
  // a stationary target is hit and the bolt is consumed
  const g2 = fresh();
  place(g2, 100.5, -4.5);
  seconds(g2, 1.3);
  assert(g2.world.bolts.length === 0 && g2.world.stats.shieldAbsorbs === 1, 'bolt did not strike a stationary ILO');
});
test('a pulse interrupts the drone aim and stuns it for 2.5 s', () => {
  const g = fresh();
  place(g, 100.5, -4.5);
  seconds(g, 0.3);
  tapKey(g, 'pulse');
  seconds(g, 0.3);
  const e = g.world.enemies.D_R;
  assert(e.state === 'stunned', `state ${e.state}`);
  between(e.timer, 2.1, 2.6, 'stun time');
  seconds(g, 0.6);
  assert(g.world.bolts.length === 0, 'stunned drone fired');
});
test('Shutter Sentinel: closed 1.5 → warning 0.9 → firing 0.35 → venting 2.0; damage only inside the lane', () => {
  const g = fresh();
  place(g, 132, 1.5); // inside the lane: this hurts, so first observe from cover
  const e = g.world.enemies.SEN1;
  assert(e.state === 'closed', `state ${e.state}`);
  seconds(g, 1.55);
  assert(e.state === 'warning', `expected warning, got ${e.state}`);
  seconds(g, 0.95);
  assert(e.state === 'firing', `expected firing, got ${e.state}`);
  assert(g.world.stats.shieldAbsorbs === 1, 'beam did not hit inside the lane');
  seconds(g, 0.4);
  assert(e.state === 'venting', `expected venting, got ${e.state}`);
  seconds(g, 2.05);
  assert(e.state === 'closed', `expected closed, got ${e.state}`);
  // outside the lane (in the recess) the beam never hits
  const g2 = fresh();
  place(g2, 130, 0.3);
  seconds(g2, 4.0);
  assert(g2.world.stats.shieldAbsorbs === 0 && g2.world.stats.damageTaken === 0, 'beam hit through cover');
});
test('Sentinel: a pulse during venting disables it; against closed armor it deflects without changing state', () => {
  const g = fresh();
  place(g, 132, 1.5);
  const e = g.world.enemies.SEN1;
  seconds(g, 0.3);
  tapKey(g, 'pulse');
  seconds(g, 0.3);
  assert(!e.disabled && e.state !== 'disabled', 'closed armor was disabled');
  assert(g.drainEvents().some((ev) => ev.type === 'pulseDeflect'), 'no deflection feedback');
  while (e.state !== 'venting') g.step();
  g.player.energy = 100;
  g.player.pulseCooldown = 0;
  tapKey(g, 'pulse');
  seconds(g, 0.3);
  assert(e.disabled, 'venting sentinel not disabled');
});
test('vents: dormant → warning (≥0.6 s) → active; damage only while active; first exposure starts with a warning', () => {
  const g = fresh();
  place(g, 138, -2.5);
  const v = g.world.vents.V1;
  assert(v.activated && v.stage === 'warning', `first exposure stage ${v.stage}`);
  seconds(g, 0.65);
  assert(v.stage === 'warning', 'warning shorter than 0.6 s');
  place(g, 139.6, -2.5);
  assert(g.world.stats.shieldAbsorbs === 0, 'hit during warning');
  while (g.world.vents.V1.stage !== 'active') g.step();
  seconds(g, 0.05);
  assert(g.world.stats.shieldAbsorbs === 1, 'active vent did not hurt');
});

// ---------------------------------------------------------------- cells
suite('Power cells & sockets');
test('pick up → carrying: speed 4.5, no dash, no pulse, no wall slide', () => {
  const g = fresh();
  place(g, 51.4, 0);
  tapKey(g, 'interact');
  assert(g.player.carrying === 'C1', 'not carrying');
  g.setKey('right', true);
  seconds(g, 0.6);
  approx(g.player.vx, T.player.carrySpeed, 0.01, 'carry speed');
  g.setKey('right', false);
  seconds(g, 0.3);
  g.setKey('dash', true);
  g.step();
  assert(g.player.dashing === 0, 'dashed while carrying');
  g.setKey('dash', false);
  const energy = g.player.energy;
  tapKey(g, 'pulse');
  assert(g.player.energy === energy && g.world.pulses.length === 0, 'pulsed while carrying');
});
test('insert → socket powered → shutter opens; the cell cannot be duplicated by repeated or held input', () => {
  const g = fresh();
  place(g, 51.4, 0);
  tapKey(g, 'interact');
  place(g, 54.3, 0);
  g.setKey('right', true);
  seconds(g, 0.4);
  g.setKey('right', false);
  seconds(g, 0.3);
  assert(g.interaction?.kind === 'insert', `prompt ${g.interaction?.kind}`);
  g.setKey('interact', true);
  seconds(g, 1.0); // held: must not insert then remove repeatedly
  g.setKey('interact', false);
  assert(g.world.sockets.S_A.cell === 'C1' && g.player.carrying === null, 'socket state wrong after held input');
  seconds(g, 2);
  assert(g.world.shutters.SH_A.pos === 1, 'shutter did not open');
  const loose = Object.values(g.world.cells).filter((c) => c.state === 'loose').length;
  assert(loose === 1, `cell count changed (${loose} loose)`);
});
test('placement inside terrain is rejected and the cell stays carried', () => {
  const g = fresh();
  place(g, 9.6, 0); // facing the step face
  g.player.carrying = 'C1';
  g.world.cells.C1 = { x: 0, y: 0, state: 'carried', socket: null };
  g.setKey('right', true);
  seconds(g, 0.05);
  g.setKey('right', false);
  tapKey(g, 'interact');
  assert(g.player.carrying === 'C1', 'cell was placed inside terrain');
  g.setKey('left', true);
  seconds(g, 0.02);
  g.setKey('left', false);
  tapKey(g, 'interact');
  assert(g.player.carrying === null, 'cell was not placed on open ground');
  const c = g.world.cells.C1;
  assert(c.state === 'loose' && Math.abs(c.y - 0) < 0.01, 'cell not resting on the ground');
});
test('interaction priority: carried cell → empty socket first; loose cell before a removable socketed cell', () => {
  const g = fresh();
  // carried cell with an empty socket in range: insert wins over everything
  place(g, 54.3, 0);
  g.player.carrying = 'C1';
  g.world.cells.C1 = { x: 0, y: 0, state: 'carried', socket: null };
  seconds(g, 0.1);
  assert(g.interaction?.kind === 'insert', `got ${g.interaction?.kind}`);
  // loose cell near a socketed one: pickup wins
  const g2 = fresh();
  g2.world.sockets.S_A.cell = 'C2';
  g2.world.cells.C2 = { x: 55.5, y: 0, state: 'socketed', socket: 'S_A' };
  g2.world.cells.C1 = { x: 54.0, y: 0, state: 'loose', socket: null };
  place(g2, 54.6, 0);
  seconds(g2, 0.1);
  assert(g2.interaction?.kind === 'pickup', `got ${g2.interaction?.kind}`);
  // no loose cell: the removable socketed cell is offered
  g2.world.cells.C1 = { x: 0, y: 0, state: 'socketed', socket: 'S_C' };
  seconds(g2, 0.1);
  assert(g2.interaction?.kind === 'remove', `got ${g2.interaction?.kind}`);
});

// ---------------------------------------------------------------- puzzles & route
suite('Authored route (scripted inputs through the real simulation)');
test('MAIN ROUTE: full completion with ordinary movement and required mechanisms, no optional discoveries', () => {
  const g = fresh();
  const bot = new Bot(g, 'main');
  R.playMainRoute(bot);
  assert(g.state === STATE.COMPLETE, `state ${g.state}`);
  const r = g.result;
  assert(r.archives.length === 0, 'main route should not need archives');
  assert(r.caches === 0, 'main route should not need caches');
  assert(r.relays.A && r.relays.B && r.relays.C, 'relays');
  assert(r.recoveries === 0 && r.damageTaken === 0, `recoveries ${r.recoveries} damage ${r.damageTaken}`);
  assert(r.time > 30 && r.time < 400, `reference time ${r.time.toFixed(1)}s`);
  console.log(`      reference completion: ${formatTime(r.time)}, machines disabled ${r.machinesDisabled}`);
});
test('FULL ROUTE: all three archive routes, all caches, all machines, completion retained', () => {
  const g = fresh();
  const bot = new Bot(g, 'full');
  R.playFullRoute(bot);
  assert(g.state === STATE.COMPLETE, `state ${g.state}`);
  const r = g.result;
  assert(r.archives.length === 3, `archives ${r.archives}`);
  assert(r.caches === 3, `caches ${r.caches}`);
  assert(r.machinesDisabled === 5, `disabled ${r.machinesDisabled}`);
  assert(r.recoveries === 0 && r.damageTaken === 0, 'took damage');
  console.log(`      reference full completion: ${formatTime(r.time)}`);
});
test('the deep channel cannot be crossed without the bridge (jump + dash falls short)', () => {
  const g = fresh();
  place(g, 79.6, -4.5);
  g.setKey('right', true);
  g.setKey('jump', true);
  seconds(g, 0.3);
  g.setKey('jump', false);
  seconds(g, 0.25);
  g.setKey('dash', true);
  seconds(g, 0.05);
  g.setKey('dash', false);
  seconds(g, 1.5);
  g.setKey('right', false);
  assert(g.state === STATE.SHUTDOWN && g.shutdownReason === 'deepWater', `state ${g.state} ${g.shutdownReason} at x=${g.player.x.toFixed(2)}`);
});
test('the final lift refuses boarding without all relays or outside the boarding area', () => {
  const g = fresh();
  place(g, 189.5, 20);
  seconds(g, 0.1);
  assert(g.interaction?.kind === 'liftLocked', `prompt ${g.interaction?.kind}`);
  tapKey(g, 'interact');
  assert(g.state === STATE.PLAY, 'lift started without relays');
  g.world.relays.A.active = true;
  g.world.relays.B.active = true;
  g.world.relays.C.active = true;
  seconds(g, 0.1);
  assert(g.interaction?.kind === 'lift', `prompt ${g.interaction?.kind}`);
  place(g, 187.9, 20); // at the console range but beside the car, not inside
  seconds(g, 0.1);
  assert(g.interaction?.kind === 'liftLocked', `prompt outside boarding ${g.interaction?.kind}`);
  place(g, 189.5, 20);
  seconds(g, 0.1);
  tapKey(g, 'interact');
  assert(g.state === STATE.LIFT, 'lift sequence did not start');
  const committed = g.result;
  const t = g.world.time;
  assert(committed && committed.relays.A, 'result not committed');
  seconds(g, 30);
  assert(g.state === STATE.COMPLETE, `state ${g.state}`);
  assert(g.result === committed, 'result changed');
  approx(g.world.time, t, 1e-6, 'clock kept running during the celebration');
});
test('Relay activation is atomic with its station checkpoint and the opened route', () => {
  const g = fresh();
  const bot = new Bot(g);
  R.workshop(bot);
  assert(g.snapshot.station === 'S1', `station ${g.snapshot.station}`);
  assert(g.snapshot.world.relays.A.active === true, 'snapshot relay');
  assert(g.snapshot.world.shutters.SH_W.pos === 1, 'snapshot shutter');
  assert(g.snapshot.world.sockets.S_A.cell === 'C1', 'snapshot socket');
  assert(g.snapshot.world.seams.seam_train.broken, 'snapshot seam');
});

// ---------------------------------------------------------------- checkpoints
suite('Checkpoints');
test('recovery restores the committed snapshot: later changes roll back, committed progress stays, time is not rewound', () => {
  const g = fresh();
  const bot = new Bot(g);
  R.workshop(bot); // checkpoint at S1 with relay A active, cell in S_A, K1 disabled, training seam broken
  const t0 = g.world.time;
  // make changes after the snapshot: break the alcove seam, re-enable nothing, collect nothing, move the cell
  g.world.seams.seam_alcove.broken = true;
  g.world.sockets.S_A.cell = null;
  g.world.cells.C1 = { x: 60, y: 0, state: 'loose', socket: null };
  g.world.enemies.K2.disabled = true;
  seconds(g, 1.0);
  const t1 = g.world.time;
  g.setKey('retry', true);
  g.step();
  g.setKey('retry', false);
  assert(g.state === STATE.SHUTDOWN && g.shutdownReason === 'retry', 'retry did not start');
  seconds(g, 2);
  assert(g.state === STATE.PLAY, `state ${g.state}`);
  assert(g.world.seams.seam_alcove.broken === false, 'later seam break not rolled back');
  assert(g.world.sockets.S_A.cell === 'C1', 'socket not restored');
  assert(g.world.enemies.K2.disabled === false, 'later disable not rolled back');
  assert(g.world.relays.A.active && g.world.shutters.SH_W.pos === 1 && g.world.seams.seam_train.broken, 'committed progress lost');
  assert(g.world.stats.recoveries === 1, 'retry not counted as a recovery');
  assert(g.world.time >= t1, 'clock rewound'); // presentation time is excluded by design
  approx(g.player.x, 62.5, 0.01, 'respawn x');
  approx(g.player.y, 0, 0.01, 'respawn y');
  assert(g.player.integrity === 3 && g.player.energy === 100 && g.player.vx === 0 && g.player.vy === 0, 'respawn state');
});
test('R never restarts the expedition; retry input is ignored during shutdown/reboot', () => {
  const g = fresh();
  const bot = new Bot(g);
  R.workshop(bot);
  const runId = g.runId;
  g.setKey('retry', true);
  g.step();
  g.setKey('retry', false);
  seconds(g, 0.2);
  g.setKey('retry', true);
  seconds(g, 2.5);
  g.setKey('retry', false);
  assert(g.runId === runId, 'run id changed');
  assert(g.world.stats.recoveries === 1, `recoveries ${g.world.stats.recoveries}`);
  assert(g.world.relays.A.active, 'retry removed committed progress');
});
test('a station commits the world state and repairs ILO', () => {
  const g = fresh();
  place(g, 3.0, 0);
  g.player.integrity = 1;
  g.player.energy = 5;
  g.setKey('right', true);
  seconds(g, 0.4);
  g.setKey('right', false);
  assert(g.world.stations.S0.active && g.world.checkpoint === 'S0', 'station not activated');
  assert(g.player.integrity === 3 && g.player.energy === 100, 'not repaired');
  assert(g.snapshot?.station === 'S0', 'snapshot');
});

// ---------------------------------------------------------------- platforms
suite('Platforms & machinery');
test('bridge platform: boarding, rider carried, jump velocity not amplified, endpoint pauses, deterministic reset', () => {
  const g = fresh();
  g.world.switches.SW_B.on = true;
  g.world.movers.M_B.running = true;
  g.world.movers.M_B.t = 0; // parked at the left end (pause phase)
  place(g, 80.8, -4.5);
  seconds(g, 0.1);
  assert(g.player.groundSolid?.id === 'M_B', `standing on ${g.player.groundSolid?.id}`);
  const p0 = g.world.movers.M_B.pos;
  seconds(g, 1.0);
  approx(g.world.movers.M_B.pos, p0, 1e-6, 'platform left during its boarding pause');
  seconds(g, 1.2); // travel begins
  assert(g.world.movers.M_B.pos > p0 + 0.2, 'platform did not depart');
  const x0 = g.player.x;
  const m0 = g.world.movers.M_B.pos;
  seconds(g, 1.0);
  approx(g.player.x - x0, g.world.movers.M_B.pos - m0, 0.01, 'rider not carried');
  g.setKey('jump', true);
  g.step();
  g.step();
  approx(g.player.vy, T.player.jumpSpeed - T.player.gravity * DT * 2, 0.01, 'jump velocity amplified by the platform');
  g.setKey('jump', false);
  while (!g.player.grounded) g.step();
  for (let i = 0; i < 1500 && g.world.movers.M_B.pos < 86 - 1e-9; i++) g.step();
  approx(g.world.movers.M_B.pos, 86, 1e-6, 'right endpoint');
  const posAtPause = g.world.movers.M_B.pos;
  seconds(g, 1.5);
  approx(g.world.movers.M_B.pos, posAtPause, 1e-6, 'no pause at the right endpoint');
  // deterministic reset: a fresh world starts the platform parked at the left end
  const g2 = fresh();
  approx(g2.world.movers.M_B.pos, 80, 1e-9, 'initial position');
});
test('lift car: powered by its socket, carries the rider, descends when unpowered', () => {
  const g = fresh();
  place(g, 151.5, -2.5);
  g.world.sockets.S_L.cell = 'C2';
  g.world.cells.C2 = { x: 152.6, y: 2.7, state: 'socketed', socket: 'S_L' };
  seconds(g, 0.1);
  assert(g.player.groundSolid?.id === 'M_L', `standing on ${g.player.groundSolid?.id}`);
  seconds(g, 3);
  approx(g.world.movers.M_L.pos, 2.7, 0.01, 'lift top');
  approx(g.player.y, 3.5, 0.01, 'rider height');
  g.world.sockets.S_L.cell = null;
  seconds(g, 3);
  approx(g.world.movers.M_L.pos, -3.3, 0.01, 'lift bottom');
});
test('shutters never close through ILO', () => {
  const g = fresh();
  g.world.shutters.SH_A.pos = 1;
  g.world.sockets.S_A.cell = null;
  place(g, 57.3, 0); // standing in the shutter's closed volume
  seconds(g, 2);
  assert(g.world.shutters.SH_A.pos > 0.5, `shutter closed through ILO (pos ${g.world.shutters.SH_A.pos})`);
  place(g, 54, 0);
  seconds(g, 2);
  assert(g.world.shutters.SH_A.pos === 0, 'shutter did not close once clear');
});

// ---------------------------------------------------------------- lifecycle
suite('Lifecycle');
test('repeated recovery and restart do not accumulate entities, projectiles or state', () => {
  const g = fresh();
  const count = () => JSON.stringify(Object.keys(g.world.enemies).sort()) + Object.keys(g.world.movers).length + Object.keys(g.world.bolts).length + Object.keys(g.world.pulses).length;
  const before = count();
  for (let i = 0; i < 6; i++) {
    g.player.y = -30;
    seconds(g, 2.5);
    g.drainEvents();
  }
  assert(count() === before, 'entity bookkeeping changed');
  assert(Object.keys(g.world.enemies).length === 5, 'enemy count');
  for (let i = 0; i < 4; i++) {
    g.pause();
    g.restartExpedition();
    seconds(g, 0.5);
  }
  assert(g.state === STATE.PLAY && Object.keys(g.world.enemies).length === 5 && g.world.bolts.length === 0, 'restart leaked entities');
  assert(g.world.relays.A.active === false && g.world.stats.recoveries === 0, 'restart kept run state');
  assert(g.drainEvents().length < 50, 'event queue grew');
});
test('pause freezes simulation, hazards, enemies, the run clock; resume continues', () => {
  const g = fresh();
  place(g, 132, 1.5);
  const t = g.world.time;
  const et = g.world.enemies.SEN1.timer;
  const vt = g.world.vents.V1.t;
  g.pause();
  seconds(g, 3);
  assert(g.world.time === t && g.world.enemies.SEN1.timer === et && g.world.vents.V1.t === vt, 'state advanced while paused');
  assert(g.state === STATE.PAUSED, 'state');
  g.resume();
  seconds(g, 0.1);
  assert(g.world.time > t, 'clock did not resume');
});

// ---------------------------------------------------------------- records
suite('Records');
const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
};
test('only completed expeditions qualify; full-archive time requires all three archives', () => {
  const done = { time: 100, recoveries: 2, archives: ['A1'], relays: { A: true, B: true, C: true } };
  const partial = { time: 100, recoveries: 0, archives: [], relays: { A: true, B: true, C: false } };
  assert(qualifies(done) && !qualifies(partial) && !qualifies(null), 'qualification');
  let r = applyResult(emptyRecords(), done).records;
  assert(r.bestTime === 100 && r.bestFullArchiveTime === null, 'partial archive run set the full-archive record');
  const full = { ...done, time: 150, archives: ['A1', 'A2', 'A3'] };
  r = applyResult(r, full).records;
  assert(r.bestTime === 100 && r.bestFullArchiveTime === 150, 'full-archive record');
  assert(r.expeditions === 2, 'expedition count');
});
test('fewer recoveries wins; completion time only breaks ties', () => {
  const base = { archives: [], relays: { A: true, B: true, C: true } };
  let r = applyResult(emptyRecords(), { ...base, time: 200, recoveries: 3 }).records;
  r = applyResult(r, { ...base, time: 300, recoveries: 2 }).records;
  assert(r.fewestRecoveries === 2 && r.fewestRecoveriesTime === 300, 'fewer recoveries did not win');
  r = applyResult(r, { ...base, time: 250, recoveries: 2 }).records;
  assert(r.fewestRecoveries === 2 && r.fewestRecoveriesTime === 250, 'tie-break by time');
  r = applyResult(r, { ...base, time: 100, recoveries: 5 }).records;
  assert(r.fewestRecoveries === 2 && r.fewestRecoveriesTime === 250 && r.bestTime === 100, 'more recoveries overwrote');
});
test('corrupt or incompatible stored data is ignored; unavailable storage keeps records in memory', () => {
  assert(validateRecords(null) === null, 'null');
  assert(validateRecords({ version: 2, bestTime: 5 }) === null, 'incompatible version');
  assert(validateRecords('garbage') === null, 'string');
  const v = validateRecords({ version: 1, bestTime: -3, fewestRecoveries: 2, fewestRecoveriesTime: 'x', expeditions: 3 });
  assert(v && v.bestTime === null && v.fewestRecoveries === null && v.expeditions === 3, 'sanitising');
  const store = new RecordStore({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } });
  assert(store.available === false, 'availability flag');
  store.applyResult({ time: 42, recoveries: 1, archives: ['A1', 'A2', 'A3'], relays: { A: true, B: true, C: true } });
  assert(store.records.bestTime === 42, 'in-memory record lost');
  const s = fakeStorage();
  s.setItem('deepwake.records.v1', '{not json');
  const st2 = new RecordStore(s);
  assert(st2.records.bestTime === null && st2.available, 'corrupt data not ignored');
  const s3 = fakeStorage();
  const st3 = new RecordStore(s3);
  st3.applyResult({ time: 77, recoveries: 0, archives: ['A1', 'A2', 'A3'], relays: { A: true, B: true, C: true } });
  const st4 = new RecordStore(s3);
  assert(st4.records.bestTime === 77 && st4.records.fewestRecoveries === 0, 'reload');
});
test('settings validation rejects unknown touch modes', () => {
  assert(validateSettings({ muted: true, touch: 'banana' }).touch === 'auto', 'touch mode');
  assert(validateSettings(null).muted === false, 'defaults');
});

// ---------------------------------------------------------------- summary
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('Failed:');
  for (const f of failed) console.log(`  - [${f.suite}] ${f.name}: ${f.error}`);
  process.exit(1);
}
