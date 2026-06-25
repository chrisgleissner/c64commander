# Handover 8 — S1 Replay Blocked Before Cycle 1

## Current Decision

`final-report-3.md` remains `PIXEL4-NO-GO`.

Do not certify. S1 remains open and exhaustive CTA/flow accounting is still incomplete.

## Current State

- Branch: `test/full-cta-coverage`
- Git SHA: `cf84d8e565cbc1511bfe9758887af7c9ae07fba8`
- Pixel 4: `9B081FFAZ001WX`
- Package: `uk.gleissner.c64commander`
- Installed APK: `0.8.9-cf84d`, versionCode `2044`, SHA-256 `462bfa1578c219d1f753311695688863c68bdda27480a449823ce60b36d49a07`
- App process: stopped after Handover 7 baseline block.
- `c64u`: direct unauthenticated probes still return fast HTTP `403`.
- `u64`: do not use for C64U certification closure.

## Latest Attempt

Artifact root:

`c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/s1-five-cycle-cf84d-resume/`

Observed:

1. Direct pre-launch `c64u` probe returned HTTP `403` in `0.008523s`.
2. App launched through `DroidmindClient.startApp()`.
3. App opened discovery interstitial showing `Ultimate 64 Elite · u64`; `u64` was not selected.
4. After dismissing discovery, Home showed `App 0.8.9-cf84d Device Not connected Firmware Not connected` and `Unable to connect to C64U`.
5. Drive A was visible as ON / `No disk mounted`; Drive B OFF / `No disk mounted`.
6. After a 12 second wait, app-visible state remained `Not connected`.
7. Direct post-app `c64u` probe still returned HTTP `403` in `0.009939s`.
8. No Drive A mount/eject cycle was attempted.
9. App was stopped with `DroidmindClient.stopApp()`.

Primary result:

`s1-five-cycle-cf84d-resume/baseline-block-result.json` = `BLOCKED_WITH_EVIDENCE`.

## Next Required Actions

1. Do not rebuild unless source changes.
2. Start with direct `c64u` health; expected unauthenticated result is fast HTTP `403`.
3. Launch via `DroidmindClient.startApp()`.
4. Prove app-visible green `C64U`, device `c64u`, firmware `1.1.0`, and Drive A ON / `No disk mounted`.
5. If app-visible state remains `Not connected`, stop the app and keep `PIXEL4-NO-GO`.
6. Only after the healthy app-visible baseline is proven, re-run five corrected readonly Drive A mount/eject cycles with screenshot/hierarchy-confirmed focus before every `DPAD_CENTER`.

## Do Not Do

- Do not select or use `u64`.
- Do not attempt Drive A mount/eject while app-visible target is `Not connected`.
- Do not use raw REST to replace app-driven product validation.
- Do not use raw ADB key events.
- Do not write a GO or CONDITIONAL report while S1 remains open.
