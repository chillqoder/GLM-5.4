// Scripted full playthroughs driven only by ordinary inputs.
import { FIXED_STEP } from '../src/sim/tuning.js';
import { STATE } from '../src/sim/tuning.js';

const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** Stun a machine with a pulse (unless already stunned), then dash into it. Ordinary inputs only. */
export function disableMachine(bot, id, { dropWait = 0.45 } = {}) {
  const g = bot.g;
  const e = g.world.enemies[id];
  if (e.disabled) return;
  const approach = () => {
    const target = g.world.enemies[id];
    if (Math.abs(target.x - g.player.x) > 2.0) {
      bot.walkTo(target.x - Math.sign(target.x - g.player.x) * 1.6, 0.2, 6);
    }
  };
  if (e.state !== 'stunned') {
    approach();
    bot.ensureEnergy(35);
    bot.tap('pulse');
    bot.until(() => g.world.enemies[id].state === 'stunned', 1, null, `${id} stunned`);
  }
  bot.run(dropWait); // drones sag a little when stunned
  approach();
  bot.until(() => g.player.dashCooldown <= 0, 1, null, 'dash cooldown');
  bot.face(Math.sign(g.world.enemies[id].x - g.player.x) || 1);
  bot.tap('dash', 0.05);
  bot.until(() => g.world.enemies[id].disabled === true, 1, null, `${id} disabled`);
  bot.until(() => g.player.grounded && near(g.player.vx, 0, 0.01), 3, null, `${id} dash settle`);
}

/** Workshop: movement, dash through the training seam, the pit, Skitter K1, cell → socket, Relay A. */
export function workshop(bot, opts = {}) {
  const g = bot.g;
  bot.walkTo(9.2);
  bot.jumpTo(11.6, 0.22);
  bot.walkTo(12.3);
  bot.jumpTo(14.6, 0.3);
  bot.face(1);
  bot.tap('dash', 0.05);
  bot.until(() => near(g.player.vx, 0, 0.01), 2, null, 'dash settle');
  if (g.world.seams.seam_train.broken !== true) throw new Error('training seam not broken');
  bot.walkTo(25.6); // drops off the raised platform
  bot.walkTo(29.0);
  if (opts.archive1) archiveA1(bot);
  else bot.jumpTo(35.0, 0.3); // across the shallow pit
  bot.walkTo(43.0);
  disableMachine(bot, 'K1', { dropWait: 0 });
  bot.walkTo(51.4, 0.3);
  bot.tap('interact');
  if (g.player.carrying !== 'C1') throw new Error('cell C1 not picked up');
  bot.walkTo(55.3, 0.3);
  bot.tap('interact');
  if (g.world.sockets.S_A.cell !== 'C1') throw new Error('cell not inserted into S_A');
  bot.until(() => g.world.shutters.SH_A.pos === 1, 4, null, 'SH_A open');
  bot.walkTo(59.3, 0.3);
  bot.ensureEnergy(35);
  bot.tap('pulse');
  bot.until(() => g.state === STATE.RELAY, 1, null, 'relay A cinematic');
  bot.until(() => g.state === STATE.PLAY, 5, null, 'relay A done');
  if (!g.world.relays.A.active) throw new Error('relay A inactive');
  if (g.snapshot?.station !== 'S1') throw new Error(`relay A checkpoint is ${g.snapshot?.station}`);
}

export function reservoir(bot, opts = {}) {
  const g = bot.g;
  bot.until(() => g.world.shutters.SH_W.pos === 1, 4, null, 'SH_W open');
  bot.walkTo(63.0);
  bot.walkTo(66.0);
  bot.walkTo(68.6);
  bot.walkTo(74.2); // reservoir floor, inside the shaft
  bot.climb(7.0, 25, -1);
  bot.until(() => g.player.grounded, 4, null, 'shelf landing');
  if (g.player.y < 6.9) throw new Error(`did not reach the switch shelf (y=${g.player.y.toFixed(2)})`);
  bot.walkTo(70.5, 0.3);
  bot.tap('interact');
  if (!g.world.switches.SW_B.on) throw new Error('bridge switch not on');
  bot.walkTo(68.2, 0.3); // off the shelf edge, lands on the stair
  bot.walkTo(74.5);
  bot.walkTo(79.0);
  bot.ensureEnergy(35); // top up before entering the drone's sight line
  bot.until(() => g.world.movers.M_B.pos <= 80.01, 14, null, 'bridge at left end');
  bot.walkTo(81.5, 0.3);
  if (g.player.groundSolid?.id !== 'M_B') throw new Error(`not riding the bridge (${g.player.groundSolid?.id})`);
  bot.until(() => g.world.movers.M_B.pos >= 85.99, 12, null, 'bridge at right end');
  bot.walkTo(90.6, 0.3);
  if (g.player.y < -4.6) throw new Error('fell into the channel');
  bot.walkTo(90.6, 0.3);
  if (g.player.y < -4.6) throw new Error('fell into the channel');
  disableMachine(bot, 'K2', { dropWait: 0 });
  bot.walkTo(93.3, 0.2);
  bot.ensureEnergy(35);
  bot.tap('pulse'); // reveal the veiled seam
  bot.until(() => g.world.seams.seam_passage.revealed, 1, null, 'seam revealed');
  bot.face(1);
  bot.tap('dash', 0.05);
  bot.until(() => g.world.seams.seam_passage.broken, 1, null, 'seam passage broken');
  bot.until(() => g.player.grounded && near(g.player.vx, 0, 0.01), 2, null, 'dash settle');
  if (opts.archive2) {
    archiveA2(bot);
    bot.runTo(106.3); // the drone is disabled now
  } else {
    // Bypass the shaft drone at a run: slow bolts, telegraphed lock.
    bot.runTo(106.3);
    if (g.player.integrity !== 3) throw new Error('lost integrity bypassing the reservoir drone');
  }
  bot.ensureEnergy(35);
  bot.tap('pulse');
  bot.until(() => g.state === STATE.RELAY, 1, null, 'relay B cinematic');
  bot.until(() => g.state === STATE.PLAY, 5, null, 'relay B done');
  if (g.snapshot?.station !== 'S2') throw new Error(`relay B checkpoint is ${g.snapshot?.station}`);
}

/** Archive 1: maintenance alcove behind the pulse-marked seam in the shallow pit. */
export function archiveA1(bot) {
  const g = bot.g;
  bot.ensureEnergy(35);
  bot.tap('pulse');
  bot.until(() => g.world.seams.seam_alcove.revealed, 1, null, 'alcove seam revealed');
  bot.walkTo(31.9, 0.3); // drop into the pit (past the escape step)
  if (g.player.y > -2.2) throw new Error('did not drop into the pit');
  bot.walkTo(32.6, 0.1);
  bot.face(1);
  bot.tap('dash', 0.05);
  bot.until(() => g.world.seams.seam_alcove.broken, 1, null, 'alcove seam broken');
  bot.until(() => g.player.grounded && near(g.player.vx, 0, 0.01), 2, null, 'alcove landing');
  if (g.player.x < 33.7) throw new Error('dash did not carry into the alcove');
  bot.walkTo(36.6, 0.3);
  bot.tap('interact');
  if (!g.world.archives.A1.collected) throw new Error('archive A1 not collected');
  if (g.archiveOpen !== 'A1') throw new Error('archive fragment did not open');
  bot.tap('interact'); // dismiss the fragment
  if (g.archiveOpen !== null) throw new Error('archive fragment did not dismiss');
  bot.walkTo(31.6, 0.2);
  bot.jumpTo(30.6, 0.2, 3); // onto the escape step
  if (near(g.player.y, -1.0, 0.01) === false) throw new Error(`not on the pit escape step (y=${g.player.y.toFixed(2)})`);
  bot.jumpTo(29.0, 0.2, 3); // up onto the main floor
  if (g.player.y < -0.01) throw new Error('did not climb out of the pit');
  bot.walkTo(29.0, 0.15);
  bot.jumpTo(35.0, 0.3); // across, rejoining the main route
  if (g.player.y < -0.01) throw new Error('fell back into the pit');
}

/** Stun the shaft drone, then hit it with a jump + air dash (no ledge needed). */
export function disableDroneByAirDash(bot, id) {
  const g = bot.g;
  const e = g.world.enemies[id];
  if (e.disabled) return;
  bot.ensureEnergy(35);
  bot.tap('pulse');
  bot.until(() => g.world.enemies[id].state === 'stunned', 1, null, `${id} stunned`);
  bot.run(0.45); // the unit sags while stunned
  bot.face(Math.sign(e.x - g.player.x) || 1);
  g.setKey('jump', false);
  bot.step(1);
  g.setKey('jump', true);
  bot.run(0.2);
  g.setKey('jump', false);
  bot.tap('dash', 0.05);
  bot.until(() => e.disabled === true, 1, null, `${id} disabled by air dash`);
  bot.until(() => g.player.grounded, 3, null, 'air dash landing');
}

export function archiveA2(bot) {
  const g = bot.g;
  bot.walkTo(100.5, 0.3, 8); // shaft center
  disableDroneByAirDash(bot, 'D_R');
  bot.walkTo(100.5, 0.3, 8);
  bot.climb(5.0, 25, -1);
  bot.until(() => g.player.grounded, 4, null, 'archive shelf landing');
  if (g.player.y < 4.9) throw new Error(`did not reach the archive shelf (y=${g.player.y.toFixed(2)})`);
  bot.walkTo(97.8, 0.3);
  bot.tap('interact');
  if (!g.world.caches.K1.collected) throw new Error('cache K1 not collected');
  bot.walkTo(96.0, 0.3);
  bot.tap('interact');
  if (!g.world.archives.A2.collected) throw new Error('archive A2 not collected');
  bot.tap('interact');
  bot.jumpTo(93.4, 0.2, 3); // over the low lip at the shelf edge, down to the floor
  if (g.player.y > -4.4) throw new Error('did not get down from the archive shelf');
  bot.walkTo(96.0, 0.3);
}

export function foundry(bot) {
  const g = bot.g;
  const hits = () => g.world.stats.shieldAbsorbs + g.world.stats.damageTaken;
  const hits0 = hits();
  bot.until(() => g.world.shutters.SH_B.pos === 1, 4, null, 'SH_B open');
  bot.walkTo(112.3, 0.2);
  bot.jumpTo(114.2, 0.2);
  bot.jumpTo(116.2, 0.2);
  bot.jumpTo(118.2, 0.2);
  bot.jumpTo(120.2, 0.25);
  if (near(g.player.y, 1.5, 0.01) === false) throw new Error(`not on the foundry walkway (y=${g.player.y.toFixed(2)})`);
  bot.walkTo(127.5, 0.3);
  bot.until(() => g.world.enemies.SEN1.state === 'venting', 6, null, 'sentinel venting #1');
  bot.jumpTo(130.0, 0.25); // over the lip into the recess
  if (hits() !== hits0) throw new Error('hit by the sentinel beam');
  bot.until(() => g.world.enemies.SEN1.state === 'venting', 6, null, 'sentinel venting #2');
  bot.jumpTo(132.3, 0.3);
  bot.ensureEnergy(35);
  bot.tap('pulse');
  bot.until(() => g.world.enemies.SEN1.disabled, 1, null, 'sentinel disabled');
  if (hits() !== hits0) throw new Error('hit by the sentinel beam (2)');
  bot.walkTo(135.6, 0.3); // drop to the lower floor
  bot.walkTo(138.2, 0.3);
  bot.until(() => g.world.vents.V1.stage === 'dormant', 6, null, 'V1 dormant');
  bot.walkTo(142.0, 0.3);
  bot.until(() => g.world.vents.V2.stage === 'dormant', 6, null, 'V2 dormant');
  bot.walkTo(145.9, 0.2);
  bot.tap('interact');
  if (g.player.carrying !== 'C2') throw new Error('cell C2 not picked up');
  bot.walkTo(151.4, 0.2);
  bot.tap('interact');
  if (g.world.sockets.S_L.cell !== 'C2') throw new Error('cell not inserted into the lift socket');
  bot.until(() => g.world.movers.M_L.pos >= 2.69, 6, null, 'lift at top');
  bot.walkTo(154.6, 0.2);
  bot.tap('interact');
  if (!g.world.switches.SW_L.on) throw new Error('route latch not thrown');
  bot.until(() => g.world.shutters.SH_L.pos === 1, 3, null, 'SH_L open');
  bot.walkTo(153.65, 0.08);
  bot.tap('interact');
  if (g.player.carrying !== 'C2') throw new Error('cell not removed from the lift socket');
  bot.walkTo(155.0, 0.3);
  bot.until(() => g.world.movers.M_L.pos <= -3.29, 5, null, 'lift back down');
  if (near(g.player.y, 3.5, 0.01) === false) throw new Error('player descended with the lift');
  if (g.world.shutters.SH_L.pos !== 1) throw new Error('latched route closed after cell removal');
}

export function archiveA3(bot) {
  const g = bot.g;
  bot.until(() => g.world.shutters.SH_S.pos === 1, 3, null, 'service door open');
  bot.walkTo(158.9, 0.2); // into the gap right of the crate (arriving from under the slab)
  bot.jumpTo(158.2, 0.22); // up onto the crate
  bot.jumpTo(160.6, 0.3); // service room
  if (near(g.player.y, 6.2, 0.01) === false) throw new Error(`not in the service room (y=${g.player.y.toFixed(2)})`);
  bot.walkTo(160.7, 0.2);
  bot.tap('interact');
  if (!g.world.caches.K2.collected) throw new Error('cache K2 not collected');
  bot.walkTo(162.3, 0.2);
  bot.tap('interact');
  if (!g.world.archives.A3.collected) throw new Error('archive A3 not collected');
  bot.tap('interact');
  bot.walkTo(160.6, 0.3);
  bot.walkTo(159.1, 0.15); // off the slab into the gap
  bot.jumpTo(158.2, 0.22); // back onto the crate
  bot.walkTo(156.0, 0.2); // down to the upper floor
  bot.walkTo(157.4, 0.2);
  bot.jumpTo(158.2, 0.25);
  bot.walkTo(161.6, 0.3);
}

/** Stun the ascent drone from the main ledge, then hop to the cache perch and dash into it. */
export function disableAscentDrone(bot) {
  const g = bot.g;
  const e = g.world.enemies.D_AS;
  if (e.disabled) return;
  bot.until(() => g.world.vents.V3.stage === 'dormant', 6, null, 'V3 dormant');
  bot.runTo(182.0);
  bot.ensureEnergy(35);
  bot.tap('pulse');
  bot.until(() => e.state === 'stunned', 1, null, 'D_AS stunned');
  bot.walkTo(181.9, 0.2, 4);
  bot.jumpTo(184.2, 0.3);
  if (near(g.player.y, 22.0, 0.01) === false) throw new Error(`not on the cache ledge (y=${g.player.y.toFixed(2)})`);
  bot.face(Math.sign(e.x - g.player.x) || 1);
  bot.until(() => g.player.dashCooldown <= 0, 1, null, 'dash cooldown');
  bot.tap('dash', 0.05);
  bot.until(() => e.disabled === true, 1, null, 'D_AS disabled');
  g.setKey('right', true); // counter the dash drift away from the vent
  bot.until(() => g.player.grounded, 3, null, 'perch dash landing');
  g.setKey('right', false);
  bot.until(() => near(g.player.vx, 0, 0.01), 2);
}

export function relayCAndAscent(bot, opts = {}) {
  const g = bot.g;
  if (g.world.sockets.S_C.cell !== 'C2') throw new Error('S_C has no cell before Relay C');
  bot.walkTo(163.6, 0.3);
  bot.ensureEnergy(35);
  bot.tap('pulse');
  bot.until(() => g.state === STATE.RELAY, 1, null, 'relay C cinematic');
  bot.until(() => g.state === STATE.PLAY, 5, null, 'relay C done');
  if (g.snapshot?.station !== 'S3') throw new Error(`relay C checkpoint is ${g.snapshot?.station}`);
  bot.until(() => g.world.shutters.SH_AS.pos === 1, 4, null, 'SH_AS open');
  bot.walkTo(170.6, 0.3);
  bot.climb(14.2, 30, 1);
  bot.until(() => g.player.grounded, 5, null, 'landing');
  if (g.player.y < 13.4) throw new Error(`did not reach the ascent landing (y=${g.player.y.toFixed(2)})`);
  bot.until(() => g.world.movers.M_AS.pos <= 13.25, 8, null, 'service platform at bottom');
  bot.walkTo(176.2, 0.3);
  if (g.player.groundSolid?.id !== 'M_AS') throw new Error(`not riding the service platform (${g.player.groundSolid?.id})`);
  bot.until(() => g.world.movers.M_AS.pos >= 19.65, 8, null, 'service platform at top');
  bot.walkTo(179.5, 0.3);
  if (near(g.player.y, 20, 0.01) === false) throw new Error('not on the upper ledge');
  if (opts.disableAscentDrone !== false) {
    disableAscentDrone(bot);
    if (opts.cache3) archiveCacheK3(bot);
    bot.walkTo(182.6, 0.3, 6);
  } else {
    bot.until(() => g.world.vents.V3.stage === 'dormant', 6, null, 'V3 dormant');
    bot.runTo(189.5, 8);
  }
  if (g.player.integrity !== 3) throw new Error('lost integrity on the ascent');
  bot.runTo(189.5);
  bot.until(() => g.interaction?.kind === 'lift', 2, null, 'lift prompt');
  bot.tap('interact');
  bot.until(() => g.state === STATE.LIFT, 1, null, 'lift sequence');
  const committed = g.result;
  bot.until(() => g.state === STATE.COMPLETE, 25, null, 'completion');
  if (g.result !== committed) throw new Error('run result was committed more than once');
}

export function archiveCacheK3(bot) {
  const g = bot.g;
  bot.walkTo(181.9, 0.2);
  bot.jumpTo(184.2, 0.3);
  if (near(g.player.y, 22.0, 0.01) === false) throw new Error(`not on the cache ledge (y=${g.player.y.toFixed(2)})`);
  bot.walkTo(184.2, 0.3);
  bot.tap('interact');
  if (!g.world.caches.K3.collected) throw new Error('cache K3 not collected');
  bot.walkTo(185.4, 0.2);
  bot.walkTo(182.6, 0.2); // drop back to the ledge
}

/** Full required route with no optional discoveries. */
export function playMainRoute(bot) {
  workshop(bot);
  reservoir(bot);
  foundry(bot);
  foundryRelay(bot);
  relayCAndAscent(bot);
}

/** Cell from the lift socket to the relay socket along the latched upper route. */
export function foundryRelay(bot) {
  const g = bot.g;
  bot.walkTo(156.4, 0.2); // short run-up: carrying speed is reduced
  bot.jumpTo(158.2, 0.3); // onto the crate while carrying
  if (near(g.player.y, 4.7, 0.01) === false) throw new Error(`did not land on the crate (y=${g.player.y.toFixed(2)})`);
  bot.walkTo(161.6, 0.2); // drop into the gap, continue under the service room
  bot.tap('interact');
  if (g.world.sockets.S_C.cell !== 'C2') throw new Error('cell not inserted into S_C');
}

/** Full route including all three archives and caches. */
export function playFullRoute(bot) {
  workshop(bot, { archive1: true });
  reservoir(bot, { archive2: true });
  foundry(bot);
  foundryRelay(bot);
  archiveA3(bot);
  relayCAndAscent(bot, { cache3: true });
}

export const STEP = FIXED_STEP;
