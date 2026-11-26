// Stages 7–10 — four fish. Fish local frame: +X forward (nose), +Y up, +Z right side.
//
// Every fish is two merged meshes: an opaque body and a translucent fin sheet. Vertices carry
// aFlow = (s: distance along the body 0 nose → 1 peduncle, u: distance along a fin ray from its
// base, mode: 0 body / 1.x fin kinds / 2 pectoral / 3 filament, phase) plus aDir (flutter
// direction) and aBase (attachment point). The vertex shader runs a travelling wave from head to
// tail and lets fins flutter with a phase delay that grows toward their free edges.

const FISH_DEFORM_HEAD = /* glsl */`
attribute vec4 aFlow;
attribute vec3 aDir;
attribute vec3 aBase;
uniform float uTime;
uniform float uBeat;
uniform float uAmp;
uniform float uTurn;
uniform float uLen;
uniform float uFinAmp;
uniform float uPectFreq;
varying vec2 vAUv;
varying vec3 vAPos;
varying vec4 vAFlow;`;

const FISH_DEFORM_NORMAL = /* glsl */`
{
  float s = aFlow.x;
  float ph = uBeat - s * 4.5;
  float bodyA = uAmp * ( 0.03 + s * s );
  float dbend = bodyA * 4.5 * cos( ph ) + uTurn * 0.7 * s;
  float yaw = atan( dbend / max( uLen, 0.1 ) );
  float cy = cos( yaw ), sy = sin( yaw );
  objectNormal = vec3( cy * objectNormal.x + sy * objectNormal.z, objectNormal.y, -sy * objectNormal.x + cy * objectNormal.z );
}`;

const FISH_DEFORM_BODY = /* glsl */`
{
  vAUv = uv;
  vAPos = position;
  vAFlow = aFlow;
  float s = aFlow.x, fu = aFlow.y, mode = aFlow.z, ph2 = aFlow.w;
  vec3 p = position;
  float bodyA = uAmp * ( 0.03 + s * s );
  float ph = uBeat - s * 4.5;
  p.z += bodyA * sin( ph ) + uTurn * 0.35 * s * s;
  if ( mode > 0.5 ) {
    if ( mode < 1.5 ) {
      // fin: the wave enters at the attachment and grows toward the free edge
      p += aDir * ( uFinAmp * fu * fu * sin( uBeat - fu * 3.0 + ph2 * 6.2832 + s * 4.5 ) * ( 0.25 + 0.75 * uAmp ) );
    } else if ( mode < 2.5 ) {
      // pectoral: sculls around a vertical hinge through its base
      float a = ( 0.25 + 0.5 * uAmp ) * sin( uTime * uPectFreq + ph2 * 6.2832 );
      float c = cos( a ), sn = sin( a );
      vec3 q = p - aBase;
      q = vec3( c * q.x + sn * q.z, q.y, -sn * q.x + c * q.z );
      q += aDir * ( 0.03 * fu * sin( uTime * uPectFreq + ph2 * 6.2832 + 1.2 ) );
      p = aBase + q;
    } else {
      // filament: flowing curve, attached at its base
      p += aDir * ( 0.10 * fu * fu * sin( uTime * 1.6 - fu * 4.0 + ph2 * 6.2832 ) );
    }
  }
  transformed = p;
}`;

const FISH_FRAG_COMMON = /* glsl */`
varying vec2 vAUv;
varying vec3 vAPos;
varying vec4 vAFlow;
float hash21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash21( i ), hash21( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash21( i + vec2( 0.0, 1.0 ) ), hash21( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`;

// ---------------------------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------------------------
function profileFn(table, scale = 1) {
  return (t) => scale * sampleProfile(table, t);
}

function buildBodyGeometry(prof) {
  const { x0, x1, segs = 64, radial = 32 } = prof;
  const pos = [], uv = [], flow = [], dir = [], base = [], idx = [];
  const push = (x, y, z, t, v) => { pos.push(x, y, z); uv.push(t, v); flow.push(t, 0, 0, 0); dir.push(0, 0, 1); base.push(0, 0, 0); };
  push(x0, prof.yc(0), 0, 0, 0.5);
  for (let i = 1; i <= segs; i++) {
    const t = i / segs, x = lerp(x0, x1, t);
    const ry = prof.ry(t), rz = prof.rz(t), yc = prof.yc(t), asym = prof.asym ? prof.asym(t) : 0;
    for (let j = 0; j <= radial; j++) {
      const v = j / radial, th = v * TWO_PI;
      const sy = Math.sin(th);
      push(x, yc + ry * sy * (1 + asym * sy), rz * Math.cos(th), t, v);
    }
  }
  for (let j = 0; j < radial; j++) idx.push(0, 1 + j + 1, 1 + j);
  for (let i = 1; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = 1 + (i - 1) * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const capC = pos.length / 3;
  push(x1, prof.yc(1), 0, 1, 0.5);
  const lastRing = 1 + (segs - 1) * (radial + 1);
  for (let j = 0; j < radial; j++) idx.push(capC, lastRing + j, lastRing + j + 1);

  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 4));
  g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  g.setAttribute('aBase', new THREE.Float32BufferAttribute(base, 3));
  g.computeVertexNormals();
  // average the normals of the duplicated seam vertices so no seam line shows
  const nrm = g.attributes.normal;
  for (let i = 1; i <= segs; i++) {
    const a = 1 + (i - 1) * (radial + 1), b = a + radial;
    const nx = (nrm.getX(a) + nrm.getX(b)) * 0.5, ny = (nrm.getY(a) + nrm.getY(b)) * 0.5, nz = (nrm.getZ(a) + nrm.getZ(b)) * 0.5;
    nrm.setXYZ(a, nx, ny, nz); nrm.setXYZ(b, nx, ny, nz);
  }
  nrm.needsUpdate = true;
  return g;
}

// rays: [{ base, tip, s, normal, phase }]
function buildFinGeometry(rays, segs, opts = {}) {
  const n = rays.length;
  const pos = [], uv = [], flow = [], dir = [], base = [], idx = [];
  const P = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const r = rays[i];
    const vf = i / (n - 1);
    const ruffle = opts.ruffle ? opts.ruffle * Math.sin(i * 2.1 + 0.5) : 0;
    for (let k = 0; k <= segs; k++) {
      const u = k / segs;
      const bulge = Math.sin(u * Math.PI) * ((opts.bulge || 0) * (0.3 + 0.7 * Math.sin(vf * Math.PI)) + ruffle * u);
      P.lerpVectors(r.base, r.tip, u).addScaledVector(r.normal, bulge);
      pos.push(P.x, P.y, P.z); uv.push(u, vf);
      flow.push(r.s, u, opts.mode ?? 1, r.phase ?? vf);
      dir.push(r.normal.x, r.normal.y, r.normal.z);
      base.push(r.base.x, r.base.y, r.base.z);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < segs; k++) {
    const a = i * (segs + 1) + k, b = a + segs + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 4));
  g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  g.setAttribute('aBase', new THREE.Float32BufferAttribute(base, 3));
  g.computeVertexNormals();
  return g;
}

function finRays(baseFn, tipFn, n, normal, sFn, phaseOffset = 0) {
  const rays = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    rays.push({ base: baseFn(t), tip: tipFn(t), s: sFn(t), normal: normal.clone(), phase: t + phaseOffset });
  }
  return rays;
}

// A long thin tapered tube (pelvic filaments), divided so it can bend along its length.
function buildFilamentGeometry(points, radius, s, mode, dir, phase, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(points);
  const segs = 18;
  const g = new THREE.TubeGeometry(curve, segs, radius, radial, false);
  const count = g.attributes.position.count;
  const flow = new Float32Array(count * 4), dirs = new Float32Array(count * 3), base = new Float32Array(count * 3), uv = g.attributes.uv;
  for (let i = 0; i < count; i++) {
    const u = uv.getX(i);
    flow[i * 4] = s; flow[i * 4 + 1] = u; flow[i * 4 + 2] = mode; flow[i * 4 + 3] = phase;
    dirs[i * 3] = dir.x; dirs[i * 3 + 1] = dir.y; dirs[i * 3 + 2] = dir.z;
    base[i * 3] = points[0].x; base[i * 3 + 1] = points[0].y; base[i * 3 + 2] = points[0].z;
    // taper
    const k = 1 - 0.75 * u;
    const c = curve.getPointAt(Math.min(1, u));
    const px = g.attributes.position.getX(i), py = g.attributes.position.getY(i), pz = g.attributes.position.getZ(i);
    g.attributes.position.setXYZ(i, c.x + (px - c.x) * k, c.y + (py - c.y) * k, c.z + (pz - c.z) * k);
  }
  g.setAttribute('aFlow', new THREE.BufferAttribute(flow, 4));
  g.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
  g.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------
function fishBodyMaterial(spec, uniforms) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: spec.roughness ?? 0.35, metalness: spec.metalness ?? 0.15,
    clearcoat: spec.clearcoat ?? 0.8, clearcoatRoughness: 0.12,
    iridescence: spec.iridescence ?? 0, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 400],
    envMapIntensity: 0.9,
  });
  return enhanceMaterial(m, {
    id: 'fish-' + spec.id + '-body', uniforms, caustics: 0.35,
    vertexHead: FISH_DEFORM_HEAD, vertexNormal: FISH_DEFORM_NORMAL, vertexBody: FISH_DEFORM_BODY,
    fragmentHead: FISH_FRAG_COMMON + GILL_GLSL + spec.bodyGLSL,
    fragmentColor: 'diffuseColor.rgb = fishBodyColor();',
  });
}
function fishFinMaterial(spec, uniforms) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.4, metalness: 0.05, clearcoat: 0.35, clearcoatRoughness: 0.3,
    side: THREE.DoubleSide, transparent: true, depthWrite: false, envMapIntensity: 0.6,
  });
  return enhanceMaterial(m, {
    id: 'fish-' + spec.id + '-fins', uniforms, caustics: 0.25,
    vertexHead: FISH_DEFORM_HEAD, vertexNormal: FISH_DEFORM_NORMAL, vertexBody: FISH_DEFORM_BODY,
    fragmentHead: FISH_FRAG_COMMON + spec.finGLSL,
    fragmentColor: 'vec4 fc = fishFinColor(); diffuseColor.rgb = fc.rgb; diffuseColor.a = fc.a;',
    // thin sheets scatter light: a soft self-lit term, strongest where the sheet is edge-on
    fragmentEmissive: 'totalEmissiveRadiance += diffuseColor.rgb * ( 0.16 + 0.22 * pow( 1.0 - abs( dot( normal, normalize( vViewPosition ) ) ), 1.5 ) );',
  });
}
function fishDepthMaterial(spec, uniforms) {
  return deformedDepthMaterial({ id: 'fish-' + spec.id, uniforms, vertexHead: FISH_DEFORM_HEAD, vertexBody: FISH_DEFORM_BODY });
}

// ---------------------------------------------------------------------------------------------
// Species GLSL: body colour, fin colour
// ---------------------------------------------------------------------------------------------
const GILL_GLSL = /* glsl */`
vec3 applyGill( vec3 c, float s, float ang, float at, float strength ) {
  float up = sin( ang ), side = cos( ang );
  float g = exp( -pow( ( s - at - 0.02 * up ) / 0.008, 2.0 ) ) * smoothstep( 0.15, 0.6, abs( side ) );
  c *= 1.0 - 0.35 * strength * g;
  c += vec3( 0.10 ) * strength * exp( -pow( ( s - at - 0.018 - 0.02 * up ) / 0.006, 2.0 ) ) * smoothstep( 0.15, 0.6, abs( side ) );
  c *= 1.0 - 0.5 * exp( -pow( s / 0.012, 2.0 ) ) * smoothstep( 0.1, 0.7, -up );   // mouth crease
  return c;
}`;

const GUPPY_BODY_GLSL = /* glsl */`
vec3 fishBodyColor() {
  float s = vAUv.x; float ang = vAUv.y * 6.2831853; float up = sin( ang );
  vec3 c = vec3( 0.58, 0.70, 0.82 );
  c = mix( c, vec3( 0.88, 0.93, 0.97 ), smoothstep( -0.1, -0.8, up ) );
  c = mix( c, vec3( 0.22, 0.33, 0.48 ), smoothstep( 0.35, 0.9, up ) );
  float n = vnoise( vec2( s * 7.0, ang * 1.6 ) ) * 0.6 + vnoise( vec2( s * 15.0 + 3.0, ang * 3.0 ) ) * 0.4;
  float pt = smoothstep( 0.56, 0.74, n ) * smoothstep( 0.36, 0.55, s );
  vec3 iri = mix( vec3( 0.05, 0.75, 0.65 ), vec3( 0.25, 0.9, 0.45 ), vnoise( vec2( s * 4.0, ang ) ) );
  c = mix( c, iri, pt * 0.8 );
  return applyGill( c, s, ang, 0.23, 1.0 );
}`;
const GUPPY_FIN_GLSL = /* glsl */`
vec4 fishFinColor() {
  float u = vAUv.x, v = vAUv.y; float mode = vAFlow.z;
  if ( mode > 1.5 && mode < 2.5 ) return vec4( 0.80, 0.88, 0.92, 0.55 - 0.35 * u );
  if ( mode < 0.9 ) {
    vec3 c = mix( vec3( 1.0, 0.28, 0.04 ), vec3( 1.0, 0.52, 0.1 ), u );
    float ray = smoothstep( 0.75, 1.0, abs( sin( v * 16.0 * 3.14159 ) ) );
    c *= 1.0 - 0.14 * ray;
    float sp = step( 0.82, hash21( floor( vec2( u, v ) * vec2( 24.0, 44.0 ) ) ) );
    c = mix( c, vec3( 0.3, 0.05, 0.03 ), sp * 0.7 * smoothstep( 0.1, 0.4, u ) );
    return vec4( c, 0.96 - 0.4 * smoothstep( 0.88, 1.0, u ) );
  }
  return vec4( mix( vec3( 0.9, 0.5, 0.22 ), vec3( 0.95, 0.68, 0.4 ), u ), 0.6 - 0.35 * u );
}`;

const CLOWN_BODY_GLSL = /* glsl */`
vec3 fishBodyColor() {
  float s = vAUv.x; float ang = vAUv.y * 6.2831853; float up = sin( ang );
  vec3 c = mix( vec3( 1.0, 0.36, 0.05 ), vec3( 1.0, 0.52, 0.14 ), smoothstep( -0.2, -0.9, up ) );
  c *= 1.0 - 0.12 * smoothstep( 0.5, 1.0, up );
  float wob = 0.022 * sin( ang * 3.0 + 1.0 ) + 0.012 * sin( ang * 7.0 + 2.0 );
  float d1 = abs( s - 0.19 - wob ), d2 = abs( s - 0.52 - wob - 0.03 * max( up, 0.0 ) ), d3 = abs( s - 0.88 - wob * 0.5 );
  float white = clamp( step( d1, 0.065 ) + step( d2, 0.075 ) + step( d3, 0.05 ), 0.0, 1.0 );
  float black = clamp( step( d1, 0.085 ) + step( d2, 0.095 ) + step( d3, 0.07 ), 0.0, 1.0 );
  c = mix( c, vec3( 0.02, 0.02, 0.02 ), black );
  c = mix( c, vec3( 0.98, 0.97, 0.95 ), white );
  return applyGill( c, s, ang, 0.3, 0.5 );
}`;
const CLOWN_FIN_GLSL = /* glsl */`
vec4 fishFinColor() {
  float u = vAUv.x, v = vAUv.y; float mode = vAFlow.z;
  if ( mode > 1.5 && mode < 2.5 ) { vec3 c = mix( vec3( 1.0, 0.45, 0.08 ), vec3( 1.0, 0.6, 0.2 ), u ); return vec4( c, 0.78 - 0.2 * u - 0.35 * smoothstep( 0.9, 1.0, u ) * 0.6 ); }
  vec3 c = mix( vec3( 1.0, 0.38, 0.06 ), vec3( 1.0, 0.5, 0.12 ), u );
  // dark edging
  float edge = smoothstep( 0.86, 0.96, u );
  c = mix( c, vec3( 0.03, 0.03, 0.03 ), edge * 0.9 );
  if ( mode < 0.9 ) {            // caudal: peduncle band continues onto the fin base
    float b = smoothstep( 0.0, 0.03, 0.3 - u );
    float k = smoothstep( 0.0, 0.03, 0.36 - u );
    c = mix( c, vec3( 0.02 ), k ); c = mix( c, vec3( 0.98, 0.97, 0.95 ), b );
  } else if ( mode > 1.0 && mode < 1.15 ) {   // dorsal: head band reaches its front base
    float b = smoothstep( 0.1, 0.06, v ) * ( 1.0 - smoothstep( 0.35, 0.5, u ) );
    c = mix( c, vec3( 0.98, 0.97, 0.95 ), b );
    c = mix( c, vec3( 0.02 ), smoothstep( 0.16, 0.12, v ) * ( 1.0 - smoothstep( 0.35, 0.5, u ) ) * ( 1.0 - b ) );
  }
  return vec4( c, 0.85 - 0.35 * smoothstep( 0.8, 1.0, u ) );
}`;

const ANGEL_BODY_GLSL = /* glsl */`
vec3 fishBodyColor() {
  float s = vAUv.x; float ang = vAUv.y * 6.2831853; float up = sin( ang );
  vec3 c = mix( vec3( 0.80, 0.82, 0.84 ), vec3( 0.95, 0.95, 0.93 ), smoothstep( 0.2, -0.6, up ) );
  c = mix( c, vec3( 0.42, 0.45, 0.5 ), smoothstep( 0.4, 1.0, up ) );
  float b = smoothstep( 0.035, 0.025, abs( s - 0.1 ) ) + smoothstep( 0.075, 0.06, abs( s - 0.45 - 0.02 * up ) ) + smoothstep( 0.05, 0.04, abs( s - 0.9 ) );
  c = mix( c, vec3( 0.06, 0.07, 0.08 ), clamp( b, 0.0, 1.0 ) * 0.92 );
  c += 0.05 * vnoise( vec2( s * 60.0, ang * 8.0 ) );
  return applyGill( c, s, ang, 0.22, 0.5 );
}`;
const ANGEL_FIN_GLSL = /* glsl */`
vec4 fishFinColor() {
  float u = vAUv.x, v = vAUv.y; float mode = vAFlow.z; float s = vAFlow.x;
  if ( mode > 2.5 ) return vec4( vec3( 0.32, 0.34, 0.38 ), 0.95 );
  if ( mode > 1.5 && mode < 2.5 ) return vec4( 0.8, 0.82, 0.84, 0.55 - 0.3 * u );
  vec3 c = vec3( 0.78, 0.80, 0.82 );
  float ray = smoothstep( 0.7, 1.0, sin( v * 11.0 * 3.14159 ) );
  c *= 1.0 - 0.22 * ray;
  float band = smoothstep( 0.075, 0.055, abs( s - 0.45 ) ) * ( 1.0 - smoothstep( 0.6, 1.0, u ) );
  c = mix( c, vec3( 0.07, 0.08, 0.09 ), band * 0.85 );
  c *= 1.0 - 0.25 * smoothstep( 0.85, 1.0, u );
  return vec4( c, 0.78 - 0.3 * smoothstep( 0.7, 1.0, u ) );
}`;

const BETTA_BODY_GLSL = /* glsl */`
vec3 fishBodyColor() {
  float s = vAUv.x; float ang = vAUv.y * 6.2831853; float up = sin( ang );
  vec3 body = mix( vec3( 0.10, 0.12, 0.55 ), vec3( 0.35, 0.08, 0.5 ), vnoise( vec2( s * 5.0, ang * 2.0 ) ) * 0.8 + 0.1 );
  body = mix( body, vec3( 0.05, 0.06, 0.3 ), smoothstep( 0.5, 1.0, up ) );
  vec3 head = vec3( 0.08, 0.72, 0.78 );
  vec3 c = mix( body, head, smoothstep( 0.38, 0.12, s ) );
  float sc = sin( ang * 20.0 + s * 50.0 ) * sin( ang * 20.0 - s * 50.0 + 1.3 );
  c *= 0.92 + 0.16 * smoothstep( -0.2, 0.6, sc );
  c *= 1.0 - 0.12 * smoothstep( 0.0, -0.3, sc );
  return applyGill( c, s, ang, 0.26, 0.7 );
}`;
const BETTA_FIN_GLSL = /* glsl */`
vec4 fishFinColor() {
  float u = vAUv.x, v = vAUv.y; float mode = vAFlow.z;
  if ( mode > 2.5 ) return vec4( vec3( 0.12, 0.18, 0.55 ), 0.95 );
  if ( mode > 1.5 && mode < 2.5 ) return vec4( mix( vec3( 0.15, 0.6, 0.7 ), vec3( 0.4, 0.3, 0.75 ), u ), 0.6 - 0.25 * u );
  vec3 c = mix( vec3( 0.12, 0.22, 0.75 ), vec3( 0.70, 0.08, 0.42 ), smoothstep( 0.1, 1.0, u ) );
  c = mix( c, vec3( 0.9, 0.3, 0.55 ), smoothstep( 0.85, 1.0, u ) * 0.5 );
  float ray = smoothstep( 0.75, 1.0, sin( v * 9.0 * 3.14159 ) );
  c *= 1.0 - 0.22 * ray;
  return vec4( c, 0.86 - 0.42 * smoothstep( 0.5, 1.0, u ) );
}`;

// ---------------------------------------------------------------------------------------------
// Species builders
// ---------------------------------------------------------------------------------------------
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const SIDE_R = V3(0, 0, 1), UP_V = V3(0, 1, 0);

function buildGuppy() {
  const x0 = 0.26, x1 = -0.26;
  const ry = profileFn([[0, 0], [0.02, 0.22], [0.05, 0.48], [0.1, 0.72], [0.2, 0.9], [0.34, 1.0], [0.5, 0.9], [0.7, 0.58], [0.85, 0.3], [1, 0.1]], 0.066);
  const rz = profileFn([[0, 0], [0.02, 0.28], [0.05, 0.55], [0.1, 0.78], [0.2, 0.94], [0.34, 1.0], [0.5, 0.92], [0.7, 0.65], [0.85, 0.38], [1, 0.13]], 0.046);
  const yc = profileFn([[0, 0], [0.3, -0.008], [0.6, 0], [1, 0.012]], 1);
  const body = buildBodyGeometry({ x0, x1, ry, rz, yc, asym: () => 0.12 });
  const xAt = (s) => lerp(x0, x1, s);
  const fins = [];
  // large triangular fan tail
  fins.push(buildFinGeometry(finRays(
    (t) => V3(x1 + 0.015, yc(1) + lerp(-0.024, 0.024, t), 0),
    (t) => { const fan = Math.sin(Math.PI * t); return V3(x1 - 0.33 * (0.74 + 0.26 * fan), yc(1) + lerp(-0.2, 0.2, t) * (0.8 + 0.2 * fan), 0); },
    16, SIDE_R, () => 1.0), 10, { bulge: 0.004, mode: 1.0 }));
  // dorsal
  fins.push(buildFinGeometry(finRays(
    (t) => { const s = lerp(0.5, 0.7, t); return V3(xAt(s), yc(s) + ry(s) * 0.92, 0); },
    (t) => { const s = lerp(0.5, 0.7, t); const tri = Math.sin(Math.PI * t); return V3(xAt(s) - 0.03 - 0.04 * t, yc(s) + ry(s) + 0.12 * tri, 0); },
    10, SIDE_R, (t) => lerp(0.5, 0.7, t)), 6, { bulge: 0.002, mode: 1.1 }));
  // anal
  fins.push(buildFinGeometry(finRays(
    (t) => { const s = lerp(0.58, 0.74, t); return V3(xAt(s), yc(s) - ry(s) * 0.92, 0); },
    (t) => { const s = lerp(0.58, 0.74, t); const tri = Math.sin(Math.PI * t); return V3(xAt(s) - 0.02 - 0.03 * t, yc(s) - ry(s) - 0.09 * tri, 0); },
    8, SIDE_R, (t) => lerp(0.58, 0.74, t)), 6, { bulge: 0.002, mode: 1.2 }));
  for (const side of [1, -1]) {
    // pelvic
    const s = 0.42;
    fins.push(buildFinGeometry(finRays(
      (t) => V3(xAt(s) - 0.02 + 0.03 * t, yc(s) - ry(s) * 0.85, side * 0.02),
      (t) => V3(xAt(s) - 0.08 - 0.03 * t, yc(s) - ry(s) - 0.075, side * (0.02 + 0.035 * t)),
      4, UP_V, () => s, 0.3 * side), 5, { mode: 1.3 }));
    // pectoral
    const sp = 0.3;
    const bp = V3(xAt(sp), yc(sp) - ry(sp) * 0.15, side * rz(sp) * 0.8);
    fins.push(buildFinGeometry(finRays(
      (t) => V3(bp.x + 0.02 * (t - 0.5), bp.y + 0.015 * (t - 0.5), bp.z),
      (t) => V3(bp.x - 0.1 - 0.04 * Math.sin(Math.PI * t), bp.y - 0.035 + 0.03 * t, bp.z + side * (0.06 + 0.05 * t)),
      6, UP_V, () => sp, 0.5 * side), 5, { mode: 2, bulge: 0.002 }));
  }
  return { body, fins: BufferGeometryUtils.mergeGeometries(fins, false), x0, x1, ry, rz, yc };
}

function buildClownfish() {
  const x0 = 0.41, x1 = -0.41;
  const ry = profileFn([[0, 0], [0.03, 0.5], [0.08, 0.78], [0.16, 0.95], [0.3, 1.0], [0.5, 0.97], [0.68, 0.78], [0.85, 0.45], [1, 0.14]], 0.155);
  const rz = profileFn([[0, 0], [0.03, 0.55], [0.08, 0.8], [0.16, 0.95], [0.3, 1.0], [0.5, 0.96], [0.68, 0.75], [0.85, 0.42], [1, 0.14]], 0.1);
  const yc = profileFn([[0, 0.01], [0.3, 0], [0.7, 0.0], [1, 0.02]], 1);
  const body = buildBodyGeometry({ x0, x1, ry, rz, yc, asym: () => 0.1 });
  const xAt = (s) => lerp(x0, x1, s);
  const fins = [];
  // rounded fan tail
  fins.push(buildFinGeometry(finRays(
    (t) => V3(x1 + 0.015, yc(1) + lerp(-0.03, 0.03, t), 0),
    (t) => { const q = (t - 0.5) * 2; return V3(x1 - 0.2 * (0.82 + 0.18 * Math.sqrt(Math.max(0, 1 - q * q))), yc(1) + lerp(-0.16, 0.16, t), 0); },
    16, SIDE_R, () => 1.0), 10, { bulge: 0.004, mode: 1.0 }));
  // dorsal
  fins.push(buildFinGeometry(finRays(
    (t) => { const s = lerp(0.26, 0.84, t); return V3(xAt(s), yc(s) + ry(s) * 0.93, 0); },
    (t) => { const s = lerp(0.26, 0.84, t); const h = Math.sin(Math.PI * Math.pow(t, 0.8)) * 0.13 + 0.02; return V3(xAt(s) - 0.03 * t, yc(s) + ry(s) + h, 0); },
    16, SIDE_R, (t) => lerp(0.26, 0.84, t)), 6, { bulge: 0.003, mode: 1.1 }));
  // anal
  fins.push(buildFinGeometry(finRays(
    (t) => { const s = lerp(0.52, 0.86, t); return V3(xAt(s), yc(s) - ry(s) * 0.93, 0); },
    (t) => { const s = lerp(0.52, 0.86, t); const h = Math.sin(Math.PI * Math.pow(t, 0.8)) * 0.1 + 0.02; return V3(xAt(s) - 0.03 * t, yc(s) - ry(s) - h, 0); },
    12, SIDE_R, (t) => lerp(0.52, 0.86, t)), 6, { bulge: 0.003, mode: 1.2 }));
  for (const side of [1, -1]) {
    const s = 0.4;
    fins.push(buildFinGeometry(finRays(
      (t) => V3(xAt(s) - 0.02 + 0.03 * t, yc(s) - ry(s) * 0.85, side * 0.025),
      (t) => V3(xAt(s) - 0.1 - 0.04 * t, yc(s) - ry(s) - 0.09, side * (0.025 + 0.04 * t)),
      4, UP_V, () => s, 0.3 * side), 5, { mode: 1.3 }));
    const sp = 0.25;
    const bp = V3(xAt(sp), yc(sp) - ry(sp) * 0.12, side * rz(sp) * 0.8);
    fins.push(buildFinGeometry(finRays(
      (t) => V3(bp.x + 0.025 * (t - 0.5), bp.y + 0.02 * (t - 0.5), bp.z),
      (t) => V3(bp.x - 0.13 - 0.05 * Math.sin(Math.PI * t), bp.y - 0.03 + 0.06 * (t - 0.5), bp.z + side * (0.08 + 0.06 * t)),
      7, UP_V, () => sp, 0.5 * side), 6, { mode: 2, bulge: 0.003 }));
  }
  return { body, fins: BufferGeometryUtils.mergeGeometries(fins, false), x0, x1, ry, rz, yc };
}

function buildAngelfish() {
  const x0 = 0.45, x1 = -0.45;
  const ry = profileFn([[0, 0], [0.02, 0.3], [0.05, 0.62], [0.1, 0.85], [0.2, 0.98], [0.38, 1.0], [0.55, 0.9], [0.7, 0.62], [0.85, 0.3], [1, 0.08]], 0.46);
  const rz = profileFn([[0, 0], [0.03, 0.5], [0.1, 0.9], [0.3, 1.0], [0.5, 0.85], [0.7, 0.55], [0.85, 0.3], [1, 0.12]], 0.075);
  const yc = profileFn([[0, 0.02], [0.4, 0], [1, 0.03]], 1);
  const body = buildBodyGeometry({ x0, x1, ry, rz, yc, asym: () => 0.05 });
  const xAt = (s) => lerp(x0, x1, s);
  const fins = [];
  // modest rounded tail
  fins.push(buildFinGeometry(finRays(
    (t) => V3(x1 + 0.015, yc(1) + lerp(-0.035, 0.035, t), 0),
    (t) => { const q = (t - 0.5) * 2; return V3(x1 - 0.22 * (0.8 + 0.2 * Math.sqrt(Math.max(0, 1 - q * q))), yc(1) + lerp(-0.17, 0.17, t), 0); },
    14, SIDE_R, () => 1.0), 8, { bulge: 0.003, mode: 1.0 }));
  // tall sail-like dorsal and anal fins
  const dorsalBase = (t) => { const s = lerp(0.24, 0.62, t); return V3(xAt(s), yc(s) + ry(s) * 0.9, 0); };
  const dorsalTip = (t) => V3(lerp(-0.02, -0.5, t), lerp(0.76, 0.62, t) - 0.08 * Math.sin(Math.PI * t), 0);
  fins.push(buildFinGeometry(finRays(dorsalBase, dorsalTip, 14, SIDE_R, (t) => lerp(0.24, 0.62, t)), 8, { bulge: 0.006, mode: 1.1 }));
  const analBase = (t) => { const s = lerp(0.3, 0.62, t); return V3(xAt(s), yc(s) - ry(s) * 0.9, 0); };
  const analTip = (t) => V3(lerp(-0.02, -0.5, t), lerp(-0.72, -0.58, t) + 0.08 * Math.sin(Math.PI * t), 0);
  fins.push(buildFinGeometry(finRays(analBase, analTip, 14, SIDE_R, (t) => lerp(0.3, 0.62, t)), 8, { bulge: 0.006, mode: 1.2 }));
  for (const side of [1, -1]) {
    // long pelvic-fin filaments
    fins.push(buildFilamentGeometry([V3(0.18, -0.4, side * 0.03), V3(0.1, -0.6, side * 0.06), V3(-0.1, -0.82, side * 0.08), V3(-0.32, -0.98, side * 0.1)], 0.011, 0.3, 3, V3(0, 0.25, 1).normalize(), 0.4 * side));
    const sp = 0.2;
    const bp = V3(xAt(sp), yc(sp) - ry(sp) * 0.1, side * rz(sp) * 0.8);
    fins.push(buildFinGeometry(finRays(
      (t) => V3(bp.x + 0.03 * (t - 0.5), bp.y + 0.02 * (t - 0.5), bp.z),
      (t) => V3(bp.x - 0.14 - 0.06 * Math.sin(Math.PI * t), bp.y - 0.02 + 0.05 * (t - 0.5), bp.z + side * (0.05 + 0.06 * t)),
      7, UP_V, () => sp, 0.5 * side), 6, { mode: 2, bulge: 0.002 }));
  }
  return { body, fins: BufferGeometryUtils.mergeGeometries(fins, false), x0, x1, ry, rz, yc };
}

function buildBetta() {
  const x0 = 0.3, x1 = -0.3;
  const ry = profileFn([[0, 0], [0.03, 0.45], [0.08, 0.75], [0.16, 0.95], [0.3, 1.0], [0.5, 0.95], [0.7, 0.7], [0.85, 0.4], [1, 0.12]], 0.12);
  const rz = profileFn([[0, 0], [0.03, 0.5], [0.08, 0.78], [0.16, 0.95], [0.3, 1.0], [0.5, 0.95], [0.7, 0.72], [0.85, 0.42], [1, 0.14]], 0.085);
  const yc = profileFn([[0, 0.01], [0.3, 0], [0.7, 0], [1, 0.02]], 1);
  const body = buildBodyGeometry({ x0, x1, ry, rz, yc, asym: () => 0.1 });
  const xAt = (s) => lerp(x0, x1, s);
  const fins = [];
  // huge rounded, softly scalloped veil tail
  fins.push(buildFinGeometry(finRays(
    (t) => V3(x1 + 0.015, yc(1) + lerp(-0.03, 0.03, t), 0),
    (t) => { const a = lerp(-1.35, 1.35, t); const r = 0.5 * (1 + 0.06 * Math.sin(t * 9 * Math.PI)); return V3(x1 - 0.05 - r * Math.cos(a) * 0.92, yc(1) + r * Math.sin(a), 0); },
    26, SIDE_R, () => 1.0), 12, { bulge: 0.012, ruffle: 0.02, mode: 1.0 }));
  // long flowing dorsal
  fins.push(buildFinGeometry(finRays(
    (t) => { const s = lerp(0.3, 0.96, t); return V3(xAt(s), yc(s) + ry(s) * 0.9, 0); },
    (t) => { const s = lerp(0.3, 0.96, t); const h = 0.3 * Math.pow(Math.sin(Math.PI * t), 0.6) * (0.6 + 0.4 * t); return V3(xAt(s) - 0.22 * t * t, yc(s) + ry(s) + h, 0); },
    20, SIDE_R, (t) => lerp(0.3, 0.96, t)), 10, { bulge: 0.01, ruffle: 0.02, mode: 1.1 }));
  // matching anal fin
  fins.push(buildFinGeometry(finRays(
    (t) => { const s = lerp(0.44, 0.97, t); return V3(xAt(s), yc(s) - ry(s) * 0.9, 0); },
    (t) => { const s = lerp(0.44, 0.97, t); const h = 0.27 * Math.pow(Math.sin(Math.PI * t), 0.6) * (0.6 + 0.4 * t); return V3(xAt(s) - 0.22 * t * t, yc(s) - ry(s) - h, 0); },
    18, SIDE_R, (t) => lerp(0.44, 0.97, t)), 10, { bulge: 0.01, ruffle: 0.02, mode: 1.2 }));
  for (const side of [1, -1]) {
    const s = 0.36;
    // thin pelvic fins
    fins.push(buildFinGeometry(finRays(
      (t) => V3(xAt(s) - 0.02 + 0.03 * t, yc(s) - ry(s) * 0.85, side * 0.02),
      (t) => V3(xAt(s) - 0.1 - 0.05 * t, yc(s) - ry(s) - 0.17, side * (0.02 + 0.03 * t)),
      4, UP_V, () => s, 0.3 * side), 6, { mode: 1.3 }));
    const sp = 0.27;
    const bp = V3(xAt(sp), yc(sp) - ry(sp) * 0.1, side * rz(sp) * 0.8);
    fins.push(buildFinGeometry(finRays(
      (t) => V3(bp.x + 0.03 * (t - 0.5), bp.y + 0.02 * (t - 0.5), bp.z),
      (t) => V3(bp.x - 0.15 - 0.07 * Math.sin(Math.PI * t), bp.y - 0.05 + 0.07 * (t - 0.5), bp.z + side * (0.08 + 0.07 * t)),
      8, UP_V, () => sp, 0.5 * side), 7, { mode: 2, bulge: 0.004 }));
  }
  return { body, fins: BufferGeometryUtils.mergeGeometries(fins, false), x0, x1, ry, rz, yc };
}

// ---------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------
const FISH_SPECS = {
  guppy: { id: 'guppy', build: buildGuppy, bodyGLSL: GUPPY_BODY_GLSL, finGLSL: GUPPY_FIN_GLSL, metalness: 0.3, roughness: 0.3, iridescence: 0.3, eyeR: 0.023, iris: 0xc8b45a, eyeS: 0.09, finAmp: 0.05, pectFreq: 7.0 },
  clownfish: { id: 'clownfish', build: buildClownfish, bodyGLSL: CLOWN_BODY_GLSL, finGLSL: CLOWN_FIN_GLSL, metalness: 0.05, roughness: 0.42, iridescence: 0, eyeR: 0.045, iris: 0xffb34a, eyeS: 0.1, finAmp: 0.06, pectFreq: 4.5 },
  angelfish: { id: 'angelfish', build: buildAngelfish, bodyGLSL: ANGEL_BODY_GLSL, finGLSL: ANGEL_FIN_GLSL, metalness: 0.25, roughness: 0.3, iridescence: 0.35, eyeR: 0.036, iris: 0xcfd6dc, eyeS: 0.08, finAmp: 0.06, pectFreq: 4.0 },
  betta: { id: 'betta', build: buildBetta, bodyGLSL: BETTA_BODY_GLSL, finGLSL: BETTA_FIN_GLSL, metalness: 0.2, roughness: 0.35, iridescence: 0.3, eyeR: 0.036, iris: 0x222233, eyeS: 0.1, finAmp: 0.11, pectFreq: 9.0 },
};

function createFish(kind, seed = 1) {
  const spec = FISH_SPECS[kind];
  const geos = spec.build();
  const uniforms = {
    uTime: SIM_UNIFORMS.uTime,
    uBeat: { value: seed * 1.7 }, uAmp: { value: 0.5 }, uTurn: { value: 0 },
    uLen: { value: geos.x0 - geos.x1 }, uFinAmp: { value: spec.finAmp }, uPectFreq: { value: spec.pectFreq },
  };
  const root = new THREE.Group();
  root.name = 'fish-' + kind;
  const body = new THREE.Mesh(geos.body, fishBodyMaterial(spec, uniforms));
  body.castShadow = true; body.receiveShadow = true;
  body.customDepthMaterial = fishDepthMaterial(spec, uniforms);
  const fins = new THREE.Mesh(geos.fins, fishFinMaterial(spec, uniforms));
  fins.castShadow = false; fins.receiveShadow = false;
  fins.renderOrder = 8;
  root.add(body, fins);

  // glossy eyes with a metallic iris ring
  const s = spec.eyeS;
  const ex = lerp(geos.x0, geos.x1, s), ey = geos.yc(s) + geos.ry(s) * 0.4, ez = geos.rz(s) * 0.78, r = spec.eyeR;
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x07080a, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 });
  const irisMat = new THREE.MeshPhysicalMaterial({ color: spec.iris, roughness: 0.3, metalness: 0.85 });
  const eyeGeo = new THREE.SphereGeometry(r, 18, 14), irisGeo = new THREE.SphereGeometry(r * 1.14, 18, 14);
  for (const side of [1, -1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat); eye.position.set(ex, ey, side * ez);
    const iris = new THREE.Mesh(irisGeo, irisMat); iris.position.set(ex - r * 0.4, ey, side * (ez - r * 0.3));
    root.add(eye, iris);
  }
  return { kind, spec, root, body, fins, uniforms, dims: { x0: geos.x0, x1: geos.x1 } };
}
