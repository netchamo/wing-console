// screenshots of the strip screens in demo:  node shot2.mjs [outdir]
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)), out = process.argv[2] || '/tmp/shots'; fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { fs.readFile(path.join(here, q.url.split('?')[0]), (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': q.url.includes('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); r.end(d); }); }).listen(8770);
const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1180, height: 640 } }), errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8770/demo.html'); await p.waitForTimeout(600); await p.evaluate(() => __app.setState({ started: true }));
for (const sc of ['home', 'config', 'eq', 'gate', 'comp', 'sends']) { await p.evaluate(sc => __app.setState({ screen: sc, sheet: 'ch1' }), sc); await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/n-${sc}.png` }); }
await p.evaluate(() => __app.setState({ screen: 'sends', sendPop: { k: 4 } })); await p.waitForTimeout(300); await p.screenshot({ path: out + '/n-sendpop.png' });
await p.evaluate(() => __app.setState({ screen: 'home', sheet: 'bus1', sendPop: null })); await p.waitForTimeout(600); await p.screenshot({ path: out + '/n-bus.png' });
await p.evaluate(() => __app.setState({ screen: 'main', sheet: null })); await p.waitForTimeout(300); await p.screenshot({ path: out + '/n-main.png' });
await p.evaluate(() => __app.setState({ screen: 'settings' })); await p.waitForTimeout(300); await p.screenshot({ path: out + '/n-settings.png' });
console.log('errors', errs.slice(0, 5), await p.evaluate(() => __app.logs.filter(l => l.includes('err')).slice(-3))); await b.close(); srv.close();
