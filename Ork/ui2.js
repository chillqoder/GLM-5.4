async page => {
  const out = {};
  await page.setViewportSize({ width: 1440, height: 900 });
  // file:// load test (import maps + CDN modules without a server)
  await page.goto('file:///Users/konstantin/Documents/Dev/GLM%205.4/Ork/index.html');
  await page.waitForTimeout(3000);
  out.fileProtocol = await page.evaluate(() => ({ ork: !!window.ork, loading: !!document.getElementById('loading'), children: window.ork ? window.ork.scene.children.length : -1 }));
  await page.screenshot({ path: 'shot-file.png' });
  // deny flow
  await page.goto('http://localhost:8765/index.html');
  await page.waitForTimeout(2500);
  const cast = async (s, wait) => { await page.evaluate(x => window.ork.castSpell(x), s); await page.waitForTimeout(wait); };
  await cast('earthquake', 1750);
  await cast('fireball', 1350);
  await cast('lightning', 1250);
  out.manaBeforeDeny = await page.evaluate(() => document.getElementById('mana-text').textContent);
  await cast('earthquake', 150);
  out.deny = await page.evaluate(() => ({ manaText: document.getElementById('mana-text').textContent, cls: document.querySelectorAll('.spell')[2].className, manaCls: document.getElementById('mana').className, costColor: getComputedStyle(document.querySelectorAll('.cost')[2]).color }));
  await page.screenshot({ path: 'ui-deny.png' });
  await page.waitForTimeout(600);
  out.denyCleared = await page.evaluate(() => document.querySelectorAll('.spell')[2].className);
  // real click -> audio context
  await page.waitForTimeout(4000);
  await page.locator('.spell').first().click();
  await page.waitForTimeout(300);
  out.audio = await page.evaluate(() => window.ork.audio.ctx ? window.ork.audio.ctx.state : 'none');
  out.afterClick = await page.evaluate(() => ({ manaText: document.getElementById('mana-text').textContent, cls: document.querySelectorAll('.spell')[0].className }));
  await page.waitForTimeout(1500);
  // orbit: drag on the canvas should not break, then screenshot from another angle
  await page.mouse.move(700, 300); await page.mouse.down(); await page.mouse.move(500, 300, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'shot-orbit.png' });
  out.cam = await page.evaluate(() => window.ork.camera.position.toArray().map(v => +v.toFixed(2)));
  return JSON.stringify(out);
}
