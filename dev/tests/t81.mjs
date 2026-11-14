import fs from 'fs';
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 640 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8765/index.html'); await p.waitForTimeout(900);
await p.evaluate(() => __wingNative([{ type: 'osc', address: '/ch/1/fdr', args: [0, 0.7, -5] }, { type: 'nativeOpen' }])); await p.waitForTimeout(300);
await p.evaluate(() => { __app.setLive(true); });
// desk reports FX 1 = HALL and its decay
const src = fs.readFileSync('demo.html', 'utf8'); const G = JSON.parse(/const WMAP = (\{.*?\});\n/s.exec(src)[1]).G; const gid = p => parseInt(G[p], 36) | 0;
const id = [gid('/fx/1/mdl'), gid('/fx/1/p3'), gid('/fx/1/p7')];
console.log('ids', id);
await p.evaluate(([a, b]) => __wingNative([{ type: 'nat', id: a, s: 'HALL' }, { type: 'nat', id: b, v: 2.4 }]), id); await p.waitForTimeout(300);
await p.evaluate(() => { calls.length = 0; __app.setState({ screen: 'fxed', fxEd: { n: 1, from: 'fx' } }); }); await p.waitForTimeout(500);
console.log('req', JSON.stringify(await p.evaluate(() => calls.filter(c => c[0] === 'request'))));
console.log('monv p3', await p.evaluate(() => __app.state.monv['/fx/1/p3']));
// drag the DECAY knob up
const k = await p.$('button[aria-label^="DECAY"]'); const bb = await k.boundingBox();
await p.evaluate(() => { calls.length = 0; });
await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2 - 60, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(600);
console.log('sent', JSON.stringify(await p.evaluate(() => calls.filter(c => c[0] === 'setNative'))));
// switch HI CUT value through choice? pick model change
await p.evaluate(() => { calls.length = 0; __app.fxSetModel(1, 'ROOM'); }); await p.waitForTimeout(900);
console.log('model', JSON.stringify(await p.evaluate(() => calls.filter(c => c[0] === 'setNative' || c[0] === 'request'))));
// insert on channel 1
await p.evaluate(() => { calls.length = 0; __app.mx[0]['preins/ins'] = 'NONE'; __app.mx[0]['preins/on'] = 0; __app.setState(s => __app.injectAll(s, new Set([0]))); }); await p.waitForTimeout(200);
await p.evaluate(() => { __app.setState({ screen: 'ins', insSlot: 'preins', eqCh: 0 }); }); await p.waitForTimeout(400);
await p.evaluate(() => { calls.length = 0; __app.setIns(0, 'preins', { fx: 3, on: true }); }); await p.waitForTimeout(700);
console.log('ins', JSON.stringify(await p.evaluate(() => calls.filter(c => c[0] === 'setNative'))));
await p.screenshot({ path: 'q-ins-live.png' });
console.log(errs); await b.close();
