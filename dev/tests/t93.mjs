import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 640 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8765/demo.html'); await p.waitForTimeout(800); const g = await p.$('button.ghost'); if (g) await g.click();
await p.evaluate(() => { Date.now = () => 1e12; });
const M = process.argv.slice(2).length ? process.argv.slice(2) : ['V-ROOM', 'V-REV', 'V-PLATE', 'BPLATE', 'GATED', 'REVERSE', 'DEL/REV', 'SHIMMER', 'TAP-DL', 'TAPE-DL', 'OILCAN', 'BBD-DL', 'HALL', 'ROOM', 'CHAMBER', 'PLATE', 'CONCERT', 'AMBI', 'SPRING', 'ST-DL'];
for (const m of M) {
  await p.evaluate(m => __app.setState(s => { const o = { ...s.monv, '/fx/1/mdl': m }; for (const k in o) if (k.startsWith('/fx/1/p')) delete o[k]; return { monv: o, screen: 'fxed', fxEd: { n: 1, from: 'fx' } }; }), m); await p.waitForTimeout(300);
  await p.screenshot({ path: 'x-' + m.replace(/\W/g, '') + '.png' });
  const pic = () => p.evaluate(() => { const el = document.querySelector('#stage') || document.body; return [...el.querySelectorAll('svg')].map(s => s.innerHTML).join('').length + '|' + [...el.querySelectorAll('svg')].map(s => s.innerHTML).join('').replace(/\s+/g, ''); });
  const names = await p.evaluate(m => __app.fxParams(m).map(e => e[1]), m), bad = [];
  for (const nm of names) {
    const sv = () => p.evaluate(() => [...document.querySelectorAll('svg.fxpic')].map(s => s.outerHTML).join(''));
    const a = await sv(); await p.evaluate(([m, nm]) => { const e = __app.fxParams(m).find(x => x[1] === nm), Mm = e[2]; const q = __app.fxN(Mm, __app.fxGet(1, e)); __app.fxSet(1, e, __app.fxDn(Mm, q > 0.5 ? 0.1 : 0.9)); }, [m, nm]); await p.waitForTimeout(220);
    if (a === await sv()) bad.push(nm); }
  console.log(m, 'picture ignores:', bad.join(',') || '-');
}
console.log(errs.slice(0, 3)); await b.close();
