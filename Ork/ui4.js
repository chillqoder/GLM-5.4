async page => {
  const out = { log: [] };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:8765/index.html');
  await page.waitForTimeout(2500);
  const seq = [['3', 1750], ['2', 1350], ['1', 1250], ['3', 1750], ['2', 1350], ['1', 1250], ['3', 1750], ['2', 1350], ['1', 1250]];
  outer: for (const [key, wait] of seq) {
    await page.keyboard.press(key);
    await page.waitForTimeout(130);
    const st = await page.evaluate(k => ({ mana: document.getElementById('mana-text').textContent, cls: document.querySelectorAll('.spell')[+k - 1].className, manaCls: document.getElementById('mana').className }), key);
    out.log.push(key + ':' + st.mana + ':' + st.cls.replace('spell', '').trim() + '|' + st.manaCls);
    if (st.cls.includes('deny')) { await page.screenshot({ path: 'ui-deny.png' }); await page.waitForTimeout(600); out.denyCleared = await page.evaluate(k => document.querySelectorAll('.spell')[+k - 1].className, key); break outer; }
    await page.waitForTimeout(wait - 130);
  }
  return JSON.stringify(out);
}
