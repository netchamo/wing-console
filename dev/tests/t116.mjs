// round trip: desk value -> app -> what the app would write. Every key that does not come back the same is a value the app could change on the desk.
import fs from 'fs';
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const page = process.argv[2] || 'index'; const msgs = JSON.parse(fs.readFileSync('fuzz.json'));
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 640 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto(`http://127.0.0.1:8765/${page}.html`); await p.waitForTimeout(900);
await p.evaluate(() => { __wingNative([{ type: 'osc', address: '/ch/1/fdr', args: [0, 0.7, -5] }, { type: 'nativeOpen' }]); setInterval(() => __wingNative([{ type: 'osc', address: '/ch/1/fdr', args: [0, 0.7, -5] }]), 1000); });
for (let k = 0; k < msgs.length; k += 400) await p.evaluate(m => __wingNative(m), msgs.slice(k, k + 400));
await p.waitForTimeout(800);
const bad = {};
for (const s of [0, 2, 17, 39, 41, 47, 48, 50, 63, 66, 74]) {
  for (const scr of ['eq', 'dyn:comp', 'dyn:gate', 'home', 'config', 'ins', 'sends']) {
    await p.evaluate(([s, scr]) => __app.setState({ screen: scr.split(':')[0], eqCh: s, dynSlot: scr.split(':')[1] || 'comp', insSlot: 'preins' }), [s, scr]); await p.waitForTimeout(350);
    const r = await p.evaluate(s => { const mx = __app.mx[s], d = __app.deriveStrip(__app.state, s), out = [];
      const near = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.002) : String(a) === String(b);
      for (const k in d) if (k in mx && !near(d[k], mx[k]) && k !== 'tags') out.push(k + ': desk ' + JSON.stringify(mx[k]) + ' app ' + JSON.stringify(d[k])); return out; }, s);
    for (const x of r) { const key = x.split(':')[0]; (bad[key] = bad[key] || []).push(s + '/' + scr + ' ' + x.slice(key.length + 2)); }
  }
}
for (const k in bad) console.log(k, bad[k].length, '|', bad[k].slice(0, 3).join(' ; '));
console.log('keys', Object.keys(bad).length, errs.slice(0, 3)); await b.close();
