#!/usr/bin/env python3
"""Compare the SAME tune rendered locally against the C64's audio streamed here.

WHY BOTH

"The stream sounds rough" is not measurable on its own — a SID tune can be
abrasive by design, a phone speaker colours everything, and the room adds its
own noise. What IS measurable is the *difference* between two paths carrying the
same music to the same speaker in the same room, minutes apart:

  LOCAL   the phone renders the SID itself (libsidplayfp on-device)
  STREAM  the C64 plays it and the app receives its audio over UDP

Both are scored against a `sidplayfp` render of the same file, so the reference
is identical and only the transport differs. A stream that loses or mistimes
packets scores materially below the local render and shows dropouts in its
envelope; a stream that is merely *different in timbre* does not.

It also reads the app's own stream telemetry (underruns, dropped packets,
concealed samples), because those name the mechanism when the score says
something is wrong.

USAGE
    python3 tools/hil/stream_vs_local_audio.py --serial 9B081FFAZ001WX \\
        --sid /path/to/Tune.sid --device-path /Usb0/Music/Tune.sid
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sid_radio_hil import Cdp, adb, click_testid, enable_flags, forward_devtools  # noqa: E402
from audio_overlap_hil import app_audio_streams, elapsed_seconds  # noqa: E402
import sid_audio_match  # noqa: E402

CAPTURE_SECONDS = 15


def capture(path: str, seconds: int = CAPTURE_SECONDS) -> str:
    subprocess.run(
        ["arecord", "-D", "plughw:2,0", "-f", "S16_LE", "-r", "44100", "-c", "1", "-d", str(seconds), path],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return path


def envelope_dbfs(path: str, frame_ms: float = 20.0):
    with wave.open(path, "rb") as handle:
        rate = handle.getframerate()
        samples = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16).astype(np.float64) / 32768.0
    step = max(1, int(rate * frame_ms / 1000.0))
    usable = (samples.size // step) * step
    frames = samples[:usable].reshape(-1, step)
    return 20.0 * np.log10(np.maximum(np.sqrt((frames**2).mean(axis=1)), 1e-9)), frame_ms / 1000.0


def dropout_report(path: str) -> dict:
    """Short silences inside continuous music — the audible shape of packet loss.

    A dropout is not the same as a quiet passage: it is a floor-level gap that
    starts and ends abruptly while the surrounding audio is loud. Counting gaps
    of 20-400 ms finds exactly the stutter a listener calls "patchy".
    """
    env, frame_s = envelope_dbfs(path)
    floor = float(np.percentile(env, 5))
    loud = float(np.percentile(env, 75))
    threshold = floor + 4.0
    if loud - floor < 6.0:
        return {"usable": False, "reason": "capture has no dynamic range (silence or noise only)"}
    quiet = env <= threshold
    gaps, run = [], 0
    for q in quiet:
        if q:
            run += 1
        else:
            if run:
                gaps.append(run * frame_s)
            run = 0
    if run:
        gaps.append(run * frame_s)
    short = [g for g in gaps if 0.02 <= g <= 0.4]
    return {
        "usable": True,
        "dropouts": len(short),
        "dropoutSecondsTotal": round(sum(short), 3),
        "longestDropoutSeconds": round(max(short), 3) if short else 0.0,
        "floorDbfs": round(floor, 1),
        "loudDbfs": round(loud, 1),
    }


def read_stream_stats(cdp: Cdp) -> dict:
    """The app's own view: underruns, dropped packets, concealment."""
    raw = cdp.evaluate(
        "(() => { const w = window;"
        " const s = w.__c64uAvStats || null;"
        " return s ? JSON.stringify(s) : null; })()"
    )
    if raw:
        try:
            return json.loads(raw)
        except ValueError:
            pass
    return {}


def score(capture_path: str, sid_path: str) -> dict:
    return sid_audio_match.match_any_subsong(capture_path, sid_path, reference_seconds=120)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--sid", required=True, help="host path to the .sid, for the sidplayfp reference")
    parser.add_argument("--outdir", default="artifacts/stream-vs-local")
    args = parser.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    adb(args.serial, "shell", "input", "keyevent", "224")
    adb(args.serial, "shell", "svc", "power", "stayon", "usb")
    forward_devtools(args.serial)
    cdp = Cdp()
    report: dict = {"sid": args.sid}
    try:
        # ── LOCAL ────────────────────────────────────────────────
        print("LOCAL: rendering the tune on the phone")
        enable_flags(cdp, engine="local")
        click_testid(cdp, "tab-play", timeout_s=10)
        time.sleep(2)
        click_testid(cdp, "sid-radio-launcher", timeout_s=8)
        time.sleep(2)
        click_testid(cdp, "sid-radio-style-0", timeout_s=8)
        for _ in range(12):
            time.sleep(3)
            if app_audio_streams(args.serial) > 0 and (elapsed_seconds(cdp) or 0) > 3:
                break
        local_tune = cdp.evaluate("(() => { const m = document.body.innerText.match(/[\\w\\-\\.]+\\.sid/); return m ? m[0] : null; })()")
        local_wav = capture(str(outdir / "local.wav"))
        report["local"] = {
            "tune": local_tune,
            "streams": app_audio_streams(args.serial),
            "dropouts": dropout_report(local_wav),
        }
        print(f"  tune={local_tune} dropouts={report['local']['dropouts']}")

        # ── STREAM ───────────────────────────────────────────────
        print("STREAM: same station on the C64, heard here over the mirror")
        enable_flags(cdp, engine="c64")
        click_testid(cdp, "tab-play", timeout_s=10)
        time.sleep(2)
        click_testid(cdp, "sid-radio-launcher", timeout_s=8)
        time.sleep(2)
        click_testid(cdp, "sid-radio-style-0", timeout_s=8)
        time.sleep(10)
        # Route the C64's audio here.
        click_testid(cdp, "playback-listen-both", timeout_s=8)
        time.sleep(10)
        stream_tune = cdp.evaluate("(() => { const m = document.body.innerText.match(/[\\w\\-\\.]+\\.sid/); return m ? m[0] : null; })()")
        stream_wav = capture(str(outdir / "stream.wav"))
        report["stream"] = {
            "tune": stream_tune,
            "streams": app_audio_streams(args.serial),
            "dropouts": dropout_report(stream_wav),
            "appStats": read_stream_stats(cdp),
        }
        print(f"  tune={stream_tune} dropouts={report['stream']['dropouts']}")

        # ── SCORE BOTH AGAINST THE SAME REFERENCE ────────────────
        if Path(args.sid).exists():
            report["local"]["match"] = score(str(outdir / "local.wav"), args.sid)
            report["stream"]["match"] = score(str(outdir / "stream.wav"), args.sid)

        print(json.dumps(report, indent=2))
        (outdir / "stream-vs-local.json").write_text(json.dumps(report, indent=2))
        return 0
    finally:
        try:
            click_testid(cdp, "sid-radio-stop", timeout_s=3)
        except Exception:
            pass
        cdp.close()


if __name__ == "__main__":
    raise SystemExit(main())
