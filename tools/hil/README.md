# A/V sync — Hardware-in-the-loop (HIL) test

`av_sync_hil.py` drives the **shipped app on a physically-connected Pixel** and measures the real
phone → C64 Ultimate → phone A/V pipeline over Wi-Fi. It reads the on-screen A/V sync and
tap-latency stats straight out of the running WebView via the Chrome DevTools (CDP) socket, and
drives the UI by clicking real `data-testid` elements (no raw ADB product input).

## What it covers

1. **Automatic A/V sync soak** — runs the bundled `av-sync-auto` program (periodic, frame-aligned
   white-flash + tone), lets it soak, and asserts matched pops accrue. Reports the audio↔video
   offset percentiles.
2. **Interactive space-triggered latency** — loads `av-sync-key`, sends SPACE over Remote Input
   (machine:input) repeatedly, and reports **press→see**, **press→hear** and the pop's **A/V
   offset** P99.

## Run

```bash
pip install websocket-client
python3 tools/hil/av_sync_hil.py --serial <ADB_SERIAL> --soak-seconds 45 --taps 12
```

## Thresholds — ambitious-but-achievable, ASSERTED on hardware

The original spec's `<30 ms` **source→display** target is a physical floor (the C64U's own ~1–2 frame
capture buffer + multicast Wi-Fi + WebView render), so it was reframed to **end-to-end budgets
measured on this hardware and now asserted** — see `ci/perf/stream-perf-thresholds.json` → `endToEnd`.
`av_sync_hil.py` reads those thresholds and **fails (exit 1)** if the pipeline regresses past them:

| Gate (p99)                      | Committed budget | Measured (2026-07-24) |
| ------------------------------- | ---------------- | --------------------- |
| press→see (video input→display) | < 250 ms         | ~96–176 ms            |
| press→hear (audio input→hear)   | < 150 ms         | ~90–144 ms            |
| A/V sync offset                 | < 20 ms          | ~2–5 ms               |
| audio player buffer (native)    | < 100 ms         | ~13–56 ms (watching)  |

press→see/hear are input→display/hear, so they include the machine:input HTTP round trip and the
device's once-per-frame keyboard poll — not a pure render latency. They are **noisy run-to-run**
(±~80 ms; the see metric alone swings 96→176 ms across identical-video-path runs), so they gate gross
regressions, not fine latency — the native-audio win is the separate buffer row. The A/V sync offset
(~2–5 ms) is excellent; it improved from an earlier ~36 ms after the wire-timestamp + governor +
throttle work.

### Native low-latency audio (the audio-latency reduction)

The largest **app-reducible** slice of the audio latency is the **player buffer**. The native
`AudioTrack` (Settings → "Low-latency audio (native)", default on) is fed **directly from the plugin's
`URGENT_AUDIO` receive thread**, never from JS — so there is no per-packet bridge traffic to stall the
JS loop, and the JS-thread video paint can't starve the audio feed, which lets a small buffer hold
glitch-free. The WebAudio player feeds from JS and has no cap: its buffer **balloons under concurrent
video** because its scheduler queues chunks ahead through every JS jank. A/B measured on this rig
**watching** (audio+video — the primary Live View mode), steady state, both stable 50 fps, 0 underruns:

| Audio player buffer | Setting off (WebAudio) | Setting on (native)      |
| ------------------- | ---------------------- | ------------------------ |
| depth (live Stats)  | **179–192 ms**         | **13–56 ms** (~4× lower) |

That buffer is the native audio latency; the HIL reads it from the live Stats
(`stream-stats-audio-buffer`) and gates it (`ci/perf/stream-perf-thresholds.json` →
`audioPlaybackLatency`). It is the **reproducible** native-audio win — press→hear (which measures the
JS analyzer callback, a path the native playback does not use) is too run-to-run-noisy to show it. All
the audio smarts (the A/V-sync analyzer, health stats) stay in TypeScript, fed from the same datagrams;
only the final speaker sink is native. The **full** press→hear round trip keeps a firmware/Wi-Fi floor
(machine:input round trip ~19–33 ms + capture + the once-per-frame keyboard poll) that no app change
can beat, so the factor-2 goal (met ~4× here) is on this app-controlled buffer, not that physical floor.

## Local gate, not shared CI

This HIL needs the physical rig (Pixel 4 on USB + C64U on the LAN), so it runs on the **local build**,
not in shared CI. Run the whole gate — streaming + latency — with:

```bash
npm run test:streams:hil        # or: ./build --install-apk --stream-hil
```

That runs `hil_stream_fixture.py` (fps / CPU / jank / slot accounting) and this `av_sync_hil.py`
(the latency budgets above), with a machine-readable exit (0 pass, 1 product fail, 2 infra). Shared
CI runs only the deterministic host gates (`scripts/ci/stream-gates.mjs`).

## machine:input drives the C64 keyboard matrix (verified)

Remote Input (`POST /v1/machine:input`, `{kind:"keyboard",inputs:["space"],transition:...}`) **does**
drive the CPU-visible CIA keyboard matrix on the C64U — a program that polls `$DC00`/`$DC01`
(like `av-sync-key`) sees it. Verified with `1541ultimate/tools/api/input_tool.py` and directly:
holding SPACE via machine:input clears `$DC01` bit 4 with row 7 selected, and `av-sync-key` sets
its `space_was_down` flag.

Two practical notes the app depends on:

- **Hold, don't tap.** `av-sync-key` polls the matrix once per frame, so a sub-frame `tap` can fall
  between two polls and be missed. `pressSpace` sends **press → hold ~3 frames → release** so the
  poll reliably catches the rising edge. Note the poll is not free: the pop fires when the
  end-of-frame IRQ next observes the key, i.e. up to one frame (~20 ms PAL) after the machine:input
  request arrives — that per-frame poll latency is part of the reported press→pop numbers (holding
  prevents a MISSED poll, it does not remove the poll delay itself).
- **Don't hammer the device while streaming.** Heavy concurrent REST (e.g. bulk `readmem` polling)
  degrades the video stream (observed ~47 → ~23 fps) and drops the 1-frame flashes. Read state
  sparingly during a soak.
