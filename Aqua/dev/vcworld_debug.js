// Dev-only: paints the substrate with its vCausWorld varying (R = x, G = z) to verify the input.
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
      shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', () => '#include <dithering_fragment>\n gl_FragColor = vec4(causDbg, fract(causRaw * 0.5), step(1.5, causRaw), 1.0);');
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', () => 'void main() { float causDbg = 0.0; float causRaw = 0.0;');
      shader.fragmentShader = shader.fragmentShader.replace('float causUp = ', () => 'causRaw = caus; causDbg = (caus != caus) ? 1.0 : 0.0; float causUp = ');
      shader.fragmentShader = shader.fragmentShader.replace('float causV = clamp( caus - 1.0, -0.25, 2.5 );', () => 'float causV = clamp( caus - 1.0, -0.25, 2.5 ); causDbg = 0.12;');
    };
    const oldKey = mat.customProgramCacheKey;
    mat.customProgramCacheKey = () => oldKey() + '-dbg';
    mat.needsUpdate = true;
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shots/causval_debug_c.png' });
  return 'saved';
}
