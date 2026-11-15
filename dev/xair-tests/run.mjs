// All X-Air app tests. Run:  python3 regen.py && node run.mjs      (serves this folder itself on :8766)
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), PORT = 8766;
const srv = http.createServer((q, r) => { const f = path.join(here, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); r.end(d); }); }).listen(PORT);
const B = await chromium.launch(); let fails = 0, n = 0;
const ok = (name, cond, detail = '') => { n++; if (!cond) fails++; console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + detail)); };
async function open(url, vp = { width: 1180, height: 640 }) { const p = await B.newPage({ viewport: vp }); p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); }); await p.goto(`http://127.0.0.1:${PORT}/${url}`); await p.waitForTimeout(700); return p; }
const tap = async (p, text) => { const h = await p.evaluateHandle(t => [...document.querySelectorAll('button')].find(e => e.offsetParent && !e.disabled && e.textContent.trim() === t), text); const e = h.asElement(); if (!e) return false; await e.click(); await p.waitForTimeout(160); return true; };
// drag a fader's knob by dy screen pixels (negative = up)
async function drag(p, path, dy) { const cap = await p.$(`[data-f="${path}"] .cap`); if (!cap) return false; const b = await cap.boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
  await p.mouse.move(x, y); await p.mouse.down(); for (let k = 1; k <= 8; k++) { await p.mouse.move(x, y + dy * k / 8); await p.waitForTimeout(25); } await p.mouse.up(); await p.waitForTimeout(160); return true; }
async function hdrag(p, sel, dx, dy = 0) { const el = await p.$(sel); if (!el) return false; const b = await el.boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
  await p.mouse.move(x, y); await p.mouse.down(); for (let k = 1; k <= 6; k++) { await p.mouse.move(x + dx * k / 6, y + dy * k / 6); await p.waitForTimeout(25); } await p.mouse.up(); await p.waitForTimeout(180); return true; }
const click = async (p, sel) => { await p.mouse.move(3 + Math.random() * 4, 3);   /* a real pointer event: the app only writes shortly after a hand action */
  const ok = await p.evaluate(sel => { const e = document.querySelector(sel); if (e) e.click(); return !!e; }, sel); await p.waitForTimeout(160); return ok; };
const back = p => click(p, '.backbtn');
const sets = p => p.evaluate(() => fake.sets.slice());
const names = p => p.evaluate(() => [...document.querySelectorAll('.strip .cname')].map(e => e.textContent.trim()));
const status = p => p.evaluate(() => __app.state.conn.status + '/' + __app.state.conn.model + '/' + __app.state.conn.live);
const walk = async p => { let t = 0; for (const x of ['In 9–16', 'Returns', 'Buses', 'FX · DCA', 'In 1–8', 'SENDS']) if (await tap(p, x)) t++;
  const nd = await p.evaluate(() => __app.L().dests.length); for (let k = 0; k < nd; k++) { await p.evaluate(k => document.querySelectorAll('.sofrow button')[k].click(), k); await p.waitForTimeout(90); t++; }
  for (const x of ['Returns', 'In 1–8', 'SENDS']) if (await tap(p, x)) t++;
  for (const k of [0, 3, 8]) { await p.evaluate(k => document.querySelectorAll('.strip .cname')[k].click(), k); await p.waitForTimeout(200); for (const tb of ['CONFIG', 'EQ', 'GATE', 'COMP', 'SENDS']) if (await click(p, `[data-tab="${tb}"]`)) t++; await click(p, '[data-bs="3"]'); await click(p, '[aria-label="Next strip"]'); await back(p); }
  if (await tap(p, 'נגן ומקליט USB')) { t++; await p.waitForTimeout(300); await back(p); }
  await tap(p, 'הגדרות'); await p.waitForTimeout(150); await p.evaluate(() => document.querySelector('.backbtn').click()); await p.waitForTimeout(150); return t; };

/* ---------- units ---------- */
{ const p = await open('demo.html');
  const u = await p.evaluate(() => { const { q, dbOf, posOf, STEPS, oscMsg, oscParse } = __xm; let bad = 0;
    for (const N of [1024, 161, 101]) for (let i = 0; i < N; i++) { const v = Math.fround(i / (N - 1)); if (q(v, N) !== v) bad++; }
    let inv = 0; for (let i = 1; i < 1024; i++) { const v = i / 1023; if (Math.abs(posOf(dbOf(v)) - v) > 1e-9) inv++; }
    const m = oscParse(oscMsg('/ch/01/mix/fader', [['f', 0.5], ['i', -3], ['s', 'שלום']]));
    return { bad, inv, m, z: dbOf(0), top: dbOf(1), zero: dbOf(0.75) }; });
  ok('grid values survive a round trip exactly (1024 / 161 / 101 steps)', u.bad === 0, u.bad);
  ok('fader law is its own inverse', u.inv === 0 && u.z === -Infinity && u.top === 10 && u.zero === 0, JSON.stringify(u));
  ok('OSC encode → decode', u.m.addr === '/ch/01/mix/fader' && u.m.args[0] === 0.5 && u.m.args[1] === -3 && u.m.args[2] === 'שלום', JSON.stringify(u.m));
  /* ---------- demo (browser, no bridge) ---------- */
  await tap(p, 'המשך בלי מסך מלא');
  const nm = await names(p); ok('demo: 8 strips + master, demo names', nm.length === 9 && nm[0] === 'KICK', nm.join(','));
  const d0 = await p.evaluate(() => __app.demo['/ch/01/mix/fader']); await drag(p, '/ch/01/mix/fader', -50);
  const d1 = await p.evaluate(() => __app.demo['/ch/01/mix/fader']); ok('demo: fader moves', d1 > d0, d0 + '→' + d1);
  await p.evaluate(() => document.querySelectorAll('.strip .ms button')[0].click()); ok('demo: mute toggles', await p.evaluate(() => __app.demo['/ch/01/mix/on'] === 0));
  await tap(p, 'Buses'); ok('demo XR16: 6 buses', (await names(p)).filter(x => /^MON/.test(x)).length === 6);
  await tap(p, 'הגדרות'); await tap(p, 'XR18'); await p.evaluate(() => document.querySelector('.backbtn').click()); await p.waitForTimeout(200); await tap(p, 'Buses');
  ok('demo XR18: 6 buses', (await names(p)).filter(x => /^MON/.test(x)).length === 6);
  await tap(p, 'הגדרות'); await tap(p, 'XR12'); await p.evaluate(() => document.querySelector('.backbtn').click()); await p.waitForTimeout(200);
  ok('demo XR12: second layer is In 9–12 with 4 strips', await tap(p, 'In 9–12') && (await names(p)).length === 5, (await names(p)).join(','));
  ok('demo: no page errors', p.errs.length === 0, p.errs.join(' | ')); await p.close(); }

/* ---------- demo play, then the mixer appears: nothing of the demo reaches it ---------- */
{ const p = await open('index.html?model=XR16&delay=3000');
  ok('before the mixer answers: demo', (await status(p)).startsWith('search'), await status(p));
  await drag(p, '/ch/01/mix/fader', -80); await p.evaluate(() => { document.querySelectorAll('.strip .ms button')[0].click(); document.querySelectorAll('.strip .ms button')[1].click(); });
  await tap(p, 'SENDS'); await drag(p, '/ch/02/mix/01/level', -60); await tap(p, 'SENDS');
  await p.waitForTimeout(4500);
  ok('auto-detect: connected, model from the mixer, read only', (await status(p)) === 'connected/XR16W/false', await status(p));
  const r = await p.evaluate(() => ({ sets: fake.sets.length, f: __app.desk['/ch/01/mix/fader'], ff: fake.store['/ch/01/mix/fader'][1], on: __app.desk['/ch/01/mix/on'], nm: [...document.querySelectorAll('.strip .cname')].map(e => e.textContent.trim()) }));
  ok('demo play sent nothing', r.sets === 0, r.sets);
  ok('the screen shows the mixer, not the demo', r.f === r.ff && r.on === 1 && r.nm[0] === 'D01' && r.nm[6] === 'CH 07' && r.nm[8] === 'MAIN', JSON.stringify(r));
  ok('no page errors', p.errs.length === 0, p.errs.join(' | ')); await p.close(); }

/* ---------- read only, then live ---------- */
{ const p = await open('index.html?model=XR16'); await p.waitForTimeout(2500);
  ok('connected without any question', (await status(p)) === 'connected/XR16W/false', await status(p));
  const wrong = await p.evaluate(() => { const bad = []; for (const k in __app.desk) if (fake.store[k] && fake.store[k][1] !== __app.desk[k]) bad.push(k); return { bad, n: Object.keys(__app.desk).length, miss: [...__app.missing] }; });
  ok('every value read equals the mixer', wrong.bad.length === 0 && wrong.n > 180, JSON.stringify(wrong).slice(0, 300));
  await tap(p, 'Buses'); ok('XR16: 6 buses shown', (await names(p)).filter(x => /^BUS/.test(x)).length === 6, (await names(p)).join(',')); await tap(p, 'In 1–8');
  const f0 = await p.evaluate(() => __app.desk['/ch/01/mix/fader']); await drag(p, '/ch/01/mix/fader', -60);
  const ro = await p.evaluate(() => ({ sets: fake.sets.length, f: __app.desk['/ch/01/mix/fader'], toast: __app.state.toast }));
  ok('read only: a drag sends nothing, value stays, toast shown', ro.sets === 0 && ro.f === f0 && /קריאה בלבד/.test(ro.toast), JSON.stringify(ro));
  await p.evaluate(() => document.querySelectorAll('.strip .ms button')[0].click()); await p.waitForTimeout(100);
  ok('read only: mute tap sends nothing', (await sets(p)).length === 0 && await p.evaluate(() => __app.desk['/ch/01/mix/on'] === 1));
  await p.evaluate(() => document.querySelectorAll('.strip .cname')[0].click()); await p.waitForTimeout(700);
  await click(p, '[data-tab="EQ"]');
  await hdrag(p, '[data-p="/ch/01/eq/1/f"]', 60); await hdrag(p, '[data-band="2"]', 50, -30); await click(p, '[data-tab="CONFIG"]'); await click(p, '[data-c="5"]'); await click(p, '[data-t="/ch/01/preamp/invert"]');
  const shown = await p.evaluate(() => { const t = sel => { const e = document.querySelector(sel); return e ? e.parentElement.querySelector('.hv').textContent.trim() : null; }; return [t('[data-p="/ch/01/preamp/hpf"]'), t('[data-p="/headamp/01/gain"]')]; });
  ok('real XR16 values read as on the mixer: low cut 100 Hz, gain +0.5 dB', shown[0] === '100 Hz' && shown[1] === '+0.5 dB', JSON.stringify(shown));
  await click(p, '[data-tab="GATE"]'); const gt = await p.evaluate(() => ['hold', 'release', 'thr'].map(k => document.querySelector(`[data-p="/ch/01/gate/${k}"]`).parentElement.querySelector('.hv').textContent.trim()));
  ok('gate times read as on the mixer: hold 502 ms, release 983 ms, threshold -62.0 dB', gt[0] === '502 ms' && gt[1] === '983 ms' && gt[2] === '-62.0 dB', JSON.stringify(gt));
  await back(p); ok('read only: the channel screen sends nothing', (await sets(p)).length === 0, JSON.stringify(await sets(p)));
  const w1 = await walk(p); ok(`read only: walking every view (${w1} taps) sends nothing`, (await sets(p)).length === 0, JSON.stringify(await sets(p)));
  await tap(p, 'LIVE OFF'); ok('live asks first', await p.evaluate(() => __app.state.liveAsk && !fake.live)); await tap(p, 'Turn on');
  ok('live on', (await status(p)) === 'connected/XR16W/true' && await p.evaluate(() => fake.live));
  await p.waitForTimeout(6500); ok('live, hands off for 6.5 s (refresh included): nothing sent', (await sets(p)).length === 0, JSON.stringify(await sets(p)));
  const w2 = await walk(p); await p.waitForTimeout(600); ok(`live: walking every view (${w2} taps) sends nothing`, (await sets(p)).length === 0, JSON.stringify(await sets(p)));
  await drag(p, '/ch/01/mix/fader', -60); let S = await sets(p);
  const g = await p.evaluate(() => ({ app: __app.desk['/ch/01/mix/fader'], fake: fake.store['/ch/01/mix/fader'][1] }));
  ok('live: a fader drag sends only that fader, on the 1024 grid', S.length > 0 && S.every(s => s[0] === '/ch/01/mix/fader' && s[1] === 'f' && Math.abs(s[2] * 1023 - Math.round(s[2] * 1023)) < 1e-3) && g.app === g.fake && g.app > f0, JSON.stringify(S.slice(0, 3)) + JSON.stringify(g));
  let c0 = S.length; await p.evaluate(() => document.querySelectorAll('.strip .ms button')[2].click()); await p.waitForTimeout(150); S = await sets(p);
  ok('live: mute sends one value', S.length === c0 + 1 && S[c0][0] === '/ch/02/mix/on' && S[c0][1] === 'i' && S[c0][2] === 0, JSON.stringify(S.slice(c0)));
  c0 = S.length; await p.evaluate(() => document.querySelectorAll('.strip .ms button')[3].click()); await p.waitForTimeout(150); S = await sets(p);
  ok('live: solo sends one value', S.length === c0 + 1 && S[c0][0] === '/-stat/solosw/02' && S[c0][2] === 1, JSON.stringify(S.slice(c0)));
  c0 = S.length; await tap(p, 'SENDS'); await p.evaluate(() => document.querySelectorAll('.sofrow button')[1].click()); await p.waitForTimeout(500); await drag(p, '/ch/03/mix/02/level', -50); S = await sets(p);
  ok('live: sends on faders moves only that send, on the 161 grid', S.length > c0 && S.slice(c0).every(s => s[0] === '/ch/03/mix/02/level' && Math.abs(s[2] * 160 - Math.round(s[2] * 160)) < 1e-3), JSON.stringify(S.slice(c0, c0 + 3)));
  await p.evaluate(() => document.querySelectorAll('.sofrow button')[7].click()); await p.waitForTimeout(500);
  ok('FX 2 send is mix 08', !!(await p.$('[data-f="/ch/01/mix/08/level"] .cap')));
  await tap(p, 'SENDS'); c0 = (await sets(p)).length;
  await p.evaluate(() => document.querySelectorAll('.strip .cname')[0].click()); await p.waitForTimeout(700);
  await click(p, '[data-tab="EQ"]'); c0 = (await sets(p)).length;
  await hdrag(p, '[data-p="/ch/01/eq/1/f"]', 60); S = await sets(p);
  ok('live: an EQ slider sends only that value, on the 201 grid', S.length > c0 && S.slice(c0).every(s => s[0] === '/ch/01/eq/1/f' && s[1] === 'f' && Math.abs(s[2] * 200 - Math.round(s[2] * 200)) < 1e-3), JSON.stringify(S.slice(c0, c0 + 3)));
  c0 = S.length; await hdrag(p, '[data-band="2"]', 50, -30); S = await sets(p);
  ok('live: dragging an EQ point sends its freq and gain only', S.length > c0 && S.slice(c0).every(s => s[0] === '/ch/01/eq/2/f' || s[0] === '/ch/01/eq/2/g') && S.slice(c0).some(s => s[0] === '/ch/01/eq/2/g'), JSON.stringify(S.slice(c0, c0 + 4)));
  c0 = S.length; await click(p, '[data-e="/ch/01/eq/2/type=4"]'); await click(p, '[data-tab="CONFIG"]'); await click(p, '[data-c="5"]'); S = await sets(p);
  ok('live: band type and colour send one value each', S.length === c0 + 2 && S[c0][0] === '/ch/01/eq/2/type' && S[c0][2] === 4 && S[c0 + 1][0] === '/ch/01/config/color' && S[c0 + 1][1] === 'i' && S[c0 + 1][2] === 5, JSON.stringify(S.slice(c0)));
  c0 = S.length; await click(p, '[data-t="/headamp/01/phantom"]'); const asked = await p.evaluate(() => !!__app.state.ask); const before = (await sets(p)).length; await click(p, '[data-yes]'); S = await sets(p);
  ok('live: 48V asks first, then sends one value', asked && before === c0 && S.length === c0 + 1 && S[c0][0] === '/headamp/01/phantom' && S[c0][2] === 1, JSON.stringify(S.slice(c0)));
  c0 = S.length; await p.fill('input[aria-label="Name"]', 'Guitar'); await tap(p, 'SAVE'); S = await sets(p);
  ok('live: a name is sent as text', S.length === c0 + 1 && S[c0][0] === '/ch/01/config/name' && S[c0][1] === 's' && S[c0][2] === 'Guitar', JSON.stringify(S.slice(c0)));
  await back(p); c0 = S.length; await drag(p, '/ch/07/mix/fader', -40); await p.waitForTimeout(700); S = await sets(p);
  const pair = await p.evaluate(() => [__app.desk['/ch/07/mix/fader'], __app.desk['/ch/08/mix/fader'], fake.store['/ch/08/mix/fader'][1]]);
  ok('live: a linked pair – only the touched fader is sent, the partner is read back', S.length > c0 && S.slice(c0).every(s => s[0] === '/ch/07/mix/fader') && pair[0] === pair[1] && pair[1] === pair[2], JSON.stringify(pair));
  c0 = S.length; await tap(p, 'נגן ומקליט USB'); await p.waitForTimeout(500); await click(p, '[data-tp="2"]'); await click(p, '[data-tp="4"]'); const recAsk = await p.evaluate(() => !!__app.state.ask) && (await sets(p)).length === c0 + 1; await click(p, '[data-yes]'); S = await sets(p);
  ok('live: PLAY sends state 2; REC asks first, then state 4', recAsk && S.length === c0 + 2 && S[c0][0] === '/-stat/tape/state' && S[c0][1] === 'i' && S[c0][2] === 2 && S[c0 + 1][2] === 4, JSON.stringify(S.slice(c0)));
  await click(p, '[data-tp="0"]'); await back(p); c0 = (await sets(p)).length;
  await p.evaluate(() => fake.emit('/ch/05/mix/fader', 'f', 0.25)); await p.waitForTimeout(250);
  ok('a change made on the mixer shows up, nothing sent back', await p.evaluate(() => document.querySelectorAll('.strip .dbr')[4].textContent.trim() === '-30.0') && (await sets(p)).length === c0);
  await p.waitForTimeout(1800); const blocked = await p.evaluate(() => __app.set('/ch/01/mix/fader', 'f', 0.5));
  ok('no hand action → set() refuses', blocked === false && (await sets(p)).length === c0);
  await p.mouse.move(600, 20); await p.evaluate(() => { delete __app.desk['/ch/04/mix/on']; __app.pend.delete('/ch/04/mix/on'); document.querySelectorAll('.strip .ms button')[6].click(); }); await p.waitForTimeout(120);
  ok('a value the mixer has not reported is never sent', (await sets(p)).length === c0);
  await p.evaluate(() => { fake.silent = true; }); await p.waitForTimeout(9500);
  ok('mixer silent → NO ANSWER', (await status(p)).startsWith('lost'), await status(p)); await drag(p, '/ch/01/mix/fader', 40);
  ok('no answer: nothing is sent', (await sets(p)).length === c0);
  await p.evaluate(() => { fake.store['/ch/06/mix/fader'] = ['f', 0.5]; fake.silent = false; }); await p.waitForTimeout(5000);
  ok('mixer back → connected and re-read', (await status(p)).startsWith('connected') && await p.evaluate(() => __app.desk['/ch/06/mix/fader'] === 0.5), await status(p));
  ok('the native side never had to block a value', await p.evaluate(() => fake.blocked.length === 0));
  ok('no page errors', p.errs.length === 0, p.errs.join(' | ')); await p.close(); }

/* ---------- strange mixer data: shown, never written back ---------- */
for (const seed of [1, 2, 3]) { const p = await open('index.html?model=XR18'); await p.waitForTimeout(2500); await tap(p, 'LIVE OFF'); await tap(p, 'Turn on');
  const sent = await p.evaluate(seed => { let s = seed * 7919; const R = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff, out = [];
    for (const k in fake.store) { const [t] = fake.store[k]; let v;
      if (t === 'f') v = Math.fround(R() < 0.5 ? R() : Math.round(R() * 1023) / 1023); else if (t === 'i') v = /color/.test(k) ? (R() < 0.1 ? 99 : Math.floor(R() * 16)) : R() < 0.05 ? 7 : R() < 0.5 ? 1 : 0;
      else v = R() < 0.2 ? '' : R() < 0.2 ? 'שם ארוך מאוד מאוד מאוד' : 'N' + Math.floor(R() * 99);
      if (R() < 0.03) { v = t === 'f' ? 'oops' : 0.5; fake.emit(k, t === 'f' ? 's' : 'f', v); } else fake.emit(k, t, v); out.push(k); }
    return out.length; }, seed);
  await p.waitForTimeout(700); const w = await walk(p); await p.waitForTimeout(6000);
  const r = await p.evaluate(() => { const bad = []; for (const k in __app.desk) if (fake.store[k] && fake.store[k][1] !== __app.desk[k]) bad.push(k); return { sets: fake.sets, bad }; });
  ok(`seed ${seed}: ${sent} odd values, ${w} taps, live: nothing written back`, r.sets.length === 0, JSON.stringify(r.sets.slice(0, 4)));
  ok(`seed ${seed}: the app holds exactly what the mixer said`, r.bad.length === 0, r.bad.slice(0, 5).join(','));
  ok(`seed ${seed}: no page errors, still on screen`, p.errs.length === 0 && (await names(p)).length === 9, p.errs.join(' | ')); await p.close(); }

/* ---------- models and the mixer report ---------- */
{ const p = await open('index.html?model=XR18', { width: 1200, height: 540 }); await p.waitForTimeout(2500); await tap(p, 'Buses');
  ok('XR18: model detected, 6 buses, no recorder note', (await status(p)) === 'connected/XR18W/false' && (await names(p)).filter(x => /^BUS/.test(x)).length === 6 && !(await p.evaluate(() => document.getElementById('stage').textContent.includes('נגן ומקליט USB'))));
  await tap(p, 'הגדרות'); await tap(p, 'הכן דוח'); await p.waitForTimeout(45000);
  const d = await p.evaluate(() => ({ d: __app.state.dump, t: __app.dumpText.slice(0, 400), sizes: __app.dumpParts.map(x => x.length), f: /\/ch\/01: config\/name="D01" config\/color=i1 mix\/fader=f0\.\d+/.test(__app.dumpText), sets: fake.sets.length }));
  ok('mixer report: reads only, finishes, in parts a chat can take, values typed', d.d && d.d.done && d.sets === 0 && /XR18W/.test(d.t) && d.sizes.length > 1 && d.sizes.every(x => x < 19000) && d.f, JSON.stringify(d));
  ok('no page errors (1200×540)', p.errs.length === 0, p.errs.join(' | ')); await p.close(); }
{ const p = await open('index.html?model=XR12'); await p.waitForTimeout(2500);
  await p.waitForTimeout(3500); await tap(p, 'Buses'); ok('XR12 that answers for 2 buses only: 2 shown', (await names(p)).filter(x => /^BUS/.test(x)).length === 2, (await names(p)).join(','));
  ok('XR12: 12 channels, recorder note', (await status(p)) === 'connected/XR12W/false' && await tap(p, 'In 9–12') && (await names(p)).length === 5 && await p.evaluate(() => document.getElementById('stage').textContent.includes('נגן ומקליט USB')));
  await p.close(); }

console.log(`\n${n - fails} of ${n} passed`); await B.close(); srv.close(); process.exit(fails ? 1 : 0);
