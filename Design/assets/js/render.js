/* Rough Idea — renderer. WebGL when available; a 2D canvas fallback drawn from the
   very same geometry otherwise; null if neither works (the page then runs without the tape). */
(function () {
  'use strict';
  const RI = window.RI;

  const VS = [
    'attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aTan; attribute vec2 aUV;',
    'uniform mat4 uVP; uniform vec3 uCam;',
    'varying vec3 vN; varying vec3 vV; varying vec2 vUV;',
    'void main() {',
    '  gl_Position = uVP * vec4(aPos, 1.0);',
    '  vN = aNrm; vV = uCam - aPos; vUV = aUV;',
    '}',
  ].join('\n');

  // Satin tape: soft two-tone shading, a broad highlight, a warm rim, fine crepe ribs, darker edges.
  const FS = [
    'precision mediump float;',
    'varying vec3 vN; varying vec3 vV; varying vec2 vUV;',
    'uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uLight; uniform vec3 uSpec; uniform float uRib;',
    'void main() {',
    '  vec3 N = normalize(vN);',
    '  if (!gl_FrontFacing) N = -N;',
    '  vec3 V = normalize(vV);',
    '  vec3 base = gl_FrontFacing ? uColA : uColB;',
    '  float rib = sin(vUV.x * uRib + vUV.y * 2.0);',
    '  float rib2 = sin(vUV.x * uRib * 0.41 + 1.7 + vUV.y * 7.0);',
    '  base *= 1.0 + 0.028 * rib + 0.018 * rib2;',
    '  vec3 baseL = base * base;',
    '  float d = dot(N, uLight);',
    '  float shade = 0.6 + 0.4 * smoothstep(-0.3, 0.75, d);',
    '  float fill = max(dot(N, normalize(vec3(0.7, -0.5, 0.3))), 0.0) * 0.14;',
    '  vec3 H = normalize(uLight + V);',
    '  float spec = pow(max(dot(N, H), 0.0), 20.0) * 0.38;',
    '  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.2;',
    '  float edge = smoothstep(0.82, 1.0, abs(vUV.y));',
    '  vec3 c = baseL * (shade + fill) + uSpec * spec + baseL * fres;',
    '  c = mix(c, c * 0.74, edge * 0.5);',
    '  gl_FragColor = vec4(sqrt(max(c, 0.0)), 1.0);',
    '}',
  ].join('\n');

  // Soft drop shadow: the strip squashed onto a back plane along the light direction.
  const VS_SH = [
    'attribute vec3 aPos; attribute vec3 aTan; attribute vec2 aUV;',
    'uniform mat4 uVP; uniform vec3 uLight; uniform float uPlane; uniform float uWiden; uniform vec2 uOff;',
    'void main() {',
    '  vec3 p = aPos + aTan * (aUV.y * uWiden);',
    '  float t = max((p.z - uPlane) / uLight.z, 0.0);',
    '  p = p - uLight * t;',
    '  p.xy += uOff;',
    '  gl_Position = uVP * vec4(p, 1.0);',
    '}',
  ].join('\n');
  const FS_SH = 'precision mediump float; uniform vec3 uColor; uniform float uAlpha;\nvoid main() { gl_FragColor = vec4(uColor * uAlpha, uAlpha); }';

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aNrm');
    gl.bindAttribLocation(p, 2, 'aTan');
    gl.bindAttribLocation(p, 3, 'aUV');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    return p;
  }

  // ------------------------------------------------------------------ WebGL
  function GLR(canvas, gl) {
    this.kind = 'gl';
    this.canvas = canvas;
    this.gl = gl;
    this.pRib = program(gl, VS, FS);
    this.pSh = program(gl, VS_SH, FS_SH);
    this.bPos = gl.createBuffer(); this.bNrm = gl.createBuffer(); this.bTan = gl.createBuffer();
    this.bUV = gl.createBuffer(); this.bIdx = gl.createBuffer();
    this.cap = 0;
    this.uRib = uniforms(gl, this.pRib);
    this.uSh = uniforms(gl, this.pSh);
  }
  function uniforms(gl, p) {
    const map = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      map[info.name] = gl.getUniformLocation(p, info.name);
    }
    return map;
  }
  GLR.prototype.ensure = function (rib) {
    if (this.cap === rib.V) return;
    this.cap = rib.V;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bPos); gl.bufferData(gl.ARRAY_BUFFER, rib.pos.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bNrm); gl.bufferData(gl.ARRAY_BUFFER, rib.nrm.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bTan); gl.bufferData(gl.ARRAY_BUFFER, rib.tan.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bUV); gl.bufferData(gl.ARRAY_BUFFER, rib.uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, rib.idx, gl.STATIC_DRAW);
  };
  GLR.prototype.resize = function (w, h, dpr) {
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
  };
  GLR.prototype.draw = function (rib, view) {
    const gl = this.gl;
    this.ensure(rib);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bPos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, rib.pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bNrm); gl.bufferSubData(gl.ARRAY_BUFFER, 0, rib.nrm);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bTan); gl.bufferSubData(gl.ARRAY_BUFFER, 0, rib.tan);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bPos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bNrm); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bTan); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bUV); gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bIdx);
    const count = rib.idx.length;

    // shadow (premultiplied, no depth)
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.pSh);
    const u = this.uSh;
    gl.uniformMatrix4fv(u.uVP, false, view.vp);
    gl.uniform3fv(u.uLight, view.shadowLight || view.light);
    gl.uniform1f(u.uPlane, view.plane);
    gl.uniform3fv(u.uColor, view.shadow);
    // each pass: [offsetX, offsetY, extra width (world units), alpha] — stacked for a soft penumbra
    const passes = [[0, 0, 0, 0.09], [0.006, -0.005, 0.012, 0.05], [-0.007, -0.012, 0.026, 0.04], [0, -0.022, 0.042, 0.03]];
    for (let i = 0; i < passes.length; i++) {
      gl.uniform1f(u.uWiden, passes[i][2]);
      gl.uniform2f(u.uOff, passes[i][0], passes[i][1]);
      gl.uniform1f(u.uAlpha, passes[i][3]);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    }

    // tape
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.useProgram(this.pRib);
    const r = this.uRib;
    gl.uniformMatrix4fv(r.uVP, false, view.vp);
    gl.uniform3fv(r.uCam, view.cam);
    gl.uniform3fv(r.uColA, view.colA);
    gl.uniform3fv(r.uColB, view.colB);
    gl.uniform3fv(r.uLight, view.light);
    gl.uniform3fv(r.uSpec, view.spec);
    gl.uniform1f(r.uRib, view.rib);
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
  };
  GLR.prototype.dispose = function () {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  };

  // ------------------------------------------------------------------ 2D fallback
  function C2D(canvas, ctx) {
    this.kind = '2d';
    this.canvas = canvas;
    this.ctx = ctx;
    this.M = 0;
  }
  C2D.prototype.ensure = function (rib) {
    if (this.M === rib.M) return;
    this.M = rib.M;
    this.P = new Float32Array(rib.M * 9);
    this.F = new Float32Array(rib.M);
    const segs = (rib.M - 1) * 2;
    this.order = new Uint16Array(segs);
    this.depth = new Float32Array(segs);
    for (let i = 0; i < segs; i++) this.order[i] = i;
  };
  C2D.prototype.resize = function (w, h, dpr) {
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
  };
  C2D.prototype.draw = function (rib, view) {
    this.ensure(rib);
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, m = view.vp;
    ctx.clearRect(0, 0, W, H);
    const M = rib.M, VW = rib.VW, pos = rib.pos, nrm = rib.nrm, P = this.P, F = this.F, cam = view.cam, hw = VW / 2;
    for (let j = 0; j < M; j++) {
      for (let c = 0; c < 3; c++) {
        const i = (j * (VW + 1) + c * hw) * 3;
        const w = m[3] * pos[i] + m[7] * pos[i + 1] + m[11] * pos[i + 2] + m[15];
        const o = (j * 3 + c) * 3;
        P[o] = ((m[0] * pos[i] + m[4] * pos[i + 1] + m[8] * pos[i + 2] + m[12]) / w + 1) * 0.5 * W;
        P[o + 1] = (1 - (m[1] * pos[i] + m[5] * pos[i + 1] + m[9] * pos[i + 2] + m[13]) / w) * 0.5 * H;
        P[o + 2] = w;
      }
      const i = (j * (VW + 1) + hw) * 3;
      const vx = cam[0] - pos[i], vy = cam[1] - pos[i + 1], vz = cam[2] - pos[i + 2];
      const nl = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      F[j] = (nrm[i] * vx + nrm[i + 1] * vy + nrm[i + 2] * vz) / ((Math.hypot(vx, vy, vz) || 1) * nl);
    }
    const depth = this.depth, order = this.order;
    for (let j = 0; j < M - 1; j++) {
      const z = P[(j * 3 + 1) * 3 + 2] + P[(j * 3 + 4) * 3 + 2];
      depth[j * 2] = z; depth[j * 2 + 1] = z;
    }
    order.sort((a, b) => depth[b] - depth[a]);
    const quad = (j, half, ox, oy) => {
      const c0 = half === 0 ? 0 : 1, c1 = half === 0 ? 1 : 2;
      const a = (j * 3 + c0) * 3, b = (j * 3 + c1) * 3, c = ((j + 1) * 3 + c1) * 3, d = ((j + 1) * 3 + c0) * 3;
      ctx.beginPath();
      ctx.moveTo(P[a] + ox, P[a + 1] + oy); ctx.lineTo(P[d] + ox, P[d + 1] + oy);
      ctx.lineTo(P[c] + ox, P[c + 1] + oy); ctx.lineTo(P[b] + ox, P[b + 1] + oy);
      ctx.closePath();
    };
    const A = view.colA, B = view.colB;
    ctx.fillStyle = view.shadowCss;
    for (let k = 0; k < order.length; k++) { quad(order[k] >> 1, order[k] & 1, 10, 18); ctx.fill(); }
    for (let k = 0; k < order.length; k++) {
      const j = order[k] >> 1, f = F[j], shade = 0.72 + 0.28 * Math.abs(f), c = f >= 0 ? A : B;
      ctx.fillStyle = 'rgb(' + ((c[0] * 255 * shade) | 0) + ',' + ((c[1] * 255 * shade) | 0) + ',' + ((c[2] * 255 * shade) | 0) + ')';
      quad(j, order[k] & 1, 0, 0);
      ctx.fill();
    }
  };

  RI.Renderer2D = C2D;
  RI.createRenderer = function (canvas) {
    try {
      const opts = { antialias: true, alpha: true, premultipliedAlpha: true, depth: true, stencil: false, powerPreference: 'high-performance' };
      const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (gl) {
        const r = new GLR(canvas, gl);
        // make sure the context actually works before trusting it
        gl.clear(gl.COLOR_BUFFER_BIT);
        return r;
      }
    } catch (e) { /* fall through to 2D */ }
    try {
      const ctx = canvas.getContext('2d');
      if (ctx) return new C2D(canvas, ctx);
    } catch (e) { /* nothing */ }
    return null;
  };
})();
