# Builds the two test pages next to this file from the built app (app/index.html):
#   demo.html  = the app as a browser sees it (demo mode)
#   index.html = the app with a fake Android bridge (window.WingNative) that records every call in window.calls
import os
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, '../../app/index.html')).read().replace("https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js", "./htm-preact.js")
mock = open(os.path.join(here, 'native-mock-head.html')).read().split('\n')
inject = '\n'.join(mock[2:])[len('<head>'):]
open(os.path.join(here, 'demo.html'), 'w').write(src)
open(os.path.join(here, 'index.html'), 'w').write(src.replace('<head>', '<head>' + inject, 1))
# idx_cur.html (used by the fuzz tests) = same as index.html
open(os.path.join(here, 'idx_cur.html'), 'w').write(src.replace('<head>', '<head>' + inject, 1))
