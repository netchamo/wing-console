import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 640 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8765/demo.html'); await p.waitForTimeout(800); const g = await p.$('button.ghost'); if (g) await g.click();
await p.evaluate(() => { Date.now = () => 1e12; });
const M = process.argv.slice(2);
const all = M.length ? M : await p.evaluate(() => Object.keys(FXS));
const sv = () => p.evaluate(() => [...document.querySelectorAll('svg.fxpic')].map(s => s.outerHTML).join(''));
for (const m of all) {
  const tabs = await p.evaluate(m => FXS[m].map(t => t.t || null), m);
  for (const t of tabs) {
    await p.evaluate(([m, t]) => __app.setState(s => { const o = { ...s.monv, '/fx/1/mdl': m }; for (const k in o) if (k.startsWith('/fx/1/p')) delete o[k]; return { monv: o, screen: 'fxed', fxEd: { n: 1, from: 'fx' }, fxTab: { 1: t } }; }), [m, t]); await p.waitForTimeout(250);
    await p.screenshot({ path: 'sp-' + (m + (t || '')).replace(/\W/g, '') + '.png' });
    const keys = await p.evaluate(([m, t]) => FXS[m].find(x => (x.t || null) === t).rows.flat().concat(FXS[m].find(x => (x.t || null) === t).on || []).filter(k => __app.fxParams(m).some(e => e[1] === k)), [m, t]);
    const missing = await p.evaluate(([m, t]) => { const tb = FXS[m].find(x => (x.t || null) === t); const used = new Set(FXS[m].flatMap(x => x.rows.flat().concat(x.on || []))); return __app.fxParams(m).map(e => e[1]).filter(k => !used.has(k)); }, [m, t]);
    const bad = [];
    for (const nm of keys) { const a = await sv(); await p.evaluate(([m, nm]) => { const e = __app.fxParams(m).find(x => x[1] === nm), Mm = e[2]; const q = __app.fxN(Mm, __app.fxGet(1, e)); __app.fxSet(1, e, __app.fxDn(Mm, q > 0.5 ? 0.1 : 0.9)); }, [m, nm]); await p.waitForTimeout(120); if (a === await sv()) bad.push(nm); }
    console.log(m, t || '', 'ignores:', bad.join(',') || '-', missing.length ? ' NOT ON PANEL: ' + missing.join(',') : '');
  }
}
console.log(errs.slice(0, 3)); await b.close();
