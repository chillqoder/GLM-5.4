async page => {
  const shots = [['idle', 0], ['lightning', 0.45], ['fireball', 0.5], ['fireball', 0.62], ['earthquake', 0.3], ['earthquake', 0.55], ['earthquake', 0.72]];
  for (const [spell, t] of shots) {
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(2500);
    if (spell !== 'idle') {
      await page.evaluate(([s, tt]) => window.ork.freeze(s, tt), [spell, t]);
      await page.evaluate(() => { const o = window.ork; o.camera.position.set(0.2, 1.9, 4.4); o.controls.target.set(0.1, 1.2, 0.3); });
      await page.waitForTimeout(700);
    }
    await page.screenshot({ path: spell === 'idle' ? 'shot-idle.png' : `pose-${spell}-${t}.png` });
  }
}
