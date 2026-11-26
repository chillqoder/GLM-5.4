// The glass box: five panes, silicone seams, bottom frame, upper rim, the water surface and its waterline.

const PANE_VS = /* glsl */`
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vView;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normal;                       // panes are axis-aligned and unscaled: object normal == world normal
  vec4 vp = viewMatrix * wp;
  vView = vp.xyz;
  gl_Position = projectionMatrix * vp;
}`;

const PANE_FS = /* glsl */`
uniform vec3 uMainNormal;
uniform float uEntry;                      // 1: camera on the outside of this pane (entry interface)
uniform float uThickness;
${WATER_GLSL}
${OPTIC_COMMON_GLSL}
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vView;

void main() {
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  float mainFace = step(0.985, abs(dot(N, uMainNormal)));
  // An exit face seen from inside the water is optically negligible: the near pane / surface already
  // carried the absorption and reflection for that path.
  if (mainFace > 0.5 && uEntry < 0.5) discard;
  float cosI = clamp(dot(N, V), 1e-3, 1.0);
  vec3 col;
  if (mainFace < 0.5) {
    // Glass edge: light pipes along the thickness and picks up the green cast real edges have.
    vec3 env = textureLod(uEnvCube, reflect(-V, N), 1.6).rgb * uEnvIntensity;
    float f = fresnelDielectric(cosI, 1.0 / ${GLASS_IOR.toFixed(2)});
    col = vec3(0.028, 0.082, 0.064) + env * vec3(0.35, 0.80, 0.68) * (0.45 + 0.55 * f);
  } else {
    float r = fresnelDielectric(cosI, 1.0 / ${GLASS_IOR.toFixed(2)});
    float R = 2.0 * r / (1.0 + r);                       // two parallel interfaces, incoherent
    vec3 env = textureLod(uEnvCube, reflect(-V, N), 0.6).rgb * uEnvIntensity;
    vec3 dir = -V;
    vec3 T;
    // Does the eye ray cross the water surface beyond this pane (dry pane above the waterline,
    // or a wet pane looked through from below the surface)?
    vec3 S = vec3(0.0);
    bool waterBehind = false;
    if (abs(dir.y) > 1e-4) {
      float th = (uWaterLevel - vWorld.y) / dir.y;
      if (th > 0.0) {
        S = vWorld + dir * th;
        waterBehind = S.x > uInner.x && S.x < uInner.y && S.z > uInner.z && S.z < uInner.w;
      }
    }
    if (waterBehind) {
      float sDepth = -((viewMatrix * vec4(S, 1.0)).z);
      T = shadeWaterSurface(S, V, suv, sDepth);
    } else {
      float paneDepth = -vView.z;
      float bgDepth = texture2D(uSceneCopy, suv).a;
      // Thin-pane refraction: the ray bends inside the glass, then continues straight.
      vec3 R = refract(-V, N, 1.0 / ${GLASS_IOR.toFixed(2)});
      vec3 Rv = normalize((viewMatrix * vec4(R, 0.0)).xyz);
      vec3 dv = (viewMatrix * vec4(dir, 0.0)).xyz;
      float path = clamp(bgDepth - paneDepth, 0.0, uMaxPath);
      float tIn = min(uThickness / max(-dv.z, 0.15), path);
      vec3 q = vView + Rv * (tIn / max(-Rv.z, 0.1)) + dv * ((path - tIn) / max(-dv.z, 0.15));
      vec4 cp = uProj * vec4(q, 1.0);
      vec2 cand = cp.xy / cp.w * 0.5 + 0.5;
      vec2 m = edgeFade(cand, 0.01);
      cand = mix(suv, cand, m.x * m.y);
      if (texture2D(uSceneCopy, cand).a < paneDepth + 0.02) cand = suv;
      vec3 bg = texture2D(uSceneCopy, cand).rgb;
      // Light reached this pane through water when the pane is below the waterline.
      float wet = 1.0 - step(uWaterLevel, vWorld.y);
      vec3 atten = exp(-uAbsorb * (wet * path));
      T = bg * atten + uScatter * (1.0 - atten.r);
    }
    col = T * (1.0 - R) * vec3(0.972, 0.998, 0.988) + env * R;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const WATER_VS = /* glsl */`
${WATER_GLSL}
varying vec3 vWorld;
varying vec3 vView;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y += waveHeight(wp.xz, uTime);
  vWorld = wp.xyz;
  vec4 vp = viewMatrix * wp;
  vView = vp.xyz;
  gl_Position = projectionMatrix * vp;
}`;

const WATER_FS = /* glsl */`
${WATER_GLSL}
${OPTIC_COMMON_GLSL}
varying vec3 vWorld;
varying vec3 vView;
void main() {
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec3 V = normalize(cameraPosition - vWorld);
  gl_FragColor = vec4(shadeWaterSurface(vWorld, V, suv, -vView.z), 1.0);
}`;

function paneMaterial(shared, mainNormal, thickness) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uMainNormal: { value: mainNormal.clone() }, uEntry: { value: 1 }, uThickness: { value: thickness } },
    vertexShader: PANE_VS,
    fragmentShader: PANE_FS,
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: true,
  });
}

function createTank(optics) {
  const group = new THREE.Group();
  group.name = 'tank';
  const shared = optics.shared;
  const { w, h, d, t } = TANK;
  const panes = [];

  // --- five glass panels ---------------------------------------------------------------------
  const addPane = (name, geo, pos, mainNormal, outward) => {
    const mesh = new THREE.Mesh(geo, paneMaterial(shared, mainNormal, t));
    mesh.name = name;
    mesh.position.copy(pos);
    mesh.renderOrder = 1;
    group.add(mesh);
    panes.push(mesh);
    optics.addOptic(mesh, pos.clone(), outward);
    return mesh;
  };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  addPane('glass-front', new THREE.BoxGeometry(w, h, t), V3(0, h / 2, TANK.zMax - t / 2), V3(0, 0, 1), V3(0, 0, 1));
  addPane('glass-back', new THREE.BoxGeometry(w, h, t), V3(0, h / 2, TANK.zMin + t / 2), V3(0, 0, 1), V3(0, 0, -1));
  addPane('glass-left', new THREE.BoxGeometry(t, h, d - 2 * t), V3(TANK.xMin + t / 2, h / 2, 0), V3(1, 0, 0), V3(-1, 0, 0));
  addPane('glass-right', new THREE.BoxGeometry(t, h, d - 2 * t), V3(TANK.xMax - t / 2, h / 2, 0), V3(1, 0, 0), V3(1, 0, 0));
  addPane('glass-bottom', new THREE.BoxGeometry(w, t, d), V3(0, -t / 2, 0), V3(0, 1, 0), V3(0, -1, 0));

  // --- silicone seams in the inner vertical corners -----------------------------------------
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x161c20, roughness: 0.55, metalness: 0.05, transparent: true, opacity: 0.92 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.045, h - 0.05, 0.045), seamMat);
    seam.position.set(sx * (Math.abs(TANK.ixMin) - 0.022), (h - 0.05) / 2, sz * (TANK.izMax - 0.022));
    seam.renderOrder = 4;
    group.add(seam);
  }

  // --- water surface ---------------------------------------------------------------------------
  const waterGeo = new THREE.PlaneGeometry(TANK.ixMax - TANK.ixMin, TANK.izMax - TANK.izMin, 180, 90);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: WATER_VS,
    fragmentShader: WATER_FS,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.name = 'water-surface';
  water.position.set(0, TANK.waterLevel, 0);
  water.frustumCulled = false;
  water.renderOrder = 2;
  group.add(water);
  optics.addOptic(water, V3(0, TANK.waterLevel, 0), V3(0, 1, 0));

  // --- waterline: a thin bright meniscus line against each pane -----------------------------
  const lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.42, 0.66, 0.74), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const lineH = 0.035;
  const lines = [
    [TANK.ixMax - TANK.ixMin, lineH, 0, TANK.waterLevel + 0.012, TANK.izMax - 0.004],
    [TANK.ixMax - TANK.ixMin, lineH, 0, TANK.waterLevel + 0.012, TANK.izMin + 0.004],
    [TANK.izMax - TANK.izMin, lineH, TANK.ixMin + 0.004, TANK.waterLevel + 0.012, 0, true],
    [TANK.izMax - TANK.izMin, lineH, TANK.ixMax - 0.004, TANK.waterLevel + 0.012, 0, true],
  ];
  for (const [lw, lh, x, y, z, rotY] of lines) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(lw, lh), lineMat);
    line.position.set(x, y, z);
    if (rotY) line.rotation.y = Math.PI / 2;
    line.renderOrder = 5;
    group.add(line);
  }

  // --- bottom frame (matte black, slightly proud of the glass) and narrow upper rim ---------
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x121417, roughness: 0.72, metalness: 0.25, envMapIntensity: 0.5 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x0f1114, roughness: 0.5, metalness: 0.45, envMapIntensity: 0.7 });
  const frame = new THREE.Group();
  frame.name = 'frame';
  const fw = 0.16, fh = 0.44, fy = 0.07 - fh / 2;      // top of frame 0.07 above the inner floor
  const ox = w / 2 + 0.035, oz = d / 2 + 0.035;        // outer frame extents
  const bar = (sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), frameMat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; frame.add(m); };
  bar(w + 0.07, fh, fw, 0, fy, oz - fw / 2);
  bar(w + 0.07, fh, fw, 0, fy, -oz + fw / 2);
  bar(fw, fh, d + 0.07 - 2 * fw, ox - fw / 2, fy, 0);
  bar(fw, fh, d + 0.07 - 2 * fw, -ox + fw / 2, fy, 0);
  bar(w + 0.07, 0.05, d + 0.07, 0, fy - fh / 2 + 0.025, 0);   // plate under the bottom pane
  // upper rim: four slim bars capping the glass edges
  const rw = 0.14, rh = 0.16, ry = h - 0.06 + rh / 2;      // overlaps the top 0.06 of the glass
  const rbar = (sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), rimMat); m.position.set(x, y, z); m.castShadow = true; frame.add(m); };
  rbar(w + 0.06, rh, rw, 0, ry, d / 2 + 0.03 - rw / 2);
  rbar(w + 0.06, rh, rw, 0, ry, -d / 2 - 0.03 + rw / 2);
  rbar(rw, rh, d - 2 * rw + 0.06, w / 2 + 0.03 - rw / 2, ry, 0);
  rbar(rw, rh, d - 2 * rw + 0.06, -w / 2 - 0.03 + rw / 2, ry, 0);
  group.add(frame);

  return { group, panes, water, frame };
}
