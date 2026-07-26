#!/usr/bin/env python3
"""Measure what a backward seek actually costs the listener, at the speaker.

WHAT IS BEING MEASURED

libsidplayfp cannot rewind. Seeking backwards used to mean re-rendering the tune
from the start at roughly 150 ms of CPU per second of audio — so a seek the
listener expects to be instant went silent for seconds. The fix pre-renders the
whole tune in the background and serves seeks out of that buffer
(`localSidEngine.seekTo`).

The honest number for that is not a log line: it is **how long the speaker is
silent** between the tap and the music coming back. This drives the shipped app
on the Pixel 4, seeks by tapping the real progress bar, and listens on the USB
microphone aimed at the phone.

WHY IT TAKES TWO READINGS PER RUN

A single "it is fast now" number proves little — the room, the volume and the
tune all moved since the 9.96 s measured before the cache existed. So one run
takes two readings in the same room, minutes apart:

  EARLY  a seek taken soon after a tune started, while the background
         pre-render of it is probably still running
  LATE   a seek taken well into a tune, by which time the pre-render has
         almost certainly finished

They are named for WHEN they are taken, not for what the cache holds, because
the harness cannot see the cache and a radio station moves on to the next tune
underneath it — the two readings are often different tunes. Treat them as two
samples along the same axis, not as a controlled pair.

The gap is found in the audio itself — the longest silence following the tap —
so it needs no clock alignment between the host and the recording, and no trust
in when `arecord` actually opened the device.

USAGE
    pip install websocket-client numpy
    python3 tools/hil/seek_latency_hil.py --serial 9B081FFAZ001WX

REQUIREMENTS
    - Pixel 4 attached over adb, app installed, USB mic aimed at its speaker.
    - Media volume at 16/25 (see sid_audio_match.py: the quietest level that
      still reads reliably in a shared room).
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

# 20 ms frames: fine enough to place a gap edge, coarse enough that one quiet
# beat inside the music does not read as silence.
FRAME_MS = 20.0
# A gap must last this long to count. Below this it is a note boundary, not a
# seek — and it is also below what a listener would call an interruption.
MIN_GAP_MS = 150.0
# How far above the capture's own noise floor counts as "the speaker is playing".
# The floor is measured per capture rather than pinned, because it drifts with
# whatever else is in the room. 4 dB is comfortably inside the ~6.7 dB that
# volume 16/25 sits above the floor on this rig.
SOUND_OVER_FLOOR_DB = 4.0
# The rig's true room floor, measured with everything silent. Early work took
# baselines at -32.9 dBFS that were not silent at all and poisoned every
# comparison drawn from them.
ROOM_FLOOR_DBFS = -42.0


def dbfs_envelope(wav_path: Path) -> tuple[np.ndarray, float]:
    """Per-frame dBFS envelope of a mono 16-bit capture, plus the frame step."""
    with wave.open(str(wav_path), "rb") as handle:
        rate = handle.getframerate()
        samples = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16)
    if samples.size == 0:
        raise SystemExit("seek_latency_hil: the capture is empty — is the mic connected?")
    step = max(1, int(rate * FRAME_MS / 1000.0))
    usable = (samples.size // step) * step
    frames = samples[:usable].astype(np.float64).reshape(-1, step) / 32768.0
    rms = np.sqrt((frames**2).mean(axis=1))
    # Floor the log so digital silence does not become -inf.
    return 20.0 * np.log10(np.maximum(rms, 1e-9)), step / rate


def first_gap_after(envelope: np.ndarray, frame_seconds: float, tap_seconds: float) -> dict:
    """The FIRST qualifying silence at or after the tap — the seek's own gap.

    Deliberately not the longest. A capture runs on past the seek, and the
    longest silence in it may be a quiet passage or a track change seconds
    later: an early run reported a 0.36 s "seek gap" that began 13 s into a
    capture whose tap was at 4 s, which is not the seek at all.

    The noise floor is the 10th percentile of the whole capture, so a capture
    that is mostly music still finds its own quiet level. Anything within
    SOUND_OVER_FLOOR_DB of that is silence as far as a listener is concerned.
    """
    floor_db = float(np.percentile(envelope, 10))
    threshold = floor_db + SOUND_OVER_FLOOR_DB
    quiet = envelope <= threshold
    min_frames = int((MIN_GAP_MS / 1000.0) / frame_seconds)

    found = {"seconds": 0.0, "start_seconds": None}
    index = int(tap_seconds / frame_seconds)
    while index < quiet.size:
        if not quiet[index]:
            index += 1
            continue
        run_end = index
        while run_end < quiet.size and quiet[run_end]:
            run_end += 1
        if run_end - index >= min_frames:
            found = {"seconds": (run_end - index) * frame_seconds, "start_seconds": index * frame_seconds}
            break
        index = run_end + 1

    found["floor_dbfs"] = round(floor_db, 1)
    found["threshold_dbfs"] = round(threshold, 1)
    found["peak_dbfs"] = round(float(envelope.max()), 1)
    return found


def mic_music_over_floor(wav_path: Path, seconds: float = 2.0) -> float:
    """How far above the room floor the phone currently is, in dB.

    Absolute, not self-referential: a short capture of music has no silence in
    it to measure a floor against, so it is compared to the rig's measured room
    floor instead. Captures that scored ~3 dB here contained no music at all,
    while good ones ran 9-13 dB.
    """
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["arecord", "-D", "plughw:2,0", "-f", "S16_LE", "-r", "16000", "-c", "1",
         "-d", str(int(seconds)), str(wav_path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    envelope, _ = dbfs_envelope(wav_path)
    return float(envelope.max()) - ROOM_FLOOR_DBFS


def started_streams(serial: str) -> int:
    """How many audio streams the phone is actually running.

    The mic hears the whole room — including the C64U — so it cannot answer
    "is the PHONE producing audio". This can.
    """
    try:
        dump = adb(serial, "shell", "dumpsys", "audio")
    except subprocess.CalledProcessError:
        return -1
    return dump.count("state:started")


def seek_to_fraction(cdp: Cdp, serial: str, fraction: float) -> bool:
    """Tap the real progress bar at `fraction` across, with a real finger.

    The bar reads the pointer's x against its own rect, so `el.click()` is no
    use — it carries no coordinates and the handler would compute a nonsense
    position. CDP-synthesised mouse events are no good either: they drove the
    control into a scrub it never came out of (the elapsed label kept the ⏵
    marker) and playback stopped. `input tap` is a genuine touch, which is what
    this control is built for.

    The element's rect is in CSS pixels; the tap is in physical pixels, so it is
    scaled by the ratio the WebView is actually laid out at (2.755 on this Pixel).
    """
    rect = cdp.evaluate(
        "(() => { const el = document.querySelector('[data-testid=\"playback-progress-seek\"]');"
        " if (!el) return null; const r = el.getBoundingClientRect();"
        " return {x: r.x, y: r.y, w: r.width, h: r.height, inner: window.innerWidth}; })()"
    )
    if not rect or not rect.get("w") or not rect.get("inner"):
        return False
    scale = physical_width(serial) / rect["inner"]
    x = int((rect["x"] + rect["w"] * fraction) * scale)
    y = int((rect["y"] + rect["h"] / 2) * scale)
    adb(serial, "shell", "input", "tap", str(x), str(y))
    return True


def physical_width(serial: str) -> float:
    match = re.search(r"Physical size:\s*(\d+)x(\d+)", adb(serial, "shell", "wm", "size"))
    if not match:
        raise SystemExit("seek_latency_hil: could not read the screen size")
    return float(match.group(1))


def _clock(cdp: Cdp, testid: str) -> float | None:
    label = cdp.evaluate(
        f"(() => {{ const el = document.querySelector('[data-testid=\"{testid}\"]');"
        " return el ? el.textContent : null; })()"
    )
    if not label:
        return None
    match = re.search(r"(\d+):(\d{2})", label)
    return int(match.group(1)) * 60 + int(match.group(2)) if match else None


def elapsed_seconds(cdp: Cdp) -> float | None:
    return _clock(cdp, "playback-elapsed")


def duration_seconds(cdp: Cdp) -> float | None:
    """Total tune length, from the two clocks either side of the bar."""
    elapsed = _clock(cdp, "playback-elapsed")
    remaining = _clock(cdp, "playback-remaining")
    return None if elapsed is None or remaining is None else elapsed + remaining


def current_tune(cdp: Cdp) -> str | None:
    return cdp.evaluate("(() => { const m = document.body.innerText.match(/[\\w\\-\\.]+\\.sid/); return m ? m[0] : null; })()")


def seek_back_seconds(cdp: Cdp, serial: str, seconds_back: float) -> dict:
    """Seek a fixed distance BACKWARD, whatever the tune's length.

    A fixed fraction of the bar is not a fixed seek: 2% of a twenty-minute tune
    is 24 seconds in, which lands AHEAD of a playhead at 0:27 and silently
    measures a forward seek. Tune lengths in HVSC vary by more than an order of
    magnitude, so the target is computed from the clocks instead.
    """
    elapsed = elapsed_seconds(cdp)
    duration = duration_seconds(cdp)
    if elapsed is None or not duration:
        return {"ok": False, "reason": "could not read the position/duration clocks"}
    target = max(0.0, elapsed - seconds_back)
    if target >= elapsed:
        return {"ok": False, "reason": f"position {elapsed}s is too early to seek {seconds_back}s back"}
    ok = seek_to_fraction(cdp, serial, target / duration)
    return {"ok": ok, "from": elapsed, "target": target, "duration": duration}


def wait_for_playback(cdp: Cdp, serial: str, timeout_s: float) -> bool:
    """Wait until the clock is advancing AND the phone owns an audio stream.

    Both halves are needed. The clock alone advances even when nothing is
    audible here — it kept running against a device that never launched
    anything — and the stream count alone dips through zero between tracks.
    """
    deadline = time.time() + timeout_s
    previous = elapsed_seconds(cdp)
    while time.time() < deadline:
        time.sleep(3)
        current = elapsed_seconds(cdp)
        if current is not None and previous is not None and current > previous and started_streams(serial) > 0:
            return True
        previous = current
    return False


def wait_for_position(cdp: Cdp, target_seconds: float, timeout_s: float) -> bool:
    """Wait until the playhead is past `target_seconds`, so a tap seeks backwards."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if (elapsed_seconds(cdp) or 0) >= target_seconds:
            return True
        time.sleep(2)
    return False


def measure_seek(
    cdp: Cdp,
    serial: str,
    label: str,
    outdir: Path,
    capture_seconds: float,
    lead_seconds: float,
    seek_back: float,
) -> dict:
    """Record, seek backwards mid-recording, and report the silence that followed."""
    wav_path = outdir / f"seek-{label}.wav"
    # Refuse to measure what cannot be heard. A run whose phone is inaudible
    # still produces a confident-looking gap — it "measured" 15.96 s from a
    # capture that was room tone end to end. The gate is the same one the
    # report applies afterwards, just applied before the effort is spent.
    # Retried, because a single 2 s sample can land in the silence between two
    # tracks and condemn a perfectly healthy rig.
    audible_db = -99.0
    for _ in range(4):
        audible_db = mic_music_over_floor(outdir / f"preflight-{label}.wav")
        if audible_db >= SOUND_OVER_FLOOR_DB:
            break
        time.sleep(2)
    if audible_db < SOUND_OVER_FLOOR_DB:
        raise SystemExit(
            f"seek_latency_hil: the mic hears the phone at only {audible_db:.1f} dB over the room floor "
            f"({ROOM_FLOOR_DBFS} dBFS) before the {label} seek — check media volume (16/25), the app's "
            "own Playback volume, Mute, and that the tune is actually playing"
        )
    recorder = subprocess.Popen(
        [
            "arecord", "-D", "plughw:2,0", "-f", "S16_LE", "-r", "16000", "-c", "1",
            "-d", str(int(capture_seconds)), str(wav_path),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    # Where the tap lands inside the recording, measured rather than assumed:
    # `arecord` opens the device some way after Popen returns, so counting from
    # Popen would put the tap earlier in the file than it really is and the
    # search would start before the seek. Poll until samples are actually being
    # written, and time from there.
    header_bytes = 44
    recording_started = None
    while recording_started is None:
        if wav_path.exists() and wav_path.stat().st_size > header_bytes:
            recording_started = time.monotonic()
        elif recorder.poll() is not None:
            raise SystemExit("seek_latency_hil: arecord exited before capturing anything")
        else:
            time.sleep(0.02)

    time.sleep(lead_seconds)  # establish the "playing" level before tapping

    streams = started_streams(serial)
    tune_before = current_tune(cdp)
    tap_offset = time.monotonic() - recording_started
    seek = seek_back_seconds(cdp, serial, seek_back)
    recorder.wait(timeout=capture_seconds + 30)
    after_position = elapsed_seconds(cdp)
    tune_after = current_tune(cdp)

    envelope, frame_seconds = dbfs_envelope(wav_path)
    gap = first_gap_after(envelope, frame_seconds, tap_seconds=tap_offset)
    silence_started = gap["start_seconds"]
    return {
        "label": label,
        "seek_dispatched": bool(seek.get("ok")),
        "seek_error": seek.get("reason"),
        # What the listener experiences, and the number to compare against the
        # 9.96 s measured before the pre-render existed: tap → music back.
        "tap_to_sound_seconds": (
            0.0 if silence_started is None else round(silence_started + gap["seconds"] - tap_offset, 2)
        ),
        # How long the speaker was actually silent. Playback runs on out of the
        # already-scheduled buffer for a moment after the tap, so the silence
        # starts a little after it.
        "silence_seconds": round(gap["seconds"], 2),
        "silence_started_after_tap_seconds": (
            None if silence_started is None else round(silence_started - tap_offset, 2)
        ),
        "position_before": seek.get("from"),
        "seek_target": seek.get("target"),
        "tune_duration": seek.get("duration"),
        "position_after": after_position,
        # A track that changed mid-capture makes the reading meaningless: the
        # silence found may be the gap between tunes, not the seek.
        "tune_changed_during_capture": tune_before != tune_after,
        "tune": tune_before,
        "phone_audio_streams_at_tap": streams,
        "capture": str(wav_path),
        "floor_dbfs": gap["floor_dbfs"],
        "peak_dbfs": gap["peak_dbfs"],
        "music_over_floor_db": round(gap["peak_dbfs"] - gap["floor_dbfs"], 1),
        "tap_offset_in_capture_seconds": round(tap_offset, 2),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--serial", required=True, help="adb serial of the Pixel")
    parser.add_argument("--station", default="style", choices=("song", "style", "taste"))
    parser.add_argument("--style", default="fast_paced")
    parser.add_argument(
        "--seek-back-seconds", type=float, default=20.0, help="how far BACK the seek goes"
    )
    parser.add_argument("--capture-seconds", type=float, default=20.0)
    parser.add_argument("--lead-seconds", type=float, default=4.0, help="recorded before the tap")
    parser.add_argument(
        "--prerender-seconds",
        type=float,
        default=90.0,
        help="wait between the cold and warm seeks, for the background render to finish",
    )
    parser.add_argument(
        "--min-position-seconds",
        type=float,
        default=75.0,
        help="wait until the playhead passes this before tapping, so the seek is BACKWARD",
    )
    parser.add_argument("--outdir", default="artifacts/seek-latency")
    args = parser.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    # A screen that sleeps mid-run stops playback and turns a measurement into
    # 20 s of room tone, which is exactly how the first run "measured" a 16 s gap.
    adb(args.serial, "shell", "input", "keyevent", "224")  # WAKEUP
    adb(args.serial, "shell", "svc", "power", "stayon", "usb")

    forward_devtools(args.serial)
    cdp = Cdp()
    try:
        enable_flags(cdp, engine="local")
        start_station(cdp, args.station, args.style)

        # Playback has to be genuinely running, or both readings measure silence.
        #
        # Waiting, never poking. `playlist-play` is a TOGGLE that reads "Stop"
        # once a station is running, so the usual "press play if the clock has not
        # moved" fallback stops the very playback it is waiting for — and the
        # local engine takes ~6-9 s to open and render its first chunk, which is
        # exactly the window that fallback fires in.
        if not wait_for_playback(cdp, args.serial, timeout_s=60.0):
            raise SystemExit(
                "seek_latency_hil: playback never advanced within 60 s; there is nothing to seek in"
            )
        # The stream check gets a window rather than one shot: the app's clock
        # starts before AAudio has opened an output, and between tracks the count
        # dips through zero. One immediate sample called a healthy local playback
        # "on the C64".
        deadline = time.time() + 30
        while time.time() < deadline and started_streams(args.serial) <= 0:
            time.sleep(2)
        if started_streams(args.serial) <= 0:
            raise SystemExit(
                "seek_latency_hil: the app's clock advances but the phone reports no audio stream "
                f"after 30 s (route={cdp.evaluate('localStorage.getItem(\"c64u_playback_engine\")')}) — "
                "playback is not on this phone; check Listen on = This device"
            )

        # BACKWARD is the case that matters: libsidplayfp cannot rewind, so going
        # back is what used to cost seconds of silence. Seeking while the clock is
        # still near zero lands AHEAD of the playhead and measures the wrong
        # thing — an early run tapped 15% at 0:07 and quietly reported a forward
        # seek. So let the tune run past the target first.
        if not wait_for_position(cdp, args.min_position_seconds, timeout_s=180.0):
            raise SystemExit(
                f"seek_latency_hil: playback never reached {args.min_position_seconds}s, "
                "so a tap at the target would be a FORWARD seek and would measure nothing"
            )

        # EARLY: taken soon after a tune began, so the pre-render is likely mid-flight.
        early = measure_seek(
            cdp, args.serial, "early", outdir, args.capture_seconds, args.lead_seconds, args.seek_back_seconds
        )

        # Give the background pre-render time to finish, then take the second
        # reading.
        time.sleep(args.prerender_seconds)
        if not wait_for_position(cdp, args.min_position_seconds, timeout_s=180.0):
            raise SystemExit("seek_latency_hil: the late seek could not be taken backward; refusing to report it")
        late = measure_seek(
            cdp, args.serial, "late", outdir, args.capture_seconds, args.lead_seconds, args.seek_back_seconds
        )

        report = {"early": early, "late": late}
        for reading in (early, late):
            if reading["tune_changed_during_capture"]:
                report.setdefault("warnings", []).append(
                    f"{reading['label']}: the track changed mid-capture — the gap may be the track change"
                )
            if reading["seek_error"]:
                report.setdefault("warnings", []).append(f"{reading['label']}: {reading['seek_error']}")
            if reading["music_over_floor_db"] < 4.0:
                report.setdefault("warnings", []).append(
                    f"{reading['label']}: peak only {reading['music_over_floor_db']} dB over the floor — "
                    "the mic heard no music, so the gap is not a measurement"
                )
        print(json.dumps(report, indent=2))
        (outdir / "seek-latency.json").write_text(json.dumps(report, indent=2))

        # Leave the phone silent, as every audible test here must.
        click_testid(cdp, "sid-radio-stop", timeout_s=3.0)
        click_testid(cdp, "playlist-stop", timeout_s=3.0)
        return 0
    finally:
        cdp.close()


if __name__ == "__main__":
    raise SystemExit(main())
