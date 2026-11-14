import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 640 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8765/demo.html'); await p.waitForTimeout(800); const g = await p.$('button.ghost'); if (g) await g.click();
await p.evaluate(() => __app.setState(s => { const o = { ...s.monv, '/fx/1/mdl': 'SPKMAN' }; for (const k in o) if (k.startsWith('/fx/1/p')) delete o[k]; return { monv: o, screen: 'fxed', fxEd: { n: 1, from: 'fx' } }; })); await p.waitForTimeout(300);
const P = await p.evaluate(() => __app.fxParams('SPKMAN'));
const setv = (k, v) => p.evaluate(([k, v]) => { const e = __app.fxParams('SPKMAN').find(x => x[1] === k); __app.fxSet(1, e, v); }, [k, v]);
await setv('hptype', 'LR24'); await setv('hpf', 80); await setv('lptype', 'BW12'); await setv('lpf', 9000); await setv('tiltg', 3); await setv('dyneq', 1); await setv('deqg', -6); await setv('deqf', 2500); await setv('lim', 1); await setv('limthr', -6);
await p.waitForTimeout(300); await p.screenshot({ path: 'spk1.png' });
const sv = () => p.evaluate(() => [...document.querySelectorAll('svg.fxpic')].map(s => s.outerHTML).join('') + document.body.innerText.length);
const bad = []; for (const e of P) { const a = await sv(); await p.evaluate(nm => { const e = __app.fxParams('SPKMAN').find(x => x[1] === nm), M = e[2]; const q = __app.fxN(M, __app.fxGet(1, e)); __app.fxSet(1, e, __app.fxDn(M, q > 0.5 ? 0.1 : 0.9)); }, e[1]); await p.waitForTimeout(100); if (a === await sv()) bad.push(e[1]); }
console.log('ignores', bad.join(','));
const h = await p.$('button[aria-label="TILT"]'); const bb = await h.boundingBox(); await p.mouse.move(bb.x + 26, bb.y + 26); await p.mouse.down(); await p.mouse.move(bb.x + 80, bb.y - 30, { steps: 5 }); await p.mouse.up();
console.log('tilt', await p.evaluate(() => [__app.fxV(1, 'tiltf'), __app.fxV(1, 'tiltg')]));
await p.evaluate(() => __app.setState({ spkTab: 'DYN EQ' })); await p.waitForTimeout(200); await p.screenshot({ path: 'spk2.png' });
console.log(errs); await b.close();
