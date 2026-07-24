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
import os
import re
import subprocess
import sys
import time
import urllib.request

THRESHOLDS_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "ci", "perf", "stream-perf-thresholds.json")


def parse_ms(value):
    """Extract the millisecond number that precedes 'ms' (e.g. 'p99 153 ms' -> 153, '+2 ms' -> 2)."""
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*ms", value or "")
    return abs(float(m.group(1))) if m else None

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
    click("av-sync-toggle"); time.sleep(0.5)  # the A/V Sync section is collapsed by default
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
    click("av-sync-lat-toggle"); time.sleep(0.5)  # the Tap latency section is collapsed by default
    click("av-sync-key-load"); time.sleep(4)
    err = text("av-sync-error")
    assert err in (None, "", "none"), f"failed to load space program: {err}"
    click("av-sync-reset")
    print(f"Sending {args.taps} SPACE taps...")
    for _ in range(args.taps):
        click("av-sync-press")
        time.sleep(1.6)
    time.sleep(1)
    see_p99 = parse_ms(text("av-sync-lat-see-p99"))
    hear_p99 = parse_ms(text("av-sync-lat-hear-p99"))
    offset_p99 = parse_ms(text("av-sync-lat-offset-p99"))
    soak_offset_p99 = parse_ms(stats.get("p99"))
    print("  taps:", text("av-sync-lat-count"),
          "| press->see p99:", see_p99, "ms | press->hear p99:", hear_p99,
          "ms | A/V offset p99:", offset_p99, "ms | soak A/V offset p99:", soak_offset_p99, "ms")
    taps = int((text("av-sync-lat-count") or "0").split()[0])
    required = max(2, args.taps // 2)
    assert taps >= required, f"only {taps}/{args.taps} SPACE taps produced a detected pop (need >= {required})"

    # Assert the committed AMBITIOUS-BUT-ACHIEVABLE end-to-end budgets (§16.1, reframed). These are
    # measured on real hardware and gated with headroom; a regression here fails the local build.
    gates = json.load(open(THRESHOLDS_PATH))["endToEnd"]["thresholds"]
    checks = {
        "videoInputToDisplayP99Ms": (see_p99, gates["videoInputToDisplayP99Ms"]),
        "audioInputToHearP99Ms": (hear_p99, gates["audioInputToHearP99Ms"]),
        "avOffsetP99Ms": (max(v for v in (offset_p99, soak_offset_p99) if v is not None), gates["avOffsetP99Ms"]),
    }
    failed = []
    for name, (measured, limit) in checks.items():
        ok = measured is not None and measured <= limit
        print(f"  gate {name}: {measured} ms <= {limit} ms -> {'PASS' if ok else 'FAIL'}")
        if not ok:
            failed.append(name)
    if failed:
        print(f"HIL FAIL: {len(failed)} latency gate(s) exceeded: {', '.join(failed)}", file=sys.stderr)
        sys.exit(1)

    print("HIL PASS: pipeline works end to end on real hardware AND meets the committed latency budgets.")


if __name__ == "__main__":
    main()
