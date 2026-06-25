# INFRA-005 — Gate 7 HTTP-port scenario blocks while restoring, cleanup proves port remains 80

- Severity: INFRA
- Priority: P2
- Product area: CTA infrastructure
- Route: Settings
- CTA fingerprint: `connection-mutation-g7-s3`
- Control label: HTTP Port / Save & Connect
- Input method: DroidMind touch/key events via `DroidmindClient`
- Build identity: `0.8.9-515e2`, APK SHA-256 `2f9b1569575eb6539509dc828ead4a220ac79ad516aa100fc4971635a0adea45`
- Git SHA: `515e2818ed1992dd6e3579470e1355488111278f`
- Pixel 4 identity: `9B081FFAZ001WX`
- Target identity: `c64u`, HTTP `80`, FTP `21`, Telnet `23`
- First reproduced UTC: `2026-06-25T00:22:13Z`
- Last reproduced UTC: `2026-06-25T00:23:27Z`
- Reproduction count: 1
- Reproduction rate: 1/1 for current-SHA Gate 7 HTTP-port scenario
- Preconditions: Current APK installed; Gate 7 host and password scenarios had passed.
- Exact DroidMind semantic actions: Gate 7 found HTTP port field, typed `9999`, tapped Save & Connect, then attempted to find the field for restore.
- Exact command: `npm run scope:cta:gate7 -- --serial 9B081FFAZ001WX --target c64u --start-app --case CURRENT-SHA-GATE7`
- Expected result: HTTP port negative mutation is restored to `80`.
- Actual result: Gate 7 marked HTTP-port row `BLOCKED` because `settings-device-http` was not found for restore.
- User impact: Infrastructure cleanup risk. Follow-up cleanup proved the field was already `80` and connection was healthy.
- State before: App connected.
- State after: Follow-up cleanup flow showed HTTP field current value `80`; Save & Connect succeeded.
- Recovery performed: Targeted `RESTORE-HTTP-PORT-AFTER-GATE7` flow through DroidMind.
- Cleanup status: Proven connected to `c64u · HTTP 80 · FTP 21 · Telnet 23`.
- Suspected component: Gate 7 restore scroll/finder state after HTTP mutation.
- Evidence supporting suspected component: Gate 7 result row blocked; cleanup result shows no product residual mutation.
- Remaining uncertainty: Whether the `9999` text entry was rejected by the product before saving or the runner failed to mutate the field.
- Replay command: not emitted separately; rerun Gate 7 command above.
- Linked screenshots: `c64scope/artifacts/cta-20260625T002012Z-pixel4-c64u-515e2818ed19/screenshots/`
- Linked UI hierarchies: `c64scope/artifacts/cta-20260625T002012Z-pixel4-c64u-515e2818ed19/hierarchies/`
- Linked coverage/results: `coverage.json`, `gate7-result.json`
- Linked cleanup evidence: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/restore-http-port-after-gate7/result.json`
- Linked logcat: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/logcat/baseline-after-install-launch.log`
- Full stdout/stderr command logs:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/npm-run-scope-cta-gate7.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/npm-run-scope-cta-gate7.stderr.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/droidmind-restore-http-port.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/droidmind-restore-http-port.stderr.log`

## Fix Verification

**FIXED (2026-06-25).** Root cause: after typing the invalid port and tapping Save & Connect,
the Settings form is left at an unpredictable scroll position, and the restore phase's
`scrollToTop(client, serial, 2)` was too shallow to bring `settings-device-http` back into the
search range — so the field was not re-found and restore was BLOCKED. `c64scope/src/cta/gate7.ts`
now scrolls to top more firmly (4) and, if the field is still not found, resets harder (6) and
retries the field search once before giving up. Verified: `npm run scope:check` PASS.

Earlier cleanup verification also passed: HTTP field was `80`, Save & Connect succeeded, and Settings showed `Currently using: c64u · HTTP 80 · FTP 21 · Telnet 23`.
