# Raw Observations

See WORKLOG.md for the chronological execution log. Key raw observations promoted into final evidence:

- Pixel 4 baseline was authorized and already running C64 Commander before reinstall.
- Both u64 and c64u responded to baseline /v1/info probes.
- Build and install completed successfully through the repository helper.
- Home initially showed Device/Firmware as Not available despite a Healthy badge, then later resolved to c64u firmware 1.1.0.
- adb coordinate scaling caused early route taps to hit Home content; physical coordinates corrected this.
- Diagnostics showed Healthy and a populated action/REST activity feed.
- Settings showed one visible saved c64u device and connection fields for c64u.
- Safety/circuit-breaker related settings were visible near the bottom of Settings.
- Open Source Licenses rendered bundled third-party notices.
- c64scope preflight passed for both u64 and c64u.
- Final liveness passed for Pixel 4, u64, and c64u.
- Logcat error summary found no candidate runtime errors.
