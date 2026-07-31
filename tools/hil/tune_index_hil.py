#!/usr/bin/env python3
"""Prove, from the room, that the app plays the tune it was asked for.

A `.sid` holds several tunes and they are different pieces of music. The app
numbers them from 1; `libsidplayfp-wasm`'s `loadSidBuffer` numbers them from 0.
Nothing converted between the two, so on-device playback rendered the tune after
the one selected and the first tune of a multi-tune file could not be reached at
all. Nothing on screen could show this: the app displays the number it *asked*
for, which was right, while the speaker played something else.

So the oracle has to come from the audio. This records the phone's speaker and
hands the capture to `sid_audio_match.match_any_subsong`, which scores it against
every tune of the file rendered by the native `sidplayfp` binary -- a different
implementation from the one under test -- and reports which tune it heard. The
answer has to be the tune that was requested.

Usage:
  # start the tune in the app first, then:
  tools/hil/tune_index_hil.py --sid /path/to/Wicked.sid --expect-tune 1

Options:
  --seconds N       capture length (default 12; the matcher is calibrated on 12)
  --device DEV      ALSA capture device (default: the SF558 USB mic on this rig)
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sid_audio_match import MATCH_THRESHOLD, match_any_subsong  # noqa: E402

DEFAULT_DEVICE = "plughw:CARD=SF558,DEV=0"


def record(seconds: int, device: str) -> str:
    out = os.path.join(tempfile.mkdtemp(prefix="tune-index-"), "capture.wav")
    subprocess.run(
        ["arecord", "-D", device, "-f", "S16_LE", "-r", "48000", "-c", "1", "-d", str(seconds), out],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sid", required=True, help="the .sid file the app is playing")
    parser.add_argument("--expect-tune", type=int, required=True, help="one-based tune number requested in the app")
    parser.add_argument("--seconds", type=int, default=12)
    parser.add_argument("--device", default=DEFAULT_DEVICE)
    parser.add_argument("--out", default=None, help="where to write the verdict JSON")
    args = parser.parse_args()

    capture = record(args.seconds, args.device)
    result = match_any_subsong(capture, args.sid)

    heard = result.get("songnr")
    # Two separate claims, kept apart on purpose. A capture of silence, or of the
    # wrong file, scores below the threshold and says nothing about numbering; only
    # a capture the matcher actually recognised can answer which tune was playing.
    recognised = bool(result.get("melSim", 0.0) >= MATCH_THRESHOLD)
    correct = recognised and heard == args.expect_tune

    verdict = {
        "sid": os.path.basename(args.sid),
        "requestedTune": args.expect_tune,
        "heardTune": heard,
        "melSim": result.get("melSim"),
        "threshold": MATCH_THRESHOLD,
        "recognised": recognised,
        "playsTheRequestedTune": correct,
        "subsongsScanned": result.get("subsongsScanned"),
        "capture": capture,
    }
    print(json.dumps(verdict, indent=2))
    if args.out:
        with open(args.out, "w") as fh:
            json.dump(verdict, fh, indent=2)

    if not recognised:
        print("FAIL: nothing recognisable was captured -- check the phone is playing and the mic is live", file=sys.stderr)
        return 2
    if not correct:
        print(f"FAIL: asked for tune {args.expect_tune}, heard tune {heard}", file=sys.stderr)
        return 1
    print(f"PASS: heard tune {heard}, which is the one requested")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
