// Stage 4 — substrate layer, instanced pebble bed and larger accent stones.

function makePebbleGeometry(seed, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const noise = makeNoise2D(seed);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm(noise, v.x * 1.2 + v.z * 0.6 + 4, v.y * 1.1 + v.z * 0.9 + 7, 3);
    const r = 1 + 0.13 * n;
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  const merged = BufferGeometryUtils.mergeVertices(g, 1e-4);
  merged.computeVertexNormals();
  g.dispose();
  return merged;
}

function weightedPick(rng, items, weights) {
  let r = rng.float(), acc = 0;
  for (let i = 0; i < items.length; i++) { acc += weights[i]; if (r <= acc) return items[i]; }
  return items[items.length - 1];
}

const ACCENT_STONES = [];   // { x, z, cy, r, ry } — also used by the simplified ground query

function createPebbleBed(parent) {
  const rng = new Rng(4242);
  const innerW = TANK.ixMax - TANK.ixMin, innerD = TANK.izMax - TANK.izMin;

  // --- continuous substrate layer ---------------------------------------------------------------
  const subGeo = new THREE.PlaneGeometry(innerW, innerD, 150, 76);
  subGeo.rotateX(-Math.PI / 2);
  const sp = subGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setY(i, substrateHeight(sp.getX(i), sp.getZ(i)));
  subGeo.computeVertexNormals();
  const subMat = new THREE.MeshStandardMaterial({ map: gravelTexture(512, 3), color: 0xb8aa94, roughness: 0.95, metalness: 0 });
  enhanceMaterial(subMat, { id: 'substrate', caustics: 1.0 });
  const substrate = new THREE.Mesh(subGeo, subMat);
  substrate.name = 'substrate';
  substrate.receiveShadow = true;
  parent.add(substrate);

  // --- pebbles ------------------------------------------------------------------------------------
  const shapes = [];
  for (let i = 0; i < 6; i++) shapes.push(makePebbleGeometry(100 + i, 2));
  const mottle = mottleTexture(256, 3, { lo: 0.72, hi: 1.06 });
  const pebbleMat = new THREE.MeshStandardMaterial({ map: mottle, roughness: 0.8, metalness: 0.02 });
  enhanceMaterial(pebbleMat, {
    id: 'pebble', caustics: 1.0,
    vertexHead: 'varying float vLocalY;', vertexBody: 'vLocalY = position.y;',
    fragmentHead: 'varying float vLocalY;',
    // baked contact darkening toward each stone's underside
    fragmentColor: 'diffuseColor.rgb *= mix(0.42, 1.0, smoothstep(-1.0, 0.35, vLocalY));',
  });
  const palette = [[0.80, 0.72, 0.60], [0.54, 0.56, 0.59], [0.23, 0.24, 0.26], [0.50, 0.40, 0.31], [0.88, 0.86, 0.80], [0.66, 0.59, 0.50]];
  const weights = [0.28, 0.22, 0.12, 0.18, 0.08, 0.12];
  const target = 560, perShape = Math.ceil(target / shapes.length);
  const meshes = shapes.map((geo) => {
    const im = new THREE.InstancedMesh(geo, pebbleMat, perShape);
    im.castShadow = true; im.receiveShadow = true; im.name = 'pebbles';
    parent.add(im);
    return im;
  });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  const placed = [];
  const perMeshCount = new Array(shapes.length).fill(0);
  let count = 0, tries = 0;
  while (count < target && tries < 40000) {
    tries++;
    const x = rng.range(TANK.ixMin + 0.06, TANK.ixMax - 0.06), z = rng.range(TANK.izMin + 0.06, TANK.izMax - 0.06);
    const baseR = rng.float() < 0.12 ? rng.range(0.11, 0.15) : rng.range(0.045, 0.1);
    let ok = true;
    for (let k = 0; k < placed.length; k++) {
      const o = placed[k];
      if (Math.hypot(o.x - x, o.z - z) < (o.r + baseR) * 0.78) { ok = false; break; }
    }
    if (!ok) continue;
    placed.push({ x, z, r: baseR });
    const sy = baseR * rng.range(0.5, 0.75), sx = baseR * rng.range(0.85, 1.1), sz = baseR * rng.range(0.8, 1.1);
    p.set(x, substrateHeight(x, z) + sy * 0.32, z);     // settled into the substrate
    e.set(rng.range(0, Math.PI), rng.range(0, Math.PI), rng.range(0, Math.PI)); q.setFromEuler(e); s.set(sx, sy, sz);
    m.compose(p, q, s);
    const mi = count % shapes.length, idx = Math.floor(count / shapes.length);
    meshes[mi].setMatrixAt(idx, m);
    const col = weightedPick(rng, palette, weights);
    c.setRGB(col[0], col[1], col[2]).multiplyScalar(rng.range(0.85, 1.12));
    meshes[mi].setColorAt(idx, c);
    perMeshCount[mi]++;
    count++;
  }
  for (let i = 0; i < meshes.length; i++) {
    meshes[i].count = perMeshCount[i];
    meshes[i].instanceMatrix.needsUpdate = true;
    if (meshes[i].instanceColor) meshes[i].instanceColor.needsUpdate = true;
  }

  // --- larger accent stones (placed by layout, kept off the creature routes) -------------------
  const stoneMat = new THREE.MeshStandardMaterial({ map: mottleTexture(256, 8, { lo: 0.6, hi: 1.05, tint: [0.9, 0.95, 1.0] }), roughness: 0.85, metalness: 0.02 });
  enhanceMaterial(stoneMat, { id: 'stone', caustics: 1.0, vertexHead: 'varying float vLocalY;', vertexBody: 'vLocalY = position.y;', fragmentHead: 'varying float vLocalY;', fragmentColor: 'diffuseColor.rgb *= mix(0.45, 1.0, smoothstep(-1.0, 0.3, vLocalY));' });
  const bigShape = makePebbleGeometry(777, 3);
  const stoneMesh = new THREE.InstancedMesh(bigShape, stoneMat, LAYOUT.stones.length);
  stoneMesh.castShadow = true; stoneMesh.receiveShadow = true; stoneMesh.name = 'accent-stones';
  const stonePalette = [[0.56, 0.58, 0.6], [0.36, 0.37, 0.39], [0.68, 0.62, 0.54], [0.72, 0.70, 0.66]];
  LAYOUT.stones.forEach((st, i) => {
    const ry = st.r * st.squash;
    const h = substrateHeight(st.x, st.z);
    const cy = h + ry * 0.55;
    p.set(st.x, cy, st.z);
    e.set(rng.range(-0.2, 0.2), rng.range(0, Math.PI), rng.range(-0.2, 0.2)); q.setFromEuler(e);
    s.set(st.r, ry, st.r * rng.range(0.85, 1.0));
    m.compose(p, q, s);
    stoneMesh.setMatrixAt(i, m);
    const col = stonePalette[i % stonePalette.length];
    stoneMesh.setColorAt(i, c.setRGB(col[0], col[1], col[2]));
    ACCENT_STONES.push({ x: st.x, z: st.z, cy, r: st.r, ry, index: i });
  });
  stoneMesh.instanceMatrix.needsUpdate = true;
  stoneMesh.instanceColor.needsUpdate = true;
  parent.add(stoneMesh);

  return { substrate, meshes, count, stoneMesh };
}

// Simplified ground surface for bottom animals: substrate plus the tops of the accent stones.
function groundHeightAt(x, z) {
  let h = substrateHeight(x, z);
  for (let i = 0; i < ACCENT_STONES.length; i++) {
    const st = ACCENT_STONES[i];
    const dx = x - st.x, dz = z - st.z;
    const rr = st.r * 0.95;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr) {
      const top = st.cy + st.ry * Math.sqrt(1 - d2 / (rr * rr));
      if (top > h) h = top;
    }
  }
  return h;
}
