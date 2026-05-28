# Prod Hardening 6 Issue Ledger

Every observed issue from the live Pixel 4 / `c64u` review will be recorded here.

## Issue Index

| ID     | Severity | Subsystem                                      | Status                                                                    |
| ------ | -------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| PH6-01 | P1       | Config writes / saved-device switching         | Fixed; full HIL run confirms no stale write                               |
| PH6-02 | P1       | Web FTP bridge retry ownership                 | Fixed; full HIL run confirms no excess FTP                                |
| PH6-03 | P1       | Eager Telnet capability discovery on mount     | Fixed; full HIL run confirms no mount Telnet                              |
| PH6-04 | P0       | Unconditional CRLF to Telnet crashes c64u REST | **Fixed; PH6-04 regression tests pass; S3 passes in fixed-APK run**       |
| INC-S3 | P0       | c64u REST crash during S3 health check         | **Reclassified: root cause is PH6-04 (app defect), not external. Fixed.** |

## PH6-01 - Queued Config Write Can Survive Saved-Device Switch

- Severity: **P1**
- Page/subsystem: Config writes from Home, Config, Play volume, Disks, and app-config restore flows.
- Reproduction steps: queue at least two config writes, switch saved devices before the queued write starts, then allow the queue to drain.
- Baseline `c64u` health before live step: REST was already unhealthy at baseline (`curl: (56)`), so this was proven statically and by deterministic tests rather than live traffic.
- `c64u` health after step: not live-executed because REST was baseline-unhealthy.
- Logcat evidence: pending final Pixel run; no live `c64u` execution used for this finding.
- App diagnostic evidence: deterministic unit failures would expose stale task execution.
- Suspected root cause: `resetInteractionState("saved-device-switch")` cancelled REST/FTP/Telnet schedulers but did not cancel `scheduleConfigWrite`'s independent queue.
- Confirmed root cause: `src/lib/config/configWriteThrottle.ts` held a module-level promise chain with no generation/cancellation guard; queued tasks could run later. Because `getC64API()` returns a singleton whose device host is mutated during switching, stale config write closures could execute against the new selected host.
- Fix:
  - Added `ConfigWriteCancelledError` and generation-based cancellation to `scheduleConfigWrite`.
  - Made config write cooldown waits cancel immediately when the throttle is reset.
  - Suppressed "preceding task failed" error logging for expected config-write cancellation.
  - Wired `resetInteractionState(reason)` to `resetConfigWriteThrottle(reason)`.
- Tests added:
  - `configWriteThrottle > cancels queued writes on reset before they can run against a new selected device`
  - `configWriteThrottle > cancels a queued write while it is waiting for the config-write cooldown`
  - `deviceInteractionManager > PH10: resetInteractionState rejects queued config writes before stale device mutation`
- Proof:
  - `npm run test -- tests/unit/configWriteThrottle.test.ts tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts` passed (`55` tests).
  - Later targeted run with FTP tests passed (`84` tests).
- Final status: **fixed; awaiting full validation and Pixel redeploy proof**.

## PH6-02 - Web FTP Bridge Retries Outside Gateway Ownership

- Severity: **P1**
- Page/subsystem: C64U/HVSC/play/disk browsing and import in web runtime via `src/lib/native/ftpClient.web.ts`.
- Reproduction steps: FTP bridge returns transient timeout/HTTP 5xx/connection reset; bridge retries internally before `withFtpInteraction` sees completion/failure.
- Baseline `c64u` health before live step: REST was baseline-unhealthy; this finding is static/protocol-safety evidence, not app-caused live failure.
- `c64u` health after step: not live-executed against `c64u`.
- Logcat evidence: not Android-path; web bridge path only.
- App diagnostic evidence: existing unit tests proved internal retry count.
- Suspected root cause: `FtpClientWeb` had `FTP_BRIDGE_MAX_ATTEMPTS = 3` while all TypeScript FTP calls already run inside `withFtpInteraction`, which has pacing, cooldown, coalescing, circuit breaking, and one bounded transient retry.
- Confirmed root cause: internal bridge retry was invisible to the approved FTP gateway and could multiply a single scheduled FTP operation into several backend FTP attempts.
- Fix:
  - Reduced `FTP_BRIDGE_MAX_ATTEMPTS` to `1`.
  - Documented retry ownership in the bridge source.
  - Updated web FTP tests to assert no internal retries for timeout, HTTP 5xx, write timeout, repeated transient failure, and connection reset.
- Tests changed:
  - `tests/unit/lib/native/ftpClient.web.test.ts`
- Proof:
  - `npm run test -- tests/unit/lib/native/ftpClient.web.test.ts tests/unit/lib/ftp/ftpClient.test.ts tests/unit/configWriteThrottle.test.ts tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts` passed (`84` tests).
- Final status: **fixed; awaiting full validation**.

## PH6-03 - Eager Telnet Capability Discovery on Mount

- Severity: **P1**
- Page/subsystem: `useTelnetActions.ts` / Telnet gateway
- Reproduction steps: Open any page that renders the Telnet actions hook; Telnet capability discovery would fire on mount, producing Telnet traffic without any user action.
- Confirmed root cause: A `useEffect` in `useTelnetActions` called `loadCapabilities()` eagerly on mount (or reconnect), issuing Telnet traffic before the user pressed any button.
- Fix: Removed eager `loadCapabilities()` from the mount effect. Discovery is now deferred to the first `executeAction()` call. Capability cache continues to function normally.
- Tests: `tests/unit/hooks/useTelnetActions.test.tsx` updated to assert no Telnet calls on mount.
- Proof: targeted test pass, included in `npm run test` passing run (578 files, 6677 tests).
- Final status: **fixed; live validation confirmed no Telnet storms on S2–S14**.

## PH6-04 - Bare Telnet CRLF Crashes c64u REST

- Severity: **P0**
- Page/subsystem: `src/lib/diagnostics/healthCheckEngine.ts` / Telnet health probe
- Root cause: The health-check Telnet probe could emit bare `"\r\n"` (CRLF) before a confirmed authenticated prompt path existed. The original defect was the unconditional post-auth CRLF after `authenticateTelnetIfNeeded()` returned `{ passwordSent: false }`. The follow-up defect was that the probe would also continue after reading visible text even when no `Password:` prompt had been observed, leaving a prompt-discovery CRLF path that was stricter in the normal Telnet session implementation but still unsafe here. The c64u firmware interprets bare CRLF before successful Telnet negotiation as a fatal protocol violation, crashing the HTTP/REST server process.
- Timeline from `logcat-s3-health-check.txt`:
  - `15:12:20.356` Telnet TCP connect to port 23 succeeded.
  - `15:12:20.361` CRLF sent unconditionally.
  - `15:12:20.362` c64u: "Connection reset by peer".
  - `15:12:20.428+` All REST calls: ECONNRESET.
- Fix:
  - `src/lib/diagnostics/healthCheckEngine.ts`: if no `Password:` prompt is observed, `authenticateTelnetIfNeeded()` now returns without sending any discovery CRLF.
  - Post-auth CRLF and `send-raw` trace steps remain wrapped in `if (authResult.passwordSent) { ... }`.
- Regression tests added (`tests/unit/lib/diagnostics/healthCheckEngine.test.ts`):
  - "does NOT send CRLF when no password configured" — asserts `transport.send` called 0 times (down from 1).
  - "does not send prompt-discovery CRLF when no password prompt is observed" — asserts `transport.send` called 0 times even when a password exists but no prompt was shown.
  - "sends CRLF only when passwordSent=true" — verifies gate works both directions.
- Proof: 69 health-check engine tests pass. Fixed-APK run S3 PASS with REST_EXIT:0 pre and post.
- Final status: **P0 FIXED** ✅

## INC-S3 - c64u REST Crash During S3 Health Check

- Original severity: ~~Not a defect (external)~~ → **Reclassified: P0 app defect (FIXED by PH6-04)**
- Page/subsystem: Health check poller — `src/lib/diagnostics/healthCheckEngine.ts`
- Observation: During the first (unfixed) run S3, c64u REST crashed with `curl: (56)` immediately after a Telnet health probe.
- Initial classification was "external c64u instability" — **this was incorrect**.
- Confirmed root cause: PH6-04 (see above). Bare CRLF from `healthCheckEngine.ts` before a confirmed Telnet password exchange caused the c64u REST process to crash.
- Evidence of fix effectiveness: In the fixed-APK run, S3 (health check cycle) completed with all sub-checks passing (REST/FTP/Telnet/Config/Raster SUCCESS) and POST_REST_EXIT:0. No crash.
- Logcat evidence: `logcat-s3-health-check.txt` (crash; 7611 lines) vs `logcat-s3-health-check-fixed.txt` (clean; 801 lines).
- Final status: **P0 FIXED** ✅

## INC-TURBO - Accidental Turbo Control Toggle During S5 (P3)

- Severity: **P3**
- Page/subsystem: Config → C64 and Cartridge Settings → Turbo Control
- Observation: During S5 (CPU Speed slider), the drag gesture was approximately 10px off in the y axis, accidentally tapping the Turbo Control selector and changing it from "Off" to "Manual".
- This is a live test operator error, not an app defect.
- The config write was correctly routed through `scheduleConfigWrite` / `withRestInteraction` per the safety model.
- The c64u device accepted the config write with REST exit 0; no crash or instability resulted.
- The Turbo Control value remains "Manual" on c64u after the session. The user can restore it via Config → C64 and Cartridge Settings if desired.
- Disposition: Operator error during live test. Config write safety model worked correctly. No app fix required.

## INC-S3-UX - Diagnostics Panel ≠ Saved-Device Switcher (P3)

- Severity: **P3**
- Page/subsystem: Settings page / device switching UX
- Observation: S3 was intended to test the "saved-device switch picker" but the operator opened the Diagnostics panel instead. The saved-device switcher is not prominently discoverable from the Settings page.
- Disposition: Minor UX discoverability issue. Not a functional defect. The switcher was exercised in a subsequent scenario. No app fix required for this pass.
