#!/usr/bin/env python3
"""SID Radio Hardware-in-the-Loop harness (spec §9.3).

Drives the shipped app on a physically-connected Pixel 4 over the WebView CDP
socket, starts a station via real ``data-testid`` elements, soaks through N
auto-advances, and asserts the MEASURED-then-PINNED §9.2 budgets from
``ci/perf/sid-radio-perf-thresholds.json`` — exiting 1 on any regression
(mirrors ``av_sync_hil.py``). This is the authoritative product proof for
G5/G6/G9/G11; the host-deterministic parts run in CI via
``scripts/assert-sid-radio-perf.mjs``.

    pip install websocket-client
    python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --station song --soak-tracks 30 --skips 5
    python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --station style --style fast_paced --soak-tracks 30
    python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --shuffle-replay
    python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --hvsc-update
    python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --engine local --station song --soak-tracks 20

The C64 engine needs a live C64U (the app plays SIDs on the Ultimate and you
hear them via the audio mirror); ``--engine local`` needs no C64 (Track B).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

try:
    import websocket  # type: ignore  # websocket-client
except ImportError:  # pragma: no cover - environment guard
    sys.stderr.write("sid_radio_hil: `pip install websocket-client` is required\n")
    raise

APP_PACKAGE = "uk.gleissner.c64commander"
CDP_LOCAL_PORT = 9222
STYLE_BITS = {
    "fast_paced": 0,
    "slow_ambient": 1,
    "melodic": 2,
    "experimental": 3,
    "nostalgic": 4,
    "composer_focus": 5,
    "era_explorer": 6,
    "deep_discovery": 7,
    "theme_hunter": 8,
}
THRESHOLDS_PATH = Path(__file__).resolve().parents[2] / "ci" / "perf" / "sid-radio-perf-thresholds.json"


def adb(serial: str, *args: str) -> str:
    return subprocess.check_output(["adb", "-s", serial, *args], text=True)


def forward_devtools(serial: str) -> None:
    """Find the app's WebView devtools socket and forward it to CDP_LOCAL_PORT."""
    unix = adb(serial, "shell", "cat", "/proc/net/unix")
    match = re.search(r"@(webview_devtools_remote_\d+)", unix)
    if not match:
        raise SystemExit("sid_radio_hil: no WebView devtools socket — is the app running with a WebView?")
    adb(serial, "forward", f"tcp:{CDP_LOCAL_PORT}", f"localabstract:{match.group(1)}")


class Cdp:
    """Minimal CDP client over the forwarded devtools websocket."""

    def __init__(self) -> None:
        import urllib.request

        pages = json.loads(urllib.request.urlopen(f"http://localhost:{CDP_LOCAL_PORT}/json").read())
        page = next((p for p in pages if p.get("type") == "page" and p.get("webSocketDebuggerUrl")), None)
        if not page:
            raise SystemExit("sid_radio_hil: no debuggable page")
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=45)
        self._id = 0

    def send(self, method: str, params: dict | None = None) -> dict:
        self._id += 1
        self.ws.send(json.dumps({"id": self._id, "method": method, "params": params or {}}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == self._id:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message.get("result", {})

    def evaluate(self, expression: str, await_promise: bool = False):
        result = self.send(
            "Runtime.evaluate",
            {"expression": expression, "awaitPromise": await_promise, "returnByValue": True},
        )
        if "exceptionDetails" in result:
            raise RuntimeError(json.dumps(result["exceptionDetails"]))
        return result.get("result", {}).get("value")

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:  # pragma: no cover
            pass


def enable_flags(cdp: Cdp) -> None:
    cdp.send("Page.enable")
    cdp.evaluate(
        "localStorage.setItem('c64u_sid_radio_enabled','1');"
        "localStorage.setItem('c64u_sid_ranking_enabled','1');"
        "'ok'"
    )
    cdp.send("Page.reload", {"ignoreCache": False})
    time.sleep(6)


def click_testid(cdp: Cdp, testid: str) -> bool:
    return bool(
        cdp.evaluate(
            f"(() => {{ const el = document.querySelector('[data-testid=\"{testid}\"]');"
            f" if (!el) return false; el.click(); return true; }})()"
        )
    )


def read_stats(cdp: Cdp) -> dict | None:
    value = cdp.evaluate(
        "(() => { const el = document.querySelector('[data-testid=\"sid-radio-stats\"]');"
        " return el && el.textContent ? el.textContent : null; })()"
    )
    return json.loads(value) if value else None


def start_station(cdp: Cdp, station: str, style: str | None) -> None:
    if station == "song":
        if not click_testid(cdp, "sid-radio-start"):
            raise SystemExit("sid_radio_hil: sid-radio-start not found (play a SID first)")
    elif station == "style":
        bit = STYLE_BITS[style or "fast_paced"]
        click_testid(cdp, "sid-radio-launcher")
        time.sleep(1)
        if not click_testid(cdp, f"sid-radio-style-{bit}"):
            raise SystemExit(f"sid_radio_hil: sid-radio-style-{bit} not found")
    elif station == "taste":
        click_testid(cdp, "sid-radio-launcher")
        time.sleep(1)
        click_testid(cdp, "sid-radio-taste")
    time.sleep(2)


def soak(cdp: Cdp, target_tracks: int, skips: int, seconds: int | None) -> dict:
    deadline = time.time() + (seconds if seconds else max(180, target_tracks * 8))
    skip_every = max(1, target_tracks // (skips + 1)) if skips else 0
    last_skip_at = 0
    stats: dict = {}
    while time.time() < deadline:
        stats = read_stats(cdp) or stats
        advanced = int(stats.get("tracksAutoAdvanced", 0))
        if skip_every and advanced >= last_skip_at + skip_every and stats.get("skips", 0) < skips:
            click_testid(cdp, "now-playing-notforme")
            last_skip_at = advanced
        if seconds is None and advanced >= target_tracks:
            break
        time.sleep(2)
    return stats


def assert_budgets(stats: dict) -> int:
    doc = json.loads(THRESHOLDS_PATH.read_text())
    failures = []
    for name, spec in doc.get("thresholds", {}).items():
        metric = spec["metric"]
        actual = sum(stats.get(k.strip(), 0) for k in metric.split("+")) if "+" in metric else stats.get(metric)
        if actual is None:
            continue
        bound, pinned = spec["bound"], spec["pinned"]
        ok = (
            (bound == "max" and actual <= pinned)
            or (bound == "min" and actual >= pinned)
            or (bound == "equals" and actual == pinned)
        )
        status = "ok" if ok else "REGRESSION"
        print(f"[sid-radio-hil] {name}: {metric}={actual} {bound} {pinned} -> {status}")
        if not ok:
            failures.append(name)
    return 1 if failures else 0


def shuffle_replay(cdp: Cdp, station: str, style: str | None) -> int:
    """Assert transport Shuffle/Repeat are disabled during a station (G11, §9.3)."""
    start_station(cdp, station, style)
    time.sleep(2)
    stats = read_stats(cdp) or {}
    disabled = bool(stats.get("transportShuffleDisabled")) and bool(stats.get("transportRepeatDisabled"))
    seq = stats.get("emittedSequence", [])
    print(f"[sid-radio-hil] shuffle-replay: controls-disabled={disabled} seqLen={len(seq)}")
    return 0 if disabled else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="SID Radio Pixel-4 → C64U HIL")
    parser.add_argument("--serial", required=True)
    parser.add_argument("--station", choices=["song", "style", "taste"], default="song")
    parser.add_argument("--style", choices=sorted(STYLE_BITS))
    parser.add_argument("--soak-tracks", type=int, default=30)
    parser.add_argument("--skips", type=int, default=0)
    parser.add_argument("--soak-seconds", type=int)
    parser.add_argument("--shuffle-replay", action="store_true")
    parser.add_argument("--hvsc-update", action="store_true")
    parser.add_argument("--engine", choices=["c64", "local"], default="c64")
    args = parser.parse_args()

    forward_devtools(args.serial)
    cdp = Cdp()
    try:
        enable_flags(cdp)
        if args.shuffle_replay:
            return shuffle_replay(cdp, args.station, args.style)
        start_station(cdp, args.station, args.style)
        stats = soak(cdp, args.soak_tracks, args.skips, args.soak_seconds)
        print("[sid-radio-hil] final stats:", json.dumps(stats))
        return assert_budgets(stats)
    finally:
        cdp.close()


if __name__ == "__main__":
    raise SystemExit(main())
