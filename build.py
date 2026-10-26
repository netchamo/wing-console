# Builds index.html for GitHub Pages from the published artifact source.
import sys
src = open(sys.argv[1]).read()
head = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#0b0a09">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Wing">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-192.png">
'''
i = src.index('<div id="stage">')
body = src[i:].replace("started: false,", "started: matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true,", 1)
sw = "<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});</script>\n"
open('app/index.html', 'w').write(head + src[:i] + sw + '</head>\n<body>\n' + body + '\n</body>\n</html>\n')
