// Dev-only: renders the GPU caustic function + raw wave uniforms as a debug quad.
async page => {
  await page.goto('http://127.0.0.1:8791/dev/aquarium-dev.html');
  await page.waitForFunction(() => window.__dev && window.__aquariumReady, null, { timeout: 60000 });
  await page.evaluate(() => {
    const d = window.__dev, A = d.APP, O = A.optics;
    const Scene = O.fsScene.constructor, ShaderMaterial = A.tank.water.material.constructor;
    const BufferGeometry = O.tri.geometry.constructor, Mesh = O.tri.constructor;
    const BufferAttribute = O.tri.geometry.attributes.position.constructor;
    const u = Object.assign({}, O.shared);
    const loop = `
      vec2 p = vec2(vUv.x * 8.0 - 4.0, (vUv.y - 0.33) * 4.0 - 2.0);
      float lap = 0.0, norm = 0.0, lap1 = 0.0;
      for (int i = 0; i < NUM_CAUSTIC_WAVES; i++) {
        vec4 a = uWaveA[i]; vec4 b = uWaveB[i];
        float w = b.z * b.x * a.z * a.z;
        lap += w * ( -sin( dot( a.xy, p ) * a.z - a.w * uTime + b.y ) ); norm += w;
        if (i == 0) lap1 = -sin( dot( a.xy, p ) * a.z - a.w * uTime + b.y );
      }
      float f = lap / norm;
      if (vUv.y > 0.66) gl_FragColor = vec4(vec3(f * 0.5 + 0.5), 1.0);
      else if (vUv.y > 0.33) gl_FragColor = vec4(vec3(lap1 * 0.5 + 0.5), 1.0);
      else gl_FragColor = vec4(uWaveB[0].x / 0.02, uWaveB[0].z / 1.6, uWaveA[0].z / 10.0, 1.0);`;
    const sm = new ShaderMaterial({ uniforms: u, vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: d.glsl.WATER_GLSL + 'varying vec2 vUv; void main(){' + loop + '}' });
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const sc = new Scene(); sc.add(new Mesh(geo, sm));
    O.render = () => { A.renderer.setRenderTarget(null); A.renderer.render(sc, O.fsCam); };
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/caus_debug_a.png' });
  return 'saved';
}
