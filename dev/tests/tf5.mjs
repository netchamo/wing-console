import fs from 'fs';
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const v = process.argv[2]; const msgs = JSON.parse(fs.readFileSync('fuzz.json'));
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 640 } }); const errs = [];
p.on('pageerror', e => errs.push('PAGE ' + String(e.stack || e).slice(0, 500)));
const T = (pr, ms = 6000) => Promise.race([pr, new Promise(r => setTimeout(() => r('TIMEOUT'), ms))]);
await p.goto(`http://127.0.0.1:8765/idx_${v}.html`); await p.waitForTimeout(900);
await p.evaluate(() => __wingNative([{ type: 'osc', address: '/ch/1/fdr', args: [0, 0.7, -5] }, { type: 'nativeOpen' }])); await p.waitForTimeout(300);
for (let k = 0; k < msgs.length; k += 400) await T(p.evaluate(m => __wingNative(m), msgs.slice(k, k + 400)));
for (let k = 0; k < 4; k++) { const t = Date.now(); const r = await T(p.evaluate(() => 1)); console.log(v, 'ping', r, Date.now() - t, 'ms'); await new Promise(r => setTimeout(r, 500)); }
const chk = await T(p.evaluate(() => { const bad = []; for (let s = 0; s < 76; s++) { const c = __app.state.chans[s]; if (c && c.name !== 'N' + s) bad.push(s + ':' + (c && c.name)); } return { linked: __app.isLinked(), bad: bad.slice(0, 12), nbad: bad.length, calls: calls.length, req: calls.filter(c => c[0] === 'request').reduce((a, c) => a + c[1], 0) }; }));
console.log(v, JSON.stringify(chk));
const scr = [...[0,5,20,40,47,48,50,66].flatMap(c => [{ screen: 'home', eqCh: c }, { screen: 'config', eqCh: c }, { screen: 'chain', eqCh: c }, { screen: 'eq', eqCh: c }, { screen: 'dyn', dynSlot: 'gate', eqCh: c }, { screen: 'dyn', dynSlot: 'comp', eqCh: c }, { screen: 'ins', insSlot: 'preins', eqCh: c }, { screen: 'ins', insSlot: 'postins', eqCh: c }, { screen: 'sends', eqCh: c }]), { sendPop: { i: 3, bank: 0 } }, { sendPop: null }, { screen: 'bus' }, { screen: 'mon' }, { screen: 'osc' }, { screen: 'rec' }, { screen: 'routing' }, { screen: 'lib' }, { screen: 'settings' },{ screen: 'main' }, { screen: 'main', bank: 2 }, { screen: 'eq', eqCh: 3 }, { screen: 'dyn', dynSlot: 'gate', eqCh: 3 }, { screen: 'dyn', dynSlot: 'comp', eqCh: 3 }, { screen: 'ins', insSlot: 'preins', eqCh: 3 }, { screen: 'fx' }];
for (let n = 1; n <= 16; n++) scr.push({ screen: 'fxed', fxEd: { n, from: 'fx' } });
scr.push({ screen: 'main', bank: 0 });
for (const s of scr) { const e0 = errs.length, t = Date.now(); const r = await T(p.evaluate(x => { __app.setState(x); return new Promise(r => setTimeout(() => r(1), 200)); }, s)); const dt = Date.now() - t;
  if (r === 'TIMEOUT' || dt > 800 || errs.length > e0) console.log('  ', JSON.stringify(s), r, dt + 'ms', errs.slice(e0, e0 + 2).join(' | ')); if (r === 'TIMEOUT') break; }
console.log('caught:', JSON.stringify(await T(p.evaluate(() => (__app.logLines || []).filter(l => /screen error/.test(l)))))); await T(p.evaluate(() => { calls.length = 0; __app.setLive(true); })); await p.waitForTimeout(1500);
for (const s of scr) { const r = await T(p.evaluate(x => { __app.setState(x); return new Promise(r => setTimeout(() => r(1), 150)); }, s)); if (r === 'TIMEOUT') { console.log('LIVE TIMEOUT', JSON.stringify(s)); break; } }
await p.waitForTimeout(1500);
console.log('live sends without hand:', JSON.stringify(await T(p.evaluate(() => { const S = calls.filter(c => c[0] === 'setNative' || c[0] === 'set'); return [S.length, S.slice(0, 5)]; }))));
console.log(v, 'faders', await T(p.evaluate(() => document.querySelectorAll('button.fader').length)));
await b.close();
