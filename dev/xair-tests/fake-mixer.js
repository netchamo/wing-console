/* A fake X-Air behind a fake Android bridge (window.XAirNative), for the tests.
   URL: ?model=XR16|XR18|XR12  &delay=ms (the mixer starts answering only after this long)
   window.fake.sets = every packet that carried a value (what a real mixer would have been told to change). */
(function () {
  const Q = new URLSearchParams(location.search), MODEL = Q.get('model') || 'XR16', DELAY = +(Q.get('delay') || 0), IP = Q.get('ip') || '192.168.1.1', GHOST = Q.get('ghost') ? '192.168.1.77' : '';  /* ghost: a second mixer (XR18) that answers only when asked at its own address, as behind a router that drops broadcasts */
  const NBUS = +(Q.get('bus') || (MODEL === 'XR12' ? 2 : 6)), NCH = MODEL === 'XR12' ? 12 : 16;
  const TE = new TextEncoder(), TD = new TextDecoder(), pad2 = n => String(n).padStart(2, '0');
  const oscStr = s => { const b = TE.encode(s), o = new Uint8Array((b.length + 4) & ~3); o.set(b); return o; };
  function enc(addr, args) {
    const parts = [oscStr(addr), oscStr(',' + args.map(a => a[0]).join(''))];
    for (const [t, v] of args) {
      if (t === 's') parts.push(oscStr(String(v)));
      else if (t === 'b') { const h = new Uint8Array(4); new DataView(h.buffer).setInt32(0, v.length); const p = new Uint8Array((v.length + 3) & ~3); p.set(v); parts.push(h, p); }
      else { const b = new Uint8Array(4), d = new DataView(b.buffer); if (t === 'f') d.setFloat32(0, v); else d.setInt32(0, v | 0); parts.push(b); }
    }
    let n = 0; parts.forEach(p => { n += p.length; }); const o = new Uint8Array(n); let k = 0; parts.forEach(p => { o.set(p, k); k += p.length; }); return o;
  }
  function dec(u) {
    const d = new DataView(u.buffer, u.byteOffset, u.byteLength); let p = 0;
    const str = () => { let e = p; while (e < u.length && u[e]) e++; const s = TD.decode(u.subarray(p, e)); p = (e + 4) & ~3; return s; };
    const addr = str(), args = []; let types = '';
    if (p < u.length && u[p] === 44) { types = str().slice(1); for (const t of types) { if (t === 'i') { args.push(d.getInt32(p)); p += 4; } else if (t === 'f') { args.push(d.getFloat32(p)); p += 4; } else if (t === 's') args.push(str()); } }
    return { addr, types, args };
  }
  const b64 = u => { let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
  const unb64 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const g = (v, n) => Math.fround(Math.round(v * (n - 1)) / (n - 1));

  const store = {};
  const core = (b, name, col, i, pan) => { store[b + '/config/name'] = ['s', name]; store[b + '/config/color'] = ['i', col]; store[b + '/mix/fader'] = ['f', g(0.3 + (i * 0.037) % 0.6, 1024)]; store[b + '/mix/on'] = ['i', i % 5 === 3 ? 0 : 1]; if (pan) store[b + '/mix/pan'] = ['f', g((i * 0.13) % 1, 101)]; };
  const sends = b => { for (let k = 1; k <= 10; k++) { store[`${b}/mix/${pad2(k)}/level`] = ['f', g((k * 0.071 + b.length * 0.03) % 1, 161)]; store[`${b}/mix/${pad2(k)}/pan`] = ['f', 0.5]; store[`${b}/mix/${pad2(k)}/tap`] = ['i', k > 6 ? 4 : k > 4 ? 5 : 2]; store[`${b}/mix/${pad2(k)}/grpon`] = ['i', 0]; if (!(k < 6 && k % 2)) delete store[`${b}/mix/${pad2(k)}/pan`]; } };
  for (let n = 1; n <= NCH; n++) { const b = '/ch/' + pad2(n); core(b, n === 7 ? '' : 'D' + pad2(n), n % 16, n, true); sends(b); store[b + '/preamp/hpf'] = ['f', 0.25]; store[b + '/eq/1/f'] = ['f', 0.2]; store[b + '/eq/1/type'] = ['i', 1]; }
  core('/rtn/aux', 'USBRTN', 15, 20, true); sends('/rtn/aux');
  for (let n = 1; n <= 4; n++) { core('/rtn/' + n, 'RTN' + n, 13, 21 + n, true); sends('/rtn/' + n); core('/fxsend/' + n, 'FXS' + n, 6, 30 + n, false);
    store[`/dca/${n}/config/name`] = ['s', 'DCA' + n]; store[`/dca/${n}/config/color`] = ['i', 7]; store[`/dca/${n}/fader`] = ['f', g(0.75, 1024)]; store[`/dca/${n}/on`] = ['i', 1]; store[`/fx/${n}/type`] = ['i', n]; }
  for (let n = 1; n <= NBUS; n++) core('/bus/' + n, 'BUS' + n, 3, 40 + n, true);
  core('/lr', 'MAIN', 7, 50, true);
  /* processing, with the values of a real XR16 report */
  const eq = (b, n) => { for (let k = 1; k <= n; k++) { store[`${b}/eq/${k}/type`] = ['i', k === 1 ? 1 : k === n ? 4 : 2]; store[`${b}/eq/${k}/f`] = ['f', g(0.1 + k * 0.13, 201)]; store[`${b}/eq/${k}/g`] = ['f', g(0.5, 121)]; store[`${b}/eq/${k}/q`] = ['f', g(0.46479, 72)]; } store[b + '/eq/on'] = ['i', 1]; if (n === 6) store[b + '/eq/mode'] = ['i', 0]; };
  const dyn = b => { const D = { on: ['i', 0], mode: ['i', 0], det: ['i', 0], env: ['i', 1], thr: ['f', g(0.65833, 121)], ratio: ['i', 5], knee: ['f', 0.2], mgain: ['f', g(0.27083, 49)], attack: ['f', g(0.08333, 121)], hold: ['f', 0.54], release: ['f', 0.51], mix: ['f', 1], auto: ['i', 0] }; for (const k in D) store[b + '/dyn/' + k] = D[k]; };
  for (let n = 1; n <= NCH; n++) { const b = '/ch/' + pad2(n); eq(b, 4); dyn(b); store[b + '/mix/lr'] = ['i', 1]; store[b + '/config/insrc'] = ['i', n - 1]; store[b + '/preamp/hpf'] = ['f', Math.fround(0.7)]; store[b + '/preamp/hpon'] = ['i', 1]; store[b + '/preamp/invert'] = ['i', 0];
    for (const k of ['gate', 'dyn']) { store[`${b}/${k}/keysrc`] = ['i', 0]; store[`${b}/${k}/filter/on`] = ['i', 0]; store[`${b}/${k}/filter/type`] = ['i', 6]; store[`${b}/${k}/filter/f`] = ['f', g(0.565, 201)]; }
    const G = { on: ['i', 0], mode: ['i', 3], thr: ['f', g(0.225, 161)], range: ['f', 1], attack: ['f', g(0.00833, 121)], hold: ['f', Math.fround(0.88)], release: ['f', Math.fround(0.79)] }; for (const k in G) store[b + '/gate/' + k] = G[k];
    store[`/headamp/${pad2(n)}/gain`] = ['f', g(0.17361, 145)]; store[`/headamp/${pad2(n)}/phantom`] = ['i', 0]; }
  ['/rtn/aux', '/rtn/1', '/rtn/2', '/rtn/3', '/rtn/4'].forEach(b => { eq(b, 4); store[b + '/mix/lr'] = ['i', 1]; });
  for (let n = 1; n <= NBUS; n++) { eq('/bus/' + n, 6); dyn('/bus/' + n); store[`/bus/${n}/mix/lr`] = ['i', 0]; }
  eq('/lr', 6); dyn('/lr');
  for (let k = 1; k < 16; k += 2) store[`/config/chlink/${k}-${k + 1}`] = ['i', k === 7 ? 1 : 0];
  for (let k = 1; k < 6; k += 2) store[`/config/buslink/${k}-${k + 1}`] = ['i', 0];
  ['/rtn/aux', '/rtn/1', '/rtn/2', '/rtn/3', '/rtn/4', '/fxsend/1', '/fxsend/2', '/fxsend/3', '/fxsend/4'].concat(Array.from({ length: NCH }, (_, k) => '/ch/' + pad2(k + 1)), Array.from({ length: NBUS }, (_, k) => '/bus/' + (k + 1)))
    .forEach((b, i) => { store[b + '/grp/dca'] = ['i', i % 3 === 0 ? 1 : 0]; store[b + '/grp/mute'] = ['i', i % 4 === 0 ? 2 : 0]; });
  for (let k = 1; k <= 4; k++) { store['/config/mute/' + k] = ['i', 0]; store[`/fx/${k}/insert`] = ['i', k === 4 ? 1 : 0]; for (let p = 1; p <= 16; p++) store[`/fx/${k}/par/${pad2(p)}`] = ['f', 0.5]; }
  for (let k = 1; k <= 6; k++) { store[`/routing/aux/${pad2(k)}/src`] = ['i', 25 + k]; store[`/routing/aux/${pad2(k)}/pos`] = ['i', 10]; }
  for (let k = 1; k <= 18; k++) { store[`/routing/usb/${pad2(k)}/src`] = ['i', k <= 2 ? 35 + k : k - 1]; store[`/routing/usb/${pad2(k)}/pos`] = ['i', k <= 2 ? 4 : 0]; }
  for (let n = 1; n <= NCH; n++) { const b = `/ch/${pad2(n)}`; store[b + '/preamp/rtnsw'] = ['i', 0]; store[b + '/config/rtnsrc'] = ['i', n - 1]; store[b + '/insert/on'] = ['i', 0]; store[b + '/insert/sel'] = ['i', 0];
    store[b + '/automix/group'] = ['i', 0]; store[b + '/automix/weight'] = ['f', 0.5]; }
  for (let n = 1; n <= NBUS; n++) { store[`/bus/${n}/insert/on`] = ['i', 0]; store[`/bus/${n}/insert/sel`] = ['i', 0]; } store['/lr/insert/on'] = ['i', 0]; store['/lr/insert/sel'] = ['i', 0];
  for (const g of ['X', 'Y']) { store['/config/amixenable/' + g] = ['i', 0]; store['/config/amixlock/' + g] = ['i', 0]; }
Object.assign(store, { '/-stat/rta/source': ['i', 8], '/-stat/rta/pos': ['i', 0], '/-stat/tape/file': ['s', ''], '/-stat/tape/etime': ['i', 0], '/-stat/tape/rtime': ['i', 0], '/-stat/usb/path': ['s', ''], '/-stat/usb/count': ['i', 0] });
  for (let k = 1; k <= 54; k++) store['/-stat/solosw/' + pad2(k)] = ['i', 0];
  store['/-stat/solo'] = ['i', 0]; store['/-stat/usbmounted'] = ['i', MODEL === 'XR18' ? 0 : 1]; store['/-stat/tape/state'] = ['i', 0]; store['/-prefs/name'] = ['s', 'FAKE-' + MODEL];

  const out = []; let fl = 0;
  const push = (addr, args) => { out.push({ type: 'rx', ip: IP, d: b64(enc(addr, args)) }); if (!fl) fl = setTimeout(() => { fl = 0; const l = out.splice(0); if (window.__xairNative) window.__xairNative(l); }, 4); };
  const t0 = Date.now();
  const fake = (window.fake = { store, subs: new Set(), sets: [], blocked: [], gets: 0, live: false, silent: false, remote: 0, meters: false, copied: '',
    /* a change made on the mixer by someone else */
    emit(addr, type, val) { store[addr] = [type, val]; push(addr, [[type, val]]); } });
  window.calls = [];
  function handle(u) {
    if (fake.silent || Date.now() - t0 < DELAY) return;
    const m = dec(u);
    if (m.addr === '/xinfo') { push('/xinfo', [['s', IP], ['s', MODEL + 'W-B2-3E-C9'], ['s', MODEL + 'W'], ['s', '1.19']]); return; }
    if (m.addr === '/xremote') { fake.remote = Date.now(); return; }
    if (m.addr === '/meters') { fake.meters = true; fake.subs.add(m.args[0]); return; }
    if (!m.args.length) { fake.gets++; const v = store[m.addr]; if (v) push(m.addr, [v]); return; }
    fake.sets.push([m.addr, m.types, m.args[0]]); window.calls.push(['set', m.addr, m.args[0]]);
    if (!fake.live) { fake.blocked.push(m.addr); return; }   /* the native side drops values while live is off */
    if (store[m.addr]) store[m.addr] = [m.types[0], m.args[0]];
    /* a linked pair: the mixer moves the other channel itself */
    const L = /^\/ch\/(\d+)(\/.+)$/.exec(m.addr);
    if (L && !/\/pan$/.test(m.addr)) { const n = +L[1], lo = n % 2 ? n : n - 1, o = n % 2 ? n + 1 : n - 1, pr = `/ch/${pad2(o)}${L[2]}`; if ((store[`/config/chlink/${lo}-${lo + 1}`] || [])[1] === 1 && store[pr]) store[pr] = [m.types[0], m.args[0]]; }
  }
  /* replay of a real capture: fake.rtaReplay = [[t_ms, ...100 dB values], ...] is sent at its own times, looped */
  const rtaSend = vals => { const b = new Uint8Array(4 + 200), d = new DataView(b.buffer); d.setInt32(0, 100, true); for (let i = 0; i < 100; i++) d.setInt16(4 + 2 * i, Math.round(vals[i] * 256), true); push('/meters/4', [['b', b]]); };
  (function rp() { const R = fake.rtaReplay; if (!R || !R.length) { setTimeout(rp, 200); return; } let i = 0; const t0 = performance.now(), T = R[R.length - 1][0] + 50;
    const step = () => { if (fake.rtaReplay !== R) { rp(); return; } const now = (performance.now() - t0) % T; while (i < R.length && R[i][0] <= now) { if (fake.subs.has('/meters/4')) rtaSend(R[i].slice(1)); i++; } if (now < (R[i - 1] || [0])[0]) i = 0; setTimeout(step, 5); }; step(); })();
  setInterval(() => { if (fake.rtaReplay) return; if (!fake.subs.has('/meters/4') || fake.silent) return; const b = new Uint8Array(4 + 200), d = new DataView(b.buffer); d.setInt32(0, 100, true); for (let i = 0; i < 100; i++) d.setInt16(4 + 2 * i, Math.round((-30 - i * 0.2 + 6 * Math.random()) * 256), true); push('/meters/4', [['b', b]]); }, 60);
  setInterval(() => { if (!fake.meters || fake.silent) return; const b = new Uint8Array(4 + 80), d = new DataView(b.buffer); d.setInt32(0, 40, true); for (let i = 0; i < 40; i++) d.setInt16(4 + 2 * i, Math.round((-40 + 30 * Math.random()) * 256), true); push('/meters/1', [['b', b]]); }, 100);
  window.XAirNative = { ready() {}, version() { return 'test'; }, wifi() { return true; }, wifiAddress() { return '192.168.1.50/24'; }, netInfo() { return '[]'; },
    setLive(on) { fake.live = !!on; window.calls.push(['setLive', !!on]); },
    discover(b) { window.calls.push(['discover']); handle(unb64(b)); },
    send(ip, b) { fake.unicast = (fake.unicast || 0) + 1; if (ip === IP) handle(unb64(b));
      else if (GHOST && ip === GHOST && dec(unb64(b)).addr === '/xinfo') { out.push({ type: 'rx', ip: GHOST, d: b64(enc('/xinfo', [['s', GHOST], ['s', 'XR18W-11-22-33'], ['s', 'XR18W'], ['s', '1.19']])) }); if (!fl) fl = setTimeout(() => { fl = 0; const l = out.splice(0); if (window.__xairNative) window.__xairNative(l); }, 4); } },
    openWifi() {}, copy(t) { fake.copied = t; }, reload() {}, build() { return 1; }, checkUpdate() {}, downloadUpdate() { return 'ok'; }, updateProgress() { return -1; }, updateReason() { return ''; }, openUpdateLink() {} };
})();
