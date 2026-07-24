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
| press→see (video input→display) | < 200 ms         | ~99–168 ms            |
| press→hear (audio input→hear)   | < 100 ms         | ~83–87 ms             |
| A/V sync offset                 | < 15 ms          | ~2–5 ms               |

press→see/hear are input→display/hear, so they include the machine:input HTTP round trip and the
device's once-per-frame keyboard poll — not a pure render latency. The A/V sync offset (~2–5 ms) is
excellent; it improved from an earlier ~36 ms after the wire-timestamp + governor + throttle work.

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
