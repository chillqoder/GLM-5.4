/* Rough Idea — choreography.
   Scroll decides which "state" the tape is in. Each state is a shape anchored to a DOM box
   (so CSS layout positions the 3D). Between states the shape morphs, swings out toward the
   nearest screen edge, lifts toward the camera, and the tape color swaps. */
(function () {
  'use strict';
  const RI = window.RI, M = RI.m, Sh = RI.Shape;
  const N = 100;
  const FOV = 26 * Math.PI / 180;
  const CAM_D = 1 / Math.tan(FOV / 2);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  const HEX = { cobalt: '#1848DC', yellow: '#FFC400', red: '#FF3B24', cream: '#FBF0D6', green: '#27B455', pink: '#F7407E', teal: '#12B5C6', ink: '#15120E' };
  const C = {};
  for (const k in HEX) C[k] = M.hex(HEX[k]);

  // a/b: front/back tape colors. twist: radians over the whole strip. face: how much it turns toward the camera. width: ×base.
  const STATES = [
    { key: 'hero',     a: C.yellow, b: C.red,    twist: 6.4, face: 0.35, width: 1.35 },
    { key: 'build',    a: C.cobalt, b: C.red,    twist: 3.4, face: 0.62, width: 0.86 },
    { key: 'method',   a: C.yellow, b: C.cream,  twist: 4.6, face: 0.50, width: 1.00 },
    { key: 'concepts', a: C.red,    b: C.cobalt, twist: 3.2, face: 0.72, width: 0.80 },
    { key: 'cost',     a: C.yellow, b: C.pink,   twist: 2.4, face: 0.82, width: 0.95 },
    { key: 'ways',     a: C.cobalt, b: C.yellow, twist: 3.6, face: 0.66, width: 0.90 },
    { key: 'faq',      a: C.red,    b: C.yellow, twist: 2.6, face: 0.82, width: 1.05 },
    { key: 'start',    a: C.yellow, b: C.pink,   twist: 3.0, face: 0.78, width: 1.15 },
  ];
  const MODE = { hero: 'cover', build: 'contain', method: 'contain', concepts: 'stretch', cost: 'stretch', ways: 'contain', faq: 'contain', start: 'contain' };
  // which data-anchor element positions each state
  const ANCHOR = { hero: 'hero', build: 'glyph', method: 'track', cost: 'gauge', ways: 'treble', faq: 'q', start: 'at' };
  // resting 3D tilt per state [pitch, yaw, roll]
  const TILT = {
    hero: [0, 0, 0], build: [-0.34, 0.34, -0.06], method: [-0.42, 0, 0], concepts: [0, 0, 0],
    cost: [-0.14, 0.2, 0], ways: [-0.46, 0, 0], faq: [-0.18, 0.3, 0.05], start: [-0.16, 0.42, -0.08],
  };
  // each service glyph gets the angle that shows it best
  const GLYPH_TILT = [[-0.34, 0.34, -0.06], [-0.5, 0.55, 0], [-0.5, 0, 0], [-0.2, 0.25, 0], [-0.25, 0.25, 0.08], [-0.5, 0, 0]];

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  // Local shape → world targets. Tilt rotates the local shape before it is fitted into the anchor box.
  function mapShape(out, shape, rect, mode, tilt, sc) {
    let sx, sy;
    if (mode === 'stretch') { sx = rect.w / shape.w; sy = rect.h / shape.h; }
    else if (mode === 'cover') { sx = sy = Math.max(rect.w / shape.w, rect.h / shape.h); }
    else { sx = sy = Math.min(rect.w / shape.w, rect.h / shape.h); }
    const sz = (sx + sy) * 0.5;
    const ca = Math.cos(tilt[0]), sa = Math.sin(tilt[0]);
    const cb = Math.cos(tilt[1]), sb = Math.sin(tilt[1]);
    const cg = Math.cos(tilt[2]), sg = Math.sin(tilt[2]);
    // World units: the viewport is 2 units tall, 2·aspect wide. The camera sits at
    // 1/tan(fov/2) so that at z = 0 one world unit is exactly half the viewport height.
    const k = 2 / sc.vh, hw = sc.vw / 2, hh = sc.vh / 2;
    const p = shape.p, cx = shape.cx, cy = shape.cy;
    for (let i = 0; i < N; i++) {
      const x = p[i * 3] - cx, y = p[i * 3 + 1] - cy, z = p[i * 3 + 2];
      const x1 = x * cg - y * sg, y1 = x * sg + y * cg;
      const y2 = y1 * ca - z * sa, z2 = y1 * sa + z * ca;
      const x3 = x1 * cb + z2 * sb, z3 = -x1 * sb + z2 * cb;
      out[i * 3] = (rect.cx + x3 * sx - hw) * k;
      out[i * 3 + 1] = (hh - (rect.cy - y2 * sy)) * k;
      out[i * 3 + 2] = z3 * sz * k;
    }
  }

  // The concepts "clothesline": a run of tape across the top of every print, serpentine between rows.
  function buildTape(rects, W, H) {
    const items = rects.map((r) => ({ r })).sort((a, b) => a.r.y - b.r.y);
    const rows = [];
    items.forEach((it) => {
      let row = rows[rows.length - 1];
      if (row && it.r.y < row.maxY - 0.3 * it.r.h) row.list.push(it);
      else { row = { list: [it] }; rows.push(row); }
      row.maxY = Math.max(row.maxY || 0, it.r.y + it.r.h);
    });
    const L = (px, py) => [px - W / 2, H / 2 - py, 0];
    const wp = [];
    let prevEnd = null;
    rows.forEach((row, ri) => {
      const dir = ri % 2 === 0 ? 1 : -1;
      row.list.sort((a, b) => dir * (a.r.x - b.r.x));
      row.list.forEach((it) => {
        const r = it.r, y = r.y + r.h * 0.2, ov = r.w * 0.24;
        const a = dir > 0 ? [r.x - ov, y] : [r.x + r.w + ov, y];
        const b = dir > 0 ? [r.x + r.w + ov, y] : [r.x - ov, y];
        if (prevEnd) {
          const dy = y - prevEnd[1];
          wp.push(L(prevEnd[0] + dir * r.w * 0.24, prevEnd[1] + dy * 0.55));
          wp.push(L(a[0] + dir * r.w * 0.24, y - dy * 0.3));
        } else {
          wp.push(L(a[0] - dir * W * 0.25, y));
        }
        wp.push(L(a[0], y), L((a[0] + b[0]) / 2, y), L(b[0], y));
        prevEnd = b;
      });
    });
    const dirLast = (rows.length - 1) % 2 === 0 ? 1 : -1;
    wp.push(L(prevEnd[0] + dirLast * W * 0.25, prevEnd[1] + 60));
    const s = Sh.resample(Sh.spline(wp, 14), N, 0);
    s.cx = 0; s.cy = 0; s.w = W; s.h = H;
    return s;
  }

  // -------------------------------------------------------------------- Scene
  function Scene(ribbon, renderer, opts) {
    this.ribbon = ribbon;
    this.renderer = renderer;
    this.reduced = !!(opts && opts.reduced);
    this.sections = $$('.s');
    this.anchorEls = {};
    $$('[data-anchor]').forEach((el) => {
      const k = el.dataset.anchor;
      (this.anchorEls[k] || (this.anchorEls[k] = [])).push(el);
    });
    this.collage = $('.collage');
    this.prints = this.collage ? $$('.print', this.collage) : [];
    this.rows = $$('.svc__row');
    this.hudName = $('.svc-hud__name');
    this.hudNum = $('.svc-hud__num');
    this.glyph = 0; this.hoverGlyph = -1; this.hoverUntil = 0; this.rowNow = 0;
    this.curl = 1; this.fill = 0.35;
    this.grab = null;
    this.pointer = { x: -1e4, y: -1e4, has: false };
    this.vel = 0; this.lastScroll = -1;
    this.reveal = this.reduced ? 1 : 0;
    this.sigma = 0; this.section = 0; this.lastFlick = -1;
    this.onSection = null;
    this.cache = {};
    this.eye = [0, 0, CAM_D];
    this.eyeT = [0, 0, CAM_D];
    this.vp = new Float32Array(16);
    this.proj = new Float32Array(16);
    this.vm = new Float32Array(16);
    this.colA = [0, 0, 0]; this.colB = [0, 0, 0];
    this.qA = new Float32Array(N * 3); this.qB = new Float32Array(N * 3);
    this.twist = 0; this.face = 0; this.widthF = 1;
    this.resize();
  }

  Scene.prototype.resize = function () {
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.aspect = this.vw / this.vh;
    this.narrow = this.vw < 760;
    this.layout();
  };

  // Everything that only changes when the page layout changes.
  Scene.prototype.layout = function () {
    const sy = window.pageYOffset || 0;
    this.secTop = this.sections.map((el) => el.getBoundingClientRect().top + sy);
    this.cache = {};
    this.tape = null;
    if (this.collage && this.prints.length) {
      const c = this.collage.getBoundingClientRect();
      const rects = this.prints.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
      });
      this.collageRect = c;
      this.tape = buildTape(rects, c.width, c.height);
    }
  };

  Scene.prototype.anchor = function (key) {
    const list = this.anchorEls[key] || [];
    for (let i = 0; i < list.length; i++) if (list[i].getClientRects().length) return list[i];
    return list[0] || null;
  };

  // Anchor box of a state in viewport px. 'out' = leaving (kept peeking at the top edge),
  // 'in' = arriving (kept peeking at the bottom edge) — so the tape never pops in from nowhere.
  Scene.prototype.stateRect = function (i, role) {
    const key = STATES[i].key;
    let r;
    if (key === 'concepts') r = this.collage ? rectOf(this.collage) : { x: 0, y: this.vh, w: this.vw, h: this.vh, cx: this.vw / 2, cy: this.vh * 1.5 };
    else { const el = this.anchor(ANCHOR[key]); r = el ? rectOf(el) : { x: 0, y: 0, w: this.vw, h: this.vh, cx: this.vw / 2, cy: this.vh / 2 }; }
    r = { x: r.x, y: r.y, w: r.w, h: r.h, cx: r.cx, cy: r.cy };
    if (role === 'out') { const minY = -0.8 * r.h; if (r.y < minY) { r.cy += minY - r.y; r.y = minY; } }
    if (role === 'in') { const maxY = this.vh - 0.2 * r.h; if (r.y > maxY) { r.cy += maxY - r.y; r.y = maxY; } }
    return r;
  };

  Scene.prototype.shapeFor = function (i) {
    const key = STATES[i].key;
    if (key === 'concepts') return this.tape; // the clothesline is rebuilt from the prints' layout
    let arg = 0;
    if (key === 'hero') { const el = this.anchor('hero'); const r = el ? rectOf(el) : { w: this.vw, h: this.vh }; arg = r.w / r.h < 1.15 ? 'tall' : 'wide'; }
    else if (key === 'build') arg = this.glyph;
    else if (key === 'method') arg = this.narrow ? 'n' : 'w';
    else if (key === 'ways') arg = this.narrow ? 'n' : 'w';
    else if (key === 'cost') arg = Math.round(this.fill * 50) / 50;
    else if (key === 'faq') arg = Math.round(this.curl * 25) / 25;
    const ck = key + ':' + arg;
    let s = this.cache[ck];
    if (!s) {
      s = this.cache[ck] =
        key === 'hero' ? Sh.scribble(N, arg === 'tall') :
        key === 'build' ? Sh.GLYPHS[arg](N) :
        key === 'method' ? Sh.loops(N, 4, arg === 'n' ? 0.6 : 2.4) :
        key === 'ways' ? Sh.treble(N, arg === 'n' ? 0.5 : 2.2) :
        key === 'cost' ? Sh.gauge(N, arg) :
        key === 'faq' ? Sh.question(N, arg) : null;
    }
    return s || Sh.at(N);
  };

  Scene.prototype.tiltFor = function (i, t) {
    const k = STATES[i].key, b = k === 'build' ? GLYPH_TILT[this.glyph] || TILT[k] : TILT[k];
    if (this.reduced) return b;
    const w = Math.sin(t * 0.45 + i);
    return [b[0] + w * 0.05, b[1] + w * 0.09, b[2]];
  };

  Scene.prototype.evalState = function (i, role, out, t) {
    const rect = this.stateRect(i, role);
    mapShape(out, this.shapeFor(i), rect, MODE[STATES[i].key], this.tiltFor(i, t), this);
    return rect;
  };

  // Which service row is nearest the middle of the viewport → which glyph the tape wears.
  Scene.prototype.updateRows = function () {
    const rows = this.rows;
    if (!rows.length) return;
    let best = this.rowNow, bd = Infinity, cd = Infinity;
    for (let r = 0; r < rows.length; r++) {
      const rc = rows[r].getBoundingClientRect();
      if (rc.bottom < 0 || rc.top > this.vh) continue;
      const d = Math.abs(rc.top + rc.height / 2 - this.vh * 0.5);
      if (r === this.rowNow) cd = d;
      if (d < bd) { bd = d; best = r; }
    }
    if (best !== this.rowNow && bd + 28 < cd) this.rowNow = best;
    if (this.hudName && this.hudName.dataset.i !== String(this.rowNow)) {
      const row = rows[this.rowNow];
      this.hudName.textContent = row.querySelector('.svc__name').textContent;
      this.hudNum.textContent = row.querySelector('.svc__num').textContent;
      this.hudName.dataset.i = String(this.rowNow);
    }
  };

  Scene.prototype.update = function (dt, t) {
    this.time = t;
    const rib = this.ribbon, vh = this.vh, vw = this.vw, aspect = this.aspect;
    const k = 2 / vh;
    const sy = window.pageYOffset || 0;
    if (this.lastScroll < 0) this.lastScroll = sy;
    this.vel += ((sy - this.lastScroll) / Math.max(dt, 1e-3) - this.vel) * Math.min(1, dt * 8);
    this.lastScroll = sy;

    // ---- where are we between the 8 states?
    let sigma = 0;
    for (let c = 1; c < this.secTop.length; c++) sigma += M.smooth(1.02, 0.42, (this.secTop[c] - sy) / vh);
    sigma = M.clamp(sigma, 0, STATES.length - 1);
    this.sigma = sigma;
    const i = Math.floor(sigma), j = Math.min(i + 1, STATES.length - 1), f = sigma - i;
    const sec = f < 0.5 ? i : j;
    if (sec !== this.section) { this.section = sec; if (this.onSection) this.onSection(sec); }
    const flick = Math.round(sigma);
    if (flick !== this.lastFlick) {
      if (this.lastFlick >= 0) this.ribbon.pluck(1.1);
      this.lastFlick = flick;
    }

    // ---- sub-states
    if (this.hoverUntil && t > this.hoverUntil) { this.hoverGlyph = -1; this.hoverUntil = 0; }
    this.updateRows();
    this.glyph = this.hoverGlyph >= 0 ? this.hoverGlyph : this.rowNow;

    // ---- targets: morph between the two neighbouring states, swinging out to the side
    const rA = this.evalState(i, f > 0 ? 'out' : 'only', this.qA, t);
    const q = rib.q;
    let e = 0;
    if (f > 0) {
      const rB = this.evalState(j, 'in', this.qB, t);
      e = M.easeInOutCubic(f);
      const dist = Math.hypot(rB.cx - rA.cx, rB.cy - rA.cy);
      const side = (rA.cx + rB.cx) * 0.5 < vw / 2 ? -1 : 1;
      const swing = M.clamp((dist - 0.3 * vh) / (1.3 * vh), 0, 1) * 0.5 * vw * Math.sin(Math.PI * e);
      const lift = this.reduced ? 0 : 0.55 * Math.sin(Math.PI * e);
      const sw = side * swing * k;
      for (let c = 0; c < N * 3; c += 3) {
        q[c] = this.qA[c] + (this.qB[c] - this.qA[c]) * e + sw;
        q[c + 1] = this.qA[c + 1] + (this.qB[c + 1] - this.qA[c + 1]) * e;
        q[c + 2] = this.qA[c + 2] + (this.qB[c + 2] - this.qA[c + 2]) * e + lift;
      }
    } else {
      q.set(this.qA);
    }
    const A = STATES[i], B = STATES[j];
    this.twist = A.twist + (B.twist - A.twist) * e;
    this.face = A.face + (B.face - A.face) * e;
    this.widthF = A.width + (B.width - A.width) * e;
    M.mix3(A.a, B.a, e, this.colA);
    M.mix3(A.b, B.b, e, this.colB);

    // ---- breeze: always moving a little; more when you scroll fast
    if (!this.reduced) {
      const flutter = Math.min(Math.abs(this.vel) / 2500, 1);
      const amp = 0.012 + 0.09 * flutter;
      for (let c = 0; c < N; c++) {
        const u = c / (N - 1);
        q[c * 3 + 2] += amp * Math.sin(t * 1.3 + u * 7) * (0.15 + 0.85 * u);
        q[c * 3 + 1] += amp * 0.45 * Math.sin(t * 0.9 + u * 5) * u;
      }
    }

    // ---- grab: the held point follows the pointer, neighbours follow it loosely
    if (this.grab) {
      const gx = (this.pointer.x - vw / 2) * k, gy = (vh / 2 - this.pointer.y) * k;
      const tz = (this.eye[2] - this.grab.z) / this.eye[2];
      const px = this.eye[0] + (gx - this.eye[0]) * tz, py = this.eye[1] + (gy - this.eye[1]) * tz;
      const gi = this.grab.i, dx = px - q[gi * 3], dy = py - q[gi * 3 + 1];
      for (let c = 0; c < N; c++) {
        const w = Math.exp(-((c - gi) * (c - gi)) / 90);
        q[c * 3] += dx * w; q[c * 3 + 1] += dy * w;
      }
    }

    rib.step(dt);

    // ---- pointer pushes the tape aside
    const p = rib.p, v = rib.v;
    if (this.pointer.has && !this.reduced) {
      const px = (this.pointer.x - vw / 2) * k, py = (vh / 2 - this.pointer.y) * k;
      const R = this.narrow ? 0.26 : 0.34, R2 = R * R;
      for (let c = 0; c < N; c++) {
        const dx = p[c * 3] - px, dy = p[c * 3 + 1] - py, d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 1e-8) {
          const d = Math.sqrt(d2), s = 1 - d / R, push = s * s * 30 * dt;
          v[c * 3] += (dx / d) * push; v[c * 3 + 1] += (dy / d) * push; v[c * 3 + 2] += s * 7 * dt;
        }
      }
    }

    // ---- camera: a touch of parallax, eased
    const pk = this.reduced ? 0 : 0.26;
    const tx = this.pointer.has ? (this.pointer.x / vw - 0.5) * pk : 0;
    const ty = this.pointer.has ? (0.5 - this.pointer.y / vh) * pk : 0;
    const ea = Math.min(1, dt * 3);
    this.eye[0] += (tx - this.eye[0]) * ea;
    this.eye[1] += (ty - this.eye[1]) * ea;

    // ---- geometry
    const widthPx = M.clamp(0.05 * Math.min(vw, vh) * this.widthF, 9, 64);
    if (!this.reduced) this.reveal = M.easeOutCubic(M.clamp((t - (this.t0 || 0) - 0.35) / 1.9, 0, 1));
    rib.sample({
      twist: this.twist, face: this.face, width: widthPx * k, reveal: this.reveal, eye: this.eye, time: t,
      wobble: this.reduced ? 0 : 0.3 + Math.min(Math.abs(this.vel) / 2500, 1) * 0.5,
    });

    // ---- matrices
    M.perspective(this.proj, FOV, aspect, 0.1, 40);
    M.lookAt(this.vm, this.eye, [0, 0, 0], [0, 1, 0]);
    M.mul(this.vp, this.proj, this.vm);
    rib.project(this.vp, vw, vh);
  };

  Scene.prototype.view = function () {
    const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    // key light for shading; a much more frontal light for the drop shadow so it stays tucked under the tape
    const L = this._light || (this._light = norm([-0.45, 0.75, 0.6]));
    const SL = this._slight || (this._slight = norm([-0.16, 0.3, 0.94]));
    return {
      vp: this.vp, cam: this.eye, light: L, shadowLight: SL, plane: -0.14,
      colA: this.colA, colB: this.colB,
      spec: [0.9, 0.86, 0.72], shadow: [0.07, 0.055, 0.04],
      shadowCss: 'rgba(21,18,14,0.16)',
      rib: Math.PI * 2 * 150,
    };
  };

  // ---- public knobs (used by the UI)
  Scene.prototype.setHoverGlyph = function (i) { this.hoverGlyph = i; this.hoverUntil = 0; };
  Scene.prototype.flashGlyph = function (i) { this.hoverGlyph = i; this.hoverUntil = (this.time || 0) + 2.6; };
  Scene.prototype.setCurl = function (v) { this.curl = v; };
  Scene.prototype.setFill = function (v) { this.fill = v; };
  Scene.prototype.pluck = function (s) { if (!this.reduced) this.ribbon.pluck(s || 1.4); };
  Scene.prototype.celebrate = function () { if (!this.reduced) this.ribbon.pluck(3.2); };
  Scene.prototype.pointerMove = function (x, y) { this.pointer.x = x; this.pointer.y = y; this.pointer.has = true; };
  Scene.prototype.pointerLeave = function () { this.pointer.has = false; this.grab = null; };
  Scene.prototype.near = function (x, y, r) {
    const sx = this.ribbon.sx, sy = this.ribbon.sy, r2 = r * r;
    for (let i = 0; i < N; i++) { const dx = sx[i] - x, dy = sy[i] - y; if (dx * dx + dy * dy < r2) return true; }
    return false;
  };
  Scene.prototype.pointerDown = function (x, y) {
    if (this.reduced) return false;
    let best = -1, bd = 38 * 38;
    const sx = this.ribbon.sx, sy = this.ribbon.sy, p = this.ribbon.p;
    for (let i = 0; i < N; i++) { const d = (sx[i] - x) * (sx[i] - x) + (sy[i] - y) * (sy[i] - y); if (d < bd) { bd = d; best = i; } }
    if (best < 0) return false;
    this.grab = { i: best, z: p[best * 3 + 2] };
    return true;
  };
  Scene.prototype.pointerUp = function () { this.grab = null; };
  Scene.prototype.snap = function () { this.ribbon.snap(); };

  RI.Scene = Scene;
  RI.N = N;
})();
