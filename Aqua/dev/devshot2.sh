#!/bin/zsh
# usage: dev/devshot2.sh <name> <seconds> <extra-js> <view-js> [w] [h]
cd "/Users/konstantin/Documents/Dev/GLM 5.4/Aqua"
name=$1; secs=$2; extra=$3; view=$4; w=${5:-1440}; h=${6:-900}
playwright-cli -s=aqua run-code "async page => { await page.setViewportSize({ width: $w, height: $h }); await page.goto('http://127.0.0.1:8791/dev/aquarium-dev.html'); await page.waitForFunction(() => window.__dev && window.__aquariumReady, null, { timeout: 60000 }); await page.evaluate(() => { const d = window.__dev; d.setPaused(true); d.step($secs); $extra d.view($view); }); await page.waitForTimeout(1200); await page.screenshot({ path: 'shots/$name.png' }); return 'saved shots/$name.png'; }" 2>&1 | grep -E "^\"saved|Error" | head -3
