// Dev-only: grayscale visualisation of intermediate caustic terms on the substrate.
// mode: 'caus' | 'mul' | 'up' | 'on' | 'dd'
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
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', () => 'void main() { float aqCaus = 0.0; float aqMul = 0.0; float aqUp = 0.0; float aqOn = 0.0; float aqDD0 = 0.0; float aqDD1 = 0.0;');
      shader.fragmentShader = shader.fragmentShader.replace('float causUp = ', () => 'aqCaus = caus; float causUp = ');
      shader.fragmentShader = shader.fragmentShader.replace('directLight.color *= 1.0 + 0.6 * causV * causUp * causOn * uCausticStrength;', () => 'aqMul = 1.0 + 0.6 * causV * causUp * causOn * uCausticStrength; aqUp = causUp; aqOn = causOn * uCausticStrength; aqDD0 = reflectedLight.directDiffuse.g; directLight.color *= aqMul; aqDD1 = directLight.color.g;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', () => `#include <dithering_fragment>
        float m = fract(vMapUv.x * 2.0);
        vec3 c = m < 0.2 ? vec3(aqCaus / 2.5) : m < 0.4 ? vec3(aqMul / 2.0) : m < 0.6 ? vec3(aqUp) : m < 0.8 ? vec3(aqOn) : vec3(aqDD0 / 0.3, aqDD1 / 1.0, 0.0);
        gl_FragColor = vec4(c, 1.0);`);
    };
    const oldKey = mat.customProgramCacheKey;
    mat.customProgramCacheKey = () => oldKey() + '-m2dbg';
    mat.needsUpdate = true;
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shots/mult2_debug_a.png' });
  return 'ok';
}
