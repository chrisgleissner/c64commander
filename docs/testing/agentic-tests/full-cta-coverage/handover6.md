# Handover 6 — Pixel 4 CTA certification blocked on C64U connection reset

Recorded UTC: `2026-06-25T08:04:19Z`.

Do not write `final-report-3.md` from this state. The exhaustive Pixel 4 CTA certification is incomplete, cleanup is not proven, and the primary C64U target is currently unhealthy.

## Current Repository And APK State

- Branch: `test/full-cta-coverage`
- Git SHA: `cf84d8e565cbc1511bfe9758887af7c9ae07fba8`
- Working tree: dirty. Preserve unrelated/concurrent edits.
- Current source change from this handover: `src/lib/c64api.ts` adds `Connection: close` to native direct-device REST requests; `tests/unit/c64api.branches.test.ts` covers native direct-device vs web/proxy behavior.
- Current APK: `android/app/build/outputs/apk/debug/c64commander-0.8.9-cf84d-debug.apk`
- APK SHA-256: `462bfa1578c219d1f753311695688863c68bdda27480a449823ce60b36d49a07`
- Installed package on Pixel 4 `9B081FFAZ001WX`: `uk.gleissner.c64commander`, versionName `0.8.9-cf84d`, versionCode `2044`, lastUpdateTime `2026-06-25 09:01:54`, signature short `d39d81d2`, package stopped=true.
- The current APK was installed with raw `adb install -r` and deliberately not launched after installation.

## Validation Completed

- `npm run scope:check`: passed 55 files / 360 tests before the native transport hardening; no c64scope code changed afterward.
- `npm run test -- tests/unit/c64api.branches.test.ts`: passed 94 tests.
- `npm run cap:build && npm run android:apk`: passed after the hardening.
- `adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-0.8.9-cf84d-debug.apk`: passed.
- `npm run lint`: passed.
- Secret scan found only existing historical prompt/handover/report references to the lab password, not new unredacted command or artifact leakage.

## Active Artifact Root

- Current active evidence root: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/`
- Current failed replay evidence:
  - `readonly-cycle-key-1/`
  - `readonly-cycle-key-1-eject/`
  - `readonly-cycle-key-2/`
  - `readonly-cycle-key-2-eject/`

## Completed Counts

- Runtime all-route discovery rows inherited from the earlier current-SHA pass: 290 discovery-only rows.
- Final CTA rows completed: 0.
- Final unaccounted CTA count: 290 until final execution ledger is produced.
- Main flows fully certified: 0.
- Disks targeted proof:
  - One readonly key-driven Drive A mount/eject cycle passed.
  - Second corrected readonly cycle failed on eject with C64U connection reset.

## Hard Blocker

`S1-DISKS-MOUNT-EJECT-RESETS-C64U` remains open and currently blocks C64U product validation.

Cycle 2 sequence:

1. Drive A was ON with `/.../Frogger.d64` mounted.
2. Screenshot `readonly-cycle-key-2-eject/screenshots/focus-up-from-b/09-LEFT.png` proves focus on `Drive A Eject disk`.
3. `DroidmindClient.pressKey(DPAD_CENTER)` activated the focused eject CTA.
4. Logcat `readonly-cycle-key-2-eject/logs/logcat/cycle-2-eject.log` shows `PUT http://c64u/v1/drives/a:remove` failed in 37 ms with `Connection reset`; context included `idleMs=197050`, `wasIdle=true`.
5. The app moved to Home and showed `Not connected`.
6. The app was stopped with `DroidmindClient.stopApp`.
7. Direct app-stopped `http://c64u/v1/info` probes still returned `curl: (56) Recv failure: Connection reset by peer`.
8. Latest app-stopped probe at `2026-06-25T08:07:31Z` still returned connection reset; evidence `readonly-cycle-key-2-eject/logs/commands/c64u-health-final-check.stdout.log` and `.stderr.log`.

Important cleanup risk: Drive A may still have `/USB2/test-data/d64/Frogger.d64` mounted because the eject request failed and target readback is unavailable.

## Do Not Do

- Do not launch the app while direct app-stopped `c64u` probes return connection reset.
- Do not continue Disks mount/eject repetitions until `c64u` recovers.
- Do not use `u64` to close Pixel 4 C64U certification.
- Do not write `final-report-3.md`.
- Do not mark cleanup proven.
- Do not count stale coordinate fallback evidence as CTA coverage.

## Next Commands

First safe action:

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
curl -sS -o c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/readonly-cycle-key-2-eject/logs/commands/c64u-health-resume-body.txt \
  -w 'http_code=%{http_code} time_total=%{time_total}\n' \
  http://c64u/v1/info \
  > c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/readonly-cycle-key-2-eject/logs/commands/c64u-health-resume.stdout.log \
  2> c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/readonly-cycle-key-2-eject/logs/commands/c64u-health-resume.stderr.log
cat c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/readonly-cycle-key-2-eject/logs/commands/c64u-health-resume.stdout.log
cat c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/readonly-cycle-key-2-eject/logs/commands/c64u-health-resume.stderr.log
```

If the probe still returns connection reset, keep the app stopped and update `PLANS.md`, `WORKLOG.md`, and the progress ledger. No product traffic.

If the probe returns expected unauthenticated HTTP `403` quickly:

1. Launch the installed `0.8.9-cf84d` APK through `DroidmindClient.startApp()`.
2. Capture baseline screenshot, UI hierarchy if DroidMind hierarchy capture is responsive, and logcat.
3. Confirm app-visible target is `c64u`; if not connected, run app-driven Save-and-Connect through DroidMind.
4. Confirm Drive A state. If Drive A still has `Frogger.d64` mounted, eject it through a screenshot/hierarchy-confirmed `Drive A Eject disk` CTA and verify with app-visible state plus direct health.
5. Confirm the native transport hardening is present in request evidence where practical.
6. Re-run five readonly Drive A mount/eject cycles only from: Drive A ON, `No disk mounted`, healthy `c64u`, and mount sheet opened through a semantic or screenshot-confirmed target.
7. Continue exhaustive CTA execution only after S1 is either fixed/proven or blocked with target-health evidence.

## Files Updated In This Handover

- `PLANS.md`
- `WORKLOG.md`
- `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`
- `docs/testing/agentic-tests/full-cta-coverage/defects/S1-DISKS-MOUNT-EJECT-RESETS-C64U.md`
- `src/lib/c64api.ts`
- `tests/unit/c64api.branches.test.ts`
- `docs/testing/agentic-tests/full-cta-coverage/handover6.md`
