# PR: feat/prod-hardening-6 — Live Device Safety Hardening

## Summary

Four targeted safety fixes that prevent C64 Commander from issuing excessive, stale, premature, or device-crashing device calls against the C64 Ultimate / Ultimate 64, validated against a live `c64u` device (firmware 1.1.0) on a Pixel 4 over 14 scenarios with all scenarios passing (fixed APK run).

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

### PH6-04 — Unconditional CRLF to Telnet port 23 crashes c64u REST server

**File:** `src/lib/diagnostics/healthCheckEngine.ts`

A bare `"\r\n"` (CRLF) was sent to Telnet port 23 unconditionally on every health check cycle, regardless of whether a password was configured. `authenticateTelnetIfNeeded()` returns `{passwordSent: false}` via early return when no password is set — but line 1046 sent CRLF anyway. The c64u firmware interprets bare CRLF before IAC Telnet negotiation as a fatal protocol violation, crashing its HTTP/REST server process (exit 56, ECONNRESET on all subsequent REST calls). This was the root cause of all three observed c64u outages during the first live HIL run.

Fix: lines 1046, 1083, 1111 wrapped in `if (authResult.passwordSent) { ... }`. No CRLF is sent unless the authentication path actually sent a password.

**Regression tests:** "does NOT send CRLF when no password configured" and "sends CRLF only when passwordSent=true" in `tests/unit/lib/diagnostics/healthCheckEngine.test.ts`.

## Tests

- `tests/unit/lib/config/configWriteThrottle.test.ts` — generation cancellation and ConfigWriteCancelledError assertions.
- `tests/unit/hooks/useTelnetActions.test.tsx` — no-mount-Telnet assertion.
- `tests/unit/lib/native/ftpClient.web.test.ts` — max-attempts-1 assertion.
- `tests/unit/lib/diagnostics/healthCheckEngine.test.ts` — 69 tests including 2 new PH6-04 regression tests.
- Full suite: 578 test files, 6678 tests, all pass.
- Coverage: 91.65% branch (≥91% threshold met).
- Lint: pass. Build: pass. cap:build: pass.

## Live Validation

Device: Pixel 4 `9B081FFAZ001WX`, package `uk.gleissner.c64commander` 0.7.9-rc1, APK `c64commander-0.7.9-rc1-debug.apk`.
Target: `c64u` firmware 1.1.0, fpga 122, core 1.49.

Two runs executed: first with unfixed APK (identified PH6-04), second with fixed APK (confirmed fix).

### Fixed-APK Run (definitive)

| # | Scenario | PRE REST | POST REST | Result |
|---|----------|----------|-----------|--------|
| S1 | Cold app launch (c64u selected) | 0 ✅ | 0 ✅ | PASS |
| S2 | Settings page | 0 ✅ | 0 ✅ | PASS |
| S3 | Diagnostics panel / health cycle (PH6-04 verified) | 0 ✅ | 0 ✅ | **PASS** ✅ |
| S4 | Home page load | 0 ✅ | 0 ✅ | PASS |
| S5 | Case light brightness slider | 0 ✅ | 0 ✅ | PASS |
| S6 | WASD toggle | 0 ✅ | 0 ✅ | PASS |
| S7 | Config Audio Mixer slider | 0 ✅ | 0 ✅ | PASS |
| S8 | Play page open | 0 ✅ | 0 ✅ | PASS |
| S9 | Volume slider + mute/unmute | 0 ✅ | 0 ✅ | PASS |
| S10 | Play C64U source browsing | 0 ✅ | 0 ✅ | PASS |
| S11 | Disks page | 0 ✅ | 0 ✅ | PASS |
| S12 | Disks C64U source browsing | 0 ✅ | 0 ✅ | PASS |
| S13 | Background / foreground | 0 ✅ | 0 ✅ | PASS |
| S14 | Force-stop + REST probe | 0 ✅ | 0 ✅ | PASS |

**14/14 PASS. c64u firmware remained fully healthy throughout all 14 scenarios.**

## Remaining Risk / Known Issues

- No open P0 or P1 issues.
- **P3:** Turbo Control accidentally changed during first-run S5 live testing (operator gesture offset). Config write was correctly gated; operator can restore via Config page.

## Files Changed

- `src/lib/config/configWriteThrottle.ts`
- `src/lib/deviceInteraction/deviceInteractionManager.ts`
- `src/hooks/useTelnetActions.ts`
- `src/lib/native/ftpClient.web.ts`
- `src/lib/diagnostics/healthCheckEngine.ts`
- `tests/unit/lib/config/configWriteThrottle.test.ts`
- `tests/unit/hooks/useTelnetActions.test.tsx`
- `tests/unit/lib/native/ftpClient.web.test.ts`
- `tests/unit/lib/diagnostics/healthCheckEngine.test.ts`
- `docs/research/stabilization/prod-hardening-6-live-c64u/` (evidence package)
