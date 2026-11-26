/* Rough Idea — the tape.
   A chain of springs (so it lags, whips and settles) plus a sampler that turns
   the chain into a twisting strip of geometry. Pure math; the renderer just draws it. */
(function () {
  'use strict';
  const RI = window.RI;
  const SUB = 3; // geometry samples per control segment
  const VW = 6;  // quads across the width

  function Ribbon(n) {
    this.n = n;
    this.p = new Float32Array(n * 3); // positions (world)
    this.v = new Float32Array(n * 3); // velocities
    this.q = new Float32Array(n * 3); // targets (world)
    this.f = new Float32Array(n * 3); // impulses
    this.ready = false;
    this.lively = true;               // false = reduced motion: quick, no overshoot

    this.M = (n - 1) * SUB + 1;
    this.VW = VW;
    this.V = this.M * (VW + 1);
    this.pos = new Float32Array(this.V * 3);
    this.nrm = new Float32Array(this.V * 3);
    this.tan = new Float32Array(this.V * 3);
    this.uv = new Float32Array(this.V * 2);
    for (let j = 0; j < this.M; j++) {
      for (let k = 0; k <= VW; k++) {
        const i = j * (VW + 1) + k;
        this.uv[i * 2] = j / (this.M - 1);
        this.uv[i * 2 + 1] = (k / VW) * 2 - 1;
      }
    }
    const idx = new Uint16Array((this.M - 1) * VW * 6);
    let o = 0;
    for (let j = 0; j < this.M - 1; j++) {
      for (let k = 0; k < VW; k++) {
        const a = j * (VW + 1) + k, b = a + 1, c = a + VW + 1, d = c + 1;
        idx[o++] = a; idx[o++] = c; idx[o++] = b;
        idx[o++] = b; idx[o++] = c; idx[o++] = d;
      }
    }
    this.idx = idx;
    this.S = new Float32Array(this.M * 3);
    this.T = new Float32Array(this.M * 3);
    this.U = new Float32Array(this.M * 3);
    this.N = new Float32Array(this.M * 3);
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
  }

  Ribbon.prototype.setTargets = function (q) { this.q.set(q); };
  Ribbon.prototype.snap = function () {
    this.p.set(this.q);
    this.v.fill(0);
    this.ready = true;
  };

  Ribbon.prototype.step = function (dt) {
    const n = this.n, p = this.p, v = this.v, q = this.q, f = this.f;
    const live = this.lively;
    const wH = live ? 15 : 30, wT = live ? 7.5 : 30, zeta = live ? 0.6 : 1.3;
    const steps = Math.max(1, Math.min(10, Math.round(dt * 240)));
    const h = dt / steps;
    // rest length → stretch limit (keeps the tape from tearing under pointer forces)
    let L = 0;
    for (let i = 1; i < n; i++) L += Math.hypot(q[i * 3] - q[i * 3 - 3], q[i * 3 + 1] - q[i * 3 - 2], q[i * 3 + 2] - q[i * 3 - 1]);
    const maxSeg = (L / (n - 1)) * 2.4 + 1e-4;
    const dd = [0, 0, 0];
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1), w = wH + (wT - wH) * u, k = w * w, c = 2 * zeta * w, i3 = i * 3;
        for (let a = 0; a < 3; a++) {
          v[i3 + a] += (k * (q[i3 + a] - p[i3 + a]) - c * v[i3 + a] + f[i3 + a]) * h;
          p[i3 + a] += v[i3 + a] * h;
        }
      }
      for (let i = 0; i < n - 1; i++) {
        const a = i * 3, b = a + 3;
        dd[0] = p[b] - p[a]; dd[1] = p[b + 1] - p[a + 1]; dd[2] = p[b + 2] - p[a + 2];
        const d = Math.sqrt(dd[0] * dd[0] + dd[1] * dd[1] + dd[2] * dd[2]);
        if (d > maxSeg) {
          const corr = ((d - maxSeg) / d) * 0.5;
          for (let c = 0; c < 3; c++) { p[a + c] += dd[c] * corr; p[b + c] -= dd[c] * corr; }
        }
      }
    }
    const dk = Math.exp(-dt * 5);
    for (let i = 0; i < f.length; i++) f[i] *= dk;
  };

  // A wave that travels down the tape (a "pluck").
  Ribbon.prototype.pluck = function (strength) {
    const n = this.n, f = this.f;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), e = Math.sin(Math.PI * u);
      f[i * 3 + 2] += strength * e;
      f[i * 3] += strength * 0.3 * e * Math.sin(u * 7.0);
      f[i * 3 + 1] += strength * 0.3 * e * Math.cos(u * 5.0);
    }
  };

  // o = { twist, face, width, reveal, eye, time, wobble }
  Ribbon.prototype.sample = function (o) {
    const n = this.n, M = this.M, p = this.p, S = this.S, T = this.T, U = this.U, N = this.N;
    const SUBc = SUB;

    // 1) control chain → smooth curve (centripetal Catmull-Rom, Barry–Goldman form)
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      const i0 = (i > 0 ? i - 1 : 0) * 3, i1 = i * 3, i2 = i1 + 3, i3 = (i + 2 < n ? i + 2 : n - 1) * 3;
      const t1 = Math.sqrt(Math.hypot(p[i0] - p[i1], p[i0 + 1] - p[i1 + 1], p[i0 + 2] - p[i1 + 2])) + 1e-4;
      const t2 = t1 + Math.sqrt(Math.hypot(p[i2] - p[i1], p[i2 + 1] - p[i1 + 1], p[i2 + 2] - p[i1 + 2])) + 1e-4;
      const t3 = t2 + Math.sqrt(Math.hypot(p[i3] - p[i2], p[i3 + 1] - p[i2 + 1], p[i3 + 2] - p[i2 + 2])) + 1e-4;
      for (let k = 0; k < SUBc; k++, j++) {
        const t = t1 + ((t2 - t1) * k) / SUBc;
        for (let c = 0; c < 3; c++) {
          const a1 = (p[i0 + c] * (t1 - t) + p[i1 + c] * t) / t1;
          const a2 = (p[i1 + c] * (t2 - t) + p[i2 + c] * (t - t1)) / (t2 - t1);
          const a3 = (p[i2 + c] * (t3 - t) + p[i3 + c] * (t - t2)) / (t3 - t2);
          const b1 = (a1 * (t2 - t) + a2 * t) / t2;
          const b2 = (a2 * (t3 - t) + a3 * (t - t1)) / (t3 - t1);
          S[j * 3 + c] = (b1 * (t2 - t) + b2 * (t - t1)) / (t2 - t1);
        }
      }
    }
    const l3 = (n - 1) * 3;
    S[j * 3] = p[l3]; S[j * 3 + 1] = p[l3 + 1]; S[j * 3 + 2] = p[l3 + 2];

    // 2) reveal: everything past the head collapses onto the head (the tape unrolls)
    const jr = Math.max(1, Math.min(M - 1, Math.round(o.reveal * (M - 1))));
    for (let jj = jr + 1; jj < M; jj++) {
      S[jj * 3] = S[jr * 3]; S[jj * 3 + 1] = S[jr * 3 + 1]; S[jj * 3 + 2] = S[jr * 3 + 2];
    }

    // 3) tangents
    for (let jj = 0; jj <= jr; jj++) {
      const a = Math.max(0, jj - 1) * 3, b = Math.min(jr, jj + 1) * 3, j3 = jj * 3;
      const tx = S[b] - S[a], ty = S[b + 1] - S[a + 1], tz = S[b + 2] - S[a + 2];
      const l = Math.hypot(tx, ty, tz) || 1;
      T[j3] = tx / l; T[j3 + 1] = ty / l; T[j3 + 2] = tz / l;
    }
    for (let jj = jr + 1; jj < M; jj++) {
      T[jj * 3] = T[jr * 3]; T[jj * 3 + 1] = T[jr * 3 + 1]; T[jj * 3 + 2] = T[jr * 3 + 2];
    }

    // 4) frames: parallel transport, leaned toward the camera by `face`, then twisted
    const ex = o.eye[0], ey = o.eye[1], ez = o.eye[2], face = o.face, twist = o.twist, wob = o.wobble;
    let ux = 0, uy = 1, uz = 0;
    for (let jj = 0; jj <= jr; jj++) {
      const j3 = jj * 3, s = jj / (M - 1);
      const tx = T[j3], ty = T[j3 + 1], tz = T[j3 + 2];
      let vx = ex - S[j3], vy = ey - S[j3 + 1], vz = ez - S[j3 + 2];
      const vl = Math.hypot(vx, vy, vz) || 1;
      vx /= vl; vy /= vl; vz /= vl;
      // camera-facing width direction: T × V
      const fx = ty * vz - tz * vy, fy = tz * vx - tx * vz, fz = tx * vy - ty * vx;
      const fl = Math.hypot(fx, fy, fz);
      if (jj === 0) {
        if (fl > 0.05) { ux = fx / fl; uy = fy / fl; uz = fz / fl; }
        else { ux = -ty; uy = tx; uz = 0; const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l; }
      } else {
        let d = ux * tx + uy * ty + uz * tz;
        ux -= d * tx; uy -= d * ty; uz -= d * tz;
        let ul = Math.hypot(ux, uy, uz);
        if (ul < 1e-4) {
          if (fl > 1e-4) { ux = fx / fl; uy = fy / fl; uz = fz / fl; }
          else { ux = -ty; uy = tx; uz = 0; ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul; }
        } else { ux /= ul; uy /= ul; uz /= ul; }
        if (face > 0 && fl > 0.05) {
          const m = 1 - face;
          ux = ux * m + (fx / fl) * face; uy = uy * m + (fy / fl) * face; uz = uz * m + (fz / fl) * face;
          d = ux * tx + uy * ty + uz * tz;
          ux -= d * tx; uy -= d * ty; uz -= d * tz;
          const l2 = Math.hypot(ux, uy, uz) || 1;
          ux /= l2; uy /= l2; uz /= l2;
        }
      }
      const th = twist * s + (wob ? wob * Math.sin(s * 9.4 + o.time * 1.1) * (0.25 + 0.75 * s) : 0);
      const c = Math.cos(th), sn = Math.sin(th);
      const cx = ty * uz - tz * uy, cy = tz * ux - tx * uz, cz = tx * uy - ty * ux;
      const nx = ux * c + cx * sn, ny = uy * c + cy * sn, nz = uz * c + cz * sn;
      U[j3] = nx; U[j3 + 1] = ny; U[j3 + 2] = nz;
      N[j3] = ty * nz - tz * ny; N[j3 + 1] = tz * nx - tx * nz; N[j3 + 2] = tx * ny - ty * nx;
    }
    for (let jj = jr + 1; jj < M; jj++) {
      U[jj * 3] = U[jr * 3]; U[jj * 3 + 1] = U[jr * 3 + 1]; U[jj * 3 + 2] = U[jr * 3 + 2];
      N[jj * 3] = N[jr * 3]; N[jj * 3 + 1] = N[jr * 3 + 1]; N[jj * 3 + 2] = N[jr * 3 + 2];
    }

    // 5) strip geometry
    const halfW = o.width * 0.5, bow = 0.16, pos = this.pos, nrm = this.nrm, tan = this.tan;
    const jr3 = jr * 3;
    for (let jj = 0; jj < M; jj++) {
      const j3 = jj <= jr ? jj * 3 : jr3;
      const sx = S[j3], sy = S[j3 + 1], sz = S[j3 + 2];
      const tx = T[j3], ty = T[j3 + 1], tz = T[j3 + 2];
      const ux = U[j3], uy = U[j3 + 1], uz = U[j3 + 2];
      const nx = N[j3], ny = N[j3 + 1], nz = N[j3 + 2];
      const cut = (j3 === 0 || j3 === jr3) ? halfW * 0.95 : 0; // diagonal scissor cut at both ends
      for (let k = 0; k <= VW; k++) {
        const v = (k / VW) * 2 - 1, off = v * halfW, b = bow * halfW * (1 - v * v);
        const i = (jj * (VW + 1) + k) * 3;
        pos[i] = sx + ux * off + nx * b + tx * v * cut;
        pos[i + 1] = sy + uy * off + ny * b + ty * v * cut;
        pos[i + 2] = sz + uz * off + nz * b + tz * v * cut;
        const ax = nx + ux * v * 2 * bow, ay = ny + uy * v * 2 * bow, az = nz + uz * v * 2 * bow;
        const al = Math.hypot(ax, ay, az) || 1;
        nrm[i] = ax / al; nrm[i + 1] = ay / al; nrm[i + 2] = az / al;
        tan[i] = ux; tan[i + 1] = uy; tan[i + 2] = uz;
      }
    }
    this.jr = jr;
  };

  // screen-space positions of the control points (for hit-testing)
  Ribbon.prototype.project = function (m, vw, vh) {
    const p = this.p, sx = this.sx, sy = this.sy;
    for (let i = 0; i < this.n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      sx[i] = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * 0.5 * vw;
      sy[i] = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5 * vh;
    }
  };

  RI.Ribbon = Ribbon;
})();
