# PR: feat/prod-hardening-6 — Live Device Safety Hardening

## Summary

Five targeted safety fixes that prevent C64 Commander from issuing excessive, stale, premature, or device-crashing device calls against the C64 Ultimate / Ultimate 64, validated against a live `c64u` device (firmware 1.1.0) on a Pixel 4 over 14 scenarios with all scenarios passing (fixed APK run).

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

### PH6-04 — Bare Telnet CRLF crashes c64u REST server

**File:** `src/lib/diagnostics/healthCheckEngine.ts`

A bare `"\r\n"` (CRLF) was sent to Telnet port 23 from the health-check path before the app had proved there was an authenticated prompt flow. The original defect was the unconditional post-auth CRLF when `authenticateTelnetIfNeeded()` returned `{ passwordSent: false }`. A second unsafe branch was that the probe also tried to discover a prompt by reading and then proceeding without requiring an observed `Password:` banner. The c64u firmware interprets bare CRLF before successful Telnet negotiation as a fatal protocol violation, crashing its HTTP/REST server process (exit 56, ECONNRESET on subsequent REST calls).

Fix: the health-check probe now behaves like the normal Telnet session path. If no `Password:` prompt is observed, it returns immediately without sending CRLF. Any remaining CRLF/send-raw steps are still wrapped in `if (authResult.passwordSent) { ... }`. No CRLF is sent unless the probe actually saw `Password:` and sent a password.

**Regression tests:** "does NOT send CRLF when no password configured", "does not send prompt-discovery CRLF when no password prompt is observed", and "sends CRLF only when passwordSent=true" in `tests/unit/lib/diagnostics/healthCheckEngine.test.ts`.

### PH6-05 — FTP health probe opened PASV data channels, exhausting c64u TCP PCB pool

**Files:** `src/lib/diagnostics/healthCheckEngine.ts`, `src/lib/ftp/ftpClient.ts`, `src/lib/native/ftpClient.ts`, `src/lib/native/ftpClient.web.ts`, `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt`

`probeFtp()` in the health check engine called `listFtpDirectory()`, which opens a PASV data channel (2 TCP connections per call). Health checks run every ~10s for all saved devices; TIME_WAIT connections accumulated in c64u's lwIP `MEMP_NUM_TCP_PCB` pool (~16 slots) until all TCP listeners became nonresponsive.

Fix: added `pingFtp()` as a control-channel-only probe (connect → login → NOOP → disconnect, 1 TCP connection, no PASV). Added `FtpClientPlugin.pingFtp()` Kotlin `@PluginMethod`, TypeScript `pingFtp` function routed through `withFtpInteraction`, and web stub. Switched `probeFtp()` to call `pingFtp()` instead of `listFtpDirectory()`.

**Regression tests:** updated `healthCheckEngine.test.ts` to mock `pingFtp` instead of `mockListFtpDirectory`; added `FtpClientPluginTest.kt` Kotlin tests for the new `@PluginMethod`.

## Tests

- `tests/unit/configWriteThrottle.test.ts` — generation cancellation and ConfigWriteCancelledError assertions.
- `tests/unit/hooks/useTelnetActions.test.tsx` — no-mount-Telnet assertion.
- `tests/unit/lib/native/ftpClient.web.test.ts` — max-attempts-1 assertion and pingFtp stub.
- `tests/unit/lib/diagnostics/healthCheckEngine.test.ts` — 69 tests including 2 new PH6-04 regression tests and PH6-05 pingFtp mocks.
- `android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt` — PH6-05 Kotlin pingFtp tests.
- Full suite: 578 test files, 6678 tests, all pass.
- Coverage: 91.65% branch (≥91% threshold met).
- Lint: pass. Build: pass. cap:build: pass.

## Live Validation

Device: Pixel 4 `9B081FFAZ001WX`, package `uk.gleissner.c64commander` 0.7.9-rc1, APK `c64commander-0.7.9-rc1-debug.apk`.
Target: `c64u` firmware 1.1.0, fpga 122, core 1.49.

Two runs executed: first with unfixed APK (identified PH6-04), second with fixed APK (confirmed PH6-04 and PH6-05 fixes).

### Fixed-APK Run (definitive)

| #   | Scenario                                           | PRE REST | POST REST | Result      |
| --- | -------------------------------------------------- | -------- | --------- | ----------- |
| S1  | Cold app launch (c64u selected)                    | 0 ✅     | 0 ✅      | PASS        |
| S2  | Settings page                                      | 0 ✅     | 0 ✅      | PASS        |
| S3  | Diagnostics panel / health cycle (PH6-04 verified) | 0 ✅     | 0 ✅      | **PASS** ✅ |
| S4  | Home page load                                     | 0 ✅     | 0 ✅      | PASS        |
| S5  | Case light brightness slider                       | 0 ✅     | 0 ✅      | PASS        |
| S6  | WASD toggle                                        | 0 ✅     | 0 ✅      | PASS        |
| S7  | Config Audio Mixer slider                          | 0 ✅     | 0 ✅      | PASS        |
| S8  | Play page open                                     | 0 ✅     | 0 ✅      | PASS        |
| S9  | Volume slider + mute/unmute                        | 0 ✅     | 0 ✅      | PASS        |
| S10 | Play C64U source browsing                          | 0 ✅     | 0 ✅      | PASS        |
| S11 | Disks page                                         | 0 ✅     | 0 ✅      | PASS        |
| S12 | Disks C64U source browsing                         | 0 ✅     | 0 ✅      | PASS        |
| S13 | Background / foreground                            | 0 ✅     | 0 ✅      | PASS        |
| S14 | Force-stop + REST probe                            | 0 ✅     | 0 ✅      | PASS        |

**14/14 PASS. c64u firmware remained fully healthy throughout all 14 scenarios.**

## Remaining Risk / Known Issues

- No open P0 or P1 issues.
- **P3:** Turbo Control accidentally changed during first-run S5 live testing (operator gesture offset). Config write was correctly gated; operator can restore via Config page.

## Files Changed

- `src/lib/config/configWriteThrottle.ts`
- `src/lib/deviceInteraction/deviceInteractionManager.ts`
- `src/hooks/useTelnetActions.ts`
- `src/lib/native/ftpClient.ts`
- `src/lib/native/ftpClient.web.ts`
- `src/lib/ftp/ftpClient.ts`
- `src/lib/diagnostics/healthCheckEngine.ts`
- `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt`
- `tests/unit/configWriteThrottle.test.ts`
- `tests/unit/hooks/useTelnetActions.test.tsx`
- `tests/unit/lib/native/ftpClient.web.test.ts`
- `tests/unit/lib/diagnostics/healthCheckEngine.test.ts`
- `android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt`
- `docs/research/stabilization/prod-hardening-6-live-c64u/` (evidence package)
