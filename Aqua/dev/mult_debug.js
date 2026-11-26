// Dev-only: visualises the actual caustic light multiplier on the substrate.
// stripes: left = multiplier, middle = causUp, right = causOn * uCausticStrength
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
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', () => 'void main() { float aqMul = 0.0; float aqUp = 0.0; float aqOn = 0.0;');
      shader.fragmentShader = shader.fragmentShader.replace('directLight.color *= 1.0 + 0.6 * causV * causUp * causOn * uCausticStrength;', () => 'aqMul = 1.0 + 0.6 * causV * causUp * causOn * uCausticStrength; aqUp = causUp; aqOn = causOn * uCausticStrength; directLight.color *= aqMul;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', () => '#include <dithering_fragment>\n { float band = step(0.333, vMapUv.x) + step(0.666, vMapUv.x); vec3 c = band < 0.5 ? vec3(aqMul * 0.5) : (band < 1.5 ? vec3(aqUp) : vec3(aqOn)); gl_FragColor = vec4(fract(vMapUv.x * 2.5) < 0.08 ? vec3(0.0) : c, 1.0); }');
    };
    const oldKey = mat.customProgramCacheKey;
    mat.customProgramCacheKey = () => oldKey() + '-muldbg';
    mat.needsUpdate = true;
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shots/mult_debug_a.png' });
  return 'saved';
}
