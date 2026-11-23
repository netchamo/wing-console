/* Replays an analyser capture (from REC 8s) through the app and the fake mixer, and measures how calm the picture is.
   node rta-replay.mjs capture.txt [out-dir]   – without a file, a synthetic capture with uneven packet timing is used. */
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)), out = process.argv[3] || '/tmp/rta-replay'; fs.mkdirSync(out, { recursive: true });
let rows;
if (process.argv[2] && fs.existsSync(process.argv[2])) rows = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(l => /^\d+,/.test(l)).map(l => l.split(',').map(Number));
else { rows = []; let t = 0; const hz = k => 20 * Math.pow(1000, k / 99);
  for (let n = 0; n < 160; n++) { t += [20, 20, 80, 35, 140, 10][n % 6]; const beat = (t % 500) < 90 ? 10 : 0, v = [];
    for (let k = 0; k < 100; k++) { const f = hz(k); v.push(Math.round(-52 - 4 * Math.log2(Math.max(1, f / 300)) + (f < 150 ? beat * 1.4 : beat * 0.4) + 9 * Math.exp(-Math.pow(Math.log2(f / 250) * 4, 2)) + 8 * (Math.random() - 0.5))); }
    rows.push([t, ...v]); } }
const srv = http.createServer((q, r) => { const f = path.join(here, q.url.split('?')[0].replace(/^\/+/, '')); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); r.end(d); }); }).listen(8790);
const B = await chromium.launch(), p = await B.newPage({ viewport: { width: 1180, height: 640 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8790/index.html'); await p.waitForTimeout(2500);
await p.evaluate(r => { fake.rtaReplay = r; const s = __app.L().ch[0]; fake.emit('/-stat/rta/source', 'i', 0); __app.setState({ screen: 'eq', sheet: s.id }); }, rows);
await p.waitForTimeout(2500);
/* calm: how far the drawn curve moves per 50 ms frame (dB, median over bins), and how far the window moves */
const m = await p.evaluate(() => new Promise(res => { const a = [], w = []; let prev = null, pw = null, n = 0; const iv = setInterval(() => { const S = Array.from(__app.rtaS);
  if (prev) a.push(S.reduce((x, v, i) => x + Math.abs(v - prev[i]), 0) / S.length); if (pw !== null) w.push(Math.abs(__app.rtaTop - pw)); prev = S; pw = __app.rtaTop; if (++n > 80) { clearInterval(iv); res({ move: a.reduce((x, y) => x + y, 0) / a.length, maxMove: Math.max(...a), win: w.reduce((x, y) => x + y, 0), top: __app.rtaTop, hot: (__app.rtaHot || []).map(h => Math.round(h.f)) }); } }, 50); }));
for (let i = 0; i < 4; i++) { await p.screenshot({ path: `${out}/f${i}.png`, clip: { x: 0, y: 50, width: 1180, height: 470 } }); await p.waitForTimeout(700); }
console.log(JSON.stringify({ frames: rows.length, ...m, errs }));
await B.close(); srv.close();
