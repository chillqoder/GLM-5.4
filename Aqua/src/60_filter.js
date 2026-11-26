// Stage 3 — black internal sponge filter with airlift, airline hose, and its bubble plume.

function buildSpongeGeometry(half, height, grooves = 7) {
  const rings = 48, radial = 56, n = 4.5;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= rings; j++) {
    const v = j / rings, y = v * height;
    const groove = 1 - 0.05 * Math.pow(0.5 + 0.5 * Math.cos(v * Math.PI * 2 * grooves), 1.5);
    const taper = 1 - 0.10 * smoothstep(0.9, 1.0, v);
    for (let i = 0; i <= radial; i++) {
      const u = i / radial, a = u * TWO_PI;
      const ca = Math.cos(a), sa = Math.sin(a);
      const r = half * groove * taper / Math.pow(Math.pow(Math.abs(ca), n) + Math.pow(Math.abs(sa), n), 1 / n);
      pos.push(r * ca, y, r * sa); uv.push(u, v);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < radial; i++) {
    const a = j * (radial + 1) + i, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const center = pos.length / 3; pos.push(0, height, 0); uv.push(0.5, 1);
  const topStart = rings * (radial + 1);
  for (let i = 0; i < radial; i++) idx.push(center, topStart + i, topStart + i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Rescales box / cylinder UVs so that one texture tile spans one world unit on every part.
function applyUnitUV(geometry, kind) {
  geometry.computeBoundingBox();
  const s = new THREE.Vector3(); geometry.boundingBox.getSize(s);
  const uv = geometry.attributes.uv;
  if (kind === 'cyl') {
    const circ = Math.PI * (s.x + s.z);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * s.y);
  } else {
    // BoxGeometry vertex order: +x, -x, +y, -y, +z, -z (4 vertices each)
    const dims = [[s.z, s.y], [s.z, s.y], [s.x, s.z], [s.x, s.z], [s.x, s.y], [s.x, s.y]];
    for (let i = 0; i < uv.count; i++) { const f = Math.floor(i / 4) % 6; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
  }
  uv.needsUpdate = true;
  return geometry;
}

const FILTER_OUTLET_LOCAL = new THREE.Vector3(-0.33, 2.15, 0);

function createFilter(parent, env) {
  const group = new THREE.Group();
  group.name = 'filter';
  const plastic = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.42, metalness: 0.2, envMapIntensity: 0.8 });
  const sponge = new THREE.MeshStandardMaterial({ color: 0x4a4a4e, roughness: 0.96, metalness: 0, map: spongeTexture(256, 5) });
  enhanceMaterial(plastic, { id: 'filter-plastic', caustics: 0.7 });
  enhanceMaterial(sponge, { id: 'filter-sponge', caustics: 0.9 });

  const add = (geo, mat, x, y, z, rot) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m); return m;
  };
  // weighted base, sponge body, top plate
  add(new THREE.BoxGeometry(0.64, 0.1, 0.64), plastic, 0, 0.05, 0);
  add(buildSpongeGeometry(0.25, 0.92), sponge, 0, 0.1, 0);
  add(new THREE.CylinderGeometry(0.27, 0.27, 0.06, 32), plastic, 0, 1.05, 0);
  // airlift tube + elbow + horizontal outlet
  add(new THREE.CylinderGeometry(0.055, 0.055, 1.0, 24), plastic, 0, 1.55, 0);
  add(new THREE.TorusGeometry(0.1, 0.055, 16, 18, Math.PI / 2), plastic, -0.1, 2.05, 0);
  add(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 24), plastic, -0.21, 2.15, 0, [0, 0, Math.PI / 2]);
  const lip = add(new THREE.RingGeometry(0.036, 0.058, 24), plastic, -0.321, 2.15, 0, [0, -Math.PI / 2, 0]);
  lip.castShadow = false;
  const bore = new THREE.Mesh(new THREE.CircleGeometry(0.036, 24), new THREE.MeshBasicMaterial({ color: 0x040506 }));
  bore.rotation.y = -Math.PI / 2; bore.position.set(-0.30, 2.15, 0);
  group.add(bore);
  // airline nipple on the tube
  add(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 10), plastic, 0.08, 1.12, 0, [0, 0, -Math.PI / 2 + 0.35]);

  const outlet = new THREE.Object3D();
  outlet.position.copy(FILTER_OUTLET_LOCAL);
  group.add(outlet);

  // placement
  const fx = LAYOUT.filter.x, fz = LAYOUT.filter.z;
  const baseY = substrateHeight(fx, fz) - 0.02;
  group.position.set(fx, baseY, fz);
  group.rotation.y = 0.35;
  group.updateMatrixWorld(true);
  parent.add(group);
  group.updateMatrixWorld(true);

  // airline hose routed in world space: up the tube, along the back glass, over the rear rim.
  const nipple = group.localToWorld(new THREE.Vector3(0.12, 1.12, 0));
  const glassZ = TANK.izMin + 0.022;          // hose radius 0.02 against the inner face
  const hx = nipple.x;
  const pts = [
    nipple,
    new THREE.Vector3(hx + 0.02, 1.45, nipple.z - 0.02),
    new THREE.Vector3(hx, 2.3, fz - 0.25),
    new THREE.Vector3(hx, 2.95, fz - 0.55),
    new THREE.Vector3(hx, 3.4, glassZ),
    new THREE.Vector3(hx, 4.3, glassZ),
    new THREE.Vector3(hx, 4.95, glassZ + 0.03),
    new THREE.Vector3(hx, 5.18, glassZ - 0.02),
    new THREE.Vector3(hx, 5.22, glassZ - 0.12),
    new THREE.Vector3(hx, 5.0, glassZ - 0.17),
    new THREE.Vector3(hx, 4.2, glassZ - 0.17),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const hoseMat = new THREE.MeshStandardMaterial({ color: 0x6b737a, roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.9 });
  const hose = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.02, 10, false), hoseMat);
  hose.castShadow = true;
  parent.add(hose);
  // suction cups holding the hose to the glass
  const cupMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.3, metalness: 0.0, transparent: true, opacity: 0.8 });
  for (const cy of [3.7, 4.5]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.025, 20), cupMat);
    cup.rotation.x = Math.PI / 2;
    cup.position.set(hx, cy, TANK.izMin + 0.0125);
    parent.add(cup);
    const clip = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 8, 16), cupMat);
    clip.position.set(hx, cy, glassZ);
    parent.add(clip);
  }

  // bubbles leave the outlet along its axis
  const outletWorld = new THREE.Vector3();
  outlet.getWorldPosition(outletWorld);
  const outletDir = new THREE.Vector3(-1, 0.25, 0).normalize().transformDirection(group.matrixWorld);
  PLUME.copy(outletWorld);
  SIM_UNIFORMS.uPlume.value.copy(PLUME);

  // collision volume for fish / crab
  const obstacle = new THREE.Box3().setFromObject(group).expandByScalar(0.12);

  return { group, outlet, outletWorld, outletDir, obstacle };
}

