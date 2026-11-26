// Model inspector (development only): dev/preview.html?m=<model>&t=<seconds>&az=&polar=&dist=
// Renders a single asset with the production lighting and optics pipeline so it can be inspected
// on its own before its behaviour is integrated into the scene.
(function startPreview() {
  const params = new URLSearchParams((location.search || '').replace(/^\?/, ''));
  const hash = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const get = (k, d) => (params.has(k) ? params.get(k) : hash.has(k) ? hash.get(k) : d);
  const num = (k, d) => (get(k, null) === null ? d : parseFloat(get(k)));
  const what = get('m', 'tank');
  const container = document.getElementById('stage');
  const renderer = createRenderer(container);
  const scene = new THREE.Scene();
  const camera = createCamera();
  camera.fov = num('fov', 30);
  camera.near = 0.05; camera.far = 220;
  camera.updateProjectionMatrix();
  const controls = createControls(camera, renderer.domElement);
  controls.minDistance = 0.3; controls.maxDistance = 80; controls.minPolarAngle = 0.05; controls.maxPolarAngle = 1.56;
  const lights = createLights(scene);
  const env = createStudioEnvironment(renderer, scene);
  const optics = new OpticsPipeline(renderer, scene, camera, env);
  optics.useBloom = get('bloom', '1') === '1';
  scene.add(createDome(60));

  if (what !== 'tank') {
    // neutral ground for close inspection
    const ground = new THREE.Mesh(new THREE.CircleGeometry(14, 48), new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.92 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
    scene.add(ground);
  }
  const root = new THREE.Group();
  scene.add(root);
  const ctx = { optics, scene, env, lights, renderer, get, num };
  let info = buildPreviewModel(what, root, ctx) || {};

  // advance the simulation to the requested pose
  const T = num('t', 2);
  const steps = Math.round(T * 30);
  for (let i = 0; i < steps; i++) { SIM.step(1 / 30); updateRipples(SIM.time); }
  SIM_UNIFORMS.uTime.value = SIM.time;
  const animate = get('anim', '0') === '1';

  // frame the object
  const box = new THREE.Box3().setFromObject(root);
  const sphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 5) : box.getBoundingSphere(new THREE.Sphere());
  const target = get('tx', null) !== null ? new THREE.Vector3(num('tx', 0), num('ty', 0), num('tz', 0)) : sphere.center.clone();
  const dist = num('dist', sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.12);
  const sph = new THREE.Spherical(dist, num('polar', 1.25), num('az', 0.6));
  camera.position.setFromSpherical(sph).add(target);
  controls.target.copy(target);
  controls.update();

  function resize() {
    const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    optics.setSize(w, h, renderer.getPixelRatio());
  }
  window.addEventListener('resize', resize);
  resize();

  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    const raw = clock.getDelta();
    if (animate && !SIM.paused) {
      SIM.step(Math.min(raw, 0.05));
      updateRipples(SIM.time);
      SIM_UNIFORMS.uTime.value = SIM.time;
    }
    controls.update();
    optics.render(SIM.time);
  }
  frame();

  const r = renderer.info.render;
  document.getElementById('preview-info').textContent =
    `${what}  t=${SIM.time.toFixed(2)}s  r=${sphere.radius.toFixed(2)}\ncalls=${r.calls} tris=${r.triangles}  ${JSON.stringify(info, (k, v) => (k === 'bubbles' ? (v ? 'alive=' + v.alive : null) : v))}`;
  document.getElementById('boot').classList.add('gone');
  window.__aquariumReady = true;
  window.__preview = { APP, SIM, SIM_UNIFORMS, renderer, scene, camera, controls, optics, root, info, what, world: ctx.world };
})();

// Temporary optics probes (Stage 2 acceptance): striped/coloured shapes whose edges reveal distortion.
function addOpticsTestShapes(parent) {
  const g = new THREE.Group();
  const y0 = 0.2;
  const colors = [0xe84a3a, 0xf2b134, 0x3bb273, 0x3d7be0, 0xd9d9d9, 0x111111];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.5 }));
    m.position.set(-3.3 + i * 0.5, y0 + 0.25 + (i % 3) * 0.5, -0.6 + (i % 2) * 1.2);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    m.position.set(-3.0 + i * 1.2, 2.1, 0.0);
    g.add(m);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(7.8, 3.8), new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; floor.receiveShadow = true;
  g.add(floor);
  parent.add(g);
  return g;
}

function buildPreviewModel(what, root, ctx) {
  const addFilter = () => {
    const f = createFilter(root, ctx.env);
    const b = new BubbleSystem(root, ctx.env, ctx.lights);
    b.setSource(f.outletWorld, f.outletDir, 15);
    return b;
  };
  switch (what) {
    case 'tank': {
      createBackdrop(ctx.scene);
      const tank = createTank(ctx.optics);
      root.add(tank.group);
      if (ctx.get('test', '0') === '1') addOpticsTestShapes(root);
      if (ctx.get('pebbles', '0') === '1') createPebbleBed(root);
      if (ctx.get('castle', '0') === '1') createCastle(root);
      if (ctx.get('plants', '0') === '1') createPlants(root);
      if (ctx.get('plant')) createPlants(root)[ctx.get('plant')];
      let bubbles = null;
      if (ctx.get('filter', '0') === '1') bubbles = addFilter();
      if (ctx.get('all', '0') === '1') {
        const w = buildWorld(root, ctx.optics, ctx.env, ctx.lights);
        bubbles = w.bubbles;
        root.userData.world = w;
        ctx.world = w;
      }
      return { bubbles };
    }
    case 'castle': { const c = createCastle(root); return { obstacles: c.obstacles.length }; }
    case 'vallisneria': case 'anubias': case 'javafern': case 'cabomba': { createPlants(root)[what]; return {}; }
    case 'crab': { const c = createCrab(root, ctx.env); return {}; }
    case 'snailA': { createBottomSnail(root, null); return {}; }
    case 'snailB': { createGlassSnail(root); return {}; }
    case 'guppy': case 'clownfish': case 'angelfish': case 'betta': {
      const f = createFish(what, 1);
      f.uniforms.uAmp.value = ctx.num('amp', 0.6);
      f.uniforms.uTurn.value = ctx.num('turn', 0);
      f.uniforms.uBeat.value = ctx.num('beat', 0);
      const held = ctx.get('pose', 'swim');
      if (held === 'freeze') { f.root.position.y = 0.9; f.root.rotation.z = 0; }
      root.add(f.root);
      if (held !== 'freeze') f.root.position.y = 0.9;
      if (ctx.get('nofins', '0') === '1') f.fins.visible = false;
      if (ctx.get('nobody', '0') === '1') f.body.visible = false;
      if (ctx.get('both', '0') === '1') { for (const k of Object.keys(FISH_SPECS)) { if (k === what) continue; const o = createFish(k, 2); o.root.position.set(-1.4 * (Object.keys(FISH_SPECS).indexOf(k) + 1), 0.9, 0); root.add(o.root); } }
      return { verts: f.body.geometry.attributes.position.count + f.fins.geometry.attributes.position.count };
    }
    case 'pebbles': { const pb = createPebbleBed(root); return { count: pb.count }; }
    case 'filter': { const b = addFilter(); return { bubbles: b }; }
    case 'empty': return {};
    default:
      return { error: 'unknown model ' + what };
  }
}
