<!--
C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
Copyright (C) 2026 Christian Gleissner
Licensed under the GNU General Public License v3.0 or later.
-->

# Live View input latency — HIL findings & tuning

Real-hardware measurement of the joystick lag reported in game mode ("the mouse in Maniac Mansion
reacted much later and was not responsive to quick thumb changes"). Rig: Pixel (adb) → C64 Ultimate
over Wi-Fi, driven by [`input_latency_hil.py`](./input_latency_hil.py) reading the app's own
press→dispatch ring buffer (`window.__c64uRemoteInputLatency`).

## What we measured

`input_latency_hil.py` drives a burst of discrete joystick flicks on the analog stick, spaced wide
enough for the serialized input lane to drain between them, so each sample is ONE input's
gesture→dispatch latency — the app-side delay before a move hits the wire — not a saturation backlog.

## Result — joystick coalesce window (the dominant floor)

The press→dispatch p50 tracked the joystick coalesce window exactly, confirming the window WAS the
floor on the input the user is most sensitive to:

| Joystick coalesce window        | press→dispatch p50 |       mean |        p95 |
| ------------------------------- | -----------------: | ---------: | ---------: |
| 40 ms (before)                  |             ~41 ms |    ~128 ms |    ~238 ms |
| **16 ms (after, ~1 PAL frame)** |       **~17.6 ms** | **~19 ms** | **~26 ms** |

≈ 57% off the p50 floor, ≈ 85% off the mean. The C64 polls the joystick matrix once per raster frame
(~20 ms PAL / ~16.7 ms NTSC), so 40 ms was two frames of pure latency; a diagonal's two axis changes
still land within one frame (coalesced into one packet) and the serialized lane still caps the wire
rate, so this only shaves the floor on a sudden move.

## Result — input priority (video shed under active input)

With Input Priority on (default), a joystick burst sheds the video mirror from ~25 fps (the saved
"50%" frame-rate cap on this rig) down to ~5 fps FOR THE DURATION OF THE INPUT, then it ramps back —
the JS thread + native encoder are handed to input while the user is actively driving (spec priority:
joystick > keyboard > audio > video). At this modest 25 fps base the dispatch p50 is already
frame-bound (~17 ms) so the A/B on p50 is within noise; the shed matters most when the stream is at
full 50 fps and the JS thread would otherwise stall (visible in the p95/max tail, ON < OFF here).

## Priority order when trading off (per the brief)

joystick → keyboard → audio → video. The window fix serves joystick+keyboard directly; input priority
protects both by shedding video (never audio) first; native low-latency audio + the governor keep
audio artifact-free and video high-fps when input is idle.

## Reproduce

```
python3 tools/hil/input_latency_hil.py --serial <ADB_SERIAL> --taps 15 --report /tmp/report.json
```
