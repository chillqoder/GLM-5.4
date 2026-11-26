/* Rough Idea — shape library.
   Every shape is ONE continuous path, resampled to n points by arc length,
   so any shape can morph into any other by moving point i onto point i. */
(function () {
  'use strict';
  const RI = window.RI;
  const TAU = Math.PI * 2;
  const Sh = RI.Shape = {};

  const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0));

  // Centripetal Catmull-Rom through waypoints → dense polyline (smooth, no cusps)
  function spline(wp, per) {
    per = per || 14;
    const n = wp.length, out = [];
    const at = (i) => wp[i < 0 ? 0 : i > n - 1 ? n - 1 : i];
    const mix = (p, q, t0, t1, t) => {
      const a = (t1 - t) / (t1 - t0), b = (t - t0) / (t1 - t0);
      return [p[0] * a + q[0] * b, p[1] * a + q[1] * b, (p[2] || 0) * a + (q[2] || 0) * b];
    };
    for (let i = 0; i < n - 1; i++) {
      const p0 = at(i - 1), p1 = wp[i], p2 = wp[i + 1], p3 = at(i + 2);
      const t0 = 0;
      const t1 = t0 + Math.sqrt(d3(p0, p1)) + 1e-3;
      const t2 = t1 + Math.sqrt(d3(p1, p2)) + 1e-3;
      const t3 = t2 + Math.sqrt(d3(p2, p3)) + 1e-3;
      for (let k = 0; k < per; k++) {
        const t = t1 + (t2 - t1) * (k / per);
        const a1 = mix(p0, p1, t0, t1, t), a2 = mix(p1, p2, t1, t2, t), a3 = mix(p2, p3, t2, t3, t);
        const b1 = mix(a1, a2, t0, t2, t), b2 = mix(a2, a3, t1, t3, t);
        out.push(mix(b1, b2, t1, t2, t));
      }
    }
    const l = wp[n - 1];
    out.push([l[0], l[1], l[2] || 0]);
    return out;
  }

  // Polyline with (lightly) rounded corners — for shapes that should stay crisp
  function rounded(poly, r, steps) {
    steps = steps || 8;
    const out = [poly[0].slice()];
    for (let i = 1; i < poly.length - 1; i++) {
      const a = poly[i - 1], b = poly[i], c = poly[i + 1];
      const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6, l2 = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1e-6;
      const d = Math.min(r, l1 * 0.45, l2 * 0.45);
      const p1 = [b[0] - ((b[0] - a[0]) / l1) * d, b[1] - ((b[1] - a[1]) / l1) * d, b[2] || 0];
      const p2 = [b[0] + ((c[0] - b[0]) / l2) * d, b[1] + ((c[1] - b[1]) / l2) * d, b[2] || 0];
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, m = 1 - t;
        out.push([
          m * m * p1[0] + 2 * m * t * b[0] + t * t * p2[0],
          m * m * p1[1] + 2 * m * t * b[1] + t * t * p2[1],
          m * m * p1[2] + 2 * m * t * (b[2] || 0) + t * t * p2[2],
        ]);
      }
    }
    out.push(poly[poly.length - 1].slice());
    return out;
  }

  // Arc-length resample. Returns {p, cx, cy, w, h}: box is the bounding box plus padding.
  function resample(pts, n, pad) {
    const m = pts.length, cum = new Float64Array(m);
    for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + d3(pts[i - 1], pts[i]);
    const L = cum[m - 1] || 1;
    const p = new Float32Array(n * 3);
    let j = 0, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (let i = 0; i < n; i++) {
      const target = (L * i) / (n - 1);
      while (j < m - 2 && cum[j + 1] < target) j++;
      const seg = cum[j + 1] - cum[j] || 1e-9;
      const t = Math.min(1, Math.max(0, (target - cum[j]) / seg));
      const a = pts[j], b = pts[j + 1];
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      const z = (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * t;
      p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    pad = pad || 0;
    return { p, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, w: maxx - minx + pad * 2, h: maxy - miny + pad * 2 };
  }

  Sh.spline = spline;
  Sh.resample = resample;

  // ---------------------------------------------------------------- hero
  // A loose flourish with one loop: the "rough idea". The hero is a fixed 16:9 (or 9:16) stage,
  // scaled to cover the section, so these coordinates always mean the same place on screen.
  const WIDE = [
    [9.8, 3.2, 0.9], [7.0, 2.6, 0.7], [5.2, 1.7, 0.45], [3.9, 0.6, 0.25], [2.9, -0.5, 0.05],
    [2.0, -1.5, -0.15], [0.8, -1.9, -0.35], [-0.3, -1.5, -0.5], [-0.6, -0.5, -0.45], [-0.2, 0.4, -0.3],
    [0.8, 0.6, -0.15], [1.7, 0.1, 0.0], [2.0, -0.8, 0.1], [2.6, -1.3, 0.2], [3.6, -1.1, 0.3],
    [5.2, -0.6, 0.45], [7.8, -0.4, 0.6], [9.8, -0.6, 0.7],
  ];
  const TALL = [
    [-4.9, 6.2, 0.8], [-2.6, 5.8, 0.6], [-0.6, 4.9, 0.4], [1.0, 3.6, 0.2], [1.4, 2.2, 0.0],
    [0.4, 1.2, -0.2], [-1.2, 1.1, -0.4], [-2.2, 2.0, -0.5], [-1.9, 3.1, -0.4], [-0.6, 3.5, -0.2],
    [0.9, 3.1, 0.0], [2.2, 2.0, 0.2], [3.0, 0.4, 0.3], [2.2, -1.2, 0.4], [0.2, -2.2, 0.5],
    [-2.4, -2.6, 0.5], [-3.6, -3.8, 0.4], [-2.6, -5.0, 0.3], [-0.4, -5.6, 0.2], [1.8, -6.4, 0.4], [3.4, -7.8, 0.6],
  ];
  Sh.scribble = function (n, tall) {
    const s = resample(spline(tall ? TALL : WIDE, 16), n, 0);
    s.cx = 0; s.cy = 0; s.w = tall ? 9 : 16; s.h = tall ? 16 : 9;
    return s;
  };

  // ---------------------------------------------------------------- service glyphs
  const FRAME = [
    [-3.3, -2.5, 0], [-4.3, -1.6, -0.1], [-4.4, 1.6, 0], [-3.5, 2.6, 0.1], [3.4, 2.6, 0.1],
    [4.4, 1.6, 0], [4.3, -1.6, -0.1], [3.3, -2.5, 0], [-3.1, -2.5, 0], [-4.2, -1.7, 0.15],
  ];
  const CYCLE = [
    [-4.8, -4.0, 0.5], [-2.6, -3.6, 0.45], [-0.3, -3.3, 0.3], [2.5, -1.7, 0.1], [3.4, 1.0, -0.1],
    [1.5, 3.2, -0.3], [-1.5, 3.4, -0.45], [-3.5, 1.7, -0.55], [-3.4, -1.3, -0.5],
    [-1.1, -3.2, -0.3], [1.9, -3.2, -0.1], [3.7, -1.0, 0.1], [3.2, 1.7, 0.25],
  ];
  const Q_FULL = [[-2.7, 2.0], [-2.8, 3.9], [-1.4, 5.3], [0.6, 5.1], [2.0, 3.7], [1.6, 2.0], [0.2, 0.9], [-0.1, -0.4], [-0.1, -2.2], [0.2, -4.4]];
  const Q_FLAT = [[-2.5, 4.2], [-1.9, 5.1], [-0.8, 5.2], [-0.2, 4.3], [0.0, 3.0], [0.0, 1.4], [0.0, -0.2], [0.0, -1.8], [0.0, -3.2], [0.2, -4.6]];
  const AT = [
    [0.95, 1.5, 0], [1.15, 0.3, 0], [0.5, -0.9, 0], [-0.7, -0.85, 0], [-1.15, 0.3, 0], [-0.3, 1.3, 0],
    [0.85, 0.65, 0.1], [1.0, -0.5, 0.12], [1.15, -1.5, 0.1], [1.9, -2.5, 0.15], [3.3, -1.5, 0.1],
    [3.7, 0.5, 0], [2.2, 2.8, -0.1], [-0.5, 3.4, -0.15], [-3.2, 2.2, -0.1], [-3.9, -0.7, 0],
    [-2.1, -3.1, 0.1], [0.9, -3.5, 0.15], [3.0, -2.3, 0.1],
  ];

  Sh.frame = (n) => resample(spline(FRAME, 12), n, 0.7);

  Sh.layers = function (n) {
    const pts = [];
    for (let k = 0; k <= 240; k++) {
      const u = (3 * k) / 240, phi = Math.PI * u;
      pts.push([3.9 * Math.cos(phi), 3.9 - 2.6 * u, 1.35 * Math.sin(phi)]);
    }
    return resample(pts, n, 0.7);
  };

  Sh.cycle = (n) => resample(spline(CYCLE, 14), n, 0.7);

  Sh.trefoil = function (n) {
    const pts = [];
    for (let k = 0; k <= 300; k++) {
      const th = (TAU * k) / 300;
      pts.push([1.25 * (Math.sin(th) + 2 * Math.sin(2 * th)), 1.25 * (Math.cos(th) - 2 * Math.cos(2 * th) + 1), -0.6 * Math.sin(3 * th)]);
    }
    return resample(pts, n, 0.8);
  };

  Sh.dart = (n) => resample(rounded([[-4.7, 3.7, 0.1], [4.9, 0, 0], [-2.7, -3.1, -0.1], [-1.7, -0.3, 0], [-4.7, 3.7, 0.1]], 0.55, 7), n, 0.8);

  Sh.helix = function (n) {
    const pts = [];
    for (let k = 0; k <= 260; k++) {
      const t = k / 260, phi = TAU * 2.25 * t - Math.PI / 2, r = 1.6 + 1.7 * t;
      pts.push([r * Math.cos(phi), -3.7 + 7.4 * t, 0.75 * r * Math.sin(phi)]);
    }
    return resample(pts, n, 0.7);
  };

  // Web apps: a stack of three plates (screens), each one stepping toward the viewer
  Sh.plates = function (n) {
    const w = 2.6, h = 1.8, r = 0.7;
    const plate = (cx, cy, z) => rounded([[cx - w, cy - h, z], [cx + w, cy - h, z], [cx + w, cy + h, z], [cx - w, cy + h, z], [cx - w, cy - h, z]], r, 5);
    const pts = [].concat(plate(-1.3, 1.1, -1.5), [[-1.95, 0, -0.75]], plate(0, 0, 0), [[0.65, -1.1, 0.75]], plate(1.3, -1.1, 1.5));
    return resample(pts, n, 0.8);
  };

  // SaaS: an outward spiral — the roll keeps growing
  Sh.spiral = function (n) {
    const pts = [], turns = 2.2;
    for (let k = 0; k <= 260; k++) {
      const t = k / 260, th = TAU * turns * t, r = 0.4 + 3.4 * t;
      pts.push([r * Math.cos(th), r * Math.sin(th), 0.5 * t * Math.sin(th * 0.5)]);
    }
    return resample(pts, n, 0.8);
  };

  Sh.GLYPHS = [Sh.frame, Sh.plates, Sh.cycle, Sh.trefoil, Sh.dart, Sh.spiral];

  // ---------------------------------------------------------------- loop-the-loop runs
  // A prolate cycloid: forward progress with a loop in it. One loop per week / per step.
  function cycloid(count, lead, grow) {
    const a = 0.28, pts = [];
    const u0 = -Math.PI, u1 = TAU * (count - 1) + Math.PI;
    const bAt = (u) => 1 + (grow || 0) * ((u - u0) / TAU);
    const xAt = (u) => a * u - bAt(u) * Math.sin(u);
    const yAt = (u) => bAt(u) * (1 + Math.cos(u)) - 1;
    const x0 = xAt(u0), x1 = xAt(u1), steps = 6;
    for (let k = 0; k < steps; k++) pts.push([x0 - lead * (1 - k / steps), -1, 0]);
    const N = count * 70;
    for (let k = 0; k <= N; k++) {
      const u = u0 + ((u1 - u0) * k) / N;
      pts.push([xAt(u), yAt(u), 0.6 * Math.sin(u)]);
    }
    for (let k = 1; k <= steps; k++) pts.push([x1 + lead * (k / steps), -1, 0]);
    return pts;
  }
  Sh.loops = (n, count, lead) => resample(cycloid(count, lead, 0), n, 1.0);
  Sh.treble = (n, lead) => resample(cycloid(3, lead, 0.2), n, 1.0);

  // ---------------------------------------------------------------- question mark
  // curl = 1: a question mark. curl → 0: it straightens out (answer found).
  Sh.question = function (n, curl) {
    const wp = Q_FULL.map((p, i) => [p[0] * curl + Q_FLAT[i][0] * (1 - curl), p[1] * curl + Q_FLAT[i][1] * (1 - curl), 0]);
    return resample(spline(wp, 16), n, 0.9);
  };

  // ---------------------------------------------------------------- at sign, in one stroke
  Sh.at = (n) => resample(spline(AT, 16), n, 0.8);

  // ---------------------------------------------------------------- gauge
  // Unit box [0..1]². Arc from bottom-left, clockwise; fill = how much of the 270° is drawn.
  Sh.gauge = function (n, fill) {
    const pts = [], a0 = Math.PI * 1.25, sweep = Math.PI * 1.5 * Math.max(0.05, Math.min(1, fill));
    for (let k = 0; k < 240; k++) {
      const th = a0 - sweep * (k / 239);
      pts.push([0.5 + 0.5 * Math.cos(th), 0.5 + 0.5 * Math.sin(th), 0]);
    }
    const r = resample(pts, n, 0);
    r.cx = 0.5; r.cy = 0.5; r.w = 1; r.h = 1;
    return r;
  };
})();
