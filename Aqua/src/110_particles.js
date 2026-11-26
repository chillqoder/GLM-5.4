// Suspended particles: a few hundred faint specks that reveal depth and the shared current.
function createParticles(parent, count = 260) {
  const rng = new Rng(808);
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rng.range(TANK.ixMin + 0.1, TANK.ixMax - 0.1);
    pos[i * 3 + 1] = rng.range(0.5, TANK.waterLevel - 0.15);
    pos[i * 3 + 2] = rng.range(TANK.izMin + 0.1, TANK.izMax - 0.1);
    seed[i] = rng.float();
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: SIM_UNIFORMS.uTime, uMap: { value: softDiscTexture(64) }, uSize: { value: 2.4 }, uPixelRatio: { value: 1 }, uOpacity: { value: 0.42 } },
    vertexShader: /* glsl */`
      uniform float uTime;
      uniform float uSize;
      uniform float uPixelRatio;
      attribute float aSeed;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * mv;
        float tw = 0.55 + 0.45 * sin( uTime * 0.8 + aSeed * 30.0 );
        gl_PointSize = uSize * uPixelRatio * ( 0.6 + 0.4 * aSeed ) * tw * ( 6.0 / max( -mv.z, 0.5 ) );
        vA = tw;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      uniform float uOpacity;
      varying float vA;
      void main() {
        float a = texture2D( uMap, gl_PointCoord ).a;
        gl_FragColor = vec4( vec3( 0.85, 0.95, 1.0 ), a * uOpacity * vA );
      }`,
    transparent: true, depthWrite: false, depthTest: true,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'particles';
  points.frustumCulled = false;
  points.renderOrder = 21;
  parent.add(points);
  const v = new THREE.Vector3();
  SIM.add((dt, t) => {
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      currentField(pos[i3], pos[i3 + 1], pos[i3 + 2], t, v);
      // a private slow drift keeps the specks from moving in lockstep
      v.x += 0.01 * Math.sin(t * 0.4 + seed[i] * 20.0);
      v.y += 0.006 * Math.cos(t * 0.3 + seed[i] * 11.0);
      v.z += 0.01 * Math.cos(t * 0.35 + seed[i] * 7.0);
      pos[i3] += v.x * dt; pos[i3 + 1] += v.y * dt; pos[i3 + 2] += v.z * dt;
      if (pos[i3 + 1] > TANK.waterLevel - 0.12) pos[i3 + 1] = 0.45;
      if (pos[i3 + 1] < 0.4) pos[i3 + 1] = TANK.waterLevel - 0.15;
      if (pos[i3] > TANK.ixMax - 0.08) pos[i3] = TANK.ixMin + 0.08; else if (pos[i3] < TANK.ixMin + 0.08) pos[i3] = TANK.ixMax - 0.08;
      if (pos[i3 + 2] > TANK.izMax - 0.08) pos[i3 + 2] = TANK.izMin + 0.08; else if (pos[i3 + 2] < TANK.izMin + 0.08) pos[i3 + 2] = TANK.izMax - 0.08;
    }
    posAttr.needsUpdate = true;
  });
  return points;
}
