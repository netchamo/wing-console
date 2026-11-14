# fuzz from the desk's own parameter table (per strip type), not from the app's map
import json,random,sys
random.seed(int(sys.argv[1]) if len(sys.argv)>1 else 1)
std = len(sys.argv)>2
pm={}
for l in __import__('gzip').open(__import__('os').path.join(__import__('os').path.dirname(__file__),'propmap.jsonl.gz'),'rt'):
    if l.strip():
        r=json.loads(l)
        if 'fullname' in r: pm[r['fullname']]=r
s=open(__import__('os').path.join(__import__('os').path.dirname(__file__),'../../src/wing-console.html')).read(); i=s.index('const WMAP = ')+len('const WMAP = ')
d=json.JSONDecoder().raw_decode(s[i:])[0]
S=d['S']; WN=len(S); I=d['I'].split(',')
bases=[f'/ch/{n}/' for n in range(1,41)]+[f'/aux/{n}/' for n in range(1,9)]+['/main/1/']+[f'/bus/{n}/' for n in range(1,17)]+[f'/mtx/{n}/' for n in range(1,9)]+[f'/main/{n}/' for n in range(2,5)]
def b36(x): return (int(x,36)+2**31)%2**32-2**31
def val(r):
    t=r.get('type','')
    if r.get('items'): return {'s':random.choice(r['items'])['item']}
    if t=='string': return {'s':'X'+str(random.randint(1,99))}
    if t=='integer': return {'v':random.randint(r.get('minint',0),r.get('maxint',1))}
    if 'float' in t:
        a,b=r.get('minfloat',0),r.get('maxfloat',1)
        if 'log' in t: return {'v':round(a*(b/a)**random.random(),3)}
        return {'v':round(random.uniform(a,b),2)}
    if t=='fader level': return {'v':round(random.uniform(-40,10),1)}
    return None
import re
idx={}
for fn,r in pm.items():
    m=re.match(r'^(/\w+/\d+/)(gate|dyn)/([^/]+)/([^/]+)$',fn)
    if m and 'index' in r: idx[(m.group(1),m.group(2),m.group(3),r['index'])]=r
msgs=[]; miss=0
for si,b in enumerate(bases):
    chosen={}
    for k,suf in enumerate(S):
        x=I[si*WN+k]
        if not x: continue
        full=b+suf
        r=pm.get(full)
        if suf in ('gate','dyn'): continue
        pp=suf.split('/')
        if len(pp)==2 and pp[0] in ('gate','dyn') and pp[1].isdigit():
            r=idx.get((b,pp[0],chosen.get(pp[0]),int(pp[1])))
            if not r: continue
        if not r: miss+=1; continue
        v=val(r)
        if suf=='eq/mdl' and std: v={'s':'STD'}
        if suf in ('name',): v={'s':f'N{si}'}
        if v is None: continue
        if suf in ('gate/mdl','dyn/mdl'): chosen[suf.split('/')[0]]=v['s']
        msgs.append({'type':'nat','id':b36(x),**v})
json.dump(msgs,open('fuzz.json','w')); print(len(msgs),'miss',miss)
