// DEEPWAKE authored course. All collision geometry and entity placement is explicit data.
// Coordinates: x grows to the right, y grows up. Rects are {x1,y1,x2,y2} with x1<x2, y1<y2.
// Gameplay happens on the z = 0 plane; depth is reserved for scenery in the renderer.

const S = (x1, y1, x2, y2, type = 'rock', extra = {}) => ({ x1, y1, x2, y2, type, ...extra });

export const REGIONS = [
  { id: 'workshop', name: 'Buried Workshop', x1: -12, x2: 65.1 },
  { id: 'reservoir', name: 'Crystal Reservoir', x1: 65.1, x2: 121 },
  { id: 'foundry', name: 'Silent Foundry', x1: 121, x2: 168 },
  { id: 'ascent', name: 'Ascent Shaft', x1: 168, x2: 206 },
];

export function regionAt(x) {
  for (const r of REGIONS) if (x >= r.x1 && x < r.x2) return r.id;
  return 'ascent';
}

// ---------------------------------------------------------------------------
// Static solids (never change). Types drive textures, footstep sound and pulse blocking.
// ---------------------------------------------------------------------------
export const STATIC_SOLIDS = [
  // ===== Buried Workshop (floor y = 0) =====
  S(-11, -4, -10, 10, 'rock'), // left boundary
  S(-10, -4, 30, 0, 'stone'), // main floor
  S(-10, 9, 65.1, 12, 'rock'), // workshop roof
  S(10, 0, 13, 1, 'stone'), // step 1
  S(13, 0, 17, 2, 'stone'), // step 2
  S(17, 0, 17.5, 2, 'stone'), // base under the training seam
  S(17.5, 0, 24, 2, 'stone'), // raised platform after the seam
  S(30, -4, 38.5, -2.3, 'stone'), // shallow pit + maintenance alcove floor
  S(30, -2.3, 31, -1.0, 'stone'), // escape step out of the pit
  S(33.2, -0.3, 38.5, 0, 'metal'), // catwalk forming the alcove ceiling
  S(38.5, -4, 65.1, 0, 'stone'), // floor right of the pit
  // steps down into the reservoir
  S(65.1, -4, 67.5, -1.5, 'stone'),
  S(67.5, -4, 70, -3, 'stone'),

  // ===== Crystal Reservoir (banks y = -4.5) =====
  S(70, -12, 80, -4.5, 'rock'), // left bank
  S(80, -12, 89, -10, 'rock'), // deep channel bed
  S(89, -12, 113, -4.5, 'rock'), // right bank
  S(65.1, 12, 113, 15, 'rock'), // cavern roof
  S(72, -2.5, 73, 7, 'rock'), // wall-jump shaft, left wall (hangs)
  S(69, 5.5, 72, 7, 'rock'), // upper shelf with the bridge switch
  S(76.5, -2.5, 77.5, 10, 'rock'), // wall-jump shaft, right wall (hangs)
  S(94, -1.5, 94.5, 6, 'rock'), // wall above the veiled seam
  S(97.5, -2.5, 98.5, 5, 'rock'), // archive shaft, left wall (hangs)
  S(102.5, -2.5, 103.5, 8, 'rock'), // archive shaft, right wall (hangs)
  S(94.5, 3.5, 98.5, 5, 'rock'), // archive shelf
  S(64.5, 6.5, 65.1, 12, 'rock'), // lintel above the workshop exit
  S(112, 2, 112.6, 15, 'rock'), // lintel above the reservoir exit
  // stairs up to the foundry
  S(113, -6.5, 115, -3, 'stone'),
  S(115, -6.5, 117, -1.5, 'stone'),
  S(117, -6.5, 119, 0, 'stone'),
  S(119, -6.5, 121, 1.5, 'stone'),

  // ===== Silent Foundry (walkway y = 1.5, lower floor y = -2.5, upper floor y = 3.5) =====
  S(121, -6.5, 128.4, 1.5, 'metal'), // walkway left of the cover lip
  S(128.4, -6.5, 131, 0.3, 'metal'), // cover recess floor
  S(128.4, 1.5, 129, 3.1, 'metal'), // cover lip (stops the sentinel beam)
  S(131, -6.5, 134, 1.5, 'metal'), // walkway in the beam lane
  S(135, 1.5, 136.5, 6, 'metal'), // sentinel housing (overhang above the lower floor)
  S(134, -6.5, 150, -2.5, 'metal'), // lower floor with vents
  S(150, -6.5, 153, -3.3, 'metal'), // lift pit floor
  S(153, -6.5, 178, 3.5, 'metal'), // upper floor block (continues under the ascent hall)
  S(157.8, 3.5, 158.6, 4.7, 'metal'), // crate (step toward the service room)
  S(159.6, 5.8, 163.2, 6.2, 'metal'), // service room floor slab
  S(159.6, 8.7, 163.2, 9.5, 'metal'), // service room ceiling
  S(163.2, 5.8, 164.2, 9.5, 'metal'), // service room back wall
  S(121, 18.5, 174.5, 21.5, 'rock'), // foundry roof

  // ===== Ascent Shaft =====
  S(168, 6, 168.6, 18, 'rock'), // entrance lintel / shaft left wall
  S(172.5, 3.5, 173.5, 13.5, 'rock'), // shaft right wall
  S(173.5, 12.0, 174.5, 13.5, 'rock'), // landing
  S(174.5, 24, 186, 27, 'rock'), // roof over the service platform hall
  S(178, 18.5, 188, 20, 'metal'), // upper ledge (vents + drone)
  S(183.5, 21.7, 185, 22.0, 'metal'), // cache ledge: 1.7 headroom below, 2.0 rise, dash perch for the drone
  S(188, 18.5, 191, 19.6, 'metal'), // lift recess floor
  S(191, 18.5, 192.5, 20, 'metal'), // base of the lift shaft right wall
  S(186, 22.5, 188, 46, 'rock'), // lift shaft left wall (lintel: 2.5 clearance onto the car)
  S(191, 20, 192.5, 44, 'rock'), // lift shaft right wall
  S(191, 43.5, 203, 45, 'stone'), // surface terrace
  S(203, 45, 204, 50, 'rock'), // terrace back wall
];

// Breakable crystal seams. `veiled` seams must be revealed by a pulse before a dash breaks them.
export const SEAMS = [
  { id: 'seam_train', x1: 17, y1: 2, x2: 17.5, y2: 4.2, type: 'seam', veiled: false },
  { id: 'seam_alcove', x1: 33.2, y1: -2.3, x2: 33.7, y2: -0.3, type: 'seam', veiled: false },
  { id: 'seam_passage', x1: 94, y1: -4.5, x2: 94.5, y2: -1.5, type: 'seam', veiled: true },
];

// Sliding doors. `closed`/`open` are the rect at pos 0 / 1. `power` lists sources that open it.
export const SHUTTERS = [
  { id: 'SH_A', closed: { x1: 57, y1: 0, x2: 57.6, y2: 6.5 }, open: { x1: 57, y1: 9, x2: 57.6, y2: 15.5 }, power: ['socket:S_A'], latch: false },
  { id: 'SH_W', closed: { x1: 64.5, y1: 0, x2: 65.1, y2: 6.5 }, open: { x1: 64.5, y1: 9.5, x2: 65.1, y2: 16 }, power: ['relay:A'], latch: false },
  { id: 'SH_B', closed: { x1: 112, y1: -4.5, x2: 112.6, y2: 2 }, open: { x1: 112, y1: 5.5, x2: 112.6, y2: 12 }, power: ['relay:B'], latch: false },
  { id: 'SH_L', closed: { x1: 157, y1: 3.5, x2: 157.6, y2: 7 }, open: { x1: 157, y1: 10, x2: 157.6, y2: 13.5 }, power: ['switch:SW_L'], latch: true },
  { id: 'SH_S', closed: { x1: 159.6, y1: 6.2, x2: 160.2, y2: 8.7 }, open: { x1: 159.6, y1: 9.5, x2: 160.2, y2: 12 }, power: ['socket:S_C'], latch: true },
  { id: 'SH_AS', closed: { x1: 168, y1: 3.5, x2: 168.6, y2: 6 }, open: { x1: 168, y1: 8.5, x2: 168.6, y2: 11 }, power: ['relay:C'], latch: false },
];

// Moving platforms. `mode`: 'pingpong' | 'powered' | 'scripted'. `power` keeps it running.
export const MOVERS = [
  { id: 'M_B', w: 3, h: 0.3, axis: 'x', from: 80, to: 86, fixed: -4.8, speed: 1.6, pause: 2.0, mode: 'pingpong', power: ['switch:SW_B'], startAtB: true, type: 'metal' },
  { id: 'M_L', w: 3, h: 0.8, axis: 'y', from: -3.3, to: 2.7, fixed: 150, speed: 2.5, pause: 0, mode: 'powered', power: ['socket:S_L'], type: 'metal' },
  { id: 'M_AS', w: 3, h: 0.3, axis: 'y', from: 13.2, to: 20 - 0.3, fixed: 174.7, speed: 2.2, pause: 1.5, mode: 'pingpong', power: [], type: 'metal' },
  { id: 'M_FIN', w: 3, h: 0.4, axis: 'y', from: 19.6, to: 44.6, fixed: 188, speed: 3, pause: 0, mode: 'scripted', power: [], type: 'metal' },
];

export const SOCKETS = [
  { id: 'S_A', x: 55.5, y: 0, powers: ['shutter:SH_A', 'relay:A'], removable: true },
  { id: 'S_L', x: 152.6, y: 0, mover: 'M_L', powers: ['mover:M_L'], removable: true },
  { id: 'S_C', x: 161.2, y: 3.5, powers: ['shutter:SH_S', 'relay:C'], removable: true },
];

export const SWITCHES = [
  { id: 'SW_B', x: 70.5, y: 7, latched: true, label: 'Power Switch' },
  { id: 'SW_L', x: 155, y: 3.5, latched: true, label: 'Route Latch' },
];

export const RELAYS = [
  { id: 'A', x: 60.3, y: 1.2, power: ['socket:S_A'], station: 'S1', opens: 'SH_W' },
  { id: 'B', x: 107, y: -3.3, power: ['switch:SW_B'], station: 'S2', opens: 'SH_B' },
  { id: 'C', x: 164.5, y: 4.7, power: ['socket:S_C'], station: 'S3', opens: 'SH_AS' },
];

export const STATIONS = [
  { id: 'S0', x: 4.5, y: 0, region: 'workshop' },
  { id: 'S1', x: 62.5, y: 0, region: 'workshop' },
  { id: 'S2', x: 110, y: -4.5, region: 'reservoir' },
  { id: 'S3', x: 166.5, y: 3.5, region: 'foundry' },
];

export const CELLS = [
  { id: 'C1', x: 52.5, y: 0 },
  { id: 'C2', x: 147, y: -2.5 },
];

export const ARCHIVES = [
  { id: 'A1', x: 37, y: -2.3, title: 'Maintenance Log 114', text: 'The benches never fully slept. Someone oiled the same six hinges every cycle for forty years, then stopped coming. The hinges still remember.' },
  { id: 'A2', x: 96, y: 5, title: 'Hydrology Note', text: 'The reservoir was never meant to be beautiful. The crystals grew into the cooling lines because nobody drained them in time. We let them stay.' },
  { id: 'A3', x: 162.3, y: 6.2, title: 'Foundry Shift Order', text: 'Final order: seal the presses, vent the furnaces, leave the lights on for the maintenance units. Someone was expected to come back down.' },
];

export const CACHES = [
  { id: 'K1', x: 97.8, y: 5 },
  { id: 'K2', x: 160.7, y: 6.2 },
  { id: 'K3', x: 184.2, y: 22.0 },
];

export const ENEMIES = [
  { id: 'K1', type: 'skitter', x: 46, y: 0, patrol: [44, 49] },
  { id: 'K2', type: 'skitter', x: 92, y: -4.5, patrol: [91, 93.5] },
  { id: 'D_R', type: 'drone', x1: 99.0, x2: 101.5, y: -1.9, bob: 0.25 },
  { id: 'SEN1', type: 'sentinel', x: 135, y: 2.5, dir: -1, laneTo: 129 },
  { id: 'D_AS', type: 'drone', x1: 183, x2: 184.6, y: 23.0, bob: 0.2 },
];

export const VENTS = [
  { id: 'V1', x1: 139, x2: 140.2, y: -2.5 },
  { id: 'V2', x1: 144, x2: 145.2, y: -2.5, offset: 1.9 },
  { id: 'V3', x1: 180, x2: 181.2, y: 20, offset: 0.9 },
];

// Falling into these volumes triggers checkpoint recovery (deep, non-swimmable water).
export const DEEP_ZONES = [{ x1: 80, y1: -10, x2: 89, y2: -5.0 }];
export const WATER = [
  { x1: 80, x2: 89, surface: -5.0, deep: true },
  { x1: 71.5, x2: 79, surface: -4.4, deep: false, z: -2.4 }, // shallow decorative pool (background)
  { x1: 105.5, x2: 111, surface: -4.4, deep: false, z: -2.4 },
];

export const LIFT = { id: 'LIFT', x1: 188, x2: 191, boardY1: 20, boardY2: 21.6, console: { x: 189.5, y: 20 }, mover: 'M_FIN', surfaceY: 45, terraceX: 196 };

export const SPAWN = { x: 1.5, y: 0 };
export const CHECKPOINT_START = 'S0';
export const CAMERA_BOUNDS = { x1: -8.5, x2: 202, y1: -11, y2: 49 };

export const SIGNS = [
  { x: 7, y: 3.0, text: 'A / D  MOVE', keys: 'move' },
  { x: 12.2, y: 4.2, text: 'SPACE  JUMP · HOLD = HIGHER', keys: 'jump' },
  { x: 15.0, y: 4.5, text: 'SHIFT  DASH THROUGH SEAMS', keys: 'dash' },
  { x: 20.6, y: 4.4, text: 'Q  ECHO PULSE · REVEALS', keys: 'pulse' },
  { x: 28.9, y: 2.5, text: 'HUMMING BELOW', keys: 'pulse' },
  { x: 41.3, y: 3.0, text: 'STUN, THEN DASH TO DISABLE', keys: 'pulse' },
  { x: 50.6, y: 3.0, text: 'E  CARRY CELL → SOCKET', keys: 'interact' },
  { x: 59.0, y: 3.7, text: 'Q  PULSE THE RELAY', keys: 'pulse' },
  { x: 71.0, y: -1.1, text: 'HOLD TOWARD WALL · JUMP TO LEAP', keys: 'jump' },
  { x: 74.6, y: 8.1, text: 'E  POWER SWITCH', keys: 'interact' },
  { x: 91.4, y: -1.0, text: 'RESONANCE REVEALS · DASH', keys: 'pulse' },
  { x: 123.6, y: 4.2, text: 'WAIT IN COVER · CROSS ON VENT', keys: 'none' },
  { x: 136.6, y: 0.6, text: 'VENTS · WATCH THE WARNING', keys: 'none' },
  { x: 146.2, y: 0.5, text: 'E  CELL → LIFT SOCKET', keys: 'interact' },
  { x: 154.8, y: 6.3, text: 'E  LATCH THE ROUTE', keys: 'interact' },
  { x: 167.0, y: 6.3, text: 'ASCENT · R RETURNS TO STATION', keys: 'none' },
];

// Decorative glyphs that light up when reached by a pulse (render only).
export const PULSE_MARKERS = [
  { id: 'PM1', x: 33.45, y: 1.2, hint: 'archive' },
  { id: 'PM2', x: 98.6, y: 6.2, hint: 'archive' },
  { id: 'PM3', x: 160.0, y: 7.6, hint: 'archive' },
  { id: 'PM4', x: 60.3, y: 3.2, hint: 'relay' },
  { id: 'PM5', x: 107, y: -1.2, hint: 'relay' },
  { id: 'PM6', x: 164.5, y: 6.6, hint: 'relay' },
];

// Conduit polylines from each relay toward the ascent machinery (render only).
export const CONDUITS = [
  { relay: 'A', points: [[60.3, 2.4], [60.3, 7.5], [112, 7.5], [112, 10], [166, 10], [166, 14.5], [170.5, 14.5], [170.5, 18]] },
  { relay: 'B', points: [[107, -2.1], [107, 1.5], [140, 1.5], [140, 14], [167.5, 14], [167.5, 18]] },
  { relay: 'C', points: [[164.5, 5.9], [164.5, 12], [169.5, 12], [169.5, 18]] },
];

export const LAMPS = [
  { x: 4.5, y: 6.5, color: 0xffb060, region: 'workshop' },
  { x: 20, y: 7.5, color: 0xffb060, region: 'workshop' },
  { x: 45, y: 7.0, color: 0xffb060, region: 'workshop' },
  { x: 58, y: 8.0, color: 0xffb060, region: 'workshop' },
  { x: 74.5, y: 10.5, color: 0x7fe6ff, region: 'reservoir' },
  { x: 92, y: 9.5, color: 0x7fe6ff, region: 'reservoir' },
  { x: 102, y: 10.5, color: 0x7fe6ff, region: 'reservoir' },
  { x: 126, y: 14.5, color: 0xffa040, region: 'foundry' },
  { x: 142, y: 14.5, color: 0xffa040, region: 'foundry' },
  { x: 160, y: 14.5, color: 0xffa040, region: 'foundry' },
  { x: 171, y: 15.0, color: 0xffd9a0, region: 'ascent' },
  { x: 182, y: 23.2, color: 0xffd9a0, region: 'ascent' },
];

/** Build the runtime level object (deterministic). */
export function createLevel() {
  const solids = STATIC_SOLIDS.map((s, i) => ({ ...s, id: `static_${i}`, kind: 'static' }));
  // Beam lanes run from the mount face to the first solid cover (validated in validateLevel).
  const sentinelLane = (e) => {
    const h = 0.8;
    const lane = { x1: e.dir < 0 ? e.laneTo : e.x, x2: e.dir < 0 ? e.x : e.laneTo, y1: e.y - h / 2, y2: e.y + h / 2 };
    // Trim to the first solid cover between the authored end and the mount face.
    let reach = e.dir < 0 ? e.x : e.x;
    for (const s of solids) {
      if (s.x2 <= e.x + 1e-6 && s.x2 >= e.laneTo - 1e-6 && s.y2 >= lane.y1 + 0.01 && s.y1 <= lane.y2 - 0.01) {
        reach = Math.min(reach, s.x2);
      }
    }
    lane.x1 = e.dir < 0 ? reach : e.x;
    return lane;
  };
  return {
    regions: REGIONS,
    solids,
    seams: SEAMS.map((s) => ({ ...s, kind: 'seam' })),
    shutters: SHUTTERS,
    movers: MOVERS,
    sockets: SOCKETS,
    switches: SWITCHES,
    relays: RELAYS,
    stations: STATIONS,
    cells: CELLS,
    archives: ARCHIVES,
    caches: CACHES,
    enemies: ENEMIES.map((e) => (e.type === 'sentinel' ? { ...e, lane: sentinelLane(e) } : { ...e })),
    vents: VENTS.map((v) => ({ ...v, h: 3.5, volume: { x1: v.x1, y1: v.y, x2: v.x2, y2: v.y + 3.5 } })),
    deepZones: DEEP_ZONES,
    water: WATER,
    lift: LIFT,
    spawn: SPAWN,
    checkpointStart: CHECKPOINT_START,
    cameraBounds: CAMERA_BOUNDS,
    signs: SIGNS,
    pulseMarkers: PULSE_MARKERS,
    conduits: CONDUITS,
    lamps: LAMPS,
    killY: -13,
  };
}

/** Sanity checks for authored data; returns a list of problems (empty when valid). */
export function validateLevel(level) {
  const problems = [];
  const MIN_THICKNESS = 0.3;
  const checkRect = (r, label) => {
    if (!(r.x2 - r.x1 >= MIN_THICKNESS - 1e-6 && r.y2 - r.y1 >= MIN_THICKNESS - 1e-6)) {
      problems.push(`${label} is thinner than ${MIN_THICKNESS}: ${JSON.stringify(r)}`);
    }
    if (!(r.x1 < r.x2 && r.y1 < r.y2)) problems.push(`${label} has inverted bounds`);
  };
  for (const s of level.solids) checkRect(s, `solid ${s.id}`);
  for (const s of level.seams) checkRect(s, `seam ${s.id}`);
  for (const sh of level.shutters) {
    checkRect(sh.closed, `shutter ${sh.id} closed`);
    checkRect(sh.open, `shutter ${sh.id} open`);
  }
  // Spawn must stand on ground.
  const { x, y } = level.spawn;
  if (!level.solids.some((s) => x > s.x1 && x < s.x2 && Math.abs(y - s.y2) < 1e-6)) {
    problems.push('spawn is not on a solid surface');
  }
  for (const st of level.stations) {
    if (!level.solids.some((s) => st.x > s.x1 + 0.4 && st.x < s.x2 - 0.4 && Math.abs(st.y - s.y2) < 1e-6)) {
      problems.push(`station ${st.id} is not on solid ground`);
    }
  }
  for (const c of level.cells) {
    if (!level.solids.some((s) => c.x > s.x1 + 0.4 && c.x < s.x2 - 0.4 && Math.abs(c.y - s.y2) < 1e-6)) {
      problems.push(`cell ${c.id} does not start on solid ground`);
    }
  }
  // Every entity reference must resolve.
  const ids = {
    socket: new Set(level.sockets.map((s) => s.id)),
    switch: new Set(level.switches.map((s) => s.id)),
    relay: new Set(level.relays.map((r) => r.id)),
    station: new Set(level.stations.map((s) => s.id)),
    shutter: new Set(level.shutters.map((s) => s.id)),
    mover: new Set(level.movers.map((m) => m.id)),
  };
  for (const sh of level.shutters) {
    for (const p of sh.power) {
      const [kind, id] = p.split(':');
      if (!ids[kind] || !ids[kind].has(id)) problems.push(`shutter ${sh.id} power source ${p} missing`);
    }
  }
  for (const r of level.relays) {
    if (!ids.station.has(r.station)) problems.push(`relay ${r.id} station missing`);
    if (!ids.shutter.has(r.opens)) problems.push(`relay ${r.id} shutter missing`);
    for (const p of r.power) {
      const [kind, id] = p.split(':');
      if (!ids[kind] || !ids[kind].has(id)) problems.push(`relay ${r.id} power source ${p} missing`);
    }
  }
  for (const m of level.movers) {
    for (const p of m.power) {
      const [kind, id] = p.split(':');
      if (!ids[kind] || !ids[kind].has(id)) problems.push(`mover ${m.id} power source ${p} missing`);
    }
  }
  for (const so of level.sockets) {
    for (const t of so.powers) {
      const [kind, id] = t.split(':');
      if (!ids[kind] || !ids[kind].has(id)) problems.push(`socket ${so.id} target ${t} missing`);
    }
    if (so.mover && !ids.mover.has(so.mover)) problems.push(`socket ${so.id} mover missing`);
  }
  for (const e of level.enemies) {
    if (e.type === 'sentinel') {
      if (!(e.lane.x2 - e.lane.x1 > 1)) problems.push(`sentinel ${e.id} lane is degenerate`);
    }
  }
  // The sentinel lane must terminate on cover.
  for (const e of level.enemies) {
    if (e.type !== 'sentinel') continue;
    const covered = level.solids.some((s) => Math.abs(s.x2 - e.lane.x1) < 1e-6 && s.y2 >= e.lane.y2 - 1e-6 && s.y1 <= e.lane.y1 + 1e-6);
    if (!covered) problems.push(`sentinel ${e.id} lane start has no cover`);
  }
  return problems;
}
