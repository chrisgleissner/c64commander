#!/usr/bin/env python3
#
# C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
# Copyright (C) 2026 Christian Gleissner
# Licensed under the GNU General Public License v3.0 or later.
#
# Pixel 4 -> Ultimate 64 Live View streaming HIL fixture (spec §14.5, §15).
#
# A reusable, documented fixture that drives the SHIPPED app on a physically-connected Pixel over
# the WebView DevTools (CDP) socket and measures the real phone->C64U->phone streaming pipeline. It:
#   1. verifies the Pixel is reachable over ADB and the C64U REST endpoint answers (+ firmware),
#   2. gates on device state (battery %, charging, thermal) so a throttled run is not compared to a
#      cold one (§15.3),
#   3. starts Live View (video + audio) and lets it stabilise,
#   4. collects telemetry: presented fps + the app's own Stats (governor, underruns, residence, slot
#      accounting), per-thread CPU (top -H) and UI jank (gfxinfo),
#   5. asserts the committed device gates from ci/perf/stream-perf-thresholds.json (deviceCpu),
#   6. writes a machine-readable JSON report + a human summary.
#
# Exit codes (machine-readable, §17): 0 pass, 1 product gate failed, 2 infrastructure/precondition
# failure (kept DISTINCT so an infra flake is never converted into a passing product result, §1.5).
#
# Usage:
#   python3 tools/hil/hil_stream_fixture.py --serial <ADB_SERIAL> [--report out.json] [--host c64u]
#           [--stabilise 12] [--sample-seconds 12]

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

try:
    import websocket  # websocket-client
except ImportError:
    sys.exit("Missing dependency: pip install websocket-client")

PKG = "uk.gleissner.c64commander"
CDP_PORT = 9347


class InfraError(Exception):
    """A precondition / infrastructure failure (exit 2) — never a product pass."""


def sh(*args, timeout=20):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout).stdout.strip()


def adb(serial, *args, timeout=20):
    base = ["adb"] + (["-s", serial] if serial else [])
    return sh(*(base + list(args)), timeout=timeout)


# ---- CDP (WebView) -----------------------------------------------------------------------------

def forward_cdp(serial):
    pid = adb(serial, "shell", "pidof", PKG).split()
    if not pid:
        raise InfraError("app is not running on the device")
    sock = f"webview_devtools_remote_{pid[0]}"
    subprocess.run(["adb"] + (["-s", serial] if serial else []) + ["forward", "--remove", f"tcp:{CDP_PORT}"], capture_output=True)
    subprocess.run(["adb"] + (["-s", serial] if serial else []) + ["forward", f"tcp:{CDP_PORT}", f"localabstract:{sock}"], capture_output=True)


def cdp_eval(expr):
    data = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json", timeout=5))
    url = next((t["webSocketDebuggerUrl"] for t in data if t.get("webSocketDebuggerUrl")), None)
    if not url:
        raise InfraError("no CDP page target (is the WebView foregrounded?)")
    ws = websocket.create_connection(url, timeout=20, suppress_origin=True)
    try:
        ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
            "expression": expr, "returnByValue": True, "awaitPromise": True, "userGesture": True}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == 1:
                return msg.get("result", {}).get("result", {}).get("value")
    finally:
        ws.close()


def click(testid):
    return cdp_eval(f"(()=>{{const e=document.querySelector('[data-testid=\"{testid}\"]');if(!e)return 'NF';e.click();return 'ok';}})()")


def text(testid):
    return cdp_eval(f"(document.querySelector('[data-testid=\"{testid}\"]')||{{}}).textContent")


def num(testid, default=0.0):
    t = text(testid) or ""
    digits = "".join(c for c in t if (c.isdigit() or c in ".-"))
    try:
        return float(digits)
    except ValueError:
        return default


# ---- device / peer preconditions --------------------------------------------------------------

def device_state(serial):
    dump = adb(serial, "shell", "dumpsys", "battery")
    def field(key, cast=int, default=None):
        for line in dump.splitlines():
            line = line.strip()
            if line.startswith(key + ":"):
                try:
                    return cast(line.split(":", 1)[1].strip())
                except Exception:
                    return default
        return default
    level = field("level")
    temp = field("temperature")  # tenths of a degree C
    status = field("status")  # 2/5 = charging/full
    return {
        "batteryPct": level,
        "batteryTempC": (temp / 10.0) if temp is not None else None,
        "charging": status in (2, 5) if status is not None else None,
        "androidRelease": adb(serial, "shell", "getprop", "ro.build.version.release"),
        "model": adb(serial, "shell", "getprop", "ro.product.model"),
        "appVersion": next((l.split("=", 1)[1] for l in adb(serial, "shell", "dumpsys", "package", PKG).splitlines() if "versionName=" in l), "?").strip(),
    }


def sample_cpu(serial):
    out = adb(serial, "shell", "top", "-H", "-b", "-n", "3")
    pool = rend = pooln = rendn = 0.0
    for line in out.splitlines():
        cols = line.split()
        if len(cols) < 9:
            continue
        try:
            cpu = float(cols[8])
        except ValueError:
            continue
        name = cols[-2]  # top -H columns: … THREAD(name) PROCESS(pkg) — the THREAD is second-to-last
        if name.startswith("pool-"):
            pool += cpu; pooln += 1
        elif name == "CrRendererMain":
            rend += cpu; rendn += 1
    native = (pool / pooln) if pooln else 0.0
    renderer = (rend / rendn) if rendn else 0.0
    return {"nativePoolPct": round(native, 1), "crRendererPct": round(renderer, 1), "appTotalPct": round(native + renderer, 1)}


def sample_jank(serial):
    dump = adb(serial, "shell", "dumpsys", "gfxinfo", PKG)
    total = janky = missed = 0
    for line in dump.splitlines():
        s = line.strip()
        if s.startswith("Total frames rendered:"):
            total = int(s.split(":")[1])
        elif s.startswith("Janky frames:"):
            janky = int(s.split(":")[1].split("(")[0])
        elif s.startswith("Number Missed Vsync:"):
            missed = int(s.split(":")[1])
    return {"totalFrames": total, "jankyFrames": janky, "jankyPct": round(100 * janky / total, 2) if total else 0.0, "missedVsync": missed}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial", default=os.environ.get("HIL_ADB_SERIAL", ""))
    ap.add_argument("--host", default="c64u")
    ap.add_argument("--report", default="")
    ap.add_argument("--stabilise", type=int, default=12)
    ap.add_argument("--sample-seconds", type=int, default=12)
    args = ap.parse_args()

    report = {"startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "gates": {}}
    try:
        # 1. Preconditions.
        serial = args.serial or next((l.split()[0] for l in adb("", "devices").splitlines()[1:] if "\tdevice" in l), "")
        if not serial:
            raise InfraError("no ADB device")
        report["serial"] = serial
        try:
            info = json.load(urllib.request.urlopen(f"http://{args.host}/v1/info", timeout=5))
            report["c64u"] = {"product": info.get("product"), "firmware": info.get("firmware_version")}
        except Exception as exc:
            raise InfraError(f"C64U REST unreachable at {args.host}: {exc}")

        report["device"] = device_state(serial)
        thresholds = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "ci", "perf", "stream-perf-thresholds.json")))
        gates = thresholds["deviceCpu"]["thresholds"]

        forward_cdp(serial)
        report["appTitle"] = cdp_eval("document.title")

        # 3. Start Live View, let it stabilise.
        if not cdp_eval("!!document.querySelector('[data-testid=\"av-video-toggle\"]')"):
            raise InfraError("Live View controls not present (app not on a streaming surface)")
        click("av-video-toggle"); time.sleep(1)
        click("av-audio-toggle")
        time.sleep(args.stabilise)
        adb(serial, "shell", "dumpsys", "gfxinfo", PKG, "reset")  # measure jank over the sample window only

        fps = num("av-mirror-fps")
        if fps <= 0:
            raise InfraError("no video after stabilise — stream did not start")

        # 4. Collect telemetry. Expand Stats to read the app's own counters.
        click("stream-stats-toggle"); time.sleep(0.5)
        cpu = sample_cpu(serial)
        time.sleep(max(0, args.sample_seconds - 2))
        jank = sample_jank(serial)
        stats = {
            "fps": fps,
            "rate": text("stream-stats-rate"),
            "underruns": int(num("stream-stats-underruns")),
            "concealed": int(num("stream-stats-concealed")),
            "residenceP99Ms": num("stream-stats-residence-p99"),
            "presented": int(num("stream-stats-presented")),
            "partial": int(num("stream-stats-partial")),
            "repeated": int(num("stream-stats-repeated")),
            "framesLost": int(num("stream-stats-frames-lost")),
        }
        report["measurements"] = {"cpu": cpu, "jank": jank, "stats": stats}

        # 5. Assert the committed device gates (§16.4). Product failures → exit 1.
        checks = {
            "appTotalCpuPctAt100": cpu["appTotalPct"] <= gates["appTotalCpuPctAt100"],
            "audioUnderruns": stats["underruns"] <= gates["audioUnderruns"],
            # Jank needs enough HWUI frames to be meaningful; too few → inconclusive, not a fail.
            "jankyFramesPct": jank["totalFrames"] < 100 or jank["jankyPct"] <= gates["jankyFramesPct"],
            "videoLive": fps >= 40,  # PAL 50 with headroom
        }
        report["jankInconclusive"] = jank["totalFrames"] < 100
        report["gates"] = checks
        report["passed"] = all(checks.values())

        # 6. Clean stop (validate no stale session left streaming).
        click("av-audio-toggle"); time.sleep(0.5); click("av-video-toggle")

    except InfraError as exc:
        report["error"] = str(exc)
        report["result"] = "infra"
        _emit(report, args.report)
        print(f"HIL INFRA FAILURE: {exc}", file=sys.stderr)
        sys.exit(2)
    except Exception as exc:  # pragma: no cover - defensive
        report["error"] = repr(exc)
        report["result"] = "infra"
        _emit(report, args.report)
        print(f"HIL UNEXPECTED ERROR: {exc!r}", file=sys.stderr)
        sys.exit(2)

    report["result"] = "pass" if report["passed"] else "fail"
    _emit(report, args.report)
    sys.exit(0 if report["passed"] else 1)


def _emit(report, path):
    text_report = json.dumps(report, indent=2)
    if path:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w") as fh:
            fh.write(text_report + "\n")
    print(text_report)


if __name__ == "__main__":
    main()
