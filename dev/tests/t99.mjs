import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 640 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8765/demo.html'); await p.waitForTimeout(800); const g = await p.$('button.ghost'); if (g) await g.click();
await p.evaluate(() => __app.setState({ screen: 'fx' })); await p.waitForTimeout(500); await p.screenshot({ path: 'q2-rack.png' });
const t0 = Date.now(); await p.evaluate(() => __app.setState({ fxPick: 1 })); await p.waitForTimeout(500); console.log('pick render ms ~', Date.now() - t0); await p.screenshot({ path: 'q2-pick.png' });
await p.evaluate(() => __app.setState({ fxPickTab: 'std' })); await p.waitForTimeout(300); await p.screenshot({ path: 'q2-pick-std.png' });
await p.evaluate(() => __app.setState({ fxPickTab: 'ch' })); await p.waitForTimeout(300); await p.screenshot({ path: 'q2-pick-ch.png' });
console.log(errs); await b.close();
