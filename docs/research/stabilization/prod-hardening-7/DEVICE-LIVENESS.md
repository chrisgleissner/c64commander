# Device Liveness Chronology

| Time | Target | Method | Result | Evidence |
| --- | --- | --- | --- | --- |
| 2026-06-05T23:21:08+01:00 | Pixel 4 | adb devices -l, getprop, dumpsys | pass | docs/research/stabilization/prod-hardening-7/artifacts/logs/baseline-android-20260605T232108.txt |
| 2026-06-05T23:21:08+01:00 | Ultimate 64 | curl http://u64/v1/info | HTTP 200 | docs/research/stabilization/prod-hardening-7/artifacts/logs/baseline-liveness-20260605T232108.txt |
| 2026-06-05T23:21:08+01:00 | Ultimate 64 IP | curl http://192.168.1.13/v1/info | HTTP 200 | docs/research/stabilization/prod-hardening-7/artifacts/logs/baseline-liveness-20260605T232108.txt |
| 2026-06-05T23:21:08+01:00 | Commodore 64 Ultimate | curl http://c64u/v1/info | HTTP 200 | docs/research/stabilization/prod-hardening-7/artifacts/logs/baseline-liveness-20260605T232108.txt |
| 2026-06-05T23:21:08+01:00 | Commodore 64 Ultimate IP | curl http://192.168.1.167/v1/info | HTTP 200 | docs/research/stabilization/prod-hardening-7/artifacts/logs/baseline-liveness-20260605T232108.txt |
| 2026-06-05T23:34:55+01:00 | Ultimate 64 | c64scope preflight | READY | docs/research/stabilization/prod-hardening-7/artifacts/logs/c64scope-preflight-u64-20260605T233442.txt |
| 2026-06-05T23:35:20+01:00 | Commodore 64 Ultimate | c64scope preflight | READY | docs/research/stabilization/prod-hardening-7/artifacts/logs/c64scope-preflight-c64u-20260605T233508.txt |
| 2026-06-05T23:36:58+01:00 | Pixel 4/App | adb am start + window focus | pass | docs/research/stabilization/prod-hardening-7/artifacts/logs/final-liveness-20260605T233655.txt |
| 2026-06-05T23:36:58+01:00 | Ultimate 64 | curl http://u64/v1/info | HTTP 200 | docs/research/stabilization/prod-hardening-7/artifacts/logs/final-liveness-20260605T233655.txt |
| 2026-06-05T23:36:59+01:00 | Commodore 64 Ultimate | curl http://c64u/v1/info | HTTP 200 | docs/research/stabilization/prod-hardening-7/artifacts/logs/final-liveness-20260605T233655.txt |
