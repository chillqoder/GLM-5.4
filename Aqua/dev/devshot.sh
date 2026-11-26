#!/bin/zsh
# usage: dev/devshot.sh <name> <seconds> [view-js|"home"] [width] [height]
cd "/Users/konstantin/Documents/Dev/GLM 5.4/Aqua"
name=$1; secs=$2; view=${3:-"home"}; w=${4:-1440}; h=${5:-900}
if [[ "$view" == "home" ]]; then
  call="window.__dev.setPaused(true); window.__dev.step($secs); window.__dev.home();"
else
  call="window.__dev.setPaused(true); window.__dev.step($secs); window.__dev.view($view);"
fi
playwright-cli -s=aqua run-code "async page => { await page.setViewportSize({ width: $w, height: $h }); await page.goto('http://127.0.0.1:8791/dev/aquarium-dev.html'); await page.waitForFunction(() => window.__dev && window.__aquariumReady, null, { timeout: 60000 }); await page.evaluate(() => { $call }); await page.waitForTimeout(1500); await page.screenshot({ path: 'shots/$name.png' }); return 'saved shots/$name.png'; }" 2>&1 | grep -E "saved|Error|error" | head -3
playwright-cli -s=aqua console 2>&1 | sed -n '2,3p'
