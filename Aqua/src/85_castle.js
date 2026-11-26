// Stage 5 — a weathered miniature stone castle ornament with a real arched gateway.

function weatherCylinder(geo, amount, seed) {
  const noise = makeNoise2D(seed);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const n = fbm(noise, Math.cos(a) * 2 + 3, v.y * 3 + Math.sin(a) * 2, 2);
    const k = 1 + amount * n;
    pos.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function createCastle(parent) {
  const group = new THREE.Group();
  group.name = 'castle';
  const stainNoise = makeNoise2D(555);
  const tex = stoneTexture(1024, 512, 11, { courses: 7, hue: 36, sat: 9, light: 54 });
  const stone = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0, vertexColors: true });
  const stonePlain = new THREE.MeshStandardMaterial({ color: 0x9a9282, roughness: 0.9, metalness: 0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17150f, roughness: 0.95, metalness: 0 });
  enhanceMaterial(stone, { id: 'castle-stone', caustics: 1.0 });
  enhanceMaterial(stonePlain, { id: 'castle-plain', caustics: 1.0 });
  enhanceMaterial(dark, { id: 'castle-dark', caustics: 0.25 });

  const tmpColor = new THREE.Color();
  const stainBase = new THREE.Color(0.60, 0.76, 0.56);
  // Greenish / damp staining climbing up from the base, blotchy through noise.
  function applyStain(geo, baseY, height) {
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) + baseY;
      const n = 0.5 + 0.5 * fbm(stainNoise, pos.getX(i) * 3.1 + pos.getZ(i) * 2.3, y * 3.5 + 2, 2);
      const t = smoothstep(Math.min(0.9, height * 0.6), 0.02, y);
      tmpColor.setRGB(1, 1, 1).lerp(stainBase, t * (0.5 + 0.5 * n) * 0.8);
      col[i * 3] = tmpColor.r; col[i * 3 + 1] = tmpColor.g; col[i * 3 + 2] = tmpColor.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const parts = [];
  const addMesh = (geo, mat, x, y, z, ry = 0, height = 1) => {
    applyStain(geo, y, height);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m); parts.push(m);
    return m;
  };
  const box = (w, h, d) => applyUnitUV(new THREE.BoxGeometry(w, h, d), 'box');
  const cyl = (rt, rb, h, seg = 16, seed = 1) => weatherCylinder(applyUnitUV(new THREE.CylinderGeometry(rt, rb, h, seg, 6), 'cyl'), 0.012, seed);

  const Y0 = 0.22;   // top of the foundation slab
  // foundation slab, partly buried by the pebbles
  addMesh(box(2.7, 0.3, 2.0), stone, 0, 0.15, 0, 0, 0.3);

  // --- curtain wall with a true arched opening (the hole is cut into the extruded shape) -----
  const shape = new THREE.Shape();
  shape.moveTo(-1.25, 0); shape.lineTo(1.25, 0); shape.lineTo(1.25, 1.08); shape.lineTo(-1.25, 1.08); shape.closePath();
  const GX = 0.18, GW = 0.21, GH = 0.52;
  const gate = new THREE.Path();
  gate.moveTo(GX - GW, 0); gate.lineTo(GX - GW, GH);
  gate.absarc(GX, GH, GW, Math.PI, 0, true);
  gate.lineTo(GX + GW, 0); gate.closePath();
  shape.holes.push(gate);
  const wallGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.26, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.014, bevelSegments: 2, curveSegments: 18 });
  const frontWall = addMesh(wallGeo, stone, 0, Y0, 0.6, 0, 1.08);
  for (let i = 0; i < 7; i++) addMesh(box(0.18, 0.16, 0.26), stone, -1.17 + 0.09 + i * 0.36, Y0 + 1.08 + 0.08, 0.73, 0, 0.16);

  // --- towers --------------------------------------------------------------------------------------
  const crenellate = (cx, cz, radius, topY, n, w = 0.14, h = 0.2) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TWO_PI;
      addMesh(box(w, h, 0.11), stone, cx + Math.cos(a) * radius, topY + h / 2, cz + Math.sin(a) * radius, -a + Math.PI / 2, h);
    }
  };
  // keep (tallest), with a flared corbel ring under the battlement
  addMesh(cyl(0.44, 0.46, 0.3, 16, 1), stone, -0.55, Y0 + 0.15, -0.15, 0, 0.3);
  addMesh(cyl(0.41, 0.44, 1.95, 16, 2), stone, -0.55, Y0 + 0.3 + 0.975, -0.15, 0, 1.95);
  addMesh(cyl(0.49, 0.41, 0.12, 16, 3), stone, -0.55, Y0 + 2.25 + 0.06, -0.15, 0, 0.12);
  crenellate(-0.55, -0.15, 0.43, Y0 + 2.37, 10);
  // right tower
  addMesh(cyl(0.33, 0.36, 0.3, 14, 4), stone, 0.9, Y0 + 0.15, 0.15, 0, 0.3);
  addMesh(cyl(0.31, 0.34, 1.45, 14, 5), stone, 0.9, Y0 + 0.3 + 0.725, 0.15, 0, 1.45);
  addMesh(cyl(0.37, 0.31, 0.1, 14, 6), stone, 0.9, Y0 + 1.75 + 0.05, 0.15, 0, 0.1);
  crenellate(0.9, 0.15, 0.32, Y0 + 1.85, 8);
  // left-rear tower
  addMesh(cyl(0.3, 0.33, 0.3, 14, 7), stone, -1.0, Y0 + 0.15, -0.6, 0, 0.3);
  addMesh(cyl(0.28, 0.31, 1.15, 14, 8), stone, -1.0, Y0 + 0.3 + 0.575, -0.6, 0, 1.15);
  addMesh(cyl(0.34, 0.28, 0.1, 14, 9), stone, -1.0, Y0 + 1.45 + 0.05, -0.6, 0, 0.1);
  crenellate(-1.0, -0.6, 0.29, Y0 + 1.55, 8);

  // --- connecting walls ------------------------------------------------------------------------------
  addMesh(box(1.9, 0.95, 0.22), stone, -0.1, Y0 + 0.475, -0.88, 0, 0.95);
  for (let i = 0; i < 5; i++) addMesh(box(0.18, 0.15, 0.22), stone, -0.9 + 0.09 + i * 0.42, Y0 + 0.95 + 0.075, -0.88, 0, 0.15);
  addMesh(box(0.22, 0.7, 1.05), stone, -1.14, Y0 + 0.35, 0.0, 0, 0.7);      // ruined west wall
  addMesh(box(0.2, 0.3, 0.3), stone, -1.14, Y0 + 0.85, -0.3, 0.2, 0.3);     // broken stub
  addMesh(box(0.22, 0.82, 0.5), stone, 1.14, Y0 + 0.41, 0.32, 0, 0.82);      // east wall to the gate wall

  // --- recessed arched windows: a dark arch inside a lighter stone frame ---------------------------
  function archShape(w, h) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - w / 2);
    s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false);
    s.lineTo(-w / 2, 0);
    return s;
  }
  const frameGeo = new THREE.ShapeGeometry(archShape(0.16, 0.28), 10);
  const paneGeo = new THREE.ShapeGeometry(archShape(0.1, 0.22), 10);
  const windows = [
    [-0.55, -0.15, 0.41, 0.0, 0.95], [-0.55, -0.15, 0.41, 1.3, 1.35], [-0.55, -0.15, 0.41, 2.6, 1.75], [-0.55, -0.15, 0.41, 4.1, 1.1],
    [0.9, 0.15, 0.31, 0.5, 0.75], [0.9, 0.15, 0.31, 2.3, 1.2], [0.9, 0.15, 0.31, 4.4, 0.95],
    [-1.0, -0.6, 0.28, 1.0, 0.7], [-1.0, -0.6, 0.28, 3.4, 1.1],
  ];
  for (const [cx, cz, r, ang, y] of windows) {
    const nx = Math.cos(ang), nz = Math.sin(ang);
    const frame = new THREE.Mesh(frameGeo, stonePlain);
    frame.position.set(cx + nx * (r + 0.002), Y0 + y - 0.03, cz + nz * (r + 0.002));
    frame.rotation.y = -ang + Math.PI / 2;
    const pane = new THREE.Mesh(paneGeo, dark);
    pane.position.set(cx + nx * (r + 0.006), Y0 + y, cz + nz * (r + 0.006));
    pane.rotation.y = -ang + Math.PI / 2;
    group.add(frame, pane);
  }

  // --- placement and collision volumes ---------------------------------------------------------------
  const L = LAYOUT.castle;
  group.position.set(L.x, substrateHeight(L.x, L.z) - 0.12, L.z);
  group.rotation.y = L.rotY;
  parent.add(group);
  group.updateMatrixWorld(true);

  const localBoxes = [
    [-1.0, -0.15, 0.92, 2.7, 0.92],          // keep
    [0.9, 0.15, 0.74, 2.2, 0.74],            // right tower
    [-1.0, -0.6, 0.68, 1.9, 0.68],           // left tower
    [-0.1, -0.88, 1.9, 1.1, 0.22],           // rear wall
    [-1.14, 0.0, 0.22, 1.0, 1.05],           // west wall
    [1.14, 0.32, 0.22, 1.1, 0.5],            // east wall
    [-0.64, 0.73, 1.22, 1.4, 0.26],          // gate wall, west of the opening
    [0.82, 0.73, 0.86, 1.4, 0.26],           // gate wall, east of the opening
  ];
  const obstacles = localBoxes.map(([cx, cz, w, h, d]) => new THREE.Box3(
    new THREE.Vector3(cx - w / 2, 0, cz - d / 2), new THREE.Vector3(cx + w / 2, h, cz + d / 2)
  ).applyMatrix4(group.matrixWorld));

  return { group, obstacles, parts, gate: { x: GX, z: 0.73, halfWidth: GW, height: GH + GW } };
}
