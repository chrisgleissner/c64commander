# PLANS.md - Authoritative Execution Plan

## Phase 0: Coverage and Code Hygiene (BLOCKING)

### 0.1 Unit Test Coverage > 85%
- [x] playwright/traceComparison.js (Current: 86.14%)
- [x] src/components/disks/HomeDiskManager.tsx (Current: 90.26%)
- [x] src/lib/uiErrors.ts (Current: 100%)
- [x] src/lib/hvsc/hvscArchiveExtraction.ts (Current: 93.91%)
- [x] src/lib/hvsc/hvscFilesystem.ts (Current: 85.86%)
- [ ] src/lib/hvsc/hvscIngestionRuntime.ts (Current: 80.16%)
- [x] src/lib/hvsc/hvscReleaseService.ts (Current: 96.42%)
- [x] src/lib/native/folderPicker.ts (Current: 100%)
- [x] src/lib/native/platform.ts (Current: 100%)
- [x] src/lib/native/playbackClock.ts (Current: 100%)
- [x] src/lib/tracing/traceExport.ts (Current: 100%)
- [x] src/lib/tracing/traceFormatter.ts (Current: 100%)
- [x] src/lib/tracing/traceIds.ts (Current: 100%)
- [x] src/lib/tracing/traceSession.ts (Current: 93%)

### 0.2 Exception Handling Rule
- [x] Audit code during coverage uplift for silent catches
- [x] Fix identified silent catches
- [x] Add exception handling rule to `AGENTS.md`

## Phase 1: Android Build Stabilization (BLOCKING)

### 1.1 Android Compilation
- [ ] Fix `FolderPickerPlugin.kt` compilation errors

### 1.2 Android Coverage Artifacts
- [ ] Ensure `android/app/build/reports` and JaCoCo XML are generated
- [ ] Verify `verify-coverage-artifacts.mjs` passes

## Phase 2: Playwright Failures

### 2.1 Product Regressions
- [ ] Restore Playback failure UX
- [ ] Fix Missing REST calls (`/v1/runners:sidplay`, `/v1/configs`)
- [ ] Fix Playlist persistence across navigation
- [ ] Fix SID volume and mute semantics
- [ ] Fix Enabled vs disabled SID routing

### 2.2 Intentional UX Changes
- [ ] Update Playwright tests for Settings page canonical order

## Phase 3: Maestro (Conditional Gate)

- [ ] Attempt Maestro in CI
- [ ] If blocked, gate behind CI condition with justification

## Final
- [ ] CI is fully green
