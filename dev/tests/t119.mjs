// app start with live on, desk values arriving slowly while the user taps: are faders ever sent / shown wrong?
import fs from 'fs';
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const msgs = JSON.parse(fs.readFileSync('fuzz.json'));
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 640 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto(`http://127.0.0.1:8765/${process.argv[2] || 'idx_cur'}.html`); await p.waitForTimeout(700);
await p.evaluate(() => { try { __app.setLive(true); } catch (e) {} });
await p.evaluate(() => { __wingNative([{ type: 'osc', address: '/ch/9/fdr', args: [0, 0.7, -5] }, { type: 'nativeOpen' }]); setInterval(() => __wingNative([{ type: 'osc', address: '/ch/9/mute', args: ['0', 0, 0] }]), 700); });
for (let k = 0; k < msgs.length; k += 150) { await p.evaluate(m => __wingNative(m), msgs.slice(k, k + 150)); if (k % 1500 === 0) await p.mouse.click(600, 30); await p.waitForTimeout(40); }
await p.waitForTimeout(2500);
const r = await p.evaluate(() => ({ live: __app.state.conn.live, linked: __app.isLinked(), v: __app.state.chans.slice(0, 8).map(c => Math.round(c.v * 100) / 100), mx: [0, 1, 2, 3, 4, 5, 6, 7].map(s => __app.mx[s] && __app.mx[s].fdr), sent: calls.filter(c => c[0] === 'setNative' || c[0] === 'set').slice(0, 10) }));
console.log(JSON.stringify(r), errs.slice(0, 2)); await b.close();
