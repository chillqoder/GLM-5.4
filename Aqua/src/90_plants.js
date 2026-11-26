// Stage 6 — four rooted aquatic plants with different leaf structures and motion.
//
// Every leaf/stem vertex carries a "flow frame" (aCenter, aSide, aTan) on its supporting axis and
// two parameters: aLeaf.x = distance along the organ (0 base → 1 tip), aLeaf.w = position on the
// supporting stem. The vertex shader bends the organ along that frame, so leaves stay attached.

const PLANT_DEFORM_HEAD = /* glsl */`
attribute vec4 aLeaf;
attribute vec3 aCenter;
attribute vec3 aSide;
attribute vec3 aTan;
attribute float aKind;
uniform float uTime;
uniform float uLeafAmp;
uniform float uLeafFreq;
uniform float uLeafDelay;
uniform float uPlantSeed;
varying vec2 vLeafUv;
varying vec4 vLeafData;
varying float vLeafKind;
${CURRENT_GLSL}
vec3 rotAxis( vec3 v, vec3 axis, float a ) {
  float c = cos( a ), s = sin( a );
  return v * c + cross( axis, v ) * s + axis * dot( axis, v ) * ( 1.0 - c );
}`;

const PLANT_DEFORM_BODY = /* glsl */`
{
  vLeafUv = uv;
  vLeafData = aLeaf;
  vLeafKind = aKind;
  float t = aLeaf.x;
  float s = aLeaf.w;
  float ph = aLeaf.y;
  float stiff = aLeaf.z * uLeafAmp;
  float ws = s * s;
  float wt = t * t;
  vec3 wp = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vec3 cur = currentField( wp, uTime );
  float gust = 0.65 + 0.35 * sin( uTime * 0.31 + ph * 2.0 + uPlantSeed );
  float sway = sin( uTime * uLeafFreq + ph - s * uLeafDelay )
             + 0.5 * sin( uTime * uLeafFreq * 1.7 + ph * 1.3 - s * uLeafDelay * 1.6 );
  // motion of the supporting axis at this height
  vec3 follow = aSide * ( stiff * ws * sway * gust * 0.35 )
              + vec3( 0.0, 1.0, 0.0 ) * ( stiff * ws * 0.10 * sin( uTime * uLeafFreq * 0.7 + ph * 1.3 ) )
              + cur * ( stiff * ws * 1.8 );
  float tw = stiff * 0.35 * s * sin( uTime * uLeafFreq * 0.8 + ph + 1.0 );
  vec3 off = rotAxis( transformed - aCenter, aTan, tw );
  // the organ's own tip motion (leaf blades, fine whorls)
  float isStem = step( 0.5, aKind ) * ( 1.0 - step( 1.5, aKind ) );
  vec3 flutter = normal * ( stiff * wt * 0.12 * ( 1.0 - isStem ) * sin( uTime * uLeafFreq * 1.3 + ph - t * uLeafDelay ) );
  transformed = aCenter + off + follow + flutter;
}`;

const PLANT_FRAG_HEAD = /* glsl */`
varying vec2 vLeafUv;
varying vec4 vLeafData;
varying float vLeafKind;
uniform vec3 uLeafDark;
uniform vec3 uLeafLight;
uniform float uLeafVeins;
float leafHash( float n ) { return fract( sin( n * 127.1 ) * 43758.5453 ); }
vec3 leafColor() {
  float t = vLeafUv.y;
  float u = vLeafUv.x;
  float v = abs( u - 0.5 ) * 2.0;
  float ph = vLeafData.y;
  float lr = leafHash( ph );
  vec3 c = mix( uLeafDark, uLeafLight, 0.25 + 0.55 * smoothstep( 0.0, 0.85, t ) + 0.25 * lr );
  // midrib
  float mid = 1.0 - smoothstep( 0.0, 0.045 * ( 1.0 - t * 0.5 ), v );
  c = mix( c, uLeafLight * 1.12, mid * 0.55 );
  // lateral veins
  float lat = sin( ( t * uLeafVeins + v * 0.9 ) * 6.28318 );
  float lines = smoothstep( 0.9, 1.0, lat ) * ( 1.0 - mid ) * ( 1.0 - v * 0.6 ) * step( 0.5, uLeafVeins );
  c = mix( c, uLeafLight * 1.08, lines * 0.35 );
  // edges a touch darker
  c *= mix( 0.82, 1.0, 1.0 - smoothstep( 0.8, 1.0, v ) );
  return c;
}`;

function makePlantMaterial(spec, uniforms) {
  const transparent = !!spec.transparent;
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: spec.roughness ?? 0.46, metalness: 0,
    clearcoat: spec.clearcoat ?? 0.3, clearcoatRoughness: 0.45,
    side: THREE.DoubleSide, transparent, depthWrite: !transparent,
    sheen: 0.3, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.35, 0.75, 0.4),
    envMapIntensity: 0.5,
  });
  enhanceMaterial(mat, {
    id: spec.id,
    uniforms,
    caustics: spec.caustics ?? 0.7,
    vertexHead: PLANT_DEFORM_HEAD,
    vertexBody: PLANT_DEFORM_BODY,
    fragmentHead: PLANT_FRAG_HEAD + (spec.fragmentExtra || ''),
    fragmentColor: 'diffuseColor.rgb = leafColor();' + (spec.fragmentColor || ''),
    fragmentEmissive: 'totalEmissiveRadiance += diffuseColor.rgb * 0.30 * pow( 1.0 - abs( dot( normal, normalize( vViewPosition ) ) ), 2.0 );',
  });
  return mat;
}
function plantDepthMaterial(id, uniforms) {
  return deformedDepthMaterial({ id, uniforms, vertexHead: PLANT_DEFORM_HEAD, vertexBody: PLANT_DEFORM_BODY, side: THREE.DoubleSide });
}
function plantUniforms(seed, amp, freq, delay, dark, light, veins) {
  return {
    uTime: SIM_UNIFORMS.uTime, uPlume: SIM_UNIFORMS.uPlume,
    uPlantSeed: { value: seed }, uLeafAmp: { value: amp }, uLeafFreq: { value: freq }, uLeafDelay: { value: delay },
    uLeafDark: { value: new THREE.Vector3(...dark) }, uLeafLight: { value: new THREE.Vector3(...light) }, uLeafVeins: { value: veins },
  };
}
function placePlant(group, layout, parent, sink = 0.03) {
  group.position.set(layout.x, substrateHeight(layout.x, layout.z) - sink, layout.z);
  parent.add(group);
  group.updateMatrixWorld(true);
}

// Sets flow attributes on an indexed geometry whose uv.x runs along the organ.
function addFlowAttributes(g, frameFn, phase, stiffness, kind = 0, alongOwn = false) {
  const count = g.attributes.position.count;
  const aLeaf = new Float32Array(count * 4), aCenter = new Float32Array(count * 3), aSide = new Float32Array(count * 3), aTan = new Float32Array(count * 3), aKind = new Float32Array(count);
  const fr = { c: new THREE.Vector3(), s: new THREE.Vector3(), t: new THREE.Vector3() };
  for (let i = 0; i < count; i++) {
    const u = g.attributes.uv.getX(i);
    frameFn(u, fr);
    const t = alongOwn ? g.attributes.uv.getY(i) : u;
    aLeaf[i * 4] = t; aLeaf[i * 4 + 1] = phase; aLeaf[i * 4 + 2] = stiffness; aLeaf[i * 4 + 3] = u;
    aCenter.set([fr.c.x, fr.c.y, fr.c.z], i * 3); aSide.set([fr.s.x, fr.s.y, fr.s.z], i * 3); aTan.set([fr.t.x, fr.t.y, fr.t.z], i * 3);
    aKind[i] = kind;
  }
  g.setAttribute('aLeaf', new THREE.BufferAttribute(aLeaf, 4));
  g.setAttribute('aCenter', new THREE.BufferAttribute(aCenter, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 3));
  g.setAttribute('aTan', new THREE.BufferAttribute(aTan, 3));
  g.setAttribute('aKind', new THREE.BufferAttribute(aKind, 1));
  return g;
}

// Ribbon/sheet organ: spine(t), facing(t) (desired normal), width(t), twist(t), crease, wrinkle(t, a).
function buildLeafGeometry(o) {
  const segs = o.segments ?? 24, across = o.across ?? 2;
  const rows = segs + 1, cols = across + 1, count = rows * cols;
  const pos = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const aLeaf = new Float32Array(count * 4), aCenter = new Float32Array(count * 3), aSide = new Float32Array(count * 3), aTan = new Float32Array(count * 3), aKind = new Float32Array(count);
  const C = new THREE.Vector3(), T = new THREE.Vector3(), S = new THREE.Vector3(), N = new THREE.Vector3(), P = new THREE.Vector3(), F = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  const follow = o.follow || null;
  for (let i = 0; i < rows; i++) {
    const t = i / segs;
    o.spine(t, C);
    o.spine(Math.min(1, t + 0.01), tmpA); o.spine(Math.max(0, t - 0.01), tmpB);
    T.subVectors(tmpA, tmpB);
    if (T.lengthSq() < 1e-10) T.set(0, 1, 0); else T.normalize();
    o.facing(t, F);
    S.crossVectors(F, T);
    if (S.lengthSq() < 1e-8) S.set(1, 0, 0).cross(T);
    S.normalize();
    N.crossVectors(T, S).normalize();
    const tw = o.twist ? o.twist(t) : 0;
    if (tw) { S.applyAxisAngle(T, tw); N.applyAxisAngle(T, tw); }
    const w = o.width(t);
    for (let j = 0; j < cols; j++) {
      const a = j / across - 0.5;
      const edge = Math.abs(a) * 2;
      let lift = (o.crease ?? 0) * w * Math.pow(edge, o.creasePow ?? 1.6);
      if (o.wrinkle) lift += o.wrinkle(t, a);
      P.copy(C).addScaledVector(S, a * w).addScaledVector(N, lift);
      const k = i * cols + j;
      pos[k * 3] = P.x; pos[k * 3 + 1] = P.y; pos[k * 3 + 2] = P.z;
      uv[k * 2] = a + 0.5; uv[k * 2 + 1] = t;
      const s = follow ? follow.s : t;
      aLeaf[k * 4] = t; aLeaf[k * 4 + 1] = o.phase; aLeaf[k * 4 + 2] = o.stiffness; aLeaf[k * 4 + 3] = s;
      if (follow) {
        aCenter.set([follow.center.x, follow.center.y, follow.center.z], k * 3);
        aSide.set([follow.side.x, follow.side.y, follow.side.z], k * 3);
        aTan.set([follow.tan.x, follow.tan.y, follow.tan.z], k * 3);
      } else {
        aCenter.set([C.x, C.y, C.z], k * 3); aSide.set([S.x, S.y, S.z], k * 3); aTan.set([T.x, T.y, T.z], k * 3);
      }
      aKind[k] = o.kind ?? 0;
    }
  }
  const idx = [];
  for (let i = 0; i < segs; i++) for (let j = 0; j < across; j++) {
    const a = i * cols + j, b = a + cols;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aLeaf', new THREE.BufferAttribute(aLeaf, 4));
  g.setAttribute('aCenter', new THREE.BufferAttribute(aCenter, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 3));
  g.setAttribute('aTan', new THREE.BufferAttribute(aTan, 3));
  g.setAttribute('aKind', new THREE.BufferAttribute(aKind, 1));
  g.computeVertexNormals();
  return g;
}

function mergePlant(geos) {
  const g = BufferGeometryUtils.mergeGeometries(geos, false);
  for (const x of geos) x.dispose();
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------------------------
// Plant 1 — Vallisneria: a rear-corner clump of long, narrow, twisting ribbon leaves.
// ---------------------------------------------------------------------------------------------
function createVallisneria(parent) {
  const rng = new Rng(101);
  const group = new THREE.Group();
  group.name = 'plant-vallisneria';
  const geos = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * TWO_PI + rng.range(-0.35, 0.35);
    const L = i < 3 ? rng.range(3.9, 4.3) : rng.range(2.3, 3.8);
    const lean = rng.range(0.2, 0.6);
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const sideDir = new THREE.Vector3(-dir.z, 0, dir.x);
    const baseOff = dir.clone().multiplyScalar(rng.range(0.0, 0.14));
    const twistTotal = rng.range(-1.3, 1.3);
    const wBase = rng.range(0.06, 0.088);
    const wave = rng.range(0, TWO_PI);
    geos.push(buildLeafGeometry({
      spine: (t, out) => {
        const y = L * (t - 0.08 * t * t);
        const r = lean * t * t;
        const s = 0.05 * Math.sin(t * 3.1 + wave) * t;
        return out.set(baseOff.x + dir.x * r + sideDir.x * s, y, baseOff.z + dir.z * r + sideDir.z * s);
      },
      facing: (t, out) => out.copy(sideDir),
      width: (t) => wBase * (0.7 + 0.45 * Math.sin(Math.min(1, t * 2.2) * Math.PI * 0.5)) * (1 - smoothstep(0.6, 1.0, t)) + 0.004,
      twist: (t) => twistTotal * t * t,
      crease: 0.35, creasePow: 1.4,
      segments: 40, across: 4,
      phase: rng.float() * TWO_PI, stiffness: rng.range(0.8, 1.2),
    }));
  }
  const geo = mergePlant(geos);
  const uniforms = plantUniforms(0.3, 1.0, 1.5, 1.1, [0.07, 0.27, 0.08], [0.34, 0.68, 0.18], 0);
  const mesh = new THREE.Mesh(geo, makePlantMaterial({ id: 'vallisneria', clearcoat: 0.2, fragmentExtra: '', fragmentColor: 'diffuseColor.rgb *= 1.0 + 0.18 * (1.0 - smoothstep(0.0, 0.12, abs(vLeafUv.x - 0.5)));' }, uniforms));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.customDepthMaterial = plantDepthMaterial('vallisneria', uniforms);
  group.add(mesh);
  placePlant(group, LAYOUT.plants.vallisneria, parent);
  return { group, mesh };
}

// ---------------------------------------------------------------------------------------------
// Plant 2 — Anubias: thick oval leaves on petioles above a visible rhizome. Stiff, small motion.
// ---------------------------------------------------------------------------------------------
function createRhizome(group, rng, length, radius, color, parts) {
  const pts = [];
  const a = rng.range(0, TWO_PI);
  const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    pts.push(new THREE.Vector3().copy(dir).multiplyScalar((u - 0.5) * length).add(new THREE.Vector3(rng.range(-0.03, 0.03), radius * 0.9 + rng.range(-0.01, 0.02), rng.range(-0.03, 0.03))));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 24, radius, 10, false);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
  enhanceMaterial(mat, { id: 'rhizome-' + color, caustics: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  // leaf scars / nodules
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(radius * rng.range(0.35, 0.55), 8, 6), mat);
    curve.getPointAt(rng.range(0.1, 0.9), b.position);
    b.position.y += radius * 0.6;
    b.castShadow = true;
    group.add(b);
    parts.push(b);
  }
  return { mesh, curve, dir };
}

function createAnubias(parent) {
  const rng = new Rng(202);
  const group = new THREE.Group();
  group.name = 'plant-anubias';
  const rhizomeParts = [];
  createRhizome(group, rng, 0.46, 0.055, 0x4a4a2a, rhizomeParts);
  const geos = [];
  const n = 7, PT = 0.42;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * TWO_PI + rng.range(-0.4, 0.4);
    const petLen = rng.range(0.2, 0.36), bladeLen = rng.range(0.3, 0.44), W = rng.range(0.17, 0.25);
    const tilt = rng.range(0.25, 0.7), tiltB = tilt + rng.range(0.35, 0.6);
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const sideDir = new THREE.Vector3(-dir.z, 0, dir.x);
    const p0 = dir.clone().multiplyScalar(rng.range(0.02, 0.14));
    p0.y = 0.07;
    const p1 = p0.clone().addScaledVector(dir, petLen * Math.sin(tilt)).addScaledVector(UP, petLen * Math.cos(tilt));
    const droop = rng.range(0.06, 0.14);
    const roll = rng.range(-0.25, 0.25);
    geos.push(buildLeafGeometry({
      spine: (t, out) => {
        if (t < PT) {
          const u = t / PT;
          out.lerpVectors(p0, p1, u);
          out.y += 0.03 * Math.sin(u * Math.PI);           // slight bow
        } else {
          const u = (t - PT) / (1 - PT);
          out.copy(p1).addScaledVector(dir, bladeLen * u * Math.sin(tiltB)).addScaledVector(UP, bladeLen * u * Math.cos(tiltB) - droop * u * u);
          out.addScaledVector(sideDir, roll * bladeLen * u * u);
        }
        return out;
      },
      facing: (t, out) => out.copy(sideDir).lerp(UP, smoothstep(0.3, 0.62, t)).normalize(),
      width: (t) => (t < PT ? 0.02 + 0.012 * (1 - t / PT) : W * Math.pow(Math.sin(Math.PI * (0.02 + 0.98 * (t - PT) / (1 - PT))), 1.05)),
      crease: -0.22, creasePow: 2.0,
      twist: (t) => roll * 0.4 * smoothstep(PT, 1, t),
      segments: 30, across: 6,
      phase: rng.float() * TWO_PI, stiffness: rng.range(0.8, 1.2),
    }));
  }
  const geo = mergePlant(geos);
  const uniforms = plantUniforms(1.7, 0.14, 3.2, 2.0, [0.015, 0.10, 0.035], [0.06, 0.28, 0.09], 7);
  const mesh = new THREE.Mesh(geo, makePlantMaterial({ id: 'anubias', clearcoat: 0.7, roughness: 0.42, fragmentExtra: '', fragmentColor: 'diffuseColor.rgb *= 0.92 + 0.16 * leafHash( floor( vLeafUv.y * 9.0 ) * 3.1 + floor( vLeafUv.x * 7.0 ) );' }, uniforms));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.customDepthMaterial = plantDepthMaterial('anubias', uniforms);
  group.add(mesh);
  placePlant(group, LAYOUT.plants.anubias, parent);
  return { group, mesh };
}

// ---------------------------------------------------------------------------------------------
// Plant 3 — Java fern: lance-shaped fronds with uneven outlines from a single anchored base.
// ---------------------------------------------------------------------------------------------
function createJavaFern(parent) {
  const rng = new Rng(303);
  const group = new THREE.Group();
  group.name = 'plant-javafern';
  createRhizome(group, rng, 0.4, 0.045, 0x3a3220, []);
  const geos = [];
  const n = 9, PT = 0.16;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * TWO_PI + rng.range(-0.5, 0.5);
    const petLen = rng.range(0.08, 0.16), bladeLen = rng.range(0.75, 1.45), W = rng.range(0.13, 0.2);
    const tilt = rng.range(0.3, 0.7);                       // from vertical
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const sideDir = new THREE.Vector3(-dir.z, 0, dir.x);
    const p0 = dir.clone().multiplyScalar(rng.range(0.0, 0.12)); p0.y = 0.06;
    const p1 = p0.clone().addScaledVector(dir, petLen * Math.sin(tilt)).addScaledVector(UP, petLen * Math.cos(tilt));
    const droop = rng.range(0.15, 0.4) * bladeLen;
    const roll = rng.range(-0.5, 0.5);
    const bumps = rng.range(28, 42), bp = rng.range(0, TWO_PI);
    geos.push(buildLeafGeometry({
      spine: (t, out) => {
        if (t < PT) {
          out.lerpVectors(p0, p1, t / PT);
        } else {
          const u = (t - PT) / (1 - PT);
          out.copy(p1).addScaledVector(dir, bladeLen * (u * Math.sin(tilt) + droop * u * u * 0.5)).addScaledVector(UP, bladeLen * (u * Math.cos(tilt) - droop * u * u * 0.35));
          out.addScaledVector(sideDir, roll * 0.15 * bladeLen * u * u);
        }
        return out;
      },
      facing: (t, out) => out.copy(sideDir).lerp(UP, 0.6).normalize(),
      width: (t) => {
        if (t < PT) return 0.016;
        const u = (t - PT) / (1 - PT);
        return W * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.75) * (1 + 0.13 * Math.sin(u * bumps + bp)) + 0.003;
      },
      wrinkle: (t, a) => (t > PT ? 0.006 * Math.sin(t * 70 + a * 9) * (1 - Math.abs(a) * 1.6) : 0),
      crease: 0.12, creasePow: 1.5,
      twist: (t) => roll * 0.5 * smoothstep(PT, 1, t),
      segments: 36, across: 6,
      phase: rng.float() * TWO_PI, stiffness: rng.range(0.75, 1.15),
    }));
  }
  const geo = mergePlant(geos);
  const uniforms = plantUniforms(2.9, 0.55, 2.2, 3.6, [0.09, 0.23, 0.07], [0.30, 0.52, 0.19], 9);
  const mesh = new THREE.Mesh(geo, makePlantMaterial({ id: 'javafern', clearcoat: 0.25, fragmentExtra: '', fragmentColor: 'diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.25, 1.05, 0.7 ), 0.5 * step( 0.55, leafHash( floor( vLeafUv.y * 14.0 ) * 7.7 + floor( vLeafUv.x * 5.0 ) ) ) );' }, uniforms));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.customDepthMaterial = plantDepthMaterial('javafern', uniforms);
  group.add(mesh);
  placePlant(group, LAYOUT.plants.javafern, parent);
  return { group, mesh };
}

// ---------------------------------------------------------------------------------------------
// Plant 4 — Cabomba: branching fine stems carrying feathery fan-like leaf whorls.
// ---------------------------------------------------------------------------------------------
function createCabomba(parent) {
  const rng = new Rng(404);
  const group = new THREE.Group();
  group.name = 'plant-cabomba';
  const geos = [];
  const stems = [];
  const nStems = 6;
  for (let k = 0; k < nStems; k++) {
    const az = (k / nStems) * TWO_PI + rng.range(-0.4, 0.4);
    const H = rng.range(1.7, 2.7);
    const lean = rng.range(0.15, 0.45);
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const sideDir = new THREE.Vector3(-dir.z, 0, dir.x);
    const baseOff = dir.clone().multiplyScalar(rng.range(0.0, 0.16));
    const wave = rng.range(0, TWO_PI);
    stems.push({
      baseOff, dir, sideDir, wave, H, lean,
      fn: (u, out) => out.copy(baseOff).addScaledVector(UP, H * u).addScaledVector(dir, lean * u * u).addScaledVector(sideDir, 0.09 * Math.sin(u * 3.5 + wave) * u),
      phase: rng.float() * TWO_PI, stiffness: 1.0, radius: 0.012,
    });
  }
  // two side branches emerging from mid-stem nodes
  const branchSeeds = [stems[1], stems[4]];
  for (const s of branchSeeds) {
    const d = s.dir.clone().addScaledVector(s.sideDir, rng.range(-1, 1)).normalize();
    const side2 = new THREE.Vector3(-d.z, 0, d.x);
    const origin = s.fn(0.5, new THREE.Vector3());
    const H = s.H * rng.range(0.45, 0.6);
    const lean = rng.range(0.3, 0.6);
    stems.push({
      baseOff: origin, dir: d, sideDir: side2, wave: rng.range(0, TWO_PI), H, lean,
      fn: (u, out) => out.copy(origin).addScaledVector(UP, H * u).addScaledVector(d, lean * u * u + 0.25 * u).addScaledVector(side2, 0.06 * Math.sin(u * 4) * u),
      phase: rng.float() * TWO_PI, stiffness: 1.15, radius: 0.009, branch: true,
    });
  }

  const tmp = { c: new THREE.Vector3(), s: new THREE.Vector3(), t: new THREE.Vector3() };
  for (const st of stems) {
    const pts = [];
    for (let i = 0; i <= 12; i++) pts.push(st.fn(i / 12, new THREE.Vector3()));
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 28, st.radius, 6, false);
    const frameFn = (u, out) => {
      curve.getPointAt(u, out.c);
      curve.getTangentAt(u, out.t);
      out.s.set(-out.t.z, 0, out.t.x);
      if (out.s.lengthSq() < 1e-6) out.s.set(1, 0, 0);
      out.s.normalize();
    };
    addFlowAttributes(tube, frameFn, st.phase, st.stiffness, 1);
    geos.push(tube);

    // whorls: at every node two opposing flat fans of finely serrated segments
    let u = st.branch ? 0.25 : 0.14;
    let nodeIdx = 0;
    while (u < 0.97) {
      frameFn(u, tmp);
      const center = tmp.c.clone();
      const nodeScale = (st.branch ? 0.8 : 1) * (1 - 0.38 * Math.abs(u - 0.6));
      const fanAz = u * 9.0 + nodeIdx * 1.3 + st.phase;
      for (let f = 0; f < 2; f++) {
        const fa = fanAz + f * Math.PI;
        const nf = 6;
        for (let j = 0; j < nf; j++) {
          const spread = (j / (nf - 1) - 0.5) * 1.9;
          const el = 0.28 + 0.3 * Math.abs(spread);
          const a = fa + spread;
          const d = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
          const Lw = 0.32 * nodeScale * (1 - 0.45 * Math.abs(spread) / 0.95) * rng.range(0.9, 1.1);
          const curl = rng.range(0.25, 0.5);
          const phase = st.phase + nodeIdx * 1.7 + j * 0.9 + f * 2.3;
          geos.push(buildLeafGeometry({
            spine: (t, out) => out.copy(center).addScaledVector(d, Lw * t).addScaledVector(UP, curl * Lw * t * t),
            facing: (t, out) => out.copy(UP),
            width: (t) => (0.024 * (1 - smoothstep(0.55, 1.0, t)) + 0.002) * (1 + 0.6 * Math.abs(Math.sin(t * 9.0 * Math.PI))),
            segments: 16, across: 1,
            phase, stiffness: rng.range(1.0, 1.4),
            follow: { s: u, center, side: tmp.s.clone(), tan: tmp.t.clone() },
            kind: 2,
          }));
        }
      }
      u += rng.range(0.085, 0.125);
      nodeIdx++;
    }
    // terminal tuft
    frameFn(0.99, tmp);
    const tip = tmp.c.clone();
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * TWO_PI + st.phase;
      const d = new THREE.Vector3(Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35).normalize();
      geos.push(buildLeafGeometry({
        spine: (t, out) => out.copy(tip).addScaledVector(d, 0.14 * t),
        facing: (t, out) => out.set(-Math.sin(a), 0, Math.cos(a)),
        width: (t) => 0.02 * (1 - smoothstep(0.5, 1.0, t)) + 0.002,
        segments: 6, across: 1, phase: st.phase + j, stiffness: 1.2,
        follow: { s: 0.99, center: tip, side: tmp.s.clone(), tan: tmp.t.clone() }, kind: 2,
      }));
    }
  }
  const geo = mergePlant(geos);
  const uniforms = plantUniforms(4.1, 1.5, 4.4, 4.2, [0.22, 0.55, 0.17], [0.56, 0.88, 0.36], 0);
  const mesh = new THREE.Mesh(geo, makePlantMaterial({
    id: 'cabomba', transparent: true, clearcoat: 0.15, roughness: 0.5,
    fragmentExtra: '',
    fragmentColor: `
      if ( vLeafKind > 0.5 ) diffuseColor.rgb = mix( vec3( 0.20, 0.46, 0.17 ), vec3( 0.30, 0.60, 0.22 ), vLeafUv.y );   // darker stems
      diffuseColor.a = vLeafKind > 0.5 ? 1.0 : 1.0 - 0.55 * pow( abs( vLeafUv.x - 0.5 ) * 2.0, 2.0 ) - 0.25 * smoothstep( 0.7, 1.0, vLeafUv.y );`,
  }, uniforms));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.renderOrder = 6;
  mesh.customDepthMaterial = plantDepthMaterial('cabomba', uniforms);
  group.add(mesh);
  placePlant(group, LAYOUT.plants.cabomba, parent);
  return { group, mesh };
}

function createPlants(parent) {
  return {
    vallisneria: createVallisneria(parent),
    anubias: createAnubias(parent),
    javafern: createJavaFern(parent),
    cabomba: createCabomba(parent),
  };
}
