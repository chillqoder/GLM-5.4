// Dev-only: does recompiling the substrate's shader (unchanged source, new cache key) change the caustics?
async page => {
  await page.goto('http://127.0.0.1:8791/dev/aquarium-dev.html');
  await page.waitForFunction(() => window.__dev && window.__aquariumReady, null, { timeout: 60000 });
  await page.evaluate(() => {
    const d = window.__dev;
    d.setPaused(true); d.step(45);
    d.view({ az: 0.62, polar: 0.9, dist: 6.5, target: [0.6, 0.5, 0.6] });
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/rc_before.png' });
  await page.evaluate(() => {
    const d = window.__dev;
    const mat = d.APP.world.pebbles.substrate.material;
    const oldKey = mat.customProgramCacheKey;
    mat.customProgramCacheKey = () => oldKey() + '-rc';
    mat.needsUpdate = true;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/rc_after.png' });
  return 'ok';
}
