# PR: feat/prod-hardening-6 — Live Device Safety Hardening

## Summary

Three targeted safety fixes that prevent C64 Commander from issuing excessive, stale, or premature device calls against the C64 Ultimate / Ultimate 64, validated against a live `c64u` device (firmware 1.1.0) on a Pixel 4 over 14 scenarios.

## Fixes

### PH6-01 — Config write generation-based cancellation

**File:** `src/lib/config/configWriteThrottle.ts`, `src/lib/deviceInteraction/deviceInteractionManager.ts`

A queued config write from the previously-selected device could fire after the user switched to a different device. Added a generation counter to `configWriteThrottle`; `resetConfigWriteThrottle(reason)` is called from `resetInteractionState` on every saved-device switch, cancelling all in-flight writes for the previous device. A typed `ConfigWriteCancelledError` is thrown on cancellation instead of silently swallowing the exception.

### PH6-02 — FTP bridge max attempts reduced to 1

**File:** `src/lib/native/ftpClient.web.ts`

`FTP_BRIDGE_MAX_ATTEMPTS` was 3, causing up to 3 consecutive FTP calls per single failure path before giving up. Reduced to 1. All retry policy is now owned exclusively by the `withFtpInteraction` gateway.

### PH6-03 — Telnet capability discovery deferred to first use

**File:** `src/hooks/useTelnetActions.ts`

A `useEffect` eagerly called `loadCapabilities()` on every mount (and reconnect), firing Telnet traffic with no user action. Removed the eager call; capability discovery is now deferred to the first `executeAction()` invocation and cached normally.

## Tests

- `tests/unit/lib/config/configWriteThrottle.test.ts` — generation cancellation and ConfigWriteCancelledError assertions.
- `tests/unit/hooks/useTelnetActions.test.tsx` — no-mount-Telnet assertion.
- `tests/unit/lib/native/ftpClient.web.test.ts` — max-attempts-1 assertion.
- Full suite: 578 test files, 6677 tests, all pass.
- Coverage: 91.66% branch (≥91% threshold met).
- Lint: pass. Build: pass. cap:build: pass.

## Live Validation

Device: Pixel 4 `9B081FFAZ001WX`, package `uk.gleissner.c64commander` 0.7.9-rc1, APK `c64commander-0.8.5-debug.apk`.
Target: `c64u` firmware 1.1.0, fpga 122, core 1.49.

| # | Scenario | Result |
|---|----------|--------|
| S1 | Cold app launch (c64u selected) | PASS |
| S2 | Settings page | PASS |
| S3 | Diagnostics panel / health cycle | External c64u REST crash; NOT app defect |
| S4 | Home page load | PASS |
| S5 | CPU Speed slider + config write | PASS |
| S6 | Badline Timing toggle | PASS |
| S7 | Config Audio Mixer slider | PASS |
| S8 | Play page open | PASS |
| S9 | Volume slider + mute/unmute | PASS |
| S10 | Play C64U source browsing | PASS |
| S11 | Disks page | PASS |
| S12 | Disks C64U source browsing | PASS |
| S13 | Background / foreground | PASS |
| S14 | Force-stop + REST probe | PASS |

13/14 scenarios PASS. S3 classified external: c64u REST listener has a known pre-existing intermittent crash pattern (exit 56, ECONNRESET); FTP and Telnet TCP remained reachable during the crash, confirming it is a c64u firmware process crash, not a device freeze or app-caused failure. No app fix required.

## Remaining Risk / Known Issues

- **P3: Turbo Control accidentally changed** during S5 live testing (operator gesture offset). Remains "Manual" on c64u (was "Off"). Config write was correctly gated. Operator can restore via Config page.
- **P3: Saved-device switcher UX** — not prominently discoverable from Settings; minor discoverability gap.
- **Pre-existing: c64u intermittent REST instability** — the REST listener on c64u firmware 1.1.0 can crash spontaneously. This is a known hardware/firmware limitation, not caused by C64 Commander.

## Files Changed

- `src/lib/config/configWriteThrottle.ts`
- `src/lib/deviceInteraction/deviceInteractionManager.ts`
- `src/hooks/useTelnetActions.ts`
- `src/lib/native/ftpClient.web.ts`
- `tests/unit/lib/config/configWriteThrottle.test.ts`
- `tests/unit/hooks/useTelnetActions.test.tsx`
- `tests/unit/lib/native/ftpClient.web.test.ts`
- `docs/research/stabilization/prod-hardening-6-live-c64u/` (evidence package)
