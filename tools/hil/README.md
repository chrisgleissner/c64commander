# SID Radio HIL harness

`sid_radio_hil.py` is the authoritative Pixel-4 → C64U product proof for SID Radio
(spec §9). It drives the **shipped app** over the WebView CDP socket, starts a station
via real `data-testid` elements, soaks through auto-advances, and asserts the
MEASURED-then-PINNED §9.2 budgets in [`ci/perf/sid-radio-perf-thresholds.json`](../../ci/perf/sid-radio-perf-thresholds.json),
exiting `1` on any regression. Like the Live View device gates, it is **manual/local**
today (no self-hosted runner, spec §9.5); the host-deterministic budget check runs in CI
via [`scripts/assert-sid-radio-perf.mjs`](../../scripts/assert-sid-radio-perf.mjs).

## Prerequisites

- A Pixel 4 (flame) connected over ADB with the SID Radio build installed
  (`./build --skip-tests --install-apk`).
- For the **C64 engine**: a live C64U on the LAN (the app plays SIDs on the Ultimate and
  you hear them via the audio mirror). `--engine local` needs **no C64** (Track B).
- `pip install websocket-client`

## Usage

```bash
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --station song  --soak-tracks 30 --skips 5
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --station style --style fast_paced --soak-tracks 30
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --shuffle-replay        # G11: controls disabled during a station
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --hvsc-update           # G12: continuity while md5PathIndex rebuilds
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --soak-seconds 300      # long unattended wake-lock/refill soak
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --engine local --station song --soak-tracks 20
```

## What it enables and reads

It sets `localStorage` `c64u_sid_radio_enabled` / `c64u_sid_ranking_enabled` and reloads, then
reads the hidden `data-testid="sid-radio-stats"` JSON blob (spec §9.4) each tick — the same
counters shown in the in-app Diagnostics surface. `--shuffle-replay` asserts the transport
Shuffle/Repeat are disabled while a station drives (G11) and, with a pinned `shuffleSeed`,
that the emitted sequence is byte-identical run-to-run.

## Measured-then-pinned

On-device measurements already recorded (M0/M2, see `docs/plans/sid-station/WORKLOG.md`):
cold bundle load + reverse index **≈145 ms** (« 1500 ms), `engineThreadIsMain=false`, hot
memory **5.0 MB**. Continuity (≥30 auto-advances) and skip latency need a live C64U (or the
Local engine). Never auto-rewrite a pinned baseline to hide a regression (spec §9.2).
