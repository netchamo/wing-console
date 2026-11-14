# Builds xair/index.html (GitHub Pages + the Android app's bundled copy) from src/xair-console.html.
import sys
src = open(sys.argv[1] if len(sys.argv) > 1 else 'src/xair-console.html').read()
head = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#0b0a09">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Air Console">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-192.png">
'''
i = src.index('<div id="stage">')
a = "started: !!NATIVE,"
assert a in src
body = src[i:].replace(a, "started: !!NATIVE || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true,", 1)
sw = "<script>if ('serviceWorker' in navigator && !window.XAirNative) navigator.serviceWorker.register('sw.js').catch(() => {});</script>\n"
open('xair/index.html', 'w').write(head + src[:i] + sw + '</head>\n<body>\n' + body + '\n</body>\n</html>\n')
