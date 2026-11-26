async page => {
  const out = {};
  await page.goto('http://localhost:8765/index.html');
  await page.waitForTimeout(2500);
  // 1) Hotkey casting
  await page.keyboard.press('3');
  await page.waitForTimeout(200);
  out.afterKey3 = await page.evaluate(() => ({ manaText: document.getElementById('mana-text').textContent, onCd: [...document.querySelectorAll('.spell')].map(b => b.className), p: document.querySelectorAll('.spell')[2].style.getPropertyValue('--p'), num: document.querySelectorAll('.cd-num')[2].textContent }));
  // 2) spamming while casting is ignored (no extra mana cost)
  await page.keyboard.press('3'); await page.keyboard.press('e');
  await page.waitForTimeout(100);
  out.afterSpam = await page.evaluate(() => document.getElementById('mana-text').textContent);
  // 3) drain mana: cast 3 more earthquakes after cooldowns -> should get denied
  await page.waitForTimeout(5300);
  await page.keyboard.press('3'); await page.waitForTimeout(5300);
  await page.keyboard.press('3'); await page.waitForTimeout(1800);
  await page.keyboard.press('3');
  await page.waitForTimeout(120);
  out.deny = await page.evaluate(() => ({ manaText: document.getElementById('mana-text').textContent, cls: document.querySelectorAll('.spell')[2].className, manaCls: document.getElementById('mana').className, costColor: getComputedStyle(document.querySelectorAll('.cost')[2]).color }));
  await page.screenshot({ path: 'ui-deny.png' });
  // 4) audio context state after a real click on a button
  await page.waitForTimeout(2500);
  const btn = page.locator('.spell').first();
  await btn.click();
  await page.waitForTimeout(300);
  out.audio = await page.evaluate(() => { const c = window.__ac; return c ? c.state : 'n/a'; });
  out.afterClick = await page.evaluate(() => ({ manaText: document.getElementById('mana-text').textContent, cls: document.querySelectorAll('.spell')[0].className }));
  // 5) fps over 2s
  out.fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(+(n / 2).toFixed(1)); }; requestAnimationFrame(f); }));
  // 6) resize
  await page.setViewportSize({ width: 800, height: 600 });
  await page.waitForTimeout(400);
  out.canvas = await page.evaluate(() => { const c = document.getElementById('scene'); return { w: c.width, h: c.height, dpr: window.devicePixelRatio }; });
  await page.screenshot({ path: 'ui-small.png' });
  return JSON.stringify(out);
}
