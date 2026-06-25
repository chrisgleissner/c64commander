# Cleanup Report — Bug Hunt 2026-06-25 (bughunt-20260625T125855Z)

Artifact root: `c64scope/artifacts/bughunt-20260625T125855Z-pixel4-c64u-cf84d8e565cb/`
Build: `0.8.9-cf84d` (2044, SHA-256 462bfa…). Pixel 4 `9B081FFAZ001WX`. Target `c64u`.

## Final app/device state (verified `final-01-cleanup-home`)

| Item | Baseline (session start) | Final | Restored? |
|------|--------------------------|-------|-----------|
| c64u connection | OFFLINE (c64u HTTP down; user restarted mid-session) | **C64U ● green, c64u, fw 1.1.0** | Improved (connected) |
| Drive A | ON / No disk mounted / OK | ON / No disk mounted / OK | ✓ |
| Drive B | OFF / No disk mounted | OFF / No disk mounted | ✓ |
| Device-side Drive A image_file | "" | "" (readback) | ✓ |
| c64u health | n/a (down) | HTTP 403 in 8 ms | ✓ healthy |
| Theme | system (Auto) | system (Auto) | ✓ unchanged |
| Screen orientation | auto | auto | ✓ unchanged |
| Display profile | compact (pre-existing) | compact | unchanged (not touched by run) |
| Saved devices | c64u (selected), u64 | c64u (selected), u64 | ✓ unchanged |
| HTTP/FTP/Telnet ports | 80 / 21 / 23 | 80 / 21 / 23 | ✓ unchanged |
| Password | pwd | pwd | ✓ unchanged |

## Mutations performed during the run (all reverted/benign)

1. **Reconnected c64u** via app-driven Settings → Save & Connect (host=c64u, ports/pwd unchanged). This restored the intended connected baseline; not a setting change.
2. **5× Drive A readonly mount/eject** (Boulder Dash 2.d64). Ended with Drive A `No disk mounted` (verified app + device readback). Clean.
3. Opened (read-only) Diagnostics sheet, Device Switcher (closed via Back, no device switched), Config sub-page, Docs accordion (transient UI state, resets on nav).

No persistent app-local setting (theme, orientation, display profile, full-screen, ports, password, saved devices, feature flags, hvsc/commoserve URLs) was modified.

## Residual differences vs baseline

- **c64u is now CONNECTED** (was OFFLINE at start only because the device's HTTP stack was down). This is the correct/expected baseline; the user power-cycled c64u mid-session.
- No other residual differences.

## Background capture processes

CDP console/network listener and continuous logcat were stopped after the device work (188 CDP events, 29 logcat snapshots captured). adb tcp:9333 forward may remain; harmless.

## QA tooling added (not product code)

- `scripts/bughunt-capture.sh`, `scripts/bughunt-snap.sh`, `scripts/bughunt-cdp.mjs` — observation/evidence helpers (screenshot/hierarchy/logcat + CDP DOM/console/network). No product code modified.

Cleanup status: **COMPLETE.** App left connected/healthy, drives clean, no settings drift.
