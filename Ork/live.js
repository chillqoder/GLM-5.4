async page => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const runs = {
    lightning: [520, 650],
    fireball: [350, 640, 960],
    earthquake: [500, 780, 1050, 1900],
  };
  for (const [spell, times] of Object.entries(runs)) {
    await page.goto('http://localhost:8765/index.html');
    await page.waitForTimeout(2500);
    await page.evaluate(s => window.ork.castSpell(s), spell);
    let prev = 0;
    for (const t of times) { await page.waitForTimeout(t - prev); prev = t; await page.screenshot({ path: `live-${spell}-${t}.png` }); }
  }
}
