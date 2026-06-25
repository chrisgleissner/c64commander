# Full CTA Coverage Handover 5

Recorded UTC: 2026-06-25T01:44:00Z.

Do not write `docs/testing/agentic-tests/full-cta-coverage/final-report-3.md` from this state. The exhaustive Pixel 4 certification is blocked before CTA execution, cleanup, reliability, lifecycle, and soak completion.

## Current Identity

- Branch: `test/full-cta-coverage`
- Git SHA: `515e2818ed1992dd6e3579470e1355488111278f`
- Pixel 4 serial: `9B081FFAZ001WX`
- Package: `uk.gleissner.c64commander`
- Current APK: `android/app/build/outputs/apk/debug/c64commander-0.8.9-515e2-debug.apk`
- APK SHA-256: `2f9b1569575eb6539509dc828ead4a220ac79ad516aa100fc4971635a0adea45`
- Installed identity: versionName `0.8.9-515e2`, versionCode `2041`, lastUpdateTime `2026-06-25 00:59:13`, package path `/data/app/~~RNFTH4jdudOH7uFn_NTnlA==/uk.gleissner.c64commander-Epu5KWMBWr_2w8EVExzTXA==/base.apk`, signature short `d39d81d2`
- Active artifact root: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/`

## Required State Files

- Plan: `PLANS.md`
- Worklog: `WORKLOG.md`
- Progress ledger: `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`
- Defect directory: `docs/testing/agentic-tests/full-cta-coverage/defects/`

## Completed Evidence

- `npm run scope:check`: passed 55 files / 356 tests. Logs:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/npm-run-scope-check.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/npm-run-scope-check.stderr.log`
- Current APK built and installed with `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX`. Logs:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/build-skip-tests-install-apk.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/build-skip-tests-install-apk.stderr.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/adb-dumpsys-package-after-install.stdout.log`
- Baseline launch through DroidMind:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/screenshots/baseline-current-sha-launch.png`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/hierarchies/baseline-current-sha-launch.xml`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/logcat/baseline-after-install-launch.log`
- MCP capability check: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/mcp-capabilities.json`, satisfied true.
- App-driven Save-and-Connect proof: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/targeted-save-connect/result.json`, status `PROVEN`.
- All-route discovery on current APK: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/results.json`.
  - Total runtime CTAs discovered: `290`
  - Home: `106`
  - Play: `24`
  - Disks: `40`
  - Config: `28`
  - Settings: `74`
  - Docs: `18`
  - These are discovery-only rows, not execution coverage.
- Keypad canary: `c64scope/artifacts/cta-20260625T000854Z-pixel4-c64u-515e2818ed19/`, 11/11 passed.
- Gate 4: `c64scope/artifacts/cta-20260625T000959Z-pixel4-c64u-515e2818ed19/`, `PROVEN`.
- Gate 5: `c64scope/artifacts/cta-20260625T001042Z-pixel4-c64u-515e2818ed19/`, 12/12 passed.
- Gate 6 partial/hung artifact: `c64scope/artifacts/cta-20260625T001329Z-pixel4-c64u-515e2818ed19/`, infrastructure defect filed.
- Gate 6.5: `c64scope/artifacts/cta-20260625T001827Z-pixel4-c64u-515e2818ed19/`, Config block attributed to leftover Drive A mount sheet, not Config.
- Gate 7: `c64scope/artifacts/cta-20260625T002012Z-pixel4-c64u-515e2818ed19/`, 2/3 passed; HTTP cleanup separately proven.
- HTTP port cleanup: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/restore-http-port-after-gate7/result.json`, status `PROVEN`.
- Config deep dive: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/config-deep-dive/result.json`, status `PROVEN`; five loads reached Config, connected, with no error/retry/loading state.

## Current Blocker

`S1-DISKS-MOUNT-EJECT-RESETS-C64U` is a hard safety blocker.

Evidence:

- Repeated Drive A mount/eject loop artifact: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/disks-mount-eject-loop/result.json`
- First two cycles mounted and ejected `Boulder Dash 2.d64`; post-eject text showed `No disk mounted`.
- Third cycle tapped the Drive A mount path and selected `Boulder Dash 2.d64`; the app then showed red C64U status with Drive A `Connection reset`.
- Authenticated `/v1/info` immediately after the app failure returned connection reset. Log: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/target-health-after-disks-loop.stdout.log`.
- Live evidence before stopping the app:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/screenshots/disks-loop-connection-reset-live.png`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/hierarchies/disks-loop-connection-reset-live.xml`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/logcat/disks-loop-connection-reset.log`
- The live hierarchy showed Drive A and Drive B as `No disk mounted`, so disk media cleanup appears likely, but connected final cleanup is not proven.
- The app was stopped through `DroidmindClient.stopApp`.

Safety instruction:

- Do not send further `c64u` app, REST, FTP, or Telnet traffic until this request pattern is reviewed and either fixed or an explicit safe device-test window is available.

## Source Inspection Notes

Read-only inspection after the safety stop found this request pattern:

- `src/lib/disks/diskMount.ts`: C64U disk mount calls `api.mountDrive(drive, disk.path, mountType, "readwrite")`.
- `src/lib/c64api.ts`: `mountDrive` sends `PUT /v1/drives/{drive}:mount?image=...&type=...&mode=readwrite`; `unmountDrive` sends `PUT /v1/drives/{drive}:remove`.
- `src/components/disks/HomeDiskManager.tsx`: mount/eject invalidates `["c64-drives"]` after mutations.
- `src/hooks/useC64Connection.ts`: `useC64Drives` polls `GET /v1/drives` while active.
- `src/lib/deviceInteraction/deviceInteractionManager.ts`: device safety has cooldown logic for `/v1/drives`.

No code fix was made in this continuation.

## Remaining CTAs

- Runtime CTAs discovered: `290`
- Runtime CTA rows with final execution status: `0`
- Remaining unaccounted CTAs: `290`

The final exhaustive ledger must be `docs/testing/agentic-tests/full-cta-coverage/exhaustive-cta-ledger-3.md` and must end with unaccounted count `0`. No discovered CTA may be treated as passed from visibility alone.

## Remaining Flows

- Home deep dive
- Play deep dive
- Disks deep dive continuation after S1 triage
- Config individual CTA execution and safe mutation/readback
- Settings deep dive
- Docs and Licenses deep dive
- Diagnostics deep dive
- Device Switcher deep dive
- Native Android picker flows
- Touch parity pass
- Full keypad-first pass
- Lifecycle pass
- Negative-path pass
- Performance measurements
- Reliability repetitions
- Background playback transition pass
- Soak
- Final cleanup and state diff

## Open Defects

- `docs/testing/agentic-tests/full-cta-coverage/defects/S1-DISKS-MOUNT-EJECT-RESETS-C64U.md`
- `docs/testing/agentic-tests/full-cta-coverage/defects/S2-DISKS-FTP-RECURSIVE-SCAN-STALL.md`
- `docs/testing/agentic-tests/full-cta-coverage/defects/INFRA-002-GATE3-RUNNER-LOSES-APP.md`
- `docs/testing/agentic-tests/full-cta-coverage/defects/INFRA-003-GATE6-HIERARCHY-CAPTURE-HANG.md`
- `docs/testing/agentic-tests/full-cta-coverage/defects/INFRA-004-GATE65-CONFIG-BLOCKED-BY-MOUNT-SHEET.md`
- `docs/testing/agentic-tests/full-cta-coverage/defects/INFRA-005-GATE7-HTTP-RESTORE-BLOCK.md`

Previously fixed/proven defects remain in the directory and should be included in the final defect summary:

- `docs/testing/agentic-tests/full-cta-coverage/defects/S2-DISKS-MOUNT-EMPTY.md`
- `docs/testing/agentic-tests/full-cta-coverage/defects/S2-DISKS-COMMOSERVE-MISSING.md`

## Exact Next Commands

Safe local/source-only commands:

```bash
rg -n "mountDrive|unmountDrive|invalidateQueries\\(\\{ queryKey: \\[\\\"c64-drives\\\"\\]" src tests
sed -n '520,630p' src/components/disks/HomeDiskManager.tsx
sed -n '560,790p' src/lib/deviceInteraction/deviceInteractionManager.ts
```

After a fix is made, run focused regression tests and `npm run scope:check`. Do not device-retest against `c64u` until the safety window is deliberate. When safe to resume device work, the first product action must be a minimal restore/confirm sequence:

1. One authenticated target health probe to `c64u`.
2. Launch the app through DroidMind.
3. Confirm or restore Settings to `c64u`, redacted password, HTTP `80`, FTP `21`, Telnet `23`.
4. Confirm app-visible connected state.
5. Only then resume exhaustive CTA execution.

## Working Tree At Handover

Latest observed `git status --short` before writing this handover:

```text
 M PLANS.md
 M WORKLOG.md
 M docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md
 M scripts/repro-cursor-blink-snapshot-restore.mjs
 M src/lib/c64api.ts
 M src/lib/c64api/hostConfig.ts
 M src/lib/connection/connectionManager.ts
 M src/lib/machine/ramOperations.ts
 M tests/unit/machine/ramOperations.test.ts
 M tests/unit/machine/screenSnapshotRoundtrip.test.ts
?? docs/c64/ram-snapshot-constraints.md
?? docs/testing/agentic-tests/full-cta-coverage/defects/INFRA-002-GATE3-RUNNER-LOSES-APP.md
?? docs/testing/agentic-tests/full-cta-coverage/defects/INFRA-003-GATE6-HIERARCHY-CAPTURE-HANG.md
?? docs/testing/agentic-tests/full-cta-coverage/defects/INFRA-004-GATE65-CONFIG-BLOCKED-BY-MOUNT-SHEET.md
?? docs/testing/agentic-tests/full-cta-coverage/defects/INFRA-005-GATE7-HTTP-RESTORE-BLOCK.md
?? docs/testing/agentic-tests/full-cta-coverage/defects/S1-DISKS-MOUNT-EJECT-RESETS-C64U.md
?? scripts/prove-snapshot-all-types.ts
```
