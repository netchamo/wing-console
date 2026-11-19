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
/* the analyser's source is a viewing setting the app moves on its own while live (as the WING app does): left out of the general counts */
/* long press beside a fader's knob (near its bottom) */
async function longFader(p, path) { const fb = await (await p.$(`[data-f="${path}"]`)).boundingBox(); await p.mouse.move(fb.x + fb.width / 2, fb.y + fb.height - 30); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up(); await p.waitForTimeout(500); }
const sets = p => p.evaluate(() => fake.sets.filter(x => !x[0].startsWith('/-stat/rta/')));
const rawSets = p => p.evaluate(() => fake.sets.slice());
const names = p => p.evaluate(() => [...document.querySelectorAll('.strip .cname')].map(e => e.textContent.trim()));
const status = p => p.evaluate(() => __app.state.conn.status + '/' + __app.state.conn.model + '/' + __app.state.conn.live);
const walk = async p => { let t = 0; for (const x of ['In 9–16', 'Returns', 'Buses', 'FX · DCA', 'In 1–8', 'SENDS']) if (await tap(p, x)) t++;
  const nd = await p.evaluate(() => __app.L().dests.length); for (let k = 0; k < nd; k++) { await p.evaluate(k => document.querySelectorAll('.sofrow button')[k].click(), k); await p.waitForTimeout(90); t++; }
  for (const x of ['Returns', 'In 1–8', 'SENDS']) if (await tap(p, x)) t++;
  for (const k of [0, 3, 8]) { await p.evaluate(k => document.querySelectorAll('.strip .cname')[k].click(), k); await p.waitForTimeout(200); for (const tb of ['Config', 'EQ', 'Gate', 'Comp', 'Sends', 'Home']) if (await click(p, `[data-tab="${tb}"]`)) t++; await click(p, '[data-bs="3"]'); await click(p, '[aria-label="Next strip"]'); await back(p); }
  if (await p.$('[data-nav="tape"]')) { await p.evaluate(() => document.querySelector('[data-nav="tape"]').click()); t++; await p.waitForTimeout(300); await p.evaluate(() => document.querySelector('.backbtn').click()); await p.waitForTimeout(160); }
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
  ok('a channel opens on HOME with the WING tabs', await p.evaluate(() => __app.state.screen === 'home' && [...document.querySelectorAll('.tab')].map(e => e.textContent).join(',') === 'Home,Config,EQ,Gate,Comp,Sends'));
  await click(p, '[data-tab="EQ"]');
  await hdrag(p, '[data-p="/ch/01/eq/1/f"]', 60); await hdrag(p, '[data-band="2"]', 50, -30); await hdrag(p, '[data-band="0"]', 40); await click(p, '[data-tab="Config"]'); await click(p, '[data-name]'); await click(p, '[data-c="5"]'); await tap(p, 'CLOSE'); await click(p, '[data-t="/ch/01/preamp/invert"]');
  const shown = await p.evaluate(() => ['hpf', 'gain'].map(k => document.querySelector(`[data-v="${k}"]`).textContent.trim()));
  ok('real XR16 values read as on the mixer: low cut 100 Hz, gain +0.5 dB', shown[0] === '100 Hz' && shown[1] === '+0.5', JSON.stringify(shown));
  await click(p, '[data-tab="Gate"]'); await hdrag(p, '[data-p="/ch/01/gate/thr"]', 60); await hdrag(p, '[data-thr="graph"]', 30, -30);
  const gt = await p.evaluate(() => ['hold', 'release', 'thr'].map(k => document.querySelector(`[data-p="/ch/01/gate/${k}"] em`).textContent.trim()));
  ok('gate times read as on the mixer: hold 502 ms, release 983 ms, threshold -62.0 dB', gt[0] === '502 ms' && gt[1] === '983 ms' && gt[2] === '-62.0 dB', JSON.stringify(gt));
  await click(p, '[data-tab="Comp"]'); await hdrag(p, '[data-ratio]', 0, 40); await click(p, '[data-tab="Sends"]'); await click(p, '[data-sp="4"]'); await click(p, '[data-tap="4"]'); await tap(p, 'CLOSE');
  await click(p, '[data-tab="EQ"]'); await p.waitForTimeout(1300);
  ok('read only: the mixer analyses another strip – a note, no spectrum, nothing sent', await p.evaluate(() => !!document.querySelector('[data-rtanote]') && !document.querySelector('[data-rta]')) && (await rawSets(p)).length === 0, JSON.stringify(await rawSets(p)));
  await back(p); ok('read only: the channel screen sends nothing', (await rawSets(p)).length === 0, JSON.stringify(await rawSets(p)));
  await p.mouse.move(100, 120); const pb = await (await p.$('.strip .panmini')).boundingBox(); await p.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up(); await p.waitForTimeout(500);
  const pp1 = await p.evaluate(() => !!document.querySelector('[data-panpop]')); await click(p, '[data-ppv="L50"]');
  ok('read only: a long press on a pan opens the fine pan window, which sends nothing', pp1 && (await rawSets(p)).length === 0, JSON.stringify(await rawSets(p))); await tap(p, 'CLOSE');
  await longFader(p, '/ch/02/mix/fader');
  const sw = await p.evaluate(() => ({ id: __app.state.sendsWin && __app.state.sendsWin.id, n: document.querySelectorAll('[data-sendswin] .fader[data-f$="/level"]').length, m: document.querySelectorAll('[data-sm]').length, ch: !!document.querySelector('[data-sendswin] [data-f="/ch/02/mix/fader"]') }));
  ok('long press beside a fader opens the sends window: 10 sends with meters and the strip fader', sw.id === 'ch2' && sw.n === 10 && sw.m === 20 && sw.ch, JSON.stringify(sw));
  await drag(p, '/ch/02/mix/03/level', -40); ok('read only: the sends window sends nothing', (await rawSets(p)).length === 0); await tap(p, 'DONE');
  await click(p, '[data-busq="2"]'); const bq = await p.evaluate(() => ({ so: __app.state.sofOn, d: __app.L().dests[__app.state.sof].label, m: !!document.querySelector('.strip [data-f="/bus/2/mix/fader"]'), s1: !!document.querySelector('.strip [data-f="/ch/01/mix/02/level"]'), row: getComputedStyle(document.querySelector('.sofrow')).opacity }));
  ok('a bus square turns the faders into that bus mix, with its master on the right and the sends row on top', bq.so && bq.d === 'BUS 2' && bq.m && bq.s1 && +bq.row > 0.5, JSON.stringify(bq));
  await click(p, '[data-busq="2"]'); ok('the same square again: back to the main mix', await p.evaluate(() => !__app.state.sofOn && !!document.querySelector('.strip [data-f="/lr/mix/fader"]')));
  ok('six bus squares on the XR16', await p.evaluate(() => document.querySelectorAll('[data-busq]').length === 6));
  await click(p, '[data-nav="mute"]'); await p.waitForTimeout(500); await click(p, '[data-mg="1"]'); await tap(p, 'DONE');
  await (await p.$$('.strip .cname'))[0].click(); await p.waitForTimeout(300); await click(p, '[data-tab="Config"]'); await click(p, '[data-bit="/ch/01/grp/dca:1"]'); await back(p);
  await click(p, '[data-nav="routing"]'); await p.waitForTimeout(500); await click(p, '[data-insrc="3"]'); await click(p, '[data-kp="5"]'); await click(p, '[data-link="1"]'); await click(p, '[data-yes]');
  await click(p, '[data-rtab="out"]'); await p.waitForTimeout(400); await click(p, '[data-rsrc="/routing/aux/01"]'); await click(p, '[data-kp="36"]'); await back(p);
  await click(p, '[data-nav="fx"]'); await p.waitForTimeout(500); await click(p, '[data-fxslot="2"]'); await p.waitForTimeout(400); await hdrag(p, '[data-p="/fx/2/par/01"]', 60); await click(p, '[data-fxtype]'); await click(p, '[data-kp="10"]'); await click(p, '[data-yes]');
  ok('read only: mute groups, DCA, assignment, routing, links and effects send nothing', (await rawSets(p)).length === 0, JSON.stringify(await rawSets(p)));
  ok('the effects screen names the effect and lists its parameters (Rich Plate: 16)', await p.evaluate(() => document.querySelector('[data-fxname]').textContent === 'Rich Plate' && document.querySelector('[data-fxparams]').dataset.fxparams === '16'));
  await back(p);
  const w1 = await walk(p); ok(`read only: walking every view (${w1} taps) sends nothing`, (await sets(p)).length === 0, JSON.stringify(await sets(p)));
  await tap(p, 'LIVE OFF'); ok('live asks first', await p.evaluate(() => __app.state.liveAsk && !fake.live)); await tap(p, 'Turn on');
  ok('live on', (await status(p)) === 'connected/XR16W/true' && await p.evaluate(() => fake.live));
  await p.waitForTimeout(6500); ok('live, hands off for 6.5 s (refresh included): nothing sent', (await sets(p)).length === 0, JSON.stringify(await sets(p)));
  const w2 = await walk(p); await p.waitForTimeout(1200); const rs = await rawSets(p);
  ok(`live: walking every view (${w2} taps) sends only the analyser source, and gives it back`, (await sets(p)).length === 0 && rs.every(x => x[0] === '/-stat/rta/source' && x[1] === 'i') && rs.length > 0 && rs[rs.length - 1][2] === 8 && await p.evaluate(() => fake.store['/-stat/rta/source'][1] === 8), JSON.stringify(rs.slice(-4)));
  let r0 = rs.length; await (await p.$$('.strip .cname'))[0].click(); await p.waitForTimeout(1500);
  ok('live: HOME points the analyser at the strip and shows it in the EQ tile', await p.evaluate(() => fake.store['/-stat/rta/source'][1] === 0 && !!document.querySelector('[data-rta="mini"]')), JSON.stringify((await rawSets(p)).slice(r0)));
  await click(p, '[data-tab="EQ"]'); await p.waitForTimeout(600);
  ok('live: the EQ shows the spectrum', await p.evaluate(() => !!document.querySelector('[data-rta="eq"]') && !document.querySelector('[data-rtanote]')));
  await click(p, '[data-eqr]'); ok('EQ range button: ±18 → ±12', await p.evaluate(() => __app.state.prefs.eqR === 12 && document.querySelector('[data-eqr]').textContent.trim() === '±12 dB'));
  await click(p, '[data-eqr]'); await click(p, '[data-eqr]'); await click(p, '[data-eqr]'); await back(p); await p.waitForTimeout(600);
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
  c0 = S.length; await hdrag(p, '[data-band="0"]', 40); S = await sets(p);
  ok('live: the low cut point on the EQ graph sends the low cut frequency only', S.length > c0 && S.slice(c0).every(s => s[0] === '/ch/01/preamp/hpf' && Math.abs(s[2] * 100 - Math.round(s[2] * 100)) < 1e-3), JSON.stringify(S.slice(c0, c0 + 3)));
  c0 = S.length; await click(p, '[data-bs="2"]'); await click(p, '[data-e="/ch/01/eq/2/type=4"]'); await click(p, '[data-tab="Config"]'); await click(p, '[data-name]'); await click(p, '[data-c="5"]'); S = await sets(p);
  ok('live: band type and colour send one value each', S.length === c0 + 2 && S[c0][0] === '/ch/01/eq/2/type' && S[c0][2] === 4 && S[c0 + 1][0] === '/ch/01/config/color' && S[c0 + 1][1] === 'i' && S[c0 + 1][2] === 5, JSON.stringify(S.slice(c0)));
  c0 = S.length; await p.fill('input[aria-label="Name"]', 'Guitar'); await p.mouse.move(8, 8); await tap(p, 'SAVE'); S = await sets(p);
  ok('live: a name is sent as text', S.length === c0 + 1 && S[c0][0] === '/ch/01/config/name' && S[c0][1] === 's' && S[c0][2] === 'Guitar', JSON.stringify(S.slice(c0)));
  await p.waitForTimeout(800); await p.evaluate(() => fake.emit('/ch/01/config/name', 's', 'Guitar _23')); await p.waitForTimeout(250); await click(p, '[data-name]');
  const shownName = await p.evaluate(() => [document.querySelector('.topbar .tag').textContent.trim(), document.querySelector('input[aria-label="Name"]').value]);
  c0 = S.length; await p.fill('input[aria-label="Name"]', 'Gtr'); await p.mouse.move(9, 9); await tap(p, 'SAVE'); S = await sets(p);
  ok('names: the "_23" tail is hidden everywhere and kept when a name is saved', shownName[0] === 'Guitar' && shownName[1] === 'Guitar' && S.length === c0 + 1 && S[c0][2] === 'Gtr_23', JSON.stringify([shownName, S.slice(c0)]));
  c0 = S.length; await click(p, '[data-t="/headamp/01/phantom"]'); const asked = await p.evaluate(() => !!__app.state.ask); const before = (await sets(p)).length; await click(p, '[data-yes]'); S = await sets(p);
  ok('live: 48V asks first, then sends one value', asked && before === c0 && S.length === c0 + 1 && S[c0][0] === '/headamp/01/phantom' && S[c0][2] === 1, JSON.stringify(S.slice(c0)));
  c0 = S.length; await drag(p, '/headamp/01/gain', -30); S = await sets(p);
  ok('live: the gain fader sends the head amp gain on the 145 grid', S.length > c0 && S.slice(c0).every(s => s[0] === '/headamp/01/gain' && Math.abs(s[2] * 144 - Math.round(s[2] * 144)) < 1e-3), JSON.stringify(S.slice(c0, c0 + 3)));
  c0 = S.length; await click(p, '[data-tab="Gate"]'); await hdrag(p, '[data-thr="graph"]', 0, -40); S = await sets(p);
  ok('live: the gate threshold handle sends the threshold on the 161 grid', S.length > c0 && S.slice(c0).every(s => s[0] === '/ch/01/gate/thr' && Math.abs(s[2] * 160 - Math.round(s[2] * 160)) < 1e-3), JSON.stringify(S.slice(c0, c0 + 3)));
  c0 = S.length; await click(p, '[data-e="/ch/01/gate/mode=0"]'); await click(p, '[data-tab="Comp"]'); await hdrag(p, '[data-ratio]', 0, 40); S = await sets(p);
  ok('live: gate shape and the ratio handle send whole numbers', S.length >= c0 + 2 && S[c0][0] === '/ch/01/gate/mode' && S[c0][1] === 'i' && S[c0][2] === 0 && S.slice(c0 + 1).every(s => s[0] === '/ch/01/dyn/ratio' && s[1] === 'i' && Number.isInteger(s[2])), JSON.stringify(S.slice(c0)));
  c0 = S.length; await click(p, '[data-tab="Sends"]'); await click(p, '[data-sp="4"]'); await click(p, '[data-tap="4"]'); await tap(p, 'CLOSE'); S = await sets(p);
  ok('live: the send button changes where that send is taken from', S.length === c0 + 1 && S[c0][0] === '/ch/01/mix/05/tap' && S[c0][1] === 'i' && S[c0][2] === 4, JSON.stringify(S.slice(c0)));
  await click(p, '[data-tab="EQ"]'); await click(p, '[data-bs="3"]'); c0 = (await sets(p)).length;
  const sv = await (await p.$('svg.eqg')).boundingBox(), cx = sv.x + sv.width / 2, cy = sv.y + sv.height / 2;
  await p.mouse.move(cx - 300, cy + 120);
  await p.evaluate(([cx, cy]) => { const g = document.querySelector('svg.eqg'), ev = (t, id, x) => g.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: cy, bubbles: true, pointerType: 'touch' }));
    ev('pointerdown', 11, cx - 50); ev('pointerdown', 12, cx + 50); for (let k = 1; k <= 6; k++) { ev('pointermove', 11, cx - 50 - k * 15); ev('pointermove', 12, cx + 50 + k * 15); } ev('pointerup', 11, cx - 140); ev('pointerup', 12, cx + 140); }, [cx, cy]);
  await p.waitForTimeout(250); S = await sets(p); const q3 = await p.evaluate(() => fake.store['/ch/01/eq/3/q'][1]);
  ok('live: a two-finger pinch on the EQ changes only the Q of the selected band (apart = wider), on the 72 grid', S.length > c0 && S.slice(c0).every(x => x[0] === '/ch/01/eq/3/q' && Math.abs(x[2] * 71 - Math.round(x[2] * 71)) < 1e-3) && q3 > 0.47, JSON.stringify(S.slice(c0, c0 + 3)));
  await p.evaluate(() => fake.emit('/ch/02/preamp/hpf', 'f', 0)); await click(p, '[aria-label="Next strip"]'); await p.waitForTimeout(500);
  const lcb = await p.evaluate(() => { const r = document.querySelector('[data-band="0"] rect').getBoundingClientRect(), g = document.querySelector('svg.eqg').getBoundingClientRect(); return r.left >= g.left && r.width > 20; });
  ok('low cut at 20 Hz is drawn fully inside the graph', lcb); await click(p, '[aria-label="Previous strip"]');
  await back(p); c0 = (await sets(p)).length; await p.mouse.move(100, 120); const pb2 = await (await p.$('.strip .panmini')).boundingBox(); await p.mouse.move(pb2.x + pb2.width / 2, pb2.y + pb2.height / 2); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up(); await p.waitForTimeout(500);
  await click(p, '[data-ppv="L50"]'); await click(p, '[data-pps="1"]'); S = await sets(p);
  ok('live: the fine pan window sends the pan on its grid (L50, then one step right)', S.length === c0 + 2 && S[c0][0] === '/ch/01/mix/pan' && S[c0][2] === 0.25 && Math.abs(S[c0 + 1][2] - 0.26) < 1e-6, JSON.stringify(S.slice(c0)));
  await tap(p, 'CLOSE');
  await p.waitForTimeout(400); c0 = (await sets(p)).length; await longFader(p, '/ch/02/mix/fader'); await drag(p, '/ch/02/mix/03/level', -40); S = await sets(p);
  ok('live: a send fader in the sends window sends only that send, on the 161 grid', S.length > c0 && S.slice(c0).every(x => x[0] === '/ch/02/mix/03/level' && Math.abs(x[2] * 160 - Math.round(x[2] * 160)) < 1e-3), JSON.stringify(S.slice(c0, c0 + 3)));
  c0 = S.length; await click(p, '[data-swtap="1"]'); await click(p, '[data-tap="4"]'); await tap(p, 'CLOSE'); await click(p, '[data-sendswin] [data-t="/ch/02/mix/on"]'); S = await sets(p);
  ok('live: from the sends window – the send tap and the strip mute', S.length === c0 + 2 && S[c0][0] === '/ch/02/mix/02/tap' && S[c0][2] === 4 && S[c0 + 1][0] === '/ch/02/mix/on' && S[c0 + 1][1] === 'i', JSON.stringify(S.slice(c0)));
  await click(p, '[data-sendswin] [data-t="/ch/02/mix/on"]'); await tap(p, 'DONE');
  c0 = (await sets(p)).length; await click(p, '[data-busq="1"]'); await drag(p, '/ch/03/mix/01/level', -30); await drag(p, '/bus/1/mix/fader', -20); S = await sets(p);
  ok('live: in a bus mix the faders move the sends to that bus and the right fader is the bus master', S.length > c0 && S.slice(c0).every(x => x[0] === '/ch/03/mix/01/level' || x[0] === '/bus/1/mix/fader') && S.slice(c0).some(x => x[0] === '/bus/1/mix/fader'), JSON.stringify(S.slice(c0, c0 + 4)));
  await click(p, '[data-busq="1"]');
  c0 = (await sets(p)).length; await click(p, '[data-nav="mute"]'); await p.waitForTimeout(500); await click(p, '[data-mg="1"]'); await click(p, '[data-mgpop] [data-t="/dca/1/on"]'); await tap(p, 'DONE'); S = await sets(p);
  ok('live: the mute window switches mute group 1 on and mutes DCA 1', S.length === c0 + 2 && S[c0][0] === '/config/mute/1' && S[c0][1] === 'i' && S[c0][2] === 1 && S[c0 + 1][0] === '/dca/1/on' && S[c0 + 1][2] === 0, JSON.stringify(S.slice(c0)));
  await click(p, '[data-nav="mute"]'); await p.waitForTimeout(400); await click(p, '[data-mg="1"]'); await click(p, '[data-mgpop] [data-t="/dca/1/on"]'); await tap(p, 'DONE');
  c0 = (await sets(p)).length; const dca0 = await p.evaluate(() => fake.store['/ch/01/grp/dca'][1]);
  await (await p.$$('.strip .cname'))[0].click(); await p.waitForTimeout(300); await click(p, '[data-tab="Config"]'); await p.waitForTimeout(300); await click(p, '[data-bit="/ch/01/grp/dca:1"]'); await click(p, '[data-bit="/ch/01/grp/mute:2"]'); S = await sets(p);
  ok('live: CONFIG assigns the strip to DCA 2 and mute group 3 (one bit each)', S.length === c0 + 2 && S[c0][0] === '/ch/01/grp/dca' && S[c0][2] === (dca0 ^ 2) && S[c0 + 1][0] === '/ch/01/grp/mute' && S[c0 + 1][1] === 'i', JSON.stringify(S.slice(c0)));
  await back(p); c0 = S.length; await click(p, '[data-nav="routing"]'); await p.waitForTimeout(300); await click(p, '[data-rtab="in"]'); await p.waitForTimeout(400); await click(p, '[data-insrc="3"]'); await click(p, '[data-kp="5"]'); await click(p, '[data-link="1"]'); const la = await p.evaluate(() => !!__app.state.ask); await click(p, '[data-yes]'); S = await sets(p);
  ok('live: routing input – channel 3 from IN 06; a stereo link asks first', la && S.length === c0 + 2 && S[c0][0] === '/ch/03/config/insrc' && S[c0][2] === 5 && S[c0 + 1][0] === '/config/chlink/1-2' && S[c0 + 1][2] === 1, JSON.stringify(S.slice(c0)));
  c0 = S.length; await click(p, '[data-rtab="out"]'); await p.waitForTimeout(500); await click(p, '[data-rsrc="/routing/aux/01"]'); await click(p, '[data-kp="36"]'); await click(p, '[data-rpos="/routing/aux/01"]'); await click(p, '[data-kp="8"]'); S = await sets(p);
  ok('live: routing output – AUX 1 from MAIN L, taken PRE', S.length === c0 + 2 && S[c0][0] === '/routing/aux/01/src' && S[c0][2] === 36 && S[c0 + 1][0] === '/routing/aux/01/pos' && S[c0 + 1][2] === 8, JSON.stringify(S.slice(c0)));
  ok('XR16: four aux outputs and the recorder L/R', await p.evaluate(() => document.querySelectorAll('[data-rsrc^="/routing/aux/"]').length === 4 && document.querySelectorAll('[data-rsrc^="/routing/usb/"]').length === 2));
  await back(p); c0 = S.length; await click(p, '[data-nav="fx"]'); await p.waitForTimeout(500); await click(p, '[data-fxslot="2"]'); await p.waitForTimeout(500); await hdrag(p, '[data-p="/fx/2/par/01"]', 60); S = await sets(p);
  ok('live: an effect parameter sends only itself on its grid (Pre Delay, 101 steps)', S.length > c0 && S.slice(c0).every(x => x[0] === '/fx/2/par/01' && Math.abs(x[2] * 100 - Math.round(x[2] * 100)) < 1e-3), JSON.stringify(S.slice(c0, c0 + 3)));
  c0 = S.length; const g0 = await p.evaluate(() => fake.gets); await click(p, '[data-fxtype]'); await click(p, '[data-kp="10"]'); const fa = await p.evaluate(() => !!__app.state.ask); await click(p, '[data-yes]'); await p.waitForTimeout(800); S = await sets(p);
  ok('live: changing the effect asks first, sends the type, then reads the new parameters', fa && S.length === c0 + 1 && S[c0][0] === '/fx/2/type' && S[c0][1] === 'i' && S[c0][2] === 10 && await p.evaluate(g0 => fake.gets > g0 + 10 && document.querySelector('[data-fxname]').textContent === 'Stereo Delay', g0), JSON.stringify(S.slice(c0)));
  await back(p); c0 = S.length; await drag(p, '/ch/07/mix/fader', -40); await p.waitForTimeout(700); S = await sets(p);
  const pair = await p.evaluate(() => [__app.desk['/ch/07/mix/fader'], __app.desk['/ch/08/mix/fader'], fake.store['/ch/08/mix/fader'][1]]);
  ok('live: a linked pair – only the touched fader is sent, the partner is read back', S.length > c0 && S.slice(c0).every(s => s[0] === '/ch/07/mix/fader') && pair[0] === pair[1] && pair[1] === pair[2], JSON.stringify(pair));
  c0 = S.length; await click(p, '[data-nav="tape"]'); await p.waitForTimeout(500); await click(p, '[data-tp="2"]'); await click(p, '[data-tp="4"]'); const recAsk = await p.evaluate(() => !!__app.state.ask) && (await sets(p)).length === c0 + 1; await click(p, '[data-yes]'); S = await sets(p);
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
  const r = await p.evaluate(() => { const bad = []; for (const k in __app.desk) if (fake.store[k] && fake.store[k][1] !== __app.desk[k]) bad.push(k); return { sets: fake.sets.filter(x => !x[0].startsWith('/-stat/rta/')), bad }; });
  ok(`seed ${seed}: ${sent} odd values, ${w} taps, live: nothing written back`, r.sets.length === 0, JSON.stringify(r.sets.slice(0, 4)));
  ok(`seed ${seed}: the app holds exactly what the mixer said`, r.bad.length === 0, r.bad.slice(0, 5).join(','));
  ok(`seed ${seed}: no page errors, still on screen`, p.errs.length === 0 && (await names(p)).length === 9, p.errs.join(' | ')); await p.close(); }

/* ---------- models and the mixer report ---------- */
{ const p = await open('index.html?model=XR18', { width: 1200, height: 540 }); await p.waitForTimeout(2500); await tap(p, 'Buses');
  await click(p, '[data-nav="routing"]'); await p.waitForTimeout(500); ok('XR18 routing: USB return switch on each channel', await p.evaluate(() => document.querySelectorAll('[data-t$="/preamp/rtnsw"]').length === 16)); await click(p, '[data-rtab="out"]'); await p.waitForTimeout(400);
  ok('XR18 routing: six aux outputs and 18 USB outputs', await p.evaluate(() => document.querySelectorAll('[data-rsrc^="/routing/aux/"]').length === 6 && document.querySelectorAll('[data-rsrc^="/routing/usb/"]').length === 18)); await back(p); await tap(p, 'Buses');
  ok('XR18: model detected, 6 buses, no recorder note', (await status(p)) === 'connected/XR18W/false' && (await names(p)).filter(x => /^BUS/.test(x)).length === 6 && !(await p.$('[data-nav="tape"]')));
  await tap(p, 'הגדרות'); await tap(p, 'הכן דוח'); await p.waitForTimeout(45000);
  const d = await p.evaluate(() => ({ d: __app.state.dump, t: __app.dumpText.slice(0, 400), sizes: __app.dumpParts.map(x => x.length), f: /\/ch\/01: config\/name="D01" config\/color=i1 mix\/fader=f0\.\d+/.test(__app.dumpText), sets: fake.sets.length }));
  ok('mixer report: reads only, finishes, in parts a chat can take, values typed', d.d && d.d.done && d.sets === 0 && /XR18W/.test(d.t) && d.sizes.length > 1 && d.sizes.every(x => x < 19000) && d.f, JSON.stringify(d));
  ok('no page errors (1200×540)', p.errs.length === 0, p.errs.join(' | ')); await p.close(); }
{ const p = await open('index.html?model=XR12'); await p.waitForTimeout(2500);
  await p.waitForTimeout(3500); await tap(p, 'Buses'); ok('XR12 that answers for 2 buses only: 2 shown', (await names(p)).filter(x => /^BUS/.test(x)).length === 2, (await names(p)).join(','));
  ok('XR12: two bus squares', await p.evaluate(() => document.querySelectorAll('[data-busq]').length === 2));
  ok('XR12: 12 channels, recorder note', (await status(p)) === 'connected/XR12W/false' && await tap(p, 'In 9–12') && (await names(p)).length === 5 && !!(await p.$('[data-nav="tape"]')));
  await tap(p, 'הגדרות'); await click(p, '[data-pref="entereq"]'); await click(p, '[data-pref="navtrue"]'); await back(p); await p.evaluate(() => document.querySelectorAll('.strip .cname')[0].click()); await p.waitForTimeout(300);
  ok('settings: entry screen and back side are kept', await p.evaluate(() => __app.state.screen === 'eq' && !document.querySelector('.topbar').classList.contains('backR') && JSON.parse(localStorage.getItem('xair.prefs')).enter === 'eq'));
  await p.close(); }

console.log(`\n${n - fails} of ${n} passed`); await B.close(); srv.close(); process.exit(fails ? 1 : 0);
