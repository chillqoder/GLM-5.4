// Stage 13 — two snails. Shared shell/body builders, different patterns and different surfaces:
// one crawls over the substrate (and a small stone), the other clings to the inside of the front glass.
// Snail local frame: +Z forward (head), +Y up (away from the surface the foot rests on).

function buildShellGeometry({ turns = 3.3, R = 0.07, growth = 2.6, segs = 220, radial = 20, spire = 0.42 } = {}) {
  const k = Math.log(growth) / TWO_PI;
  const c = (growth - 1) / 2;
  const pos = [], uv = [], idx = [];
  const aMax = TWO_PI * turns;
  for (let i = 0; i <= segs; i++) {
    const u = i / segs, a = u * aMax;
    const rc = R * Math.exp(k * (a - aMax));
    const z = spire * R * (1 - rc / R);
    const rt = c * rc * (1 + 0.4 * smoothstep(0.94, 1.0, u));
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * TWO_PI;
      const ct = Math.cos(th), st = Math.sin(th);
      pos.push((rc + rt * ct) * ca, (rc + rt * ct) * sa, z + rt * st * 0.85);
      uv.push(u, j / radial);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function buildSnailBodyGeometry(length = 0.4) {
  const segs = 44, radial = 22;
  const pos = [], uv = [], idx = [];
  // s: 0 tail → 1 head tip. width / height / centre height along the body
  const w = profileFn([[0, 0.05], [0.08, 0.5], [0.25, 0.92], [0.45, 1.0], [0.62, 0.9], [0.78, 0.6], [0.86, 0.5], [0.93, 0.62], [0.97, 0.5], [1, 0.02]], 0.052);
  const h = profileFn([[0, 0.3], [0.1, 0.75], [0.3, 1.0], [0.55, 0.95], [0.75, 0.6], [0.85, 0.45], [0.93, 0.55], [1, 0.05]], 0.085);
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    const z = lerp(-0.2, 0.2, s) * (length / 0.4);
    const ww = w(s), hh = h(s);
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * TWO_PI;
      const sy = Math.sin(th), cx = Math.cos(th);
      // flat sole: clamp the lower part of the ellipse
      const y = Math.max(sy, -0.12) * hh + hh * 0.12;
      const x = cx * ww * (1 - 0.1 * Math.max(0, sy));
      pos.push(x, y, z); uv.push(s, j / radial);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

const SNAIL_FOOT_VS_HEAD = /* glsl */`
uniform float uTime;
varying vec2 vSUv;`;
const SNAIL_FOOT_VS_BODY = /* glsl */`
{
  vSUv = uv;
  // muscular foot: a slow wave runs along the sole edges
  float edge = pow( abs( position.x ) / 0.052, 2.0 );
  transformed.y += 0.0035 * edge * sin( uv.x * 28.0 - uTime * 5.0 ) * smoothstep( 0.02, 0.1, uv.x );
}`;

function snailMaterials(palette) {
  const shell = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.15, envMapIntensity: 0.8 });
  enhanceMaterial(shell, {
    id: 'snail-shell-' + palette.id, caustics: 0.5, varyWorld: false,
    vertexHead: 'varying vec2 vShellUv;', vertexBody: 'vShellUv = uv;',
    fragmentHead: `varying vec2 vShellUv; uniform vec3 uBase; uniform vec3 uBand; uniform vec3 uCrest;`,
    fragmentColor: palette.shellGLSL,
    uniforms: palette.uniforms,
  });
  const body = new THREE.MeshPhysicalMaterial({ color: palette.body, roughness: 0.62, metalness: 0, sheen: 0.5, sheenRoughness: 0.7, sheenColor: new THREE.Color(palette.body).multiplyScalar(1.2), clearcoat: 0.15, clearcoatRoughness: 0.6 });
  enhanceMaterial(body, { id: 'snail-body-' + palette.id, caustics: 0.5, uniforms: { uTime: SIM_UNIFORMS.uTime }, vertexHead: SNAIL_FOOT_VS_HEAD, vertexBody: SNAIL_FOOT_VS_BODY });
  return { shell, body };
}

const SNAIL_PALETTES = {
  // Snail A: warm amber-brown shell with fine growth bands
  amber: {
    id: 'amber', body: 0xb98a5a,
    shellGLSL: /* glsl */`
      diffuseColor.rgb = uBase;
      float band = smoothstep( 0.55, 0.95, sin( vShellUv.x * 6.2831853 * 46.0 + 2.0 * sin( vShellUv.x * 30.0 ) ) );
      diffuseColor.rgb = mix( diffuseColor.rgb, uBand, band * 0.55 );
      float crest = smoothstep( 0.3, 1.0, cos( vShellUv.y * 6.2831853 ) );
      diffuseColor.rgb = mix( diffuseColor.rgb, uCrest, crest * 0.35 );`,
    uniforms: { uBase: { value: new THREE.Vector3(0.62, 0.34, 0.13) }, uBand: { value: new THREE.Vector3(0.28, 0.13, 0.05) }, uCrest: { value: new THREE.Vector3(0.85, 0.62, 0.35) } },
  },
  // Snail B: cream-olive shell with dark spiral stripes
  olive: {
    id: 'olive', body: 0xcfc7a8,
    shellGLSL: /* glsl */`
      diffuseColor.rgb = uBase;
      float sp = fract( vShellUv.y * 3.0 + 0.08 * sin( vShellUv.x * 40.0 ) );
      float stripe = smoothstep( 0.42, 0.46, sp ) * ( 1.0 - smoothstep( 0.62, 0.66, sp ) );
      diffuseColor.rgb = mix( diffuseColor.rgb, uBand, stripe * 0.85 );
      float speck = step( 0.86, fract( sin( dot( floor( vShellUv * vec2( 160.0, 60.0 ) ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) );
      diffuseColor.rgb = mix( diffuseColor.rgb, uBand, speck * 0.5 );
      float crest = smoothstep( 0.3, 1.0, cos( vShellUv.y * 6.2831853 ) );
      diffuseColor.rgb = mix( diffuseColor.rgb, uCrest, crest * 0.3 );`,
    uniforms: { uBase: { value: new THREE.Vector3(0.80, 0.74, 0.52) }, uBand: { value: new THREE.Vector3(0.22, 0.24, 0.10) }, uCrest: { value: new THREE.Vector3(0.95, 0.92, 0.75) } },
  },
};

function buildSnail(paletteKey, scale = 1) {
  const palette = SNAIL_PALETTES[paletteKey];
  const mats = snailMaterials(palette);
  const group = new THREE.Group();
  group.name = 'snail-' + paletteKey;
  group.scale.setScalar(scale);

  const body = new THREE.Mesh(buildSnailBodyGeometry(0.4), mats.body);
  body.castShadow = true; body.receiveShadow = true;
  body.customDepthMaterial = deformedDepthMaterial({ id: 'snail-foot', uniforms: { uTime: SIM_UNIFORMS.uTime }, vertexHead: SNAIL_FOOT_VS_HEAD, vertexBody: SNAIL_FOOT_VS_BODY });
  group.add(body);

  // shell: coiled in the XY plane with its axis along Z and the spire tip at +Z.
  const turns = paletteKey === 'amber' ? 3.25 : 3.4;
  const R = paletteKey === 'amber' ? 0.068 : 0.062;
  const growth = paletteKey === 'amber' ? 2.55 : 2.9;
  const shellGeo = buildShellGeometry({ R, growth, turns, spire: paletteKey === 'amber' ? 0.45 : 0.3 });
  const shell = new THREE.Mesh(shellGeo, mats.shell);
  shell.castShadow = true; shell.receiveShadow = true;
  // Euler XYZ applies Z first (spin about the coiling axis so the aperture lands on +Y), then X
  // (tip up, aperture toward the tail).
  const aEnd = (turns % 1) * TWO_PI;
  shell.rotation.set(-Math.PI / 2, 0, Math.PI / 2 - aEnd);
  shell.position.set(0.008, 0.075, -0.02);
  group.add(shell);
  // dark interior seen through the aperture
  {
    const k = Math.log(growth) / TWO_PI;
    const a = turns * TWO_PI;
    const tan = new THREE.Vector3(-Math.sin(a) + k * Math.cos(a), Math.cos(a) + k * Math.sin(a), 0).normalize();
    const c = (growth - 1) / 2;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(c * R * 1.4 * 0.92, 24), new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.9, side: THREE.DoubleSide }));
    disc.position.set(R * Math.cos(a), R * Math.sin(a), 0).addScaledVector(tan, -0.004);
    disc.lookAt(disc.position.clone().add(tan));
    shell.add(disc);
  }

  // head: tentacles on pivots so they can explore
  const tentMat = new THREE.MeshPhysicalMaterial({ color: palette.body, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color(palette.body) });
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0806, roughness: 0.1, clearcoat: 1 });
  const tentacles = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Object3D();
    pivot.position.set(side * 0.022, 0.04, 0.19);
    const geo = new THREE.CylinderGeometry(0.0025, 0.0055, 0.075, 8).translate(0, 0.0375, 0);
    const t = new THREE.Mesh(geo, tentMat);
    t.castShadow = true;
    pivot.add(t);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 10, 8), eyeMat);
    eye.position.y = 0.077;
    pivot.add(eye);
    pivot.rotation.set(0.5, 0, side * 0.45);
    group.add(pivot);
    tentacles.push({ pivot, side });
  }
  return { group, body, shell, tentacles, palette };
}

// ---------------------------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------------------------
const _nq = new THREE.Quaternion(), _nm = new THREE.Matrix4(), _nv = Array.from({ length: 6 }, () => new THREE.Vector3());

function createBottomSnail(parent, crab) {
  const snail = buildSnail('amber', 1.0);
  const group = snail.group;
  parent.add(group);
  const stone = LAYOUT.stones[2];
  const speed = 0.035;
  let theta = 0.6;
  const normal = new THREE.Vector3(0, 1, 0);
  let wait = 0;
  SIM.add((dt) => {
    // stay clear of the crab: wait if it is close
    const crabPos = crab ? crab.group.position : null;
    const distCrab = crabPos ? Math.hypot(crabPos.x - group.position.x, crabPos.z - group.position.z) : 99;
    if (distCrab < 0.45) wait = Math.max(wait, 0.6);
    if (wait > 0) wait -= dt; else theta += (speed / 0.3) * dt;
    // a slow Lissajous loop that crosses the small stone, so the snail climbs over it
    const x = stone.x + 0.32 * Math.sin(theta) + 0.08;
    const z = stone.z + 0.26 * Math.sin(2 * theta + 0.7) + 0.06;
    const y = groundHeightAt(x, z);
    group.position.set(x, y + 0.002, z);
    // heading = path tangent
    const x2 = stone.x + 0.32 * Math.sin(theta + 0.02) + 0.08, z2 = stone.z + 0.26 * Math.sin(2 * (theta + 0.02) + 0.7) + 0.06;
    _nv[0].set(x2 - x, 0, z2 - z);
    if (_nv[0].lengthSq() < 1e-8) _nv[0].set(1, 0, 0);
    _nv[0].normalize();
    substrateNormal(x, z, _nv[1]);
    // include the stone's slope
    if (Math.hypot(x - stone.x, z - stone.z) < stone.r * 0.95) { _nv[1].set(x - stone.x, 0.9 * stone.r * stone.squash, z - stone.z).normalize(); }
    normal.lerp(_nv[1], 1 - Math.exp(-3 * dt)).normalize();
    // forward projected onto the surface plane
    _nv[0].addScaledVector(normal, -_nv[0].dot(normal)).normalize();
    _nv[2].crossVectors(normal, _nv[0]);
    _nm.makeBasis(_nv[2], normal, _nv[0]);
    _nq.setFromRotationMatrix(_nm);
    group.quaternion.slerp(_nq, 1 - Math.exp(-4 * dt));
    animateTentacles(snail, 1);
  });
  return snail;
}

function createGlassSnail(parent) {
  const snail = buildSnail('olive', 0.95);
  const group = snail.group;
  parent.add(group);
  const glassZ = TANK.izMax;                  // inner face of the front pane
  const A = new THREE.Vector2(1.15, 0.62), B = new THREE.Vector2(1.62, 1.42);
  const speed = 0.02;
  let t = 0, dir = 1, turning = 0, heading = new THREE.Vector2(), targetHeading = new THREE.Vector2();
  heading.set(B.x - A.x, B.y - A.y).normalize();
  targetHeading.copy(heading);
  SIM.add((dt) => {
    if (turning > 0) {
      // rotate in place toward the way back
      turning -= dt;
      heading.lerp(targetHeading, 1 - Math.exp(-0.35 * dt)).normalize();
      if (turning <= 0) heading.copy(targetHeading);
    } else {
      t += (speed / 0.94) * dir * dt;
      if (t >= 1) { t = 1; dir = -1; turning = 9; targetHeading.set(A.x - B.x, A.y - B.y).normalize(); }
      else if (t <= 0) { t = 0; dir = 1; turning = 9; targetHeading.set(B.x - A.x, B.y - A.y).normalize(); }
    }
    const px = lerp(A.x, B.x, t), py = lerp(A.y, B.y, t);
    // foot exactly on the pane, shell pointing into the water
    group.position.set(px, py, glassZ);
    _nv[0].set(heading.x, heading.y, 0).normalize();          // forward, in the pane plane
    _nv[1].set(0, 0, -1);                                       // up = away from the glass
    _nv[2].crossVectors(_nv[1], _nv[0]);                        // right
    _nm.makeBasis(_nv[2], _nv[1], _nv[0]);
    group.quaternion.slerp(_nq.setFromRotationMatrix(_nm), 1 - Math.exp(-6 * dt));
    animateTentacles(snail, 1.4);
  });
  return snail;
}

function animateTentacles(snail, amount) {
  const t = SIM.time;
  for (const tc of snail.tentacles) {
    const k = tc.side;
    tc.pivot.rotation.x = 0.5 + amount * (0.12 * Math.sin(t * 1.1 + k) + 0.05 * Math.sin(t * 3.7 + k * 2));
    tc.pivot.rotation.z = -k * (0.45 + 0.1 * Math.sin(t * 0.9 + k * 1.5));
  }
}
