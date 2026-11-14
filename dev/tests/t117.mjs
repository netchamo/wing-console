// live, desk with everything set (cuts, slopes, models): tap through tabs and EQ band buttons like a user; nothing may be sent
import fs from 'fs';
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const msgs = JSON.parse(fs.readFileSync('fuzz.json'));
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 640 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto(`http://127.0.0.1:8765/idx_cur.html`); await p.waitForTimeout(900);
await p.evaluate(() => { __wingNative([{ type: 'osc', address: '/ch/1/fdr', args: [0, 0.7, -5] }, { type: 'nativeOpen' }]); setInterval(() => __wingNative([{ type: 'osc', address: '/ch/2/mute', args: ['0', 0, 0] }]), 1000); });
for (let k = 0; k < msgs.length; k += 400) await p.evaluate(m => __wingNative(m), msgs.slice(k, k + 400));
await p.evaluate(() => __app.setLive(true)); await p.waitForTimeout(2000);
await p.evaluate(() => { calls.length = 0; });
const tapText = async t => { const el = (await p.$$('button')).find ? null : null; const h = await p.evaluateHandle(t => [...document.querySelectorAll('button')].find(e => e.offsetParent && e.textContent.trim() === t), t); const e = h.asElement(); if (e) { await e.click(); await p.waitForTimeout(400); return true; } return false; };
let taps = 0;
for (const s of [2, 17, 41, 48, 50, 63, 66, 74]) {
  await p.mouse.click(600, 20); await p.evaluate(s => __app.setState({ screen: 'eq', eqCh: s }), s); await p.waitForTimeout(500);
  for (const t of ['L', '1', '2', '3', '4', ...(s >= 48 ? ['5', '6'] : []), 'H', 'HOME', 'EQ', 'COMP', 'GATE', 'INS 1', 'INS 2', 'SENDS', 'CHAIN', 'OUTPUTS', 'CONFIG', 'EQ']) if (await tapText(t)) taps++;
}
await p.waitForTimeout(1500);
const S = await p.evaluate(() => calls.filter(c => c[0] === 'setNative' || c[0] === 'set'));
console.log('taps', taps, 'sent', S.length, JSON.stringify(S.slice(0, 8)), errs.slice(0, 2)); await b.close();
