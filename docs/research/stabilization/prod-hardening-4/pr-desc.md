# Summary

- Harden FTP operations with lower connect timeout, one transient retry, circuit-aware retry suppression, and per-host connect pacing.
- Coalesce rapid manual Next/Previous skips so only the net target launches while preserving auto-advance behavior.
- Register the Android background auto-skip listener once and read current playback state through refs.

# Validation

- `npm run test`
- `npm run lint`
- `npm run build`
- `npm run test:coverage` (91.66% branch coverage)
- Local changed-line coverage: 357/357 executable TS/TSX patch lines covered
- `cd android && ./gradlew :app:testDebugUnitTest --tests uk.gleissner.c64commander.FtpClientPluginTest`
- `npm run cap:build && npm run android:apk`

# Hardware

- Installed and launched `android/app/build/outputs/apk/debug/c64commander-0.8.5-rc2-debug.apk` on Pixel 4 `9B081FFAZ001WX`.
- Validated against `u64` (`Ultimate 64 Elite`, firmware `3.14e`, `192.168.1.13`).
- Verified FTP browse, rapid Next coalescing, background auto-skip, volume commit stability, and auto-advance exactly-once behavior.
- `c64u` cross-device validation was blocked by `curl: (56) Recv failure: Connection reset by peer`.
