# Builds the test pages next to this file from the built app (xair/index.html):
#   demo.html  = the app as a browser sees it (demo mode, no bridge)
#   index.html = the app with the fake Android bridge and the fake mixer behind it
import os
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, '../../xair/index.html')).read().replace("https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js", "./htm-preact.js")
src = src.replace("navigator.serviceWorker.register('sw.js')", "Promise.resolve()")
open(os.path.join(here, 'demo.html'), 'w').write(src)
open(os.path.join(here, 'index.html'), 'w').write(src.replace('<head>', '<head><script src="fake-mixer.js"></script>', 1))
