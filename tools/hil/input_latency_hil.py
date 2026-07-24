#!/usr/bin/env python3
#
# C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
# Copyright (C) 2026 Christian Gleissner
# Licensed under the GNU General Public License v3.0 or later.
#
# Real Pixel -> C64 Ultimate INPUT-LATENCY-UNDER-LOAD HIL test.
#
# Measures the thing the user actually feels: how laggy the joystick/keyboard is WHILE Live View is
# streaming. The Live View encode+decode pipeline competes with the input path for the JS thread and
# the native CPU; when it wins, the machine:input dispatch is delayed and the C64 responds late.
#
# It reads the app's OWN press-to-dispatch latency samples (window.__c64uRemoteInputLatency, the same
# ring buffer the app records for every relayed input) over CDP, so the number is the app's real
# measured latency, not a re-derivation. It drives a fixed burst of joystick direction changes by
# dispatching synthetic PointerEvents on the live joystick knob, first with a healthy video+audio
# stream running, then does the SAME burst with Input Priority toggled off — the A/B that shows
# whether shedding video for input actually helps (spec priority: joystick > keyboard > audio > video).
#
# It also samples the live video fps and audio underruns during each burst so a latency win can be
# weighed against its cost to the picture/sound.
#
# Prerequisites: app installed + connected to the C64U (Live View reachable), websocket-client.
# Usage: python3 tools/hil/input_latency_hil.py [--serial S] [--taps 40] [--report out.json]

import argparse
import json
import os
import subprocess
import sys
import time

try:
    import websocket  # websocket-client
except ImportError:
    sys.exit("Missing dependency: pip install websocket-client")

CDP_PORT = 9346
PKG = "uk.gleissner.c64commander"


def sh(*args):
    return subprocess.run(args, capture_output=True, text=True).stdout.strip()


def forward_cdp(serial):
    pid = sh("adb", "-s", serial, "shell", "pidof", PKG).split()
    if not pid:
        sys.exit("App is not running on the device.")
    sock = f"webview_devtools_remote_{pid[0]}"
    subprocess.run(["adb", "-s", serial, "forward", "--remove", f"tcp:{CDP_PORT}"], capture_output=True)
    subprocess.run(["adb", "-s", serial, "forward", f"tcp:{CDP_PORT}", f"localabstract:{sock}"], capture_output=True)


def ws_url():
    import urllib.request

    data = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json", timeout=5))
    for t in data:
        if t.get("webSocketDebuggerUrl"):
            return t["webSocketDebuggerUrl"]
    raise RuntimeError("No CDP page target")


_conn = {"ws": None}


def evaluate(expr):
    if _conn["ws"] is None:
        _conn["ws"] = websocket.create_connection(ws_url(), timeout=25, suppress_origin=True)
    ws = _conn["ws"]
    ws.send(
        json.dumps(
            {
                "id": 1,
                "method": "Runtime.evaluate",
                "params": {"expression": expr, "returnByValue": True, "awaitPromise": True, "userGesture": True},
            }
        )
    )
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == 1:
            result = msg.get("result", {})
            if "exceptionDetails" in result:
                raise RuntimeError(f"JS error: {result['exceptionDetails'].get('text')}")
            return result.get("result", {}).get("value")


def click(testid):
    ok = evaluate(
        f"(()=>{{const e=document.querySelector('[data-testid=\"{testid}\"]');if(!e)return false;e.click();return true;}})()"
    )
    if not ok:
        raise RuntimeError(f"CTA '{testid}' not found (app not in expected state)")


def present(testid):
    return bool(evaluate(f"!!document.querySelector('[data-testid=\"{testid}\"]')"))


def text(testid):
    return evaluate(f"(document.querySelector('[data-testid=\"{testid}\"]')||{{}}).textContent")


def num(testid):
    raw = text(testid) or ""
    import re

    m = re.search(r"-?\d+(?:\.\d+)?", raw)
    return float(m.group(0)) if m else 0.0


# A burst of synthetic pointer drags on the joystick knob: press at centre, drag to each of the four
# cardinals and back, releasing between — the same held-set changes a thumb makes, so each records a
# real press-to-dispatch sample. Runs entirely in-page so the timing is the app's, not adb's.
DRIVE_BURST_JS = r"""
(async (taps) => {
  const knob = document.querySelector('[data-testid="remote-input-stick-zone"]')
            || document.querySelector('[data-testid="remote-input-joystick-action-zone"]');
  if (!knob) return { error: 'joystick stick-zone not found (need Joystick mode, stick movement style)' };
  const r = knob.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const reach = Math.max(24, Math.min(r.width, r.height) * 0.35);
  const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
  const fire = (type, x, y) => knob.dispatchEvent(new PointerEvent(type, {
    pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < taps; i++) {
    const [dx, dy] = dirs[i % dirs.length];
    fire('pointerdown', cx, cy);
    await sleep(8);
    fire('pointermove', cx + dx * reach, cy + dy * reach);
    await sleep(40);
    fire('pointerup', cx + dx * reach, cy + dy * reach);
    await sleep(40);
  }
  return { ok: true };
})(%d)
"""


def run_burst(taps):
    evaluate("window.__c64uRemoteInputLatency && window.__c64uRemoteInputLatency.clear()")
    result = evaluate(DRIVE_BURST_JS % taps)
    if isinstance(result, dict) and result.get("error"):
        raise RuntimeError(f"input driver failed: {result['error']}")
    time.sleep(0.5)
    stats = evaluate("window.__c64uRemoteInputLatency ? JSON.stringify(window.__c64uRemoteInputLatency.getStats()) : null")
    return json.loads(stats) if stats else {"count": 0}


def sample_stream():
    """Live video fps + audio underruns during the burst (Stats panel must be open)."""
    return {
        "fps": num("av-mirror-fps") if present("av-mirror-fps") else num("av-mirror-immersive-fps"),
        "underruns": int(num("stream-stats-underruns")) if present("stream-stats-underruns") else None,
        "residenceP99Ms": num("stream-stats-residence-p99") if present("stream-stats-residence-p99") else None,
    }


def phase(label, taps):
    burst = run_burst(taps)
    stream = sample_stream()
    print(
        f"  [{label}] input dispatch: count={burst.get('count')} p50={burst.get('p50Ms')}ms "
        f"p95={burst.get('p95Ms')}ms max={burst.get('maxMs')}ms | video {stream['fps']} fps "
        f"underruns={stream['underruns']}"
    )
    return {"label": label, "input": burst, "stream": stream}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial", default=os.environ.get("HIL_ADB_SERIAL", ""))
    ap.add_argument("--taps", type=int, default=40)
    ap.add_argument("--report", default="")
    args = ap.parse_args()

    serial = args.serial or next(
        (l.split()[0] for l in sh("adb", "devices").splitlines()[1:] if "\tdevice" in l), ""
    )
    if not serial:
        sys.exit("no ADB device")
    forward_cdp(serial)
    print("== input-latency-under-load HIL ==", evaluate("document.title"))

    # Open Remote Input in Joystick mode with the mirror running, so the burst competes with video.
    if not present("av-video-toggle"):
        sys.exit("Live View controls not present (open the app on Home first)")
    if not evaluate("!!document.querySelector('[data-testid=\"av-video-toggle\"]')"):
        sys.exit("no Live View")
    click("av-video-toggle")
    time.sleep(1)
    if present("av-audio-toggle"):
        click("av-audio-toggle")
    print("Stabilising the stream…")
    time.sleep(12)
    if present("stream-stats-toggle"):
        click("stream-stats-toggle")

    report = {"startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "serial": serial, "phases": []}

    # A: input priority ON (default) — the shipped behaviour.
    print(f"Phase A — Input Priority ON ({args.taps} joystick moves under load)…")
    report["phases"].append(phase("priority-on", args.taps))

    # Flip the Settings toggle off and restart the stream so the session re-reads it, then re-measure.
    print("Toggling Input Priority OFF (Settings) + restarting the stream…")
    # Navigate to Settings, flip, come back — via the persisted key so we don't fight the UI route.
    evaluate("localStorage.setItem('c64u_stream_input_priority','0')")
    click("av-video-toggle")  # stop
    time.sleep(1)
    click("av-video-toggle")  # start again → session re-reads the setting
    time.sleep(12)
    print(f"Phase B — Input Priority OFF ({args.taps} joystick moves under load)…")
    report["phases"].append(phase("priority-off", args.taps))

    # Restore the default.
    evaluate("localStorage.setItem('c64u_stream_input_priority','1')")

    on = report["phases"][0]["input"]
    off = report["phases"][1]["input"]
    print("\n=== A/B summary (input dispatch p95 under Live View load) ===")
    print(f"  Input Priority ON : p50 {on.get('p50Ms')}ms  p95 {on.get('p95Ms')}ms")
    print(f"  Input Priority OFF: p50 {off.get('p50Ms')}ms  p95 {off.get('p95Ms')}ms")

    if args.report:
        with open(args.report, "w") as f:
            json.dump(report, f, indent=2)
        print(f"  report → {args.report}")


if __name__ == "__main__":
    main()
