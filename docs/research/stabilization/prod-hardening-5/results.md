# Prod-Hardening-5 Analysis Results

## Scope

DOC_ONLY analysis-and-prompt-generation pass. No production code, tests, build
files, or prior hardening directories were modified.

## What was created

All files live under `docs/research/stabilization/prod-hardening-5/`:

- `PLANS.md` — analysis-pass plan.
- `WORKLOG.md` — chronological evidence log (read order, static scans, worktree
  state, hardware probes).
- `issue-ledger.md` — per-finding ledger for prod-hardening-1 through
  prod-hardening-4, plus the PH5 candidate cross-index.
- `feature-audit.md` — page-by-page risk audit.
- `research.md` — the main research report with executive summary, findings,
  rejected items, non-regression guarantees, and test/hardware strategy.
- `test-matrix.md` — deterministic test plan per PH5 task.
- `prompt.md` — execution-ready implementation prompt (starts with `ROLE`).
- `results.md` — this file.

## What was inspected

- All required-read documents (see WORKLOG.md "Required-read pass").
- Current source: `src/lib/deviceInteraction/deviceInteractionManager.ts`,
  `src/lib/ftp/ftpClient.ts`, `src/pages/playFiles/hooks/usePlaybackController.ts`,
  `src/pages/PlayFilesPage.tsx`, `src/hooks/useSavedDeviceSwitching.ts`,
  `src/hooks/useSavedDeviceHealthChecks.ts`, `src/hooks/useAppConfigState.ts`,
  `src/components/ConnectionController.tsx`, `src/lib/connection/connectionManager.ts`,
  `src/lib/diagnostics/healthCheckEngine.ts`, `src/lib/smoke/smokeMode.ts`,
  `src/lib/startup/fontLoading.ts`, `src/lib/playlistRepository/indexedDbRepository.ts`,
  `src/pages/playFiles/handlers/addFileSelections.ts`,
  `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts`,
  `src/pages/playFiles/playlistRepositorySync.ts`,
  `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`,
  `src/components/ConfigItemRow.tsx`, `src/pages/OpenSourceLicensesPage.tsx`,
  `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt`,
  `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt`,
  `android/app/src/main/java/uk/gleissner/c64commander/TelnetSocketPlugin.kt`.
- Test surface: `tests/unit/pages/OpenSourceLicensesPage.test.tsx` and the prior
  hardening test files referenced in WORKLOG.

## Most important findings

Four implementation tasks selected for PH5, in deterministic priority order:

1. PH5-01-CONCURRENT-WORKTREE-LANDING (Low, process). Three files are currently
   modified in the worktree from concurrent LLM work. Coordinate, run targeted
   tests, and either land or revert with a documented decision before PH5 adds
   new code.

2. PH5-04-IMPORT-CANCEL-GENERATION (Medium). Late native FTP/SAF callbacks
   delivered after a saved-device switch can mutate the active playlist or
   disk-library because `addItemsAbortControllerRef` is only aborted on user
   Cancel and no generation guard exists on the setters. Fix by either
   subscribing the import abort to a saved-device-switch event or adding a
   generation token on the setters; either approach passes the deterministic
   tests described in `test-matrix.md`.

3. PH5-05-NATIVE-LISTENER-ONCE-PROOF (Low). PH4-F3 is correct on hardware but
   lacks a deterministic add/remove counter test at the PlayFilesPage layer. Pin
   the contract.

4. PH5-06-IDB-CONSOLE-WARN-ROUTING (Low). Five raw `console.warn(...)` calls in
   `src/lib/playlistRepository/indexedDbRepository.ts` should route through
   `addLog("warn", ...)` to quiet the WebView console while preserving
   diagnostics.

All four are evidence-backed; each has a deterministic test plan and clear
non-regression guarantees.

## Hardware / mobile validation attempted

This DOC_ONLY pass only probed device availability:

- `curl http://u64/v1/info` → 200, Ultimate 64 Elite firmware 3.14e.
- `curl http://c64u/v1/info` → connection reset by peer (consistent with
  `c64u-flakiness` memory).
- `adb devices` → `9B081FFAZ001WX` (Pixel 4) attached.

No APK was deployed and no on-device validation was performed. The implementation
pass must re-probe at runtime and record exact outcomes.

## Exact blockers

- Hardware probes succeeded for `u64` and Pixel 4. `c64u` was unreachable at
  probe time; this is consistent with the documented `c64u-flakiness` and is not
  an app defect. The PH5 implementation pass should re-probe at session start.

## How to use `docs/research/stabilization/prod-hardening-5/prompt.md`

1. Read the four required-reading items at the top of `prompt.md` (including the
   analysis-pass `research.md`, `issue-ledger.md`, `feature-audit.md`, and
   `test-matrix.md`).
2. Open `PLANS.md` and `WORKLOG.md`. They already exist from this analysis pass.
   The implementation pass must append to them (do not overwrite); the analysis
   record is the basis for non-regression verification.
3. Execute tasks in the deterministic priority order:
   PH5-01 → PH5-04 → PH5-05 → PH5-06.
4. After each task, run the narrowest relevant test command, then the full
   validation suite at the end (`npm run test`, `npm run lint`, `npm run build`,
   `npm run test:coverage`).
5. Build and deploy the APK to Pixel 4 (or record the blocker).
6. Create `results.md` and `pr-desc.md` for the implementation pass.

## Remaining uncertainty

- HVSC partial browse-index transaction checkpointing remains a larger follow-up
  flagged by PH3 results.md. It is out of PH5 scope and should drive a dedicated
  hardening pass.
- The concurrent worktree edits at HEAD may belong to an in-flight LLM run; PH5
  must coordinate at landing time (PH5-01).
- `c64u` host outages will continue to block intermittent cross-device validation.
  This is a known firmware-side flakiness, not an app defect.
