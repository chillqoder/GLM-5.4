// Dev-only: shows reflectedLight.directDiffuse of the substrate (key light contribution) with caustics off / on.
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
      shader.fragmentShader = shader.fragmentShader.replace('vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;', () => 'vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse; gl_FragColor = vec4(reflectedLight.directDiffuse, 1.0); return;');
    };
    const oldKey = mat.customProgramCacheKey;
    mat.customProgramCacheKey = () => oldKey() + '-dddbg';
    mat.needsUpdate = true;
  });
  await page.waitForTimeout(600);
  for (const v of [0, 1]) {
    await page.evaluate((v) => window.__dev.caustics(v), v);
    await page.waitForTimeout(700);
    await page.screenshot({ path: 'shots/dd_' + (v ? 'on' : 'off') + '.png' });
  }
  return 'ok';
}
