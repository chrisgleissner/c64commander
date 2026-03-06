# Physical Device Validation Matrix (Productionization)

## Scope

This matrix is mandatory evidence for release hardening tasks `R-02`, `R-03`, `R-04`, `R-05`, and `R-06`.

## Preconditions

- Physical Android device connected (`adb devices` shows at least one `device`).
- C64U host reachable as `c64u` on device network.
- Local assets staged via:
  - `bash scripts/startup/stage-local-assets-adb.sh`

## Matrix

| Area                 | Action                                                   | Required artifact                                                |
| -------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| HVSC ingest          | Run HVSC ingest from app and verify completion           | `ci-artifacts/startup/startup-baseline.json` + logcat loop files |
| FTP browse           | Browse FTP folders and read at least one file            | logcat in `ci-artifacts/startup/startup-loop-*.logcat.txt`       |
| RAM save/load        | Execute RAM save and load flow                           | logcat entries for save/load requests                            |
| Local source imports | Validate `.sid/.mod/.crt/.prg/.d64/.d71/.d81` visibility | ADB stage output + on-device count verification                  |
| Startup KPI          | Run 10 cold starts and compute KPI summary               | `npm run startup:baseline` output JSON                           |
| Startup budget gate  | Enforce KPI thresholds                                   | `npm run startup:gate` output                                    |
| HVSC startup safety  | Verify no startup HVSC downloads                         | `npm run startup:gate:hvsc` output                               |

## Commands

1. Regenerate deterministic local-source assets:

```bash
npm run fixtures:local-source
```

2. Stage assets:

```bash
bash scripts/startup/stage-local-assets-adb.sh
```

3. Collect startup baseline (10 loops):

```bash
npm run startup:baseline
```

4. Enforce startup budgets:

```bash
npm run startup:gate
```

5. Enforce HVSC startup safety:

```bash
npm run startup:gate:hvsc
```

## Notes

- iOS physical-device execution cannot be performed on Linux hosts. iOS physical evidence must be collected on macOS and attached from CI or a macOS operator run.
- Do not treat unrelated system logs (NFC/sensors/wifi service chatter) as app regressions; use app-specific request and plugin lines for KPI derivation.
