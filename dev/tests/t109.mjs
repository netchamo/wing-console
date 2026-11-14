// principle: what was played in demo is never sent; after connect + live nothing goes to the desk until a hand action
import fs from 'fs';
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 640 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8765/index.html'); await p.waitForTimeout(900);
const src = fs.readFileSync('demo.html', 'utf8'); const G = JSON.parse(/const WMAP = (\{.*?\});\n/s.exec(src)[1]).G; const gid = q => parseInt(G[q], 36) | 0;
console.log('linked before', await p.evaluate(() => __app.isLinked()));
// ---- play in demo
await p.evaluate(() => {
  __app.fxSetModel(1, 'ROOM'); __app.fxSetModel(2, 'SPKMAN'); __app.fxSetModel(3, 'DEQ3'); __app.fxSetModel(4, 'PULSAR');
  const set = (n, k, v) => { const e = __app.fxParams(__app.fxModel(n)).find(x => x[1] === k); e && __app.fxSet(n, e, v); };
  set(1, 'dcy', 3); set(2, 'hpf', 120); set(2, 'dyneq', 1); set(4, '1lb', 7);
  __app.fxMixSet(1, 40);
  __app.setIns(0, 'preins', { fx: 1, on: true }); __app.setIns(1, 'postins', { fx: 2, on: false });
});
await p.evaluate(() => __app.setState({ screen: 'fxed', fxEd: { n: 2, from: 'fx' } })); await p.waitForTimeout(300);
await p.evaluate(() => __app.setState({ screen: 'fxed', fxEd: { n: 3, from: 'fx' } })); await p.waitForTimeout(300);
console.log('demo calls to desk', JSON.stringify(await p.evaluate(() => calls.filter(c => c[0] === 'setNative' || c[0] === 'set'))));
// ---- connect: the desk reports its own state
await p.evaluate(() => { calls.length = 0; __wingNative([{ type: 'osc', address: '/ch/1/fdr', args: [0, 0.7, -5] }, { type: 'nativeOpen' }]); }); await p.waitForTimeout(400);
await p.evaluate(([a, b2, c, d]) => __wingNative([{ type: 'nat', id: a, s: 'HALL' }, { type: 'nat', id: b2, v: 1.8 }, { type: 'nat', id: c, s: 'CHORUS' }, { type: 'nat', id: d, v: 100 }]), [gid('/fx/1/mdl'), gid('/fx/1/p3'), gid('/fx/2/mdl'), gid('/fx/1/fxmix')]); await p.waitForTimeout(400);
console.log('linked', await p.evaluate(() => __app.isLinked()), 'fx1', await p.evaluate(() => [__app.state.monv['/fx/1/mdl'], __app.state.monv['/fx/1/p3'], __app.state.monv['/fx/1/fxmix'], __app.state.monv['/fx/2/mdl']]));
// read-only: hand actions do nothing
await p.evaluate(() => { __app.fxMixSet(1, 20); }); await p.waitForTimeout(200);
console.log('ro mix', await p.evaluate(() => __app.state.monv['/fx/1/fxmix']));
// ---- live on, wait, walk the FX screens, still nothing sent
await p.evaluate(() => { calls.length = 0; __app.setLive(true); }); await p.waitForTimeout(2000);
for (const s of [{ screen: 'fx' }, { screen: 'fxed', fxEd: { n: 1, from: 'fx' } }, { screen: 'fxed', fxEd: { n: 2, from: 'fx' } }, { screen: 'fxed', fxEd: { n: 3, from: 'fx' } }, { screen: 'ins', insSlot: 'preins', eqCh: 0 }, { screen: 'main' }]) { await p.evaluate(x => __app.setState(x), s); await p.waitForTimeout(700); }
const sent = await p.evaluate(() => calls.filter(c => c[0] === 'setNative' || c[0] === 'set'));
console.log('after live, no hand action:', sent.length, JSON.stringify(sent.slice(0, 6)));
// ---- a hand action is sent
await p.evaluate(() => { calls.length = 0; __app.fxMixSet(1, 60); }); await p.waitForTimeout(1500);
console.log('hand mix', JSON.stringify(await p.evaluate(() => calls.filter(c => c[0] === 'setNative'))));
console.log(errs); await b.close();
