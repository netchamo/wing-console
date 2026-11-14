#!/bin/sh
curl -s -o /dev/null http://127.0.0.1:8765/demo.html || (cd "$(dirname "$0")" && setsid python3 -m http.server 8765 >/dev/null 2>&1 & sleep 1)
