# Android APK/AAB Size Regression Worklog

## [2026-04-11 00:00 +00:00] EXEC-INIT: Android size investigation started

Classification:

- `DOC_PLUS_CODE`

Scope:

- Investigate Android APK/AAB size regression between tags `0.7.2` and `0.7.3`.
- Preserve HVSC download, ingest, and real-archive decompression behavior.
- Produce byte-level attribution and implement only proven-safe size reductions.

Initial findings:

- `0.7.3` introduces upstream 7-Zip Android binary generation in `android/scripts/build-upstream-7zip.sh` and packages the outputs through `android/app/build.gradle`.
- Current release config already narrows release ABIs to `armeabi-v7a` and `arm64-v8a`, so the regression may be caused by the newly bundled native payload itself, strip state, packaging mode, or additional release artifact contents.
- Existing `PLANS.md` and `WORKLOG.md` contain unrelated prior task history and are being preserved below this investigation section.

Next step:

- Create reproducible tag worktrees, build the release artifacts for `0.7.2` and `0.7.3`, and capture the size delta before changing any code.

## [2026-04-11 15:40 +00:00] ROOT-CAUSE: Release artifacts bundled the upstream 7-Zip payload for all four ABIs

What I measured:

- Published Android release sizes from GitHub:
  - `0.7.2`: APK `5,924,008`, AAB `6,706,223`
  - `0.7.3`: APK `10,791,126`, AAB `11,580,702`
  - `0.7.4`: APK `10,818,038`, AAB `11,608,467`
- Published `0.7.3` and `0.7.4` APK/AAB contents both package eight native libraries: `lib7zz.so` and `libdatastore_shared_counter.so` for `arm64-v8a`, `armeabi-v7a`, `x86`, and `x86_64`.
- The packaged native payload alone contributes `4,863,914` compressed bytes in both the APK and the AAB.

What I ruled out:

- Debug-symbol leakage is not the cause. Extracted release `lib7zz.so` binaries are already `stripped`, and the inspected arm64 binary shows `.dynsym` only with no `.debug_*` or `.symtab` sections.

Causal conclusion:

- `0.7.3` correctly introduced the upstream 7-Zip implementation for HVSC 7z handling, but the release packaging path consumed an all-ABI generated JNI directory from the main source set.
- That made release artifacts ship `x86` and `x86_64` copies of the new upstream 7-Zip payload in addition to the required ARM device payload.

Next step:

- Split the upstream 7-Zip JNI output per variant, keep all ABIs for debug/emulator workflows, and restrict release packaging to ARM device ABIs only.

## [2026-04-11 16:10 +00:00] FIX-IMPLEMENTED: Release packaging narrowed to ARM device ABIs only

What changed:

- Updated `android/app/build.gradle` so upstream 7-Zip binaries are built into variant-specific JNI directories.
- Kept `debug` and `minifiedDebug` on all four ABIs: `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`.
- Restricted `release` to `armeabi-v7a` and `arm64-v8a` only.
- Moved ABI filtering into build types so other native dependencies follow the same release packaging policy.
- Added `tests/unit/scripts/androidUpstream7zipPackaging.test.ts` to lock the release-vs-debug ABI policy.

Measured result after the fix:

- Current optimized local release APK: `8,250,729`
- Current optimized local release AAB: `9,041,015`
- Reduction vs published `0.7.3`: APK `-2,540,397`, AAB `-2,539,687`
- Reduction vs published `0.7.4`: APK `-2,567,309`, AAB `-2,567,452`
- Current packaged native payload: `2,313,515` compressed bytes across ARM64 + ARMv7 only
- Native payload reduction: `-2,550,399` compressed bytes

Remaining justified size above `0.7.2`:

- APK: `+2,326,721`
- AAB: `+2,334,792`
- This is almost entirely the required ARM upstream 7-Zip payload (`2,313,515` compressed bytes), leaving only small non-native remainder.

Next step:

- Finish validation: repository checks, Pixel 4 HVSC proof, and final documentation closure.

## [2026-04-11 16:59 +00:00] DEVICE-VALIDATION: Pixel 4 clean-state HVSC setup succeeded on optimized release build

What I ran:

- uninstalled the app from Pixel 4 serial `9B081FFAZ001WX`
- installed `android/app/build/outputs/apk/release/c64commander-0.7.4.apk`
- cleared app state with `pm clear`
- ran `maestro test .maestro/perf-hvsc-baseline.yaml ...` with long HVSC timeouts

What succeeded:

- `maestro-report.xml` reports `SUCCESS` in `224s`
- `hvsc-download` was found and tapped
- `Status: Ready` completed after `39.4s`
- `HVSC ready` became visible
- `From HVSC` opened successfully from the add-items flow
- `Open DEMOS` became visible
- `Add to playlist` completed after HVSC selection

Interpretation:

- The app reached a usable indexed HVSC library on a clean Pixel 4 install after the HVSC setup action.
- The conditional manual `Run Ingest HVSC` action was not shown in this clean-state flow, but the same session successfully opened the HVSC browser and added HVSC content to the playlist, which proves the library was already extracted and index-ready.

Artifacts:

- `test-results/maestro/apk-size-hvsc-proof-fresh-perf/maestro-report.xml`
- `test-results/maestro/apk-size-hvsc-proof-fresh-perf/2026-04-11_165421/commands-(perf-hvsc-baseline).json`

Next step:

- Wait for the full unit-coverage rerun to finish, then mark the investigation complete and update the execution plan status.

# Device Switcher V2 Worklog

## [2026-04-09 23:14 +01:00] EXEC-INIT: Execution initialized from authoritative V2 plan

What changed:

- Replaced `PLANS.md` with the Device Switcher V2 execution plan derived from `docs/research/device-switcher/v2/plan.md`.
- Preserved the authoritative phase ordering from Phase 0 through Phase 8.
- Added execution tasks, validation checkpoints, and completion gates inside each authoritative phase.
- Reset `WORKLOG.md` to track this feature execution from plan initialization forward.

Execution classification:

- `DOC_PLUS_CODE`
- `UI_CHANGE`

Next step:

- Begin Phase 0 impact mapping against the minimal implementation surfaces required by the plan.

## [2026-04-09 23:17 +01:00] PHASE-0: Impact map aligned to the existing V2-capable architecture

What I verified:

- Saved-device persistence, selection, migration, verification summaries, label helpers, mismatch handling, and bounded summary retention already exist in `src/lib/savedDevices/store.ts`.
- Picker-side switching orchestration already exists in `src/hooks/useSavedDeviceSwitching.ts` and uses `/v1/info` verification plus active-route invalidation.
- Active-route switch invalidation already excludes `c64-all-config` in `src/lib/query/c64QueryInvalidation.ts`.
- Origin-device continuity for `ultimate` playlist and disk items already exists in `src/lib/savedDevices/deviceBoundOrigin.ts`, `src/lib/playback/playbackRouter.ts`, and `src/lib/disks/diskMount.ts`.
- Settings already acts as the CRUD surface for saved devices in `src/pages/SettingsPage.tsx`.

Current V2 blockers:

- `src/components/UnifiedHealthBadge.tsx` still supports tap-only Diagnostics open; no badge long press exists.
- `src/components/diagnostics/DiagnosticsDialog.tsx` still owns a persistent `Devices` section and routes switching from there, which violates the V2 plan.
- Diagnostics currently uses long press on the device line for connection editing; that gesture pattern is local to Diagnostics and not the badge.
- `useHealthState` already resolves the badge label from the selected saved device short label, so the badge is a valid device-context anchor.

Touched runtime surfaces for implementation:

- Badge interaction and label surface: `src/components/UnifiedHealthBadge.tsx`, `src/hooks/useHealthState.ts`
- Switch state and orchestration: `src/lib/savedDevices/store.ts`, `src/hooks/useSavedDevices.ts`, `src/hooks/useSavedDeviceSwitching.ts`, `src/lib/connection/connectionManager.ts`, `src/lib/query/c64QueryInvalidation.ts`
- Diagnostics ownership cleanup: `src/components/diagnostics/DiagnosticsDialog.tsx`, `src/lib/diagnostics/diagnosticsOverlay.ts`, `src/pages/SettingsPage.tsx`
- Decision-interstitial primitives to reuse: `src/components/ui/app-surface.tsx`
- Device-bound continuity surfaces to preserve: `src/lib/savedDevices/deviceBoundOrigin.ts`, `src/lib/playback/playbackRouter.ts`, `src/lib/disks/diskMount.ts`
- Mock layers to extend in Phase 6: `tests/mocks/mockC64Server.ts`, `tests/android-emulator/helpers/mockC64Server.mjs`, `src/lib/native/mockC64u.ts`, `src/lib/native/mockC64u.web.ts`, `android/app/src/main/java/uk/gleissner/c64commander/MockC64UPlugin.kt`

Gesture and test contract:

- Supported interaction path: pointer-driven long press on the header badge using `pointerdown`/`pointerup`/`pointerleave`/`pointercancel` with a deterministic timeout and explicit click suppression after long press.
- One-device case must suppress switching affordance entirely and preserve current tap behavior.
- Unit/UI regressions can exercise long press deterministically with fake timers and pointer events; end-to-end harness coverage will be extended in Phase 6.

Phase result:

- Phase 0 exit criteria met. The implementation can proceed without speculative architecture changes.

Next step:

- Start Phase 1 and Phase 2 on the already-existing saved-device foundation by moving the switch entry point from Diagnostics to the header badge.

## [2026-04-10 00:06 +01:00] PHASE-1-4: Badge-owned switching landed and Diagnostics simplified

What changed:

- Added badge long-press detection plus a compact `Switch device` dialog in `src/components/UnifiedHealthBadge.tsx` while preserving tap-to-Diagnostics.
- Reused the existing saved-device orchestration instead of introducing a parallel switch path.
- Removed the persistent Diagnostics `Devices` section from `src/components/diagnostics/DiagnosticsDialog.tsx`.
- Moved secondary device actions into Diagnostics overflow and updated Settings copy so device management remains the CRUD source of truth.

Regression coverage added:

- `tests/unit/lib/savedDevices/store.test.ts` now locks legacy migration, idempotent reload, short-label validation, and persisted selection.
- `tests/unit/hooks/useSavedDeviceSwitching.test.tsx` now locks immediate local selection, successful verification persistence, offline failure persistence, and route invalidation on switch.
- `tests/unit/query/c64QueryInvalidation.test.ts` now locks the exclusion of `c64-all-config` from saved-device switch reloads.
- `tests/unit/components/UnifiedHealthBadge.test.tsx` and Diagnostics dialog tests now lock the V2 tap/long-press contract and the absence of the old Diagnostics switcher.

Phase result:

- Phases 1 through 4 are satisfied on the already-landed saved-device foundation without widening scope into a second switch architecture.

Next step:

- Run full validation, refresh the smallest screenshot subset, and close the docs delta.

## [2026-04-10 00:24 +01:00] PHASE-8: Validation and docs closure completed

Validation completed:

- `npm run lint` passed. Existing repository-wide ESLint warnings remain limited to generated coverage artifacts and pre-existing unused-disable directives.
- `npm run test` passed after the final test-harness fix.
- `npm run test:coverage` passed with 92.47% branch coverage.
- `npm run build` passed.
- Targeted diagnostics screenshot refresh passed via `Diagnostics screenshots targeted 2`.

Documentation and screenshot updates:

- Updated `docs/features-by-page.md` for the new badge long-press switch flow.
- Updated `docs/research/device-switcher/v2/ux-recommendations-2026-04-09.md` to point at the new picker evidence.
- Regenerated `docs/img/app/diagnostics/**` and added `docs/img/app/diagnostics/switch-device/01-picker.png`.
- Removed the obsolete `docs/img/app/diagnostics/devices/01-expanded.png` artifact.

Final result:

- Device Switcher V2 now uses the badge as the single device-context anchor: tap opens Diagnostics, long press opens the switch picker, and Diagnostics no longer owns routine switching.
