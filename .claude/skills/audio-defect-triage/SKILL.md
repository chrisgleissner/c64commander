---
name: audio-defect-triage
description: >-
  Work out where an audio defect actually comes from — the Ultimate, the network, the app's
  pipeline, the local SID engine, or the loudspeaker and room — before changing any code.
  Use whenever crackling, dropouts, stuttering, wrong pitch or silent gaps are reported on
  Live View or on-device playback. Encodes a ladder of measurements that each rule a layer
  in or out, and the analyser traps that produce confident wrong answers.
---

# Triage an audio defect

Work down the ladder. Each rung rules a layer in or out, and each is cheap. Do not change
code until a rung has actually implicated something — several "obvious" causes on this rig
turned out to be measurement artifacts.

## 0. Which source is even playing?

The single most wasted hour on this rig was grading the *mirror* while believing it was the
local engine. Establish it first:

```bash
adb shell dumpsys audio | grep -c "state:started"          # how many players
./campaign/js.sh '(async()=>{const P=window.Capacitor?.Plugins?.StreamUdp;
  const s=await P.readAudioStats(); return JSON.stringify({mirrorBuffered:s.bufferedMs});})()'
./campaign/js.sh '(()=>localStorage.getItem("c64u_playback_engine"))()'
```

`mirrorBuffered > 0` means the mirror is feeding the speaker. A tune "on local" while the
mirror is still buffered means the switch did not take — the C64 is still playing and you
are hearing it.

## 1. Is the stream itself clean? (rules out the Ultimate)

Join the multicast group from the wired host — this measures what the device *sends*,
independent of the phone:

```bash
python3 tools/hil/av_stream_flow.py --seconds 20 --iface <host-ip>          # audio
python3 tools/hil/av_stream_flow.py --video --seconds 10 --iface <host-ip>  # video
```

Healthy audio: one packet every **4.00 ms**, p99 ≈ 4.14, max < 5, zero sequence loss, no
clumping. If this is clean, nothing downstream may be blamed on the Ultimate.

## 2. Is the phone's kernel dropping? (rules out the receive thread)

```bash
adb shell 'cat /proc/net/udp6 | grep -iE ":2AF9|:2AF8"'   # audio :2AF9, video :2AF8
```

Last column is `drops`. Zero means the receive thread is keeping up. `rx_queue` near zero
at the same time means it is draining promptly.

## 3. What do the app's own counters say?

```bash
./campaign/js.sh '(async()=>{const P=window.Capacitor?.Plugins?.StreamUdp;
  return JSON.stringify(await P.readAudioStats());})()'
```

Read them as a pair, because they are opposite faults:

- **`underruns` climbing** — the track ran dry. Something upstream stalled.
- **`droppedBytes` climbing** — audio arrived faster than it could be played, or was trimmed.
- **Both climbing** — a bursty feed against a buffer with no room in either direction.
- **`concealedMs` climbing with `arrival.lostPackets`** — real network loss being papered
  over. Not the app's fault; see §5.
- **`arrival.maxGapMs` ≫ 4 ms with a large `maxClump`** — the packets are arriving in
  bursts. Compare against §1: if the wire was even, the burstiness is the Wi-Fi hop.

## 4. Is it the app, or the speaker and room?

Capture what the app hands the speaker — no microphone, no acoustics:

```bash
./docs/agentic/hil-rc4/campaign/capture-pipeline.sh 40 /tmp/pipe.wav
python3 tools/hil/audio_e2e_probe.py analyse /tmp/pipe.wav
```

Run the microphone capture over the same window and compare. A defect present in the mic
recording but **absent from the pipeline capture at the same instant** is the loudspeaker,
the room or the microphone — not the app.

## 5. The video/audio airtime conflict

Live View video and audio are two multicast streams sharing the air, and Wi-Fi multicast is
sent once at the basic rate with no retry. Measured here: **video on → 2.9% of audio packets
lost; video off → 0.0%.** A/B it before blaming the app:

```bash
# toggle av-video-toggle, then compare arrival.lostPackets over equal windows
```

There is **no app lever** for this. `streams/video:start` takes no rate parameter, and
`setKeepFraction` decimates on the phone — it saves CPU, not airtime. Do not "fix" it via
the stream governor; that would be a placebo. The remedy is environmental (AP
multicast-to-unicast, or a higher multicast rate).

## Analyser traps that give confident wrong answers

Every one of these produced a wrong conclusion here before being caught:

- **Counting envelope dips against a median reports ~10–13% "dropouts" on a silent room.**
  Any signal, noise included, dips below its own median that often. Use a narrowband measure
  against a known frequency, or a ratio against an adjacent tone-free band.
- **A 5 ms analysis window cannot resolve tones 80 Hz apart.** Identify with ~25 ms windows,
  then measure level at the *identified* frequency with short ones.
- **Grading to a coarse segmentation's end includes the silence after a note** — 13%
  "dropouts" on audio that was flat to within 5%. Refine both edges.
- **Check for clipping (peak 32767) before believing any acoustic number.** A clipping mic
  inflates dropouts and pitch wobble.
- **`renderMsPerSec` and the SID Radio stats blob go stale.** They stop updating; two
  identical readings 40 s apart mean the blob is frozen, not that nothing changed.
- **110 Hz is below what a phone speaker reproduces.** Probe between ~500 Hz and 1.5 kHz.
