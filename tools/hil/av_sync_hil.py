#!/usr/bin/env python3
#
# C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
# Copyright (C) 2026 Christian Gleissner
# Licensed under the GNU General Public License v3.0 or later.
#
# Real Pixel 4 -> C64 Ultimate A/V sync HIL test.
#
# Drives the SHIPPED app on a physically-connected phone (no product-code shortcuts): it starts
# Live View, runs the bundled av-sync programs, and reads the on-screen A/V sync + tap-latency
# stats straight out of the running WebView via the DevTools (CDP) socket. It measures the true
# end-to-end phone->device->phone path over real Wi-Fi.
#
# Prerequisites:
#   - The app installed and connected to the C64U (adb device visible; Live View reachable).
#   - Python 'websocket-client' (pip install websocket-client).
#   - The C64U password for the interactive (space) phase (X-Password header), default "pwd".
#
# Usage:
#   python3 tools/hil/av_sync_hil.py --serial <ADB_SERIAL> [--soak-seconds 45] [--taps 12]
#
# It asserts the auto soak produces matched pops and reports every latency P99. Absolute
# thresholds are intentionally NOT asserted on hardware: the <30ms latency / <20ms offset targets
# are "perfect network" figures (validated by the mocked E2E, useAvSyncInteractive) — real Wi-Fi
# adds tens of ms of network, device video-capture buffering and frame cadence. This test proves
# the pipeline WORKS end to end on hardware and prints the real numbers.

import argparse
import json
import subprocess
import sys
import time
import urllib.request

try:
    import websocket  # websocket-client
except ImportError:
    sys.exit("Missing dependency: pip install websocket-client")

CDP_PORT = 9345


def sh(*args):
    return subprocess.run(args, capture_output=True, text=True).stdout.strip()


def webview_socket(serial):
    lines = sh("adb", "-s", serial, "shell", "pidof", "uk.gleissner.c64commander")
    pid = lines.split()[0] if lines else None
    if not pid:
        sys.exit("App is not running on the device.")
    return f"webview_devtools_remote_{pid}"


def forward_cdp(serial):
    sock = webview_socket(serial)
    subprocess.run(["adb", "-s", serial, "forward", "--remove", f"tcp:{CDP_PORT}"], capture_output=True)
    subprocess.run(["adb", "-s", serial, "forward", f"tcp:{CDP_PORT}", f"localabstract:{sock}"], capture_output=True)


def ws_url():
    data = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json", timeout=5))
    for t in data:
        if t.get("webSocketDebuggerUrl"):
            return t["webSocketDebuggerUrl"]
    raise RuntimeError("No CDP page target")


def evaluate(expr):
    ws = websocket.create_connection(ws_url(), timeout=20, suppress_origin=True)
    try:
        ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                            "params": {"expression": expr, "returnByValue": True,
                                       "awaitPromise": True, "userGesture": True}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == 1:
                return msg.get("result", {}).get("result", {}).get("value")
    finally:
        ws.close()


def click(testid):
    result = evaluate(f"(()=>{{const e=document.querySelector('[data-testid=\"{testid}\"]');"
                      f"if(!e)return 'NF';e.click();return 'ok';}})()")
    if result != "ok":
        # A missing CTA means the page is not in the expected state — fail loudly rather than
        # continuing to read stale counters and reporting a misleading pass.
        raise RuntimeError(f"HIL action failed: '{testid}' not found (page not in expected state)")
    return result


def text(testid):
    return evaluate(f"(document.querySelector('[data-testid=\"{testid}\"]')||{{}}).textContent")


def sync_stats():
    return {k: text(f"av-sync-stat-{k}") for k in ("last", "min", "avg", "p90", "p99", "max")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial", required=True)
    ap.add_argument("--soak-seconds", type=int, default=45)
    ap.add_argument("--taps", type=int, default=12)
    args = ap.parse_args()

    forward_cdp(args.serial)
    print("== A/V sync HIL ==", evaluate("document.title"))

    # 1) Start Live View (Watch + Listen) and wait for the stream to stabilise.
    click("av-video-toggle"); time.sleep(1)
    click("av-audio-toggle")
    print("Waiting for the stream to stabilise...")
    time.sleep(15)
    print("  video:", text("av-mirror-fps"), "| controls:", text("av-mirror-controls"))

    # 2) Automatic soak — periodic aligned pops; assert matched pops and report offset P99.
    click("live-view-expand"); time.sleep(1)
    click("av-sync-run"); time.sleep(1)
    click("av-sync-reset")
    print(f"Auto A/V sync soak ({args.soak_seconds}s)...")
    time.sleep(args.soak_seconds)
    count = text("av-sync-count")
    stats = sync_stats()
    print(f"  {count} | offset(signed) {stats}")
    matched = int((count or "0").split()[0])
    assert matched >= 5, f"auto soak produced too few matched pops: {count}"

    # 3) Interactive space-triggered taps — report press->see / press->hear / offset P99.
    click("av-sync-key-load"); time.sleep(4)
    err = text("av-sync-error")
    assert err in (None, "", "none"), f"failed to load space program: {err}"
    click("av-sync-reset")
    print(f"Sending {args.taps} SPACE taps...")
    for _ in range(args.taps):
        click("av-sync-press")
        time.sleep(1.6)
    time.sleep(1)
    see = text("av-sync-lat-see")
    hear = text("av-sync-lat-hear")
    offset = text("av-sync-lat-offset")
    print("  taps:", text("av-sync-lat-count"),
          "| press->see P99:", see, "| press->hear P99:", hear, "| A/V offset P99:", offset)
    taps = int((text("av-sync-lat-count") or "0").split()[0])
    # A single measured tap is not a meaningful P99. Require a majority of the sent taps to have
    # produced a detected pop, and require the latency fields to actually be populated.
    required = max(2, args.taps // 2)
    assert taps >= required, f"only {taps}/{args.taps} SPACE taps produced a detected pop (need >= {required})"
    for label, value in (("press->see", see), ("press->hear", hear), ("A/V offset", offset)):
        assert value not in (None, "", "—"), f"{label} P99 not reported after the taps"

    print("HIL PASS: pipeline works end to end on real hardware.")


if __name__ == "__main__":
    main()
