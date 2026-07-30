#!/usr/bin/env python3
"""Trace the on-device audio ring, so a dropout is measured rather than inferred.

A microphone cannot do this job at the permitted media volume (AGENTS.md caps the Pixel 4 at 10 of
25, where SID music's quiet passages already reach the room floor). This reads the pipeline instead:
`__localSinkDebug()` reports what the sink has written and what is still queued ahead of the speaker,
so the ring depth is directly observable, at any volume, with exact timing.

The ring is the whole safety margin. `localSidNativeSink` targets 15 s of audio queued ahead of the
speaker precisely so a busy JS thread cannot starve it; when that depth collapses to zero the
AudioTrack runs dry and the listener hears a gap. So the questions this answers are: how deep is the
ring actually, when does it collapse, and what else is happening at that moment.

Usage:
  python3 tools/hil/local_audio_ring_trace.py --serial <ADB_SERIAL> --seconds 240 --out trace.json
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import sid_radio_hil as hil

PROBE_JS = """
(() => {
  const debug = globalThis.__localSinkDebug ? globalThis.__localSinkDebug() : null;
  const el = document.querySelector('[data-testid="sid-radio-stats"]');
  const stats = el && el.textContent ? JSON.parse(el.textContent) : null;
  const elapsed = document.querySelector('[data-testid="playback-elapsed"]');
  return JSON.stringify({
    queuedSec: debug ? debug.queuedSec : null,
    writtenSec: debug ? debug.writtenSec : null,
    playhead: debug ? debug.playhead : null,
    pumping: debug ? debug.pumping : null,
    underruns: stats ? stats.audioUnderruns : null,
    advanced: stats ? stats.tracksAutoAdvanced : null,
    lastRefillMs: stats ? stats.lastRefillMs : null,
    emitted: stats ? stats.candidatesEmitted : null,
    elapsed: elapsed ? elapsed.textContent : null,
  });
})()
"""


def trace(cdp: hil.Cdp, seconds: float, interval: float) -> list[dict]:
    samples: list[dict] = []
    started = time.time()
    while time.time() - started < seconds:
        raw = cdp.evaluate(PROBE_JS)
        if raw:
            sample = json.loads(raw)
            sample["t"] = round(time.time() - started, 3)
            samples.append(sample)
        time.sleep(interval)
    return samples


def summarise(samples: list[dict]) -> dict:
    depths = [s["queuedSec"] for s in samples if isinstance(s.get("queuedSec"), (int, float))]
    events = []
    previous = None
    for sample in samples:
        if previous is not None:
            if (sample.get("underruns") or 0) > (previous.get("underruns") or 0):
                events.append(
                    {
                        "kind": "underrun",
                        "t": sample["t"],
                        "count": sample["underruns"] - previous["underruns"],
                        "queuedSecBefore": previous.get("queuedSec"),
                        "elapsed": sample.get("elapsed"),
                        "sinceTrackChange": sample.get("_sinceTrack"),
                    }
                )
            if (sample.get("advanced") or 0) > (previous.get("advanced") or 0):
                events.append({"kind": "track", "t": sample["t"], "elapsed": sample.get("elapsed")})
            if (sample.get("lastRefillMs") or 0) != (previous.get("lastRefillMs") or 0):
                events.append({"kind": "refill", "t": sample["t"], "ms": sample.get("lastRefillMs")})
        previous = sample

    # How long after a track change each underrun happened — the user heard one "about 2 s in".
    track_times = [e["t"] for e in events if e["kind"] == "track"]
    for event in events:
        if event["kind"] != "underrun":
            continue
        earlier = [t for t in track_times if t <= event["t"]]
        event["afterTrackChangeSec"] = round(event["t"] - earlier[-1], 2) if earlier else None

    depths_sorted = sorted(depths)
    n = len(depths_sorted)
    return {
        "samples": len(samples),
        "ringSecMin": round(min(depths), 2) if depths else None,
        "ringSecMedian": round(depths_sorted[n // 2], 2) if n else None,
        "ringSecMax": round(max(depths), 2) if depths else None,
        "ringBelow1sPct": round(100.0 * sum(1 for d in depths if d < 1.0) / n, 1) if n else None,
        "ringAtZeroPct": round(100.0 * sum(1 for d in depths if d <= 0.05) / n, 1) if n else None,
        "underrunsTotal": (samples[-1].get("underruns") or 0) - (samples[0].get("underruns") or 0) if samples else 0,
        "events": events,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Trace the on-device audio ring depth")
    parser.add_argument("--serial", required=True)
    parser.add_argument("--seconds", type=float, default=240.0)
    parser.add_argument("--interval", type=float, default=0.25)
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    hil.forward_devtools(args.serial)
    cdp = hil.Cdp()
    try:
        samples = trace(cdp, args.seconds, args.interval)
    finally:
        cdp.close()

    summary = summarise(samples)
    print(json.dumps({k: v for k, v in summary.items() if k != "events"}, indent=2))
    for event in summary["events"]:
        if event["kind"] == "underrun":
            print(
                f"  UNDERRUN t={event['t']}s (+{event['count']})"
                f" ring was {event['queuedSecBefore']}s"
                f" {event['afterTrackChangeSec']}s after a track change"
                f" elapsed={event['elapsed']}"
            )
    if args.out:
        Path(args.out).write_text(json.dumps({"summary": summary, "samples": samples}, indent=2))
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
