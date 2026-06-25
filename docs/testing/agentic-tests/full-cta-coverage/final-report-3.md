# Pixel 4 Exhaustive CTA Certification — Final Report 3

## 1. Recommendation

`PIXEL4-NO-GO`

This is a truthful NO-GO report for the current Pixel 4 run. It is not a completed certification pass. The run found an open S1 Disks reliability defect, did not complete exhaustive CTA accounting, and did not complete the required all-flow floor.

Handover 7 continuation addendum: the next attempted S1 replay did not reach Cycle 1. Direct `c64u` health stayed good with HTTP `403`, but the app-visible baseline after launch/dismissing discovery was `Device Not connected` / `Unable to connect to C64U`. The app was stopped and S1 remains open.

## 2. Scope Note

Scope is Pixel 4 behavior using touch and injected Android key events through DroidMind. Real Callback 8020 hardware is outside this run.

## 3. Build Identity

- Branch: `test/full-cta-coverage`
- Git SHA: `cf84d8e565cbc1511bfe9758887af7c9ae07fba8`
- Source state: dirty local source, including the native REST transport hardening in `src/lib/c64api.ts`.
- APK: `android/app/build/outputs/apk/debug/c64commander-0.8.9-cf84d-debug.apk`
- APK SHA-256: `462bfa1578c219d1f753311695688863c68bdda27480a449823ce60b36d49a07`
- Version shown in current app after restart: `0.8.9-cf84d`

## 4. Installed APK Identity

- Package: `uk.gleissner.c64commander`
- Pixel 4 serial: `9B081FFAZ001WX`
- versionName: `0.8.9-cf84d`
- versionCode: `2044`
- lastUpdateTime: `2026-06-25 09:01:54`
- Signature short: `d39d81d2`

## 5. Git State

Working tree at report time:

```text
 M PLANS.md
 M WORKLOG.md
 M docs/cta-inventory.md
 M docs/testing/agentic-tests/full-cta-coverage/defects/S1-DISKS-MOUNT-EJECT-RESETS-C64U.md
 M docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md
 M playwright/fixtures/traces/golden/diskmanagement--diskmanagementspects--disk-management--settings-changes-while-disk-mounted-preserve-mounted-state-layout/android-phone/trace.json
 M playwright/fixtures/traces/golden/diskmanagement--diskmanagementspects--disk-management--settings-changes-while-disk-mounted-preserve-mounted-state-layout/android-tablet/trace.json
 M playwright/fuzz/structuredRecovery.spec.ts
 M src/lib/c64api.ts
 M tests/unit/c64api.branches.test.ts
 M tests/unit/scripts/generateVariant.test.ts
 M tests/unit/scripts/variantAndroidOnly.test.ts
 M variants/feature-flags/c64u-remote.yaml
 M variants/variants.yaml
?? docs/testing/agentic-tests/full-cta-coverage/final-report-3.md
?? docs/testing/agentic-tests/full-cta-coverage/cleanup-report-3.md
?? docs/testing/agentic-tests/full-cta-coverage/handover6.md
?? docs/testing/agentic-tests/full-cta-coverage/handover7.md
```

## 6. Pixel 4 Identity

- Device: Pixel 4
- Serial: `9B081FFAZ001WX`
- Input: touch plus injected Android key events via `DroidmindClient.pressKey()`

## 7. C64U Identity

- Primary target: `c64u`
- HTTP: `80`
- FTP: `21`
- Telnet: `23`
- App-visible post-restart identity: `c64u`, firmware `1.1.0`, green `C64U` status.
- Direct unauthenticated post-restart probe: `http://c64u/v1/info` returned expected HTTP `403` in `0.008440s`.
- `u64` post-restart direct unauthenticated probe still returned connection reset and was not used for certification.

## 8. Commands Run

Material commands are recorded chronologically in `WORKLOG.md`. Key commands:

- `npm run scope:check`
- `npm run test -- tests/unit/c64api.branches.test.ts`
- `npm run cap:build && npm run android:apk`
- `adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-0.8.9-cf84d-debug.apk`
- DroidMind launch, key navigation, screenshots, hierarchy capture, logcat capture.
- Direct target health probes for `c64u` and `u64` as infrastructure evidence only.

## 9. Artifact Roots

- Active artifact root: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/`
- Restart health evidence: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/restart-health/`
- S1 failure evidence: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/readonly-cycle-key-2-eject/`
- Handover 7 baseline block evidence: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/s1-five-cycle-cf84d-resume/`

## 10. Infrastructure Reuse Summary

The existing `c64scope` and DroidMind paths were used. Product Android actions used `DroidmindClient`. Product key input used `DroidmindClient.pressKey()`. Raw ADB was limited to package identity, install, process state, and log capture. Raw REST was limited to target health/readback.

## 11. Infrastructure Augmentations

Added native REST hardening in `src/lib/c64api.ts`: native direct-device requests now send `Connection: close`; web/proxy requests are unchanged. Regression test added in `tests/unit/c64api.branches.test.ts`.

## 12. All-Route Inventory Summary

Inherited current-route discovery inventory contained 290 discovery-only controls:

- Home: 106
- Play: 24
- Disks: 40
- Config: 28
- Settings: 74
- Docs: 18

Discovery is not coverage. These rows were not exhaustively executed.

## 13. Exhaustive CTA Ledger Summary

- Total runtime CTAs discovered: `290`
- PASS: not finalized
- FAIL: at least the Disks S1 flow failure
- BLOCKED_WITH_EVIDENCE: current exhaustive accounting
- SAFETY_BLOCKED_NOT_EXECUTED: not finalized
- INCONCLUSIVE_NEEDS_REPLAY: several inherited targeted runs
- NOT_PRESENT_WITH_REASON: not finalized
- SPEC_GAP_WITH_EVIDENCE: not finalized
- Final unaccounted count: `290`

This violates the certification requirement for zero unaccounted CTAs and is one reason for `PIXEL4-NO-GO`.

## 14. Flow Ledger Summary

Critical targeted evidence exists for Save-and-Connect, some Disks source/import flows, keypad canary, and one Drive A readonly mount/eject cycle. Full Home, Play, Disks, Config, Settings, Docs/Licenses, Diagnostics, Device Switcher, native picker, negative-path, lifecycle, performance, reliability, background playback, and soak coverage is incomplete.

Final untested main-flow count is not zero.

## 15. Touch Parity Results

Not completed. DroidMind tap behavior was observed as unreliable/no-op during this continuation, while key-event activation worked. Touch parity remains blocked/incomplete.

## 16. Keypad-First Results

Partial only. Keypad canary was previously proven; Disks mount/eject actions were performed with D-pad focus and Center activation. Full keypad-first matrix was not completed.

## 17. Page Deep-Dive Results

Incomplete. The run did not complete all required page deep dives.

## 18. Play Source Results

Incomplete. Play source matrix and playlist/background playback requirements were not completed.

## 19. Disks Results

Disks is the release-blocking area.

- One readonly key-driven Drive A mount/eject cycle passed.
- Second corrected readonly cycle mounted `Frogger.d64`, then the key-driven Drive A eject failed with `Connection reset` on `PUT /v1/drives/a:remove`.
- Post-restart cleanup evidence now shows Drive A ON with `No disk mounted`.
- Handover 7 replay was blocked before Cycle 1: app-visible baseline remained `Not connected` even though direct `c64u` probes returned HTTP `403`.
- S1 remains open until five corrected cycles pass on the current hardened APK.

## 20. Config Root-Cause And Results

Incomplete. Earlier Config blockage was attributed to overlay contamination rather than a proven Config outage, but full category/row enumeration and mutation restore coverage were not completed.

## 21. Settings Results

Incomplete. Some prior settings gates existed, but full Settings deep dive and restoration matrix were not completed in this run.

## 22. Docs/Licenses Results

Incomplete.

## 23. Diagnostics Results

Incomplete. Diagnostics was used for targeted evidence in earlier passes, but the required diagnostics matrix and export/redaction checks were not completed.

## 24. Device Switcher Results

Incomplete. Device switcher was used for targeted restore evidence, but the full overlay matrix was not completed.

## 25. Native Picker Results

Incomplete.

## 26. Negative-Path Results

Incomplete.

## 27. Lifecycle Results

Incomplete.

## 28. Performance Results

Incomplete. No complete performance report was produced. The S1 eject failure occurred after an idle interval and is performance/reliability relevant.

## 29. Reliability/Repetition Results

Failed for Drive A mount/eject:

- Cycle 1: pass.
- Cycle 2: fail on eject with `Connection reset`.

Required five-cycle reliability was not achieved.

## 30. Soak Results

Not completed.

## 31. Defects And Issues

Release-blocking:

- `S1-DISKS-MOUNT-EJECT-RESETS-C64U`: open. Reproduced connection reset during Drive A mount/eject reliability replay.

Other open or relevant defects:

- `S2-DISKS-FTP-RECURSIVE-SCAN-STALL`
- `INFRA-002-GATE3-RUNNER-LOSES-APP`
- `INFRA-003-GATE6-HIERARCHY-CAPTURE-HANG`
- `INFRA-004-GATE65-CONFIG-BLOCKED-BY-MOUNT-SHEET`
- `INFRA-005-GATE7-HTTP-RESTORE-BLOCK`

## 32. Full-Log Index

Important evidence:

- `readonly-cycle-key-2-eject/logs/logcat/cycle-2-eject.log`
- `readonly-cycle-key-2-eject/screenshots/focus-up-from-b/09-LEFT.png`
- `readonly-cycle-key-2-eject/screenshots/03-after-eject-polling.png`
- `restart-health/screenshots/current-cf84d-after-restart-launch.png`
- `restart-health/screenshots/current-cf84d-disks-after-restart.png`
- `restart-health/logs/logcat/current-cf84d-after-restart-launch.log`
- `restart-health/logs/logcat/current-cf84d-disks-after-restart.log`
- `restart-health/logs/commands/c64u-info.stdout.log`
- `restart-health/logs/commands/u64-info.stdout.log`

## 33. Cleanup Status

Partial cleanup is proven after the user restarted the targets:

- App-visible `c64u` connected and green.
- Drive A ON with `No disk mounted`.
- Drive B OFF with `No disk mounted`.
- App stopped after cleanup capture to avoid further traffic.

Full exhaustive cleanup is not proven because the full certification matrix did not run. See `cleanup-report-3.md`.

## 34. Residual Differences

- S1 remains open and unmitigated on-device; the native `Connection: close` hardening has not yet passed the required five-cycle replay.
- `u64` direct unauthenticated health probe still returned connection reset after restart.
- CTA accounting incomplete: final unaccounted count is not zero.
- Full flow accounting incomplete: final untested main-flow count is not zero.

## 35. Exact Uncommitted Working-Tree Status

See section 5. The working tree remains dirty and includes both certification artifacts and source/test changes.
