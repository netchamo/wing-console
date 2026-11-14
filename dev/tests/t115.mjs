import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 640 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8765/index.html'); await p.waitForTimeout(900);
await p.evaluate(() => __wingNative([{ type: 'osc', address: '/ch/1/fdr', args: [0, 0.7, -5] }, { type: 'nativeOpen' }])); await p.waitForTimeout(300);
const W = (s, k) => p.evaluate(([s, k]) => __wm.wid(s, k), [s, k]);
const msgs = [];
for (const s of [55, 2]) {
  const kv = s === 55 ? { 'eq/on': 1, 'eq/mdl': 'STD', 'eq/STD/leq': 'LR24', 'eq/STD/lf': 80, 'eq/STD/lg': 0, 'eq/STD/heq': 'BW12', 'eq/STD/hf': 12000, 'eq/STD/hg': 0, 'eq/STD/3g': -4, 'eq/STD/3f': 3000, 'eq/STD/tilt': 0 }
    : { 'eq/on': 1, 'eq/mdl': 'STD', 'flt/lc': 1, 'flt/lcf': 120, 'flt/lcs': '24', 'flt/hc': 1, 'flt/hcf': 9000, 'flt/hcs': '6', 'flt/tf': 0, 'flt/mdl': 'MAX', 'eq/STD/3g': 2.5 };
  for (const k in kv) { const id = await W(s, k); if (id) msgs.push(typeof kv[k] === 'string' ? { type: 'nat', id, s: kv[k] } : { type: 'nat', id, v: kv[k] }); else console.log('no id', s, k); }
}
await p.evaluate(m => __wingNative(m), msgs); await p.waitForTimeout(300);
await p.evaluate(() => __app.setLive(true)); await p.waitForTimeout(1800);
await p.evaluate(() => setInterval(() => __wingNative([{ type: 'osc', address: '/ch/1/fdr', args: [0, 0.7, -5] }]), 1000));
for (const s of [55, 2]) {
  await p.evaluate(() => { calls.length = 0; }); 
  await p.mouse.click(5, 300); await p.evaluate(s => __app.setState({ screen: 'eq', eqCh: s }), s); await p.waitForTimeout(1200);
  console.log('open eq', s, JSON.stringify(await p.evaluate(() => calls.filter(c => c[0] === 'setNative'))), await p.evaluate(() => { const q = __app.state.eq; return JSON.stringify({ L: q.bands[0].type + ' ' + (q.bands[0].cut || ''), H: q.bands[q.bands.length - 1].type + ' ' + (q.bands[q.bands.length - 1].cut || ''), lc: q.lc, hc: q.hc, tool: q.tool }); }));
  await p.waitForTimeout(1700);
  console.log('direct', await p.evaluate(() => { try { __app.baseT = 0; __app.syncCheck(); const d = __app.deriveStrip(__app.state, __app.state.eqCh); return ['ok', Date.now() - __app.uAct, Object.keys(__app.base[__app.state.eqCh]).length, Object.keys(d).length, __app.isLinked(), !!__app.mx[__app.state.eqCh]].join(' '); } catch (e) { return String(e.stack).slice(0, 300); } }));
  console.log('base', s, await p.evaluate(s => JSON.stringify([!!__app.base[s], __app.base[s] && __app.base[s]['eq/STD/3g'], __app.deriveStrip(__app.state, s)['eq/STD/3g'], __app.state.eqCh, Object.keys(__app.base[s]||{}).filter(k=>k.startsWith('eq')).length, Date.now() - __app.uAct, !!__app.syncIv]), s));
  await p.evaluate(() => { calls.length = 0; __app.uAct = Date.now(); __app.setState(s => ({ eq: { ...s.eq, bands: s.eq.bands.map((x, i) => i === 3 ? { ...x, g: x.g + 3 } : x) } })); }); await p.waitForTimeout(600);
  console.log("hand", s, JSON.stringify(await p.evaluate(() => calls.filter(c => c[0] === "setNative"))), await p.evaluate(s => JSON.stringify([__app.state.eq.bands.map(b => b.id + ":" + b.g), __app.mx[s]["eq/STD/3g"], (__app.base[s] || {})["eq/STD/3g"], __app.deriveStrip(__app.state, s)["eq/STD/3g"]]), s));
  await p.waitForTimeout(1700);
}
await p.screenshot({ path: 'x-buseq.png' }); console.log(errs); await b.close();
