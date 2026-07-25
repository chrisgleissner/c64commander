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
hear them via the audio mirror); ``--engine local`` needs no C64 (Track B) and
is the only mode that asserts the ``localEngine`` (§12.6) budgets — it selects
the on-device engine before the station starts and aborts if the app did not
take the selection.
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
        # `suppress_origin`: the WebView's devtools endpoint rejects a handshake
        # that carries an Origin header (403) — websocket-client sends one by default.
        self.ws = websocket.create_connection(
            page["webSocketDebuggerUrl"], timeout=45, suppress_origin=True
        )
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


def enable_flags(cdp: Cdp, engine: str = "c64", force_hvsc_update: bool = False) -> None:
    """Select the feature flags + playback engine, then reload so they take effect."""
    script = [
        "localStorage.setItem('c64u_sid_radio_enabled','1');",
        "localStorage.setItem('c64u_sid_ranking_enabled','1');",
    ]
    if engine == "local":
        # Track B: offer the on-device engine AND select it, so the station's
        # tunes render here instead of on the Ultimate (spec §12.5).
        script.append("localStorage.setItem('c64u_local_engine_enabled','1');")
        script.append("localStorage.setItem('c64u_playback_engine','local');")
    else:
        script.append("localStorage.setItem('c64u_playback_engine','c64');")
    if force_hvsc_update:
        # G12: make the periodic HVSC update check due again, so it runs while
        # the station below is playing and rebuilds `md5PathIndex` underneath it.
        script.append(
            "(() => { const k='c64u_hvsc_state:v1'; const raw=localStorage.getItem(k);"
            " if (!raw) return; try { const s=JSON.parse(raw); s.lastUpdateCheckUtcMs=null;"
            " localStorage.setItem(k, JSON.stringify(s)); } catch {} })();"
        )
    cdp.send("Page.enable")
    cdp.evaluate("".join(script) + "'ok'")
    cdp.send("Page.reload", {"ignoreCache": False})
    time.sleep(6)


def read_hvsc_state(cdp: Cdp) -> dict:
    """The persisted HVSC state — used to tell a real update from a no-op (G12)."""
    raw = cdp.evaluate("localStorage.getItem('c64u_hvsc_state:v1')")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return {}


def read_engine_route(cdp: Cdp) -> str:
    """Which engine the app will actually use for the next SID."""
    return cdp.evaluate("localStorage.getItem('c64u_playback_engine') || 'c64'")


def click_testid(cdp: Cdp, testid: str, timeout_s: float = 10.0) -> bool:
    """Click a test id, waiting for it to appear.

    Polls rather than clicking once: the station launcher opens in a sheet that
    animates in, so a single immediate attempt raced it and reported
    "sid-radio-style-0 not found" on a perfectly healthy app.
    """
    deadline = time.time() + timeout_s
    while True:
        found = bool(
            cdp.evaluate(
                f"(() => {{ const el = document.querySelector('[data-testid=\"{testid}\"]');"
                f" if (!el) return false; el.click(); return true; }})()"
            )
        )
        if found or time.time() >= deadline:
            return found
        time.sleep(0.25)


def read_stats(cdp: Cdp) -> dict | None:
    value = cdp.evaluate(
        "(() => { const el = document.querySelector('[data-testid=\"sid-radio-stats\"]');"
        " return el && el.textContent ? el.textContent : null; })()"
    )
    return json.loads(value) if value else None


def stop_active_station(cdp: Cdp) -> bool:
    """Leave any station that is already running.

    A station survives an app restart via the persisted session, and while one is
    active the Play page shows Stop instead of the launcher — so a soak that
    assumed a clean slate failed with "sid-radio-style-0 not found" on an app
    that was working perfectly.
    """
    if not click_testid(cdp, "sid-radio-stop", timeout_s=1.0):
        return False
    time.sleep(1.5)
    return True


def open_play_tab(cdp: Cdp) -> None:
    """Every station control lives on the Play page.

    The harness used to assume the app was already there, so a run against a
    freshly launched app (which opens on Home) failed with
    "sid-radio-style-0 not found" — a missing tab, not a missing feature.
    """
    click_testid(cdp, "tab-play", timeout_s=20.0)
    time.sleep(2.5)


def start_station(cdp: Cdp, station: str, style: str | None) -> None:
    open_play_tab(cdp)
    stop_active_station(cdp)
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


def elapsed_label(cdp: Cdp) -> str | None:
    return cdp.evaluate(
        "(() => { const el = document.querySelector('[data-testid=\"playback-elapsed\"]');"
        " return el ? el.textContent : null; })()"
    )


def ensure_playing(cdp: Cdp, timeout_s: float = 25.0) -> bool:
    """Make sure audio is actually advancing, not merely that a station exists.

    Starting a station queues tracks; it does not necessarily start playback. A
    soak that skipped this reported tracksAutoAdvanced=0 and looked like a
    continuity failure when nothing had ever played.
    """
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        before = elapsed_label(cdp)
        time.sleep(3)
        after = elapsed_label(cdp)
        if after not in (None, "0:00") and after != before:
            return True
        click_testid(cdp, "playlist-play", timeout_s=2.0)
    return False


def soak(cdp: Cdp, target_tracks: int, skips: int, seconds: int | None) -> dict:
    if not ensure_playing(cdp):
        raise SystemExit("sid_radio_hil: playback never advanced; soak would measure nothing")
    deadline = time.time() + (seconds if seconds else max(180, target_tracks * 8))
    skip_every = max(1, target_tracks // (skips + 1)) if skips else 0
    last_skip_at = 0
    stats: dict = {}
    stalled_since = time.time()
    last_elapsed = None
    while time.time() < deadline:
        stats = read_stats(cdp) or stats
        # A stalled clock means playback died mid-soak; nudge it rather than
        # silently accumulating a passing-looking run with no audio.
        current = elapsed_label(cdp)
        if current != last_elapsed:
            last_elapsed, stalled_since = current, time.time()
        elif time.time() - stalled_since > 20:
            click_testid(cdp, "playlist-play", timeout_s=2.0)
            stalled_since = time.time()
        advanced = int(stats.get("tracksAutoAdvanced", 0))
        if skip_every and advanced >= last_skip_at + skip_every and stats.get("skips", 0) < skips:
            click_testid(cdp, "now-playing-notforme")
            last_skip_at = advanced
        if seconds is None and advanced >= target_tracks:
            break
        time.sleep(2)
    return stats


def assert_budgets(stats: dict, sections: tuple[str, ...] = ("thresholds",)) -> int:
    """Assert the pinned §9.2/§12.6 budgets for each requested section.

    A metric the app never reported is called out rather than skipped: a silent
    `None` would otherwise let an unmeasured budget pass as green.
    """
    doc = json.loads(THRESHOLDS_PATH.read_text())
    failures: list[str] = []
    for section in sections:
        specs = doc.get(section, {})
        reported = 0
        for name, spec in specs.items():
            metric = spec["metric"]
            actual = sum(stats.get(k.strip(), 0) for k in metric.split("+")) if "+" in metric else stats.get(metric)
            if actual is None:
                print(f"[sid-radio-hil] {section}.{name}: {metric}=NOT REPORTED (not measured this run)")
                continue
            reported += 1
            bound, pinned = spec["bound"], spec["pinned"]
            ok = (
                (bound == "max" and actual <= pinned)
                or (bound == "min" and actual >= pinned)
                or (bound == "equals" and actual == pinned)
            )
            status = "ok" if ok else "REGRESSION"
            print(f"[sid-radio-hil] {section}.{name}: {metric}={actual} {bound} {pinned} -> {status}")
            if not ok:
                failures.append(f"{section}.{name}")
        if specs and reported == 0:
            print(f"[sid-radio-hil] {section}: NO metric was reported — the run proved nothing")
            failures.append(section)
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


def hvsc_update(cdp: Cdp, args: argparse.Namespace, before: dict) -> int:
    """G12: a station keeps advancing while an HVSC update rebuilds md5PathIndex.

    `enable_flags` already made the update check due, so it runs on this launch
    — overlapping the station started here. Continuity is the assertion; whether
    upstream actually had an update is reported so a no-op run is never mistaken
    for a proof.
    """
    start_station(cdp, args.station, args.style)
    stats = soak(cdp, args.soak_tracks, 0, args.soak_seconds)
    after = read_hvsc_state(cdp)
    rebuilt = before.get("updateVersion") != after.get("updateVersion") or before.get(
        "installedVersion"
    ) != after.get("installedVersion")
    advanced = int(stats.get("tracksAutoAdvanced", 0))
    print(
        f"[sid-radio-hil] hvsc-update: advanced={advanced} "
        f"installed {before.get('installedVersion')!r}->{after.get('installedVersion')!r} "
        f"update {before.get('updateVersion')!r}->{after.get('updateVersion')!r}"
    )
    if not rebuilt:
        print(
            "[sid-radio-hil] hvsc-update: NO HVSC update was available upstream — "
            "continuity held but the index never rebuilt, so G12 is NOT proven by this run"
        )
    print("[sid-radio-hil] final stats:", json.dumps(stats))
    return assert_budgets(stats)


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
        before = read_hvsc_state(cdp) if args.hvsc_update else {}
        enable_flags(cdp, engine=args.engine, force_hvsc_update=args.hvsc_update)
        route = read_engine_route(cdp)
        print(f"[sid-radio-hil] playback engine: requested={args.engine} selected={route}")
        if route != args.engine:
            raise SystemExit(f"sid_radio_hil: engine {args.engine} was not selected (app reports {route})")
        if args.hvsc_update:
            return hvsc_update(cdp, args, before)
        if args.shuffle_replay:
            return shuffle_replay(cdp, args.station, args.style)
        start_station(cdp, args.station, args.style)
        stats = soak(cdp, args.soak_tracks, args.skips, args.soak_seconds)
        print("[sid-radio-hil] final stats:", json.dumps(stats))
        # `--engine local` is the only run that exercises the on-device engine,
        # so it is the only one whose §12.6 budgets mean anything.
        sections = ("thresholds", "localEngine") if args.engine == "local" else ("thresholds",)
        return assert_budgets(stats, sections)
    finally:
        cdp.close()


if __name__ == "__main__":
    raise SystemExit(main())
