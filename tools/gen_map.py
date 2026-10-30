"""Builds the parameter table the app uses (address <-> WING native id, plus ranges).

Source: libwing propmap.jsonl (firmware 3.0.5). Usage:
  python3 tools/gen_map.py path/to/propmap.jsonl > tools/wing-map.js
Strips: 0-39 = /ch/1-40, 40-47 = /aux/1-8, 48 = /main/1, 49-64 = /bus/1-16, 65-72 = /mtx/1-8.
"""
import json, sys

rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
by = {r['fullname']: r for r in rows if 'fullname' in r}

def b36(i):
    i &= 0xffffffff
    s = ''
    while True:
        i, r = divmod(i, 36); s = '0123456789abcdefghijklmnopqrstuvwxyz'[r] + s
        if not i: return s

core = ['mute', 'fdr', 'pan', 'wid', '$solo', 'tags', 'name', 'col']
inp = ['in/set/' + k for k in ['$mode', 'altsrc', 'inv', 'trim', 'bal', '$g', '$vph', 'dlymode', 'dly', 'dlyon']] + \
      ['in/conn/' + k for k in ['grp', 'in', 'altgrp', 'altin']]
flt = ['flt/' + k for k in ['lc', 'lcf', 'lcs', 'hc', 'hcf', 'hcs', 'tf', 'mdl', 'TILT/tilt']]
eq = ['eq/on', 'eq/mdl'] + [p[6:] for p in by if p.startswith('/ch/1/eq/STD/')]
def slots(kind):
    # model parameters share ids by position: gate/1..n hold whatever the current model puts there
    mods, n = {}, 0
    for p, r in by.items():
        pp = p.split('/')
        if p.startswith('/ch/1/' + kind + '/') and len(pp) == 6 and 'index' in r:
            mods.setdefault(pp[4], []).append((r['index'], pp[5], r))
            n = max(n, r['index'])
    return [f'{kind}/{k}' for k in range(1, n + 1)], mods
gate, GMODS = slots('gate')
gate = ['gate/on', 'gate/mdl'] + gate
gsc = ['gatesc/' + k for k in ['type', 'f', 'q', 'src', 'tap']]
dyn, DMODS = slots('dyn')
dyn = ['dyn/on', 'dyn/mdl', 'dyn/mix', 'dyn/gain'] + dyn
dsc = ['dynsc/' + k for k in ['type', 'f', 'q', 'src', 'tap']]
ins = ['preins/on', 'preins/ins', 'postins/on', 'postins/ins']
sends = [f'send/{n}/{k}' for n in range(1, 17) for k in ['on', 'lvl', 'mode', 'pan']] + \
        [f'send/MX{n}/{k}' for n in range(1, 9) for k in ['on', 'lvl']]
SUF = []
for s in core + inp + flt + eq + gate + gsc + dyn + dsc + ins + sends + ['gate', 'dyn']:
    if s not in SUF: SUF.append(s)

bases = [f'/ch/{n}/' for n in range(1, 41)] + [f'/aux/{n}/' for n in range(1, 9)] + ['/main/1/'] + \
        [f'/bus/{n}/' for n in range(1, 17)] + [f'/mtx/{n}/' for n in range(1, 9)]
def lookup(b, s):
    pp = s.split('/')
    if pp[0] in ('gate', 'dyn') and len(pp) > 1 and pp[1].isdigit():
        k = int(pp[1])
        for mods in (GMODS if pp[0] == 'gate' else DMODS).values():
            for idx, nm, _ in mods:
                if idx == k:
                    mdl = [m for m, L in (GMODS if pp[0] == 'gate' else DMODS).items() if any(x[0] == k and x[1] == nm for x in L)][0]
                    r = by.get(f'{b}{pp[0]}/{mdl}/{nm}')
                    if r: return r
        return None
    return by.get(b + s)
ids = []
for b in bases:
    for s in SUF:
        r = lookup(b, s)
        ids.append(b36(r['id']) if r else '')

def meta(r):
    t = r.get('type', '')
    m = {'t': {'linear float': 'lin', 'log float': 'log', 'fader level': 'fdr', 'integer': 'int', 'string enum': 'enum',
               'float enum': 'fenum', 'string': 'str'}.get(t, t)}
    for k, o in [('minfloat', 'a'), ('maxfloat', 'b'), ('minint', 'a'), ('maxint', 'b'), ('steps', 'n'), ('unit', 'u'), ('longname', 'l')]:
        if k in r: m[o] = round(r[k], 4) if isinstance(r[k], float) else r[k]
    if 'items' in r: m['i'] = [x['item'] for x in r['items']]
    if r.get('longname') and r.get('items') and t == 'string enum':
        m['li'] = [x.get('longitem', x['item']) for x in r['items']]
    return m

META = {}
for s in SUF:
    r = by.get('/ch/1/' + s) or by.get('/aux/1/' + s) or by.get('/main/1/' + s)
    if r: META[s] = meta(r)
MODS = {'gate': {m: [[i, n, meta(r)] for i, n, r in sorted(L)] for m, L in GMODS.items()},
        'dyn': {m: [[i, n, meta(r)] for i, n, r in sorted(L)] for m, L in DMODS.items()}}

# global parameters: inputs (gain, phantom, mode), recorder routing, player, recorder
G = {}
for p, r in by.items():
    parts = p.split('/')
    if p.startswith('/io/in/') and len(parts) == 6 and parts[5] in ('g', 'vph', 'mode', 'name') and not parts[3].startswith('$'):
        G[p] = r
    elif p.startswith('/io/out/') and len(parts) == 6 and parts[5] in ('grp', 'in'):
        G[p] = r
    elif (p.startswith('/play/') or p.startswith('/rec/')) and r.get('type') != 'node':
        G[p] = r
GIDS = {p: b36(r['id']) for p, r in G.items()}
GMETA = {}
for p, r in G.items():
    pp = p.split('/')
    key = '/'.join(pp[:4] + ['*', pp[5]]) if p.startswith('/io/') else p
    GMETA.setdefault(key, meta(r))
INCOUNT = {}
for p in by:
    pp = p.split('/')
    if p.startswith('/io/in/') and len(pp) == 5 and not pp[3].startswith('$') and pp[4].isdigit():
        INCOUNT[pp[3]] = max(INCOUNT.get(pp[3], 0), int(pp[4]))

out = {'MD': MODS, 'S': SUF, 'I': ','.join(ids), 'M': META, 'G': GIDS, 'GM': GMETA, 'IN': INCOUNT}
print('const WMAP = ' + json.dumps(out, separators=(',', ':')) + ';')
