# Physical Device Validation Matrix (Productionization)

## Scope

This matrix is mandatory evidence for release hardening tasks `R-02`, `R-03`, `R-04`, `R-05`, and `R-06`.

## Preconditions

- Physical Android device connected (`adb devices` shows at least one `device`).
- C64U host reachable as `c64u` on device network.
- Local assets staged via:
  - `bash scripts/startup/stage-local-assets-adb.sh`

## Matrix

- Area: HVSC ingest
  Action: Run HVSC ingest from app and verify completion.
  Required artifact: `ci-artifacts/startup/startup-baseline.json` plus logcat loop files.
- Area: HVSC playback proof
  Action: Run app-first HVSC download or cache-reuse -> browse -> add -> play and verify real streamed audio from the C64U.
  Required artifact: app action timeline, current-track screenshot, selected-track correlation evidence, and `c64scope` audio analysis JSON/packets with `packetCount > 0` and `RMS >= 0.005`.
- Area: FTP browse
  Action: Browse FTP folders and read at least one file.
  Required artifact: logcat in `ci-artifacts/startup/startup-loop-*.logcat.txt`.
- Area: RAM save/load
  Action: Execute RAM save and load flow.
  Required artifact: logcat entries for save/load requests.
- Area: Local source imports
  Action: Validate `.sid/.mod/.crt/.prg/.d64/.d71/.d81` visibility.
  Required artifact: ADB stage output plus on-device count verification.
- Area: Startup KPI
  Action: Run 10 cold starts and compute KPI summary.
  Required artifact: `npm run startup:baseline` output JSON.
- Area: Startup budget gate
  Action: Enforce KPI thresholds.
  Required artifact: `npm run startup:gate` output.
- Area: HVSC startup safety
  Action: Verify no startup HVSC downloads.
  Required artifact: `npm run startup:gate:hvsc` output.

## Commands

1. Regenerate deterministic local-source assets:

```bash
npm run fixtures:local-source
```

1. Stage assets:

```bash
bash scripts/startup/stage-local-assets-adb.sh
```

1. Collect startup baseline (10 loops):

```bash
npm run startup:baseline
```

1. Enforce startup budgets:

```bash
npm run startup:gate
```

1. Enforce HVSC startup safety:

```bash
npm run startup:gate:hvsc
```

## Notes

- iOS physical-device execution cannot be performed on Linux hosts. iOS physical evidence must be collected on macOS and attached from CI or a macOS operator run.
- Do not treat unrelated system logs (NFC/sensors/wifi service chatter) as app regressions; use app-specific request and plugin lines for KPI derivation.
- HVSC ingest-only evidence is insufficient for end-to-end proof. A passing HVSC hardware run must include playlist import, app-initiated playback, and real C64U streamed-audio verification.
