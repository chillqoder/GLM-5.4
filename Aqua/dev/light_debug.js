// Dev-only: replaces the colour of the first directional light (index 0 in the unrolled loop) to identify it.
async page => {
  await page.goto('http://127.0.0.1:8791/dev/aquarium-dev.html');
  await page.waitForFunction(() => window.__dev && window.__aquariumReady, null, { timeout: 60000 });
  await page.evaluate(() => {
    const d = window.__dev;
    d.setPaused(true); d.step(45);
    d.view({ az: 0.62, polar: 0.9, dist: 6.5, target: [0.6, 0.5, 0.6] });
    const mat = d.APP.world.pebbles.substrate.material;
    const orig = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader) => {
      orig(shader);
      shader.fragmentShader = shader.fragmentShader.replace('directLight.color *= 1.0 + 0.6 * causV * causUp * causOn * uCausticStrength;', () => 'directLight.color = vec3(6.0, 0.0, 0.0);');
    };
    const oldKey = mat.customProgramCacheKey;
    mat.customProgramCacheKey = () => oldKey() + '-lightdbg';
    mat.needsUpdate = true;
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shots/light_debug_a.png' });
  return 'saved';
}
