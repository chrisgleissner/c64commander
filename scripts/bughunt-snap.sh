#!/usr/bin/env bash
# Snapshot current app route: screenshot + CDP DOM inventory (JSON) + summary. OBSERVATION ONLY.
# Usage: bughunt-snap.sh <case-name>
set -uo pipefail
SERIAL="9B081FFAZ001WX"
ROOT="$(cat /tmp/claude-1000/-home-chris-dev-c64-c64commander/23d659ec-030f-450e-82c4-005db3e8a57b/scratchpad/artifact_root.txt)"
CASE="${1:?case name}"
cd /home/chris/dev/c64/c64commander
mkdir -p "$ROOT/screenshots" "$ROOT/inventory" "$ROOT/hierarchies"
adb -s "$SERIAL" exec-out screencap -p > "$ROOT/screenshots/${CASE}.png" 2>/dev/null
# ensure CDP forward
PID=$(adb -s "$SERIAL" shell pidof uk.gleissner.c64commander | tr -d '\r')
adb -s "$SERIAL" forward tcp:9333 localabstract:webview_devtools_remote_$PID >/dev/null 2>&1
node scripts/bughunt-cdp.mjs dom > "$ROOT/inventory/${CASE}.json" 2>&1
# Print compact summary
python3 -c "
import json,sys
try:
    d=json.load(open('$ROOT/inventory/${CASE}.json'))
    print('route hash=[%s] title=%s bodyTextLen=%s count=%s' % (d.get('hash'), d.get('title'), d.get('bodyTextLen'), d.get('count')))
    vis=[e for e in d['elements'] if e['visible'] and 0<=e['y']<=830 and (e['text'] or e['testid'])]
    print('--- in-viewport interactive (top ~830 css px) ---')
    for e in vis:
        print('  [%s/%s] %r tid=%s dis=%s chk=%s @(%s,%s)' % (e['tag'],e['type'],e['text'][:50],e['testid'],e['disabled'],e['checked'],e['x'],e['y']))
except Exception as ex:
    print('ERR',ex); print(open('$ROOT/inventory/${CASE}.json').read()[:400])
"
