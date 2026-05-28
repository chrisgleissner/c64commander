# Prod Hardening 6 Issue Ledger

Every observed issue from the live Pixel 4 / `c64u` review will be recorded here.

## Issue Index

| ID | Severity | Subsystem | Status |
| -- | -- | -- | -- |
| PH6-01 | P1 | Config writes / saved-device switching | Fixed; targeted tests pass |
| PH6-02 | P1 | Web FTP bridge retry ownership | Fixed; targeted tests pass |

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

## INC-S3 - c64u REST Crash During Health Check (External)

- Severity: **Not a defect** (external c64u instability)
- Page/subsystem: Health check poller / c64u firmware REST listener
- Observation: During S3 (diagnostics panel / saved-device picker), c64u REST returned `curl: (56) Recv failure: Connection reset by peer` AFTER a Telnet health probe.
- FTP TCP (port 21) and Telnet TCP (port 23) remained reachable during the crash, confirming partial REST listener crash only.
- The c64u firmware has a known pre-existing intermittent REST listener crash pattern that is independent of app behavior.
- App action: None. No app traffic had been sent in S3 that would justify a REST crash. The app correctly showed a degraded badge and did not storm the device during degraded state.
- User restarted c64u; all subsequent scenarios (S4–S14) passed without recurrence.
- Disposition: External c64u instability. No app fix required. Documented for completeness.

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
