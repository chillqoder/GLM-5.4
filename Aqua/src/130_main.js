// Boot, composition, render loop, camera constraints, UI and adaptive quality.

function computePixelRatio(width, height, scale = 1) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const budget = RENDER_BUDGET_PIXELS * scale;
  // Supersample on low-DPI screens when the budget allows; never exceed the device ratio by much.
  return clamp(Math.sqrt(budget / Math.max(1, width * height)), 0.6, Math.max(dpr, 1.5));
}

(function startAquarium() {
  const $ = (id) => document.getElementById(id);
  const container = $('stage'), boot = $('boot'), ui = $('ui'), hint = $('hint');
  const btnPause = $('btn-pause'), btnReset = $('btn-reset');

  function fail(detail) {
    $('fallback-detail').textContent = detail;
    $('fallback').hidden = false;
    boot.classList.add('gone');
    window.__aquariumReady = true;
  }

  let renderer;
  try {
    renderer = createRenderer(container);
    if (!renderer.capabilities.isWebGL2) throw new Error('This browser does not provide WebGL 2.');
  } catch (err) {
    fail('WebGL 2 could not be initialised: ' + err.message);
    return;
  }

  try {
    const scene = new THREE.Scene();
    const camera = createCamera();
    const controls = createControls(camera, renderer.domElement);
    const lights = createLights(scene);
    const env = createStudioEnvironment(renderer, scene);
    const optics = new OpticsPipeline(renderer, scene, camera, env);
    const backdrop = createBackdrop(scene);
    const tank = createTank(optics);
    scene.add(tank.group);

    const world = buildWorld(scene, optics, env, lights);

    Object.assign(APP, { renderer, scene, camera, controls, lights, env, optics, tank, world, SIM, SIM_UNIFORMS });

    // ---------------------------------------------------------------- resize / quality
    let pixelRatio = 1;
    let userMoved = false;
    let firstLayout = true;
    const perf = { ema: 16.7, scale: 1, lastChange: 0 };
    // `reframe` re-applies the home view (first layout / window resize). Quality changes resize the
    // render targets without ever moving the camera.
    function resize(reframe = false) {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      pixelRatio = computePixelRatio(w, h, perf.scale);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      optics.setSize(w, h, pixelRatio);
      if (world.particles) world.particles.material.uniforms.uPixelRatio.value = pixelRatio;
      if (!userMoved && (reframe || firstLayout)) applyHomeView(camera, controls, camera.aspect);
      firstLayout = false;
    }
    window.addEventListener('resize', () => resize(true));
    resize(true);

    // Low frame rate → cheaper optics / shadows / resolution. Creatures, refraction and
    // reflections are never removed.
    function adaptQuality(rawDt) {
      perf.ema = lerp(perf.ema, Math.min(rawDt * 1000, 120), 0.04);
      const t = performance.now();
      if (SIM.time < 2.5 || t - perf.lastChange < 2500) return;     // ignore start-up (shader compilation)
      if (perf.ema > 23 && perf.scale > 0.6) {
        perf.scale = Math.max(0.6, perf.scale - 0.15);
        perf.lastChange = t;
        perf.ema = 16.7;
        if (perf.scale < 0.8) lights.key.shadow.mapSize.set(1024, 1024);
        resize(false);
      }
    }

    // ---------------------------------------------------------------- UI
    function setPaused(p) {
      SIM.paused = p;
      btnPause.textContent = p ? 'Resume' : 'Pause';
      btnPause.setAttribute('aria-pressed', p ? 'true' : 'false');
      btnPause.setAttribute('aria-label', p ? 'Resume animation' : 'Pause animation');
    }
    btnPause.addEventListener('click', () => setPaused(!SIM.paused));
    btnReset.addEventListener('click', () => { applyHomeView(camera, controls, camera.aspect); userMoved = false; });
    controls.addEventListener('start', () => { userMoved = true; hint.classList.add('faded'); });
    window.addEventListener('keydown', (e) => {
      if (e.target && /^(INPUT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); setPaused(!SIM.paused); }
      else if (e.code === 'KeyR') { applyHomeView(camera, controls, camera.aspect); userMoved = false; }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) clock.getDelta(); });

    // ---------------------------------------------------------------- loop
    const clock = new THREE.Clock();
    let fpsAcc = 0, fpsN = 0;
    warmUp(0.6);
    updateRipples(SIM.time);
    function animate() {
      requestAnimationFrame(animate);
      const rawDt = clock.getDelta();
      const dt = SIM.paused ? 0 : Math.min(rawDt, 0.05);   // clamp after a hidden tab resumes
      SIM.step(dt);
      updateRipples(SIM.time);
      SIM_UNIFORMS.uTime.value = SIM.time;
      controls.update();
      enforceCameraLimits(camera, controls);
      optics.render(SIM.time);
      adaptQuality(rawDt);
      fpsAcc += rawDt; fpsN++;
      if (fpsAcc > 1) { APP.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    }
    animate();

    boot.classList.add('gone');
    ui.classList.remove('hidden');
    window.__aquariumReady = true;
  } catch (err) {
    console.error(err);
    fail((err && err.message) ? err.message : String(err));
  }
})();
