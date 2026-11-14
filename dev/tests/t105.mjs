import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 640 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8765/demo.html'); await p.waitForTimeout(800); const g = await p.$('button.ghost'); if (g) await g.click();
const scr = process.argv[2] || 'set';
await p.evaluate(s => eval(s), process.argv[3] || '0'); await p.waitForTimeout(400);
if (process.argv[4]) { await p.evaluate(t => { const el = [...document.querySelectorAll('span')].find(e => e.textContent.trim() === t); el && el.scrollIntoView({ block: 'start' }); }, process.argv[4]); await p.waitForTimeout(300); }
await p.screenshot({ path: scr + '.png' }); console.log(errs); await b.close();
