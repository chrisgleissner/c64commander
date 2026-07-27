#!/usr/bin/env python3
"""Prove the app never plays two sounds at once, and that the transport works.

WHAT IT CHECKS

  A) NO OVERLAPPING AUDIO. The app can make sound two independent ways — the
     local SID engine rendering a tune here, and the A/V mirror playing the
     C64's audio over UDP. Exactly one may hold the speaker. Whichever starts
     last wins and the other is stopped (`lib/audio/phoneAudioOwnership`).
     A crossfade is the one legitimate overlap, and it happens *within* the
     local engine, so it never shows up as two sources.

  B) THE TRANSPORT. Play/Pause/Stop/Previous/Next stay usable and act on
     whatever is playing — including on a Play page that was mounted *after*
     playback started, which is where this used to fail. Rewind and Fast
     Forward are offered only for audio this device renders; the C64 plays the
     SID on its own chip and cannot be scrubbed.

Run against both machines, and across a switch between them:

    python3 tools/hil/audio_overlap_hil.py --serial 9B081FFAZ001WX
    python3 tools/hil/audio_overlap_hil.py --serial 9B081FFAZ001WX --device debug-u64
    python3 tools/hil/audio_overlap_hil.py --serial 9B081FFAZ001WX --switch-devices

COUNTING AUDIO STREAMS HONESTLY

`dumpsys audio | grep -c 'state:started'` counts EVERY app on the phone. It is
the signal the older recipes use, and it is why a stray "2 concurrent streams"
was once attributed to this app when the second player belonged to something
else entirely. Here the started players are filtered to the app's own pid, so
"two streams" means two of ours.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sid_radio_hil import (  # noqa: E402
    Cdp,
    adb,
    click_testid,
    enable_flags,
    forward_devtools,
    start_station,
)

PACKAGE = "uk.gleissner.c64commander"
ROOM_FLOOR_DBFS = -42.0
AUDIBLE_OVER_FLOOR_DB = 4.0


def app_pid(serial: str) -> str | None:
    out = adb(serial, "shell", "pidof", PACKAGE).strip()
    return out.split()[0] if out else None


def app_audio_streams(serial: str) -> int:
    """Started audio players belonging to THIS app.

    Filtered by pid on purpose — see the module docstring. An unfiltered count
    reports other apps' players as ours.
    """
    pid = app_pid(serial)
    if not pid:
        return 0
    dump = adb(serial, "shell", "dumpsys", "audio")
    started = [line for line in dump.splitlines() if "state:started" in line]
    return sum(1 for line in started if re.search(rf"u/pid:\d+/{pid}\b", line))


def mic_dbfs(seconds: float = 2.0) -> float:
    path = "/tmp/c64c-overlap-mic.wav"
    subprocess.run(
        ["arecord", "-D", "plughw:2,0", "-f", "S16_LE", "-r", "16000", "-c", "1", "-d", str(int(seconds)), path],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    with wave.open(path, "rb") as handle:
        samples = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16).astype(np.float64) / 32768.0
    if samples.size == 0:
        return -99.0
    return 20.0 * float(np.log10(max(np.sqrt((samples**2).mean()), 1e-9)))


def elapsed_seconds(cdp: Cdp) -> float | None:
    label = cdp.evaluate(
        "(() => { const el = document.querySelector('[data-testid=\"playback-elapsed\"]');"
        " return el ? el.textContent : null; })()"
    )
    if not label:
        return None
    match = re.search(r"(\d+):(\d{2})", label)
    return int(match.group(1)) * 60 + int(match.group(2)) if match else None


def testid_state(cdp: Cdp, testid: str) -> dict | None:
    """Presence, enabled-ness and label of a control — what a user can actually do."""
    return cdp.evaluate(
        f"(() => {{ const el = document.querySelector('[data-testid=\"{testid}\"]');"
        " if (!el) return null;"
        " return { present: true, disabled: !!el.disabled,"
        "   label: (el.getAttribute('aria-label') || el.textContent || '').trim() }; })()"
    )


def wait_for_playing(cdp: Cdp, serial: str, timeout_s: float = 60.0) -> bool:
    """Advancing clock AND an audio stream of our own. Never presses play."""
    deadline = time.time() + timeout_s
    previous = elapsed_seconds(cdp)
    while time.time() < deadline:
        time.sleep(3)
        current = elapsed_seconds(cdp)
        if current is not None and previous is not None and current > previous and app_audio_streams(serial) > 0:
            return True
        previous = current
    return False


def select_device(cdp: Cdp, device_id: str) -> Cdp:
    """Point the app at a saved device and reload, as a device switch does.

    Returns a FRESH CDP connection: the reload navigates the inspected target,
    and every later call on the old one fails with "Inspected target navigated
    or closed" — which read as a harness crash rather than a completed switch.
    """
    cdp.evaluate(
        "(() => { const raw = localStorage.getItem('c64u_saved_devices:v1'); if (!raw) return 'none';"
        " const state = JSON.parse(raw);"
        f" state.selectedDeviceId = {json.dumps(device_id)};"
        " localStorage.setItem('c64u_saved_devices:v1', JSON.stringify(state)); return 'ok'; })()"
    )
    cdp.send("Page.reload", {"ignoreCache": False})
    cdp.close()
    time.sleep(10)
    return Cdp()


def app_connected(cdp: Cdp) -> bool:
    """Is the app actually talking to the selected machine?

    A station cannot start against a machine the app never reached, and the
    failure looks identical to "SID Radio is broken".
    """
    return bool(
        cdp.evaluate(
            "(() => { const el = document.querySelector('[data-testid=\"unified-health-badge\"]');"
            " if (!el) return false;"
            " const state = el.getAttribute('data-connection-state') || '';"
            " return /CONNECTED/i.test(state); })()"
        )
    )


def selected_device(cdp: Cdp) -> str | None:
    return cdp.evaluate(
        "(() => { const raw = localStorage.getItem('c64u_saved_devices:v1');"
        " return raw ? (JSON.parse(raw).selectedDeviceId ?? null) : null; })()"
    )


class Checks:
    def __init__(self) -> None:
        self.results: list[dict] = []

    def record(self, name: str, ok: bool, detail: str) -> None:
        self.results.append({"check": name, "ok": bool(ok), "detail": detail})
        print(f"  [{'PASS' if ok else 'FAIL'}] {name} — {detail}")

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if not r["ok"])


def check_no_overlap(cdp: Cdp, serial: str, checks: Checks) -> None:
    """A) Local tune + mirror audio must never both hold the speaker."""
    print("\nA) Overlapping audio")

    start_station(cdp, "style", "fast_paced")
    if not wait_for_playing(cdp, serial):
        checks.record("local playback starts", False, "the tune never began; nothing to test overlap against")
        return
    local_streams = app_audio_streams(serial)
    checks.record("local playback starts", local_streams == 1, f"{local_streams} stream(s) from this app")

    # Now turn the C64's audio mirror on WITHOUT touching "Listen on" — the path
    # that used to walk straight past the only place that stopped the other side.
    click_testid(cdp, "tab-home", timeout_s=10)
    time.sleep(2)
    turned_on = click_testid(cdp, "av-audio-toggle", timeout_s=8)
    time.sleep(8)
    if not turned_on:
        checks.record("mirror audio available", False, "av-audio-toggle not found; cannot test the overlap path")
    else:
        streams = app_audio_streams(serial)
        checks.record(
            "mirror audio replaces the local tune, never joins it",
            streams <= 1,
            f"{streams} stream(s) from this app while the mirror is live (must be at most 1)",
        )

    # And back the other way: starting a local tune must silence the mirror.
    click_testid(cdp, "tab-play", timeout_s=10)
    time.sleep(2)
    start_station(cdp, "style", "fast_paced")
    time.sleep(12)
    streams = app_audio_streams(serial)
    checks.record(
        "a local tune replaces the mirror, never joins it",
        streams <= 1,
        f"{streams} stream(s) from this app after starting local playback (must be at most 1)",
    )

    level = mic_dbfs()
    checks.record(
        "the phone is actually audible",
        level - ROOM_FLOOR_DBFS >= AUDIBLE_OVER_FLOOR_DB,
        f"{level:.1f} dBFS, {level - ROOM_FLOOR_DBFS:.1f} dB over the room floor",
    )


def check_transport(cdp: Cdp, serial: str, checks: Checks) -> None:
    """B) Controls stay usable and act on what is playing."""
    print("\nB) Transport controls")

    if not wait_for_playing(cdp, serial, timeout_s=45):
        checks.record("something is playing", False, "no playback to control")
        return

    # The failure this exists for: leave Play and come back, which destroys the
    # page instance that started the tune, and see whether the controls still work.
    click_testid(cdp, "tab-home", timeout_s=10)
    time.sleep(2)
    click_testid(cdp, "tab-play", timeout_s=10)
    time.sleep(1.5)  # deliberately short: the point is the FIRST paint

    pause = testid_state(cdp, "playlist-pause")
    checks.record(
        "Pause is live on a Play page mounted mid-tune",
        bool(pause and pause["present"] and not pause["disabled"]),
        f"pause={pause}",
    )

    # Play/Prev/Next are gated on `canTransport = hasPlaylist && !isPlaylistLoading`.
    # An empty playlist therefore disables them CORRECTLY — and the playlist is
    # per-device, so selecting a machine that has never had one made these read
    # as transport failures when nothing was wrong. Say which it is.
    playlist_items = cdp.evaluate("document.querySelectorAll('[data-testid=\"playlist-item\"]').length") or 0
    if not playlist_items:
        checks.record(
            "playlist present for the transport checks",
            False,
            "this device has an EMPTY playlist, so Play/Previous/Next are correctly disabled — "
            "run against a device with a playlist to exercise them",
        )
    else:
        play = testid_state(cdp, "playlist-play")
        checks.record(
            "Play/Stop reflects the running tune",
            bool(play and play["present"] and "stop" in play["label"].lower()),
            f"play={play}",
        )

        for testid in ("playlist-prev", "playlist-next"):
            state = testid_state(cdp, testid)
            checks.record(f"{testid} is usable", bool(state and state["present"] and not state["disabled"]), f"{state}")

    # Pause must act on the tune that is playing, not on nothing.
    before = elapsed_seconds(cdp)
    click_testid(cdp, "playlist-pause", timeout_s=5)
    time.sleep(4)
    after = elapsed_seconds(cdp)
    streams = app_audio_streams(serial)
    checks.record(
        "Pause acts on the playing tune",
        after is not None and before is not None and (after == before or streams == 0),
        f"clock {before}s -> {after}s, {streams} stream(s)",
    )

    # Resume, then Stop.
    click_testid(cdp, "playlist-pause", timeout_s=5)
    time.sleep(3)
    click_testid(cdp, "playlist-play", timeout_s=5)  # toggles to Stop while playing
    time.sleep(4)
    streams = app_audio_streams(serial)
    checks.record("Stop silences this device", streams == 0, f"{streams} stream(s) after Stop")


def check_seek_gating(cdp: Cdp, serial: str, engine: str, checks: Checks) -> None:
    """Rewind/FastForward only for audio this device renders."""
    print(f"\nB2) Seek affordance on the '{engine}' route")
    seek = testid_state(cdp, "playback-progress-seek")
    if engine == "local":
        checks.record(
            "the progress bar is seekable for on-device playback",
            bool(seek and seek["present"]),
            f"seek control {'present' if seek else 'absent'}",
        )
    else:
        checks.record(
            "the progress bar is NOT seekable while the C64 plays the tune",
            seek is None,
            f"seek control {'present (should be absent)' if seek else 'absent'}",
        )


def run_for_device(cdp: Cdp, serial: str, device_id: str | None, checks: Checks) -> Cdp:
    if device_id:
        print(f"\n=== device: {device_id} ===")
        cdp = select_device(cdp, device_id)
    print(f"selected device: {selected_device(cdp)}")
    connected = app_connected(cdp)
    checks.record(
        f"app reaches {selected_device(cdp)}",
        connected,
        "connected" if connected else "NOT connected — the checks below cannot mean anything",
    )
    if not connected:
        return cdp

    enable_flags(cdp, engine="local")
    check_no_overlap(cdp, serial, checks)
    check_seek_gating(cdp, serial, "local", checks)
    check_transport(cdp, serial, checks)

    # The C64 route: the tune plays on the machine, so this device must not
    # offer to scrub it.
    print("\n--- switching the route to the C64 ---")
    enable_flags(cdp, engine="c64")
    click_testid(cdp, "tab-play", timeout_s=10)
    time.sleep(2)
    start_station(cdp, "style", "fast_paced")
    time.sleep(10)
    check_seek_gating(cdp, serial, "c64", checks)
    click_testid(cdp, "sid-radio-stop", timeout_s=5)
    time.sleep(2)
    return cdp


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--device", default=None, help="saved-device id to select first (e.g. debug-u64)")
    parser.add_argument(
        "--switch-devices",
        action="store_true",
        help="run against c64u, then switch to u64 mid-session and run again",
    )
    parser.add_argument("--outdir", default="artifacts/audio-overlap")
    args = parser.parse_args()

    adb(args.serial, "shell", "input", "keyevent", "224")
    adb(args.serial, "shell", "svc", "power", "stayon", "usb")
    forward_devtools(args.serial)
    cdp = Cdp()
    checks = Checks()
    try:
        if args.switch_devices:
            cdp = run_for_device(cdp, args.serial, "debug-c64u", checks)
            # The switch itself, with a tune running: the old machine must be
            # left silent and the app must stay in control of the transport.
            enable_flags(cdp, engine="local")
            start_station(cdp, "style", "fast_paced")
            wait_for_playing(cdp, args.serial, timeout_s=45)
            print("\n=== switching devices while playing ===")
            cdp = select_device(cdp, "debug-u64")
            time.sleep(6)
            streams = app_audio_streams(args.serial)
            checks.record(
                "a device switch leaves at most one source playing",
                streams <= 1,
                f"{streams} stream(s) from this app after the switch",
            )
            cdp = run_for_device(cdp, args.serial, None, checks)
        else:
            cdp = run_for_device(cdp, args.serial, args.device, checks)

        outdir = Path(args.outdir)
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "audio-overlap.json").write_text(json.dumps(checks.results, indent=2))
        print(f"\n{len(checks.results) - checks.failed}/{len(checks.results)} checks passed")
        return 1 if checks.failed else 0
    finally:
        # Leave the phone silent and the C64 stopped.
        try:
            click_testid(cdp, "sid-radio-stop", timeout_s=3)
            click_testid(cdp, "playlist-play", timeout_s=3)
        except Exception:
            pass
        cdp.close()


if __name__ == "__main__":
    raise SystemExit(main())
