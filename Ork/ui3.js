async page => {
  const out = {};
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:8765/index.html');
  await page.waitForTimeout(2500);
  const cast = async (s, wait) => { await page.evaluate(x => window.ork.castSpell(x), s); await page.waitForTimeout(wait); };
  await cast('lightning', 1200);
  await cast('fireball', 1300);
  await cast('earthquake', 3800);
  out.manaBeforeDeny = await page.evaluate(() => document.getElementById('mana-text').textContent);
  await page.evaluate(() => window.ork.castSpell('fireball'));
  await page.waitForTimeout(120);
  out.deny = await page.evaluate(() => ({ manaText: document.getElementById('mana-text').textContent, cls: document.querySelectorAll('.spell')[1].className, manaCls: document.getElementById('mana').className }));
  await page.screenshot({ path: 'ui-deny.png' });
  await page.waitForTimeout(600);
  out.denyCleared = await page.evaluate(() => document.querySelectorAll('.spell')[1].className);
  return JSON.stringify(out);
}
