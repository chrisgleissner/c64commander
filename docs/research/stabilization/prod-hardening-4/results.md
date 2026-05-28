# Production Hardening 4 - Results

## Summary

Implemented the final hardening pass for FTP transient resilience, rapid manual skip coalescing, and stable background auto-skip listener registration.

## Changes

- FTP connect timeout now defaults to 1500 ms while transfer/read timeouts remain generous.
- FTP list/read/write operations now pass the explicit connect timeout to native code.
- `withFtpInteraction` now applies one bounded retry for transient FTP connect/connection failures, respects the circuit breaker, and preserves truthful single final error reporting.
- FTP connects are paced per host, including retry and read operations.
- Rapid user Next/Previous now update the visible target immediately but debounce the device launch so only the net target is played.
- Auto-advance remains separate and non-coalesced.
- `backgroundAutoSkipDue` listener registration now uses stable refs for current state/callbacks and avoids volatile re-subscription churn.

## Validation

- `npm run test` passed: 574 test files, 6664 tests.
- `npm run lint` passed.
- `npm run build` passed.
- `npm run test:coverage` passed:
  - Statements: 94.61%
  - Branches: 91.66%
  - Functions: 90.24%
  - Lines: 94.61%
- Local changed-line coverage check over executable TS/TSX patch lines passed: 357/357 = 100.00%.
- Android FTP plugin regression passed:
  - `cd android && ./gradlew :app:testDebugUnitTest --tests uk.gleissner.c64commander.FtpClientPluginTest`
  - 31 tests completed.
- Android APK build passed:
  - `npm run cap:build && npm run android:apk`

## Hardware validation

- Pixel 4 serial: `9B081FFAZ001WX`.
- APK installed: `android/app/build/outputs/apk/debug/c64commander-0.8.5-rc2-debug.apk`.
- Live target: `u64` / `Ultimate 64 Elite` / firmware `3.14e` / host `192.168.1.13` / unique id `38C1BA`.
- `c64u` blocker: `http://c64u/v1/info` failed with `curl: (56) Recv failure: Connection reset by peer`.

Results on `u64`:

- FTP browse: Root -> `USB2` -> `_Test`, cache-cleared first, then two refreshes. Final path `/USB2/_Test/`; listing contained `anykey-c64.prg`; no app errors or WebView exceptions.
- Rapid Next: four rapid Next taps on the mixed playlist produced one final runner call and no intermediate PRG/disk/mount/reboot requests for skipped items.
- Background auto-skip: native watchdog fired and playback advanced once per due guard without errors.
- Stable behavior spot checks: rapid volume changes produced one bounded commit and no errors; auto-advance stayed exactly-once. Cross-device disk-origin validation was blocked by the unavailable `c64u` host.

## Remaining risks

- Cross-device disk-origin playback could not be revalidated in this run because `c64u` reset `/v1/info` connections. No app-side blocker was observed against `u64`.
- The live FTP browse run did not encounter a real transient FTP stall; deterministic unit tests cover the single-retry recovery and persistent-failure behavior.
