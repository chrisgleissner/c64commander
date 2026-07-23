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

## Thresholds — why hardware is not asserted to <30ms

The `<30ms` press→pop latency and `<20ms` A/V offset targets are **perfect-network** figures. They
are asserted deterministically by the every-build mocked-C64 E2E
(`tests/unit/hooks/useAvSyncInteractive.test.tsx`). On real Wi-Fi the end-to-end path adds tens of
ms that no client can remove: the machine:input HTTP round trip, the device's once-per-frame
keyboard poll, the C64U's video-capture buffering (~1–2 frames), frame reassembly and render. So
the HIL **proves the pipeline works end to end and prints the real numbers** rather than asserting
the perfect-network thresholds.

### Representative results (Pixel 4 → C64U fw 1.2.0, PAL, Wi-Fi)

| Metric | Value |
| --- | --- |
| Auto soak — matched pops | 10–23 over 45 s |
| Auto soak — offset (signed P99) | within ±30 ms (video wire-lags audio ~36 ms; consistent) |
| Interactive — press→see P99 | ~200 ms |
| Interactive — press→hear P99 | ~110 ms |
| Interactive — A/V offset P99 | ~54 ms |

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
