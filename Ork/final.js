async page => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:8765/index.html');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'final-idle.png' });
  for (let r = 0; r < 3; r++) {
    await page.keyboard.press('q'); await page.waitForTimeout(700); await page.screenshot({ path: 'final-lightning.png' }); await page.waitForTimeout(1400);
    await page.keyboard.press('w'); await page.waitForTimeout(2150);
    await page.keyboard.press('e'); await page.waitForTimeout(900); await page.screenshot({ path: 'final-earthquake.png' }); await page.waitForTimeout(4600);
  }
  // objects in the scene should not grow without bound
  const info = await page.evaluate(() => { const o = window.ork; let n = 0; o.scene.traverse(() => n++); return { objects: n, geometries: o.scene.children.length, mem: o.THREE ? null : null }; });
  const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(+(n / 1.5).toFixed(0)); }; requestAnimationFrame(f); }));
  return JSON.stringify({ errors, info, fps });
}
