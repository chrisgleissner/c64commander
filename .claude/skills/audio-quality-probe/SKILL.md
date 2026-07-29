---
name: audio-quality-probe
description: >-
  Measure C64 audio quality end to end with a purpose-built stimulus, graded per note for
  length, crackle, timing and pitch. Use to prove an audio change worked, to reproduce a
  reported "it crackles" or "notes sound wrong", or to compare builds. Covers the mirror
  and the on-device engine, from the wire, the app's own output, or a microphone in front
  of the phone.
---

# Grade the audio with the timing barcode

## Why not just play a SID

A tune cannot grade a pipeline. Its amplitude moves constantly so an envelope dip means
nothing, its pitch changes so a resampling error is invisible, and it has no landmarks so
neither a listener nor an analyser can tell a skipped 50 ms from a skipped bar.

`tools/hil/audio_e2e_probe.py` assembles a small 6502 program — also emitted as a PSID, so
anything that renders a SID can be graded — playing a **frequency barcode**: eight
non-harmonically-related tones, 8 PAL frames on / 4 off, sequenced by raster counting so the
timing is the C64's own crystal. Slot = 239.40 ms, tone = 159.6 ms.

That makes four faults separately countable, which is what a listener actually reports:
a note of the wrong **length**, a note that **crackles**, a note that goes briefly
**off-pitch**, and the **order** being wrong (a whole segment lost or replayed).

## Run it

```bash
# 1. Start the stimulus on the machine
python3 tools/hil/audio_e2e_probe.py play --host <c64u>

# 2a. Reference — what the Ultimate sends (must grade perfect)
python3 tools/hil/audio_e2e_probe.py wire --seconds 20 --out /tmp/wire.wav --iface <host-ip>

# 2b. The app's own output — no room, no microphone
./docs/agentic/hil-rc4/campaign/capture-pipeline.sh 40 /tmp/pipe.wav
python3 tools/hil/audio_e2e_probe.py analyse /tmp/pipe.wav

# 2c. Full end to end, through the loudspeaker
python3 tools/hil/audio_e2e_probe.py record --seconds 40 --out /tmp/mic.wav
python3 tools/hil/audio_e2e_probe.py analyse /tmp/mic.wav
```

To grade the **local engine**, build the PSID and get it into the playlist:

```bash
python3 tools/hil/audio_e2e_probe.py build-sid --out /tmp/barcode.sid
python3 -c "import ftplib;f=ftplib.FTP('<c64u>');f.login();f.cwd('/USB2');f.storbinary('STOR barcode.sid',open('/tmp/barcode.sid','rb'))"
```

Then Play → Add items → C64U → USB2 → tick `barcode.sid` → Add to playlist, and set
"Listen on: this device". See the `drive-app-ui` skill for the CDP idioms.

## Reading the output

```
notes wrong      0 of 165          # length, pitch wobble or dropouts — named individually below
DROPOUTS         0.00%             # the tone's own energy collapsing mid-note
timing           jitter 3.0ms      # onset spacing against the C64's crystal
pitch            exact             # speed / resampling correctness
defective notes  none of 165
```

Known-good figures on this rig (Pixel 4 + c64u), 40 s, listening with Live View video off:

| | wire | app output | speaker via mic |
|---|---|---|---|
| notes wrong | 0 of 82 | 0 of 165 | 1 of 166 |
| dropouts | 0.00% | 0.00% | 0.04% |
| jitter | 2.9 ms | 3.0 ms | 3.6 ms |

**Always grade the wire first.** It must come out perfect. If it does not, the analyser or
the stimulus is wrong, not the app — fix that before reading anything into the other two.

## Before believing an acoustic number

- **Check for clipping.** Peak 32767 inflates dropouts and pitch wobble. Reduce the phone's
  volume and re-record.
- **Check the phone is audible at all.** Tone-to-room below ~4× is not gradeable; the
  analyser says so rather than inventing a figure.
- **Skip the first and last burst** — they are truncated by the recording boundary. The tool
  does this; a hand-rolled analysis must too.
- The phone's media volume can be read with
  `adb shell dumpsys audio | sed -n '/- STREAM_MUSIC:/,/Volume Group/p'`. Do not grep the
  first `streamVolume` in the whole dump — that is a different stream.

## Interpreting a defect

- **Notes too short** — audio was lost and the timeline compressed. A gap that is skipped
  rather than filled does not merely omit itself, it pulls everything after it earlier.
- **Notes too long** — concealment covered a loss that straddled the note's end. Expected at
  the rate of the underlying packet loss; not a bug in itself.
- **Pitch wobble within a note** — a resampler changing ratio mid-note, or concealment
  repeating at the wrong period. Above ~10 cents it is audible as the tune wandering.
- **Sequence errors** — a whole segment lost or replayed. Always a real fault.
