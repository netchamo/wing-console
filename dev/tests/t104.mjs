import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 640 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8765/demo.html'); await p.waitForTimeout(800); const g = await p.$('button.ghost'); if (g) await g.click();
await p.evaluate(() => __app.setState({ screen: 'main', bank: 0 })); await p.waitForTimeout(300);
const f = (await p.$$('button.fader'))[1]; const r = await f.boundingBox();
const v = await p.evaluate(() => __app.state.chans[1].v);
// tap near bottom (away from cap at v~0.7)
await p.mouse.click(r.x + r.width / 2, r.y + r.height - 8); await p.waitForTimeout(300);
console.log('after tap beside', await p.evaluate(() => [__app.state.screen, __app.state.eqCh]));
await p.evaluate(() => __app.setState({ screen: 'main' })); await p.waitForTimeout(300);
// drag on cap moves
const capY = await p.evaluate(() => { const c = document.querySelectorAll('button.fader')[1].querySelector('.cap').getBoundingClientRect(); return c.y + c.height / 2; });
await p.mouse.move(r.x + r.width / 2, capY); await p.mouse.down(); await p.mouse.move(r.x + r.width / 2, capY + 60, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(200);
console.log('drag', v, '->', await p.evaluate(() => __app.state.chans[1].v), await p.evaluate(() => __app.state.screen));
// double tap cap resets
const capY2 = await p.evaluate(() => { const c = document.querySelectorAll('button.fader')[1].querySelector('.cap').getBoundingClientRect(); return c.y + c.height / 2; });
await p.waitForTimeout(500); await p.mouse.click(r.x + r.width / 2, capY2); await p.mouse.click(r.x + r.width / 2, capY2); await p.waitForTimeout(200);
console.log('dbl', await p.evaluate(() => [__app.state.chans[1].v, __app.state.screen]));
await p.evaluate(() => __app.setState({ screen: 'main' })); await p.waitForTimeout(500);
await p.mouse.move(r.x + r.width / 2, r.y + r.height - 8); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up(); await p.waitForTimeout(300);
console.log('long', await p.evaluate(() => [JSON.stringify(__app.state.sendPop), __app.state.screen])); await p.screenshot({ path: 'a2.png' });
console.log(errs); await b.close();
