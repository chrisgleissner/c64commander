# Handover 7 — Continue After Final Report 3 NO-GO

Use this as the next continuation prompt for the C64 Commander / C64U Remote Pixel 4 exhaustive CTA certification.

## Current Decision

`final-report-3.md` has been written with recommendation `PIXEL4-NO-GO`.

Do not reinterpret that report as a completed certification pass. It is a truthful NO-GO because S1 remains open and exhaustive CTA/flow accounting is incomplete.

## Current State

- Branch: `test/full-cta-coverage`
- Git SHA: `cf84d8e565cbc1511bfe9758887af7c9ae07fba8`
- Pixel 4: `9B081FFAZ001WX`
- Package: `uk.gleissner.c64commander`
- Installed APK: `0.8.9-cf84d`, versionCode `2044`, SHA-256 `462bfa1578c219d1f753311695688863c68bdda27480a449823ce60b36d49a07`
- App process: stopped after cleanup capture.
- Primary target: `c64u`, app-visible healthy after restart.
- `u64`: direct unauthenticated probe still returned connection reset; do not use it for C64U certification closure.

## Important Files

- Plan: `PLANS.md`
- Worklog: `WORKLOG.md`
- Progress ledger: `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`
- Final report: `docs/testing/agentic-tests/full-cta-coverage/final-report-3.md`
- Cleanup report: `docs/testing/agentic-tests/full-cta-coverage/cleanup-report-3.md`
- S1 defect: `docs/testing/agentic-tests/full-cta-coverage/defects/S1-DISKS-MOUNT-EJECT-RESETS-C64U.md`
- Active artifact root: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/`

## Source Changes To Preserve

- `src/lib/c64api.ts`: native direct-device REST requests add `Connection: close`.
- `tests/unit/c64api.branches.test.ts`: regression test for native direct-device header behavior.
- Do not revert unrelated dirty variant/CTA inventory/certification files.

## Last Known Cleanup Evidence

- `restart-health/screenshots/current-cf84d-after-restart-launch.png`: app `0.8.9-cf84d`, green `C64U`, device `c64u`, firmware `1.1.0`.
- `restart-health/screenshots/current-cf84d-disks-after-restart.png`: Drive A ON, `No disk mounted`; Drive B OFF, `No disk mounted`.
- `restart-health/logs/droidmind/stop-after-restart-cleanup.jsonl`: app stopped after capture.

## Primary Blocker To Resolve

`S1-DISKS-MOUNT-EJECT-RESETS-C64U`

The previous run:

1. Passed one readonly key-driven Drive A mount/eject cycle.
2. Failed on the second corrected cycle during key-driven Drive A eject.
3. Logcat showed `PUT http://c64u/v1/drives/a:remove` failed with `Connection reset`, `idleMs=197050`, `wasIdle=true`.
4. The user restarted the targets; `c64u` recovered and cleanup readback now shows no disk mounted.

## Next Required Actions

1. Start from current installed `0.8.9-cf84d`; do not rebuild unless source changed.
2. Run a direct `c64u` health probe first; expected unauthenticated result is fast HTTP `403`.
3. Launch via `DroidmindClient.startApp()`.
4. Confirm app-visible `c64u` healthy and Drive A ON / `No disk mounted`.
5. Re-run five corrected readonly Drive A mount/eject cycles using only:
   - DroidMind product actions.
   - `DroidmindClient.pressKey()` for key events.
   - Screenshot/hierarchy-confirmed focus before `DPAD_CENTER`.
6. Stop immediately on any connection reset or app-visible target degradation.
7. If five cycles pass, update S1 with fix verification and continue exhaustive CTA/flow execution.
8. If any cycle fails, keep `PIXEL4-NO-GO` and do not attempt to certify.

## Do Not Do

- Do not claim final unaccounted CTA count is zero until the final ledger has one row per runtime-discovered CTA.
- Do not count visibility-only discovery as CTA pass.
- Do not use raw REST to replace app-driven product validation.
- Do not use raw ADB key events.
- Do not write a GO or CONDITIONAL report while S1 remains open.

