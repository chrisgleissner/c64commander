# Playback Configuration System - Execution Worklog

## 2026-04-03T22:09:37Z - Follow-up status pass - Reconcile live audit evidence and note stale parity contradiction

### Action

Started the requested `DOC_ONLY` follow-up status/closure pass for the HVSC production-readiness audit by reconciling the audit register with the live worktree, current `PLANS.md`, current `WORKLOG.md`, and the landed playlist/HVSC/runtime/test changes.

### Result

- Reclassified the current pass as `DOC_ONLY` and updated `PLANS.md` to make the follow-up status document the primary deliverable.
- Extracted the full `HVSC-AUD-001` through `HVSC-AUD-014` register from the original audit and mapped each issue to current source/test evidence in the playlist repository, Play-page query windowing path, HVSC runtime, Android tests, and iOS plugin/docs.
- Confirmed a material contradiction that affects issue-status accuracy: the top-level iOS HVSC plugin comment was corrected, but the `ingestHvsc` method doc in `ios/App/App/HvscIngestionPlugin.swift` still says the JS gate routes iOS to the non-native path.
- Confirmed the follow-up must distinguish genuine closures from partial progress, especially for the playlist-scale and hardware-proof issues where meaningful implementation landed but the audit exit criteria are still unmet.

### Evidence

- Read: `docs/research/hvsc/production-readiness-audit-2026-04-03.md`
- Read: `PLANS.md`
- Read: `WORKLOG.md`
- Read: `src/lib/playlistRepository/indexedDbRepository.ts`
- Read: `src/lib/playlistRepository/localStorageRepository.ts`
- Read: `src/lib/playlistRepository/queryIndex.ts`
- Read: `src/pages/PlayFilesPage.tsx`
- Read: `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
- Read: `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts`
- Read: `src/pages/playFiles/hooks/usePlaylistListItems.tsx`
- Read: `src/pages/playFiles/handlers/addFileSelections.ts`
- Read: `src/components/lists/SelectableActionList.tsx`
- Read: `src/lib/hvsc/hvscService.ts`
- Read: `src/lib/hvsc/hvscMediaIndex.ts`
- Read: `src/lib/hvsc/hvscDownload.ts`
- Read: `src/lib/hvsc/hvscIngestionRuntime.ts`
- Read: `src/lib/hvsc/hvscIngestionRuntimeSupport.ts`
- Read: `src/lib/hvsc/hvscStatusStore.ts`
- Read: `ios/App/App/HvscIngestionPlugin.swift`
- Read: `docs/internals/ios-parity-matrix.md`
- Read: `docs/testing/physical-device-matrix.md`
- Read: `docs/plans/hvsc/automation-coverage-map.md`
- Read: `android/app/build.gradle`
- Read: `android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt`
- Read: `tests/unit/lib/playlistRepository/indexedDbRepository.test.ts`
- Read: `tests/unit/playFiles/usePlaybackPersistence.repositorySession.test.tsx`
- Read: `tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx`
- Read: `tests/unit/pages/playFiles/handlers/addFileSelectionsBatching.test.ts`
- Read: `tests/unit/hvsc/hvscDownload.test.ts`
- Read: `tests/unit/hvsc/hvscNonNativeGuard.test.ts`
- Read: `tests/unit/hvsc/hvscStatusStore.test.ts`
- Read: `tests/unit/lib/hvsc/hvscIngestionRuntimeSupport.test.ts`

### Next step

Patch the stale iOS HVSC method comment, then write the follow-up document with final status buckets, closure criteria, and the remaining implementation plan.

---

## 2026-04-03T22:09:37Z - Follow-up status pass - Publish closure register and align the remaining iOS parity comment

### Action

Completed the requested follow-up status document, fixed the remaining stale iOS HVSC method comment that would otherwise have left `HVSC-AUD-009` only partially resolved, and reconciled the final issue buckets against the written register.

### Result

- Added `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md` as the companion status/closure-plan document for the 2026-04-03 audit.
- Assigned all fourteen audit issues one of the required states and converted every non-`DONE` issue into a phased remaining-work plan plus a per-issue validation plan.
- Corrected `ios/App/App/HvscIngestionPlugin.swift` so the `ingestHvsc` method doc now matches the actual native iOS runtime path.
- Final register counts reconciled to:
  - `DONE`: 2
  - `PARTIAL`: 10
  - `TODO`: 2
  - `BLOCKED`: 0

### Evidence

- Added: `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md`
- Updated: `ios/App/App/HvscIngestionPlugin.swift`
- Updated: `PLANS.md`
- Updated: `WORKLOG.md`

### Next step

Use the new follow-up document as the execution contract for the next code-delivery slice, starting with authoritative query/hydration convergence.

---

## 2026-04-03T19:21:28Z - Phase 4/5 - Enrich HVSC interruption diagnostics and recovery metadata

### Action

Extended the HVSC status-summary path so cancellations, stale-restart recovery, and failure events retain enough archive/stage context to support deterministic retry guidance instead of opaque generic error state.

### Result

- Added archive name, ingestion ID, last-stage, and recovery-hint fields to the persisted HVSC download/extraction summary model.
- Updated progress-event folding so download/extraction summaries now retain the active archive and stage while the run is in progress and on completion/failure.
- Updated cancellation handling to persist an explicit retry hint and the affected archive name into the summary store.
- Updated stale cold-start recovery to mark both stages as interrupted with a concrete “partial progress was not promoted” recovery hint.
- Locked the new diagnostics semantics with targeted status-store and runtime-support regressions.

### Evidence

- Updated: `src/lib/hvsc/hvscStatusStore.ts`
- Updated: `src/lib/hvsc/hvscIngestionRuntimeSupport.ts`
- Updated: `tests/unit/hvsc/hvscStatusStore.test.ts`
- Updated: `tests/unit/lib/hvsc/hvscIngestionRuntimeSupport.test.ts`
- Executed: `npx vitest run tests/unit/hvsc/hvscStatusStore.test.ts tests/unit/lib/hvsc/hvscIngestionRuntimeSupport.test.ts tests/unit/hvsc/hvscDownload.test.ts tests/unit/hvsc/hvscFilesystem.test.ts`
- Executed: `npm run build`

### Next step

Keep pushing the unresolved ingestion-durability gap itself: the next material step is still staged/promotable ingest state, not just better diagnostics around the existing all-or-nothing reset path.

---

## 2026-04-03T19:15:34Z - Phase 3/4/5 - Bound playlist query windows, harden cache-marker integrity, and refresh hardware target selection

### Action

Continued the convergence pass by reducing the remaining Play-page eager playlist materialization, hardening archive cache validation, codifying the new device-selection rule in repo guidance, and rerunning focused validation with fresh `u64`/`c64u` probes.

### Result

- Added the requested plan item for hardware targeting, updated `AGENTS.md` with the general instruction to use the adb-attached Pixel 4 plus `u64`/`c64u` reachability probing, and created `.github/skills/device-connectivity/SKILL.md`.
- Refactored the Play-page query path so playlist filtering now uses a bounded repository-backed window instead of materializing the full filtered playlist into the collapsed card.
- Split preview and sheet item materialization in `SelectableActionList`, which keeps the inline playlist panel bounded even after the sheet has lazily loaded more rows.
- Added view-all lazy page growth in the shared list component via `Virtuoso.endReached`, driven by repository queries instead of a full-array remap.
- Extended the playlist query hook to expose total-match counts plus incremental `loadMoreViewAllResults()` behavior, with regression coverage proving extra pages do not rewrite repository playlist rows.
- Hardened cached archive validation by persisting expected-size metadata into HVSC cache markers and deleting stale marker/file pairs when the on-disk archive no longer matches the recorded size contract.
- Refreshed the hardware target evidence: `adb devices -l` still shows the Pixel 4, `http://u64/v1/info` succeeds, and `http://c64u/v1/info` currently fails, so `u64` is now the active preferred Ultimate target for subsequent validation.

### Evidence

- Updated: `PLANS.md`
- Updated: `AGENTS.md`
- Added: `.github/skills/device-connectivity/SKILL.md`
- Updated: `src/components/lists/SelectableActionList.tsx`
- Updated: `src/pages/playFiles/components/PlaylistPanel.tsx`
- Updated: `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts`
- Updated: `src/pages/PlayFilesPage.tsx`
- Updated: `src/lib/hvsc/hvscDownload.ts`
- Updated: `src/lib/hvsc/hvscFilesystem.ts`
- Updated: `tests/unit/components/lists/SelectableActionList.test.tsx`
- Updated: `tests/unit/pages/playFiles/PlaylistPanel.test.tsx`
- Updated: `tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx`
- Updated: `tests/unit/hvsc/hvscDownload.test.ts`
- Updated: `tests/unit/hvsc/hvscFilesystem.test.ts`
- Executed: `npx vitest run tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx tests/unit/components/lists/SelectableActionList.test.tsx tests/unit/pages/playFiles/PlaylistPanel.test.tsx tests/unit/pages/playFiles/usePlaylistListItems.test.tsx`
- Executed: `npx vitest run tests/unit/hvsc/hvscDownload.test.ts tests/unit/hvsc/hvscFilesystem.test.ts tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx tests/unit/components/lists/SelectableActionList.test.tsx tests/unit/pages/playFiles/PlaylistPanel.test.tsx tests/unit/pages/playFiles/usePlaylistListItems.test.tsx`
- Executed: `npm run build`
- Executed: `adb devices -l`
- Executed: `curl -sS --max-time 5 http://u64/v1/info`
- Executed: `curl -sS --max-time 5 http://c64u/v1/info`

### Next step

Continue with the highest-leverage unresolved audit gap: staged/recoverable ingest semantics and richer ingestion-run diagnostics, now that the playlist hot path and archive-cache contract are tighter than the audited baseline.

---

## 2026-04-03T19:02:35Z - Phase 3/4/5 - Converge batching, enforce native HVSC guardrails, and restore the Android JVM lane

### Action

Continued the implementation pass by tightening the remaining large-playlist and ingest guardrails, fixing the Android JVM test lane, and rerunning the full coverage gate from a clean coverage directory.

### Result

- Batched CommoServe archive-result imports so large archive selection sets no longer append as a single large in-memory playlist block.
- Kept the earlier recursive local/HVSC batching slice and verified both paths now flush playlist appends in bounded chunks.
- Narrowed legacy localStorage playlist restore to the active playlist key plus the default-device fallback instead of scanning unrelated device keys.
- Tightened the HVSC runtime contract so non-native full-archive ingest now throws an explicit native-plugin-required error instead of silently presenting a production fallback.
- Added an early large-archive download guard so unsupported non-native platforms fail before allocating or downloading an oversized archive.
- Restored the Android JVM unit-test lane by pinning Gradle `Test` tasks to a Java 21 launcher while leaving Android compilation on Java 17.
- Updated stale HVSC bridge guard coverage to the new native-plugin-required wording.
- Reran the full coverage suite successfully from scratch after the new slices landed.
- Coverage gate remained above the repository requirement: branch coverage `91.25%`, line coverage `94.74%`.

### Evidence

- Updated: `android/app/build.gradle`
- Updated: `src/lib/hvsc/hvscDownload.ts`
- Updated: `src/lib/hvsc/hvscIngestionRuntime.ts`
- Updated: `src/pages/playFiles/handlers/addFileSelections.ts`
- Updated: `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
- Updated: `tests/unit/lib/hvsc/hvscBridgeGuards.test.ts`
- Updated: `tests/unit/hvsc/hvscDownload.test.ts`
- Updated: `tests/unit/hvsc/hvscNonNativeGuard.test.ts`
- Updated: `tests/unit/pages/playFiles/handlers/addFileSelectionsArchive.test.ts`
- Added: `tests/unit/pages/playFiles/handlers/addFileSelectionsBatching.test.ts`
- Executed: `npx vitest run tests/unit/hvsc/hvscDownload.test.ts tests/unit/hvsc/hvscNonNativeGuard.test.ts tests/unit/hvsc/hvscIngestionRuntime.test.ts`
- Executed: `npx vitest run tests/unit/pages/playFiles/handlers/addFileSelectionsArchive.test.ts tests/unit/pages/playFiles/handlers/addFileSelectionsBatching.test.ts`
- Executed: `npx vitest run tests/unit/lib/hvsc/hvscBridgeGuards.test.ts`
- Executed: `cd android && ./gradlew :app:testDebugUnitTest --tests uk.gleissner.c64commander.AppLoggerTest`
- Executed: `cd android && ./gradlew :app:testDebugUnitTest --tests uk.gleissner.c64commander.HvscIngestionPluginTest`
- Executed: `cd android && ./gradlew test`
- Executed: `npm run test:coverage`
- Executed: `node scripts/check-coverage-threshold.mjs coverage/coverage-final.json`

### Next step

Keep the readiness report honest: the storage/session hot path, batching, Android JVM lane, and native-ingest support contract improved materially, but full production-readiness still depends on unresolved end-to-end HVSC browse/search/materialization and real in-app device-flow proof.

---

## 2026-04-03T18:24:27Z - Phase 2/3/5 - Land playlist query hot-path fixes and capture fresh validation evidence

### Action

Completed the next playlist-scale slice, reran the required repository/web validation, and attempted the mandated Android and C64 Ultimate hardware checks.

### Result

- Reworked the IndexedDB repository to persist normalized records instead of a single full-state snapshot blob.
- Split playback-session persistence from playlist-row persistence so current-track changes update repository session state without rewriting playlist rows.
- Removed the audited playlist-row `findIndex(...)` hot path by switching to an ID-to-index map.
- Extracted Play-page repository sync/query logic into `useQueryFilteredPlaylist` so category-filter changes requery without rerunning full `upsertTracks(...)` and `replacePlaylistItems(...)`.
- Added regression coverage proving:
  - current-index changes do not rewrite the repository playlist rows
  - playlist filter changes requery without rewriting the repository dataset
- Corrected stale iOS HVSC parity comments/docs to match the active native plugin reality.
- `npm run build`, `npm run test`, and `npm run test:coverage` all passed after the changes.
- Coverage gate satisfied the repository requirement: branch coverage `91.31%`, line coverage `94.77%`.
- `npm run lint` passed, but still reported existing warnings from generated coverage artifact folders rather than source-file problems.
- `adb devices -l` now shows the attached Pixel 4, so the earlier ADB blocker is resolved.
- `./gradlew test` still fails in the existing Android JVM/Robolectric lane with broad `NoClassDefFoundError` / `ClassReader` failures before reaching stable HVSC-native convergence, so `HVSC-AUD-004` remains open.
- Built, synced, installed, and cold-launched the app on the attached Pixel 4 successfully.
- The launched Android app reached the network path and issued live `http://c64u/v1/info` requests from the device.
- The real Commodore 64 Ultimate remained reachable and accepted a direct SID playback request via `POST /v1/runners:sidplay` using the local `demo.sid` fixture.

### Evidence

- Added: `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts`
- Added: `tests/unit/playFiles/usePlaybackPersistence.repositorySession.test.tsx`
- Added: `tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx`
- Updated: `src/lib/playlistRepository/indexedDbRepository.ts`
- Updated: `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
- Updated: `src/pages/playFiles/hooks/usePlaylistListItems.tsx`
- Updated: `src/pages/PlayFilesPage.tsx`
- Updated: `tests/unit/lib/playlistRepository/indexedDbRepository.test.ts`
- Updated: `ios/App/App/HvscIngestionPlugin.swift`
- Updated: `docs/internals/ios-parity-matrix.md`
- Executed: `npx vitest run tests/unit/lib/playlistRepository/indexedDbRepository.test.ts tests/unit/playFiles/usePlaybackPersistence.test.tsx tests/unit/playFiles/usePlaybackPersistence.ext2.test.tsx tests/unit/pages/playFiles/usePlaylistListItems.test.tsx`
- Executed: `npx vitest run tests/unit/playFiles/usePlaybackPersistence.repositorySession.test.tsx`
- Executed: `npx vitest run tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx`
- Executed: `npm run build`
- Executed: `npm run lint`
- Executed: `npm run test`
- Executed: `npm run test:coverage`
- Executed: `node scripts/check-coverage-threshold.mjs coverage/coverage-final.json`
- Executed: `adb devices -l`
- Executed: `./gradlew test`
- Executed: `npm run cap:build`
- Executed: `./gradlew installDebug`
- Executed: `adb shell am start -W -n uk.gleissner.c64commander/.MainActivity`
- Executed: `adb logcat -d -t 200 | rg -n "uk\\.gleissner\\.c64commander|Capacitor|C64 Commander|AndroidRuntime|System\\.err|System\\.out|chromium"`
- Executed: `curl -sS --max-time 5 http://c64u/v1/info`
- Executed: `curl -sS --max-time 10 -F "file=@tests/fixtures/local-source-assets/demo.sid" http://c64u/v1/runners:sidplay`

### Next step

Close out this pass with an honest readiness summary: highlight the storage/persistence/query improvements that landed, note that the Android native test lane still needs separate repair, and avoid overstating the still-open full-HVSC-query and full-UI-scale convergence work.

---

## 2026-04-03T18:04:53Z - Phase 1/2 - Convert audit artifacts into an implementation plan and choose the first convergence slice

### Action

Read the repository guidance, the completed HVSC audit, the current planning artifacts, and the playlist/HVSC runtime modules to turn the stale research-only plan into a live implementation plan.

### Result

- Reclassified the task as `DOC_PLUS_CODE`, `CODE_CHANGE`, and `UI_CHANGE`.
- Replaced the completed audit-oriented `PLANS.md` with an implementation plan keyed to the audited issue IDs.
- Confirmed the first converging slice is the playlist repository and playback-persistence hot path because that removes the full-dataset rewrite on ordinary playback state changes and unlocks later UI work.
- Confirmed `PLANS.md` and `WORKLOG.md` already had local edits and preserved them by building on top of the current files instead of discarding history.

### Evidence

- Read: `README.md`
- Read: `.github/copilot-instructions.md`
- Read: `AGENTS.md`
- Read: `docs/research/hvsc/production-readiness-audit-2026-04-03.md`
- Read: `docs/ux-guidelines.md`
- Read: `PLANS.md`
- Read: `WORKLOG.md`
- Read: `src/lib/playlistRepository/**`
- Read: `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
- Read: `src/pages/playFiles/hooks/usePlaylistListItems.tsx`
- Read: `src/pages/PlayFilesPage.tsx`
- Read: `src/lib/hvsc/**`
- Read: `src/lib/sourceNavigation/hvscSourceAdapter.ts`
- Timestamp source: `date -u +"%Y-%m-%dT%H:%M:%SZ"`

### Next step

Patch the IndexedDB repository to use incremental normalized records, then split playlist persistence from session persistence and add regressions around the rewritten hot path.

---

## 2026-04-03T16:21:36Z - Phase 1 - Re-establish audit artifacts for HVSC production-readiness research

### Action

Reclassified the current task as a documentation-only research audit and replaced the prior implementation plan with an HVSC production-readiness audit plan for this task.

### Result

- Confirmed the task scope is research and evidence gathering, not feature delivery.
- Replaced `PLANS.md` with a phase-based audit plan covering architecture mapping, test inventory, static review, executed validation, gap analysis, and research-document production.
- Preserved `WORKLOG.md` as append-only and started a new timestamped audit section.

### Evidence

- Read: `README.md`
- Read: `.github/copilot-instructions.md`
- Read: `AGENTS.md`
- Timestamp source: `date -u +"%Y-%m-%dT%H:%M:%SZ"`

### Next step

Begin reconnaissance by mapping the HVSC-related code paths, native bridges, tests, and platform-specific files.

---

## 2026-03-31T12:43:48Z - Phase 1 - Replace research plan with execution plan

### Action

Reclassified the task as a live implementation effort and replaced the stale research-oriented planning artifacts with execution-tracking documents.

### Result

- Confirmed this is a `DOC_PLUS_CODE`, `CODE_CHANGE`, `UI_CHANGE` task.
- Established the 10 required implementation phases from the task directive.
- Converted PLANS.md into an execution plan keyed to concrete modules.

### Evidence

- Authoritative spec: `docs/research/config/playback-config.md`
- Timestamp source: `date -u +"%Y-%m-%dT%H:%M:%SZ"`

### Next step

Continue Phase 1 and Phase 2 by reading the exact runtime, persistence, import, playback, and UI modules that currently handle config references.

---

## 2026-04-03T16:25:40Z - Phase 2/5 - Map HVSC architecture and probe real-device availability

### Action

Inspected the active HVSC runtime, native bridge, playlist, and UI paths, then attempted immediate real-device discovery for the attached Pixel 4 and reachable C64 Ultimate.

### Result

- Verified the Android native plugin streams `.7z` or `.zip` entries directly into `hvsc/library` and batches metadata writes into `hvsc_metadata.db`.
- Verified the TypeScript runtime selects the native ingestion path whenever the `HvscIngestion` plugin is available, with non-native fallback only after native probe failure.
- Verified iOS now has a native `HvscIngestionPlugin` registered in `AppDelegate`, contradicting the stale parity doc that says HVSC has no native iOS code.
- Verified the playlist UI uses `react-virtuoso` only in the full-sheet “View all” flow; the preview list and several filtering/build steps still operate on full in-memory arrays.
- Attempted ADB connectivity twice; no Android device was visible to `adb devices -l`, so Pixel 4 validation is currently blocked by the environment.
- Verified the hostname `c64u` resolves and responds to ICMP (`192.168.1.167`), so the Commodore 64 Ultimate is at least network-reachable from this machine.

### Evidence

- Read: `src/lib/hvsc/hvscIngestionRuntime.ts`
- Read: `src/lib/hvsc/hvscDownload.ts`
- Read: `src/lib/hvsc/hvscArchiveExtraction.ts`
- Read: `src/lib/hvsc/hvscService.ts`
- Read: `src/lib/hvsc/hvscFilesystem.ts`
- Read: `src/lib/hvsc/hvscMediaIndex.ts`
- Read: `src/lib/hvsc/hvscStatusStore.ts`
- Read: `src/pages/PlayFilesPage.tsx`
- Read: `src/pages/playFiles/hooks/useHvscLibrary.ts`
- Read: `src/pages/playFiles/hooks/usePlaylistListItems.tsx`
- Read: `src/components/lists/SelectableActionList.tsx`
- Read: `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt`
- Read: `ios/App/App/HvscIngestionPlugin.swift`
- Read: `ios/App/App/AppDelegate.swift`
- Executed: `adb start-server`
- Executed: `adb devices -l`
- Executed: `ping -c 1 -W 2 c64u`
- Executed: `getent hosts c64u`

### Next step

Inventory the existing HVSC, playlist, and native-plugin tests, then run the most relevant suites and additional hardware-access probes.

---

## 2026-03-31T12:43:48Z - Phase 2 - Inspect current config and playlist seams

### Action

Read the existing playback-config-adjacent code paths covering runtime playlist types, playback-time config application, config reference selection, and repository persistence.

### Result

- Verified the runtime model currently stores only `configRef` with no origin, candidate list, or overrides.
- Verified playback applies `configRef` unconditionally in `usePlaybackController` immediately before `executePlayPlan`.
- Verified local and ultimate config references are currently the only persisted config state.
- Verified repository persistence stores `configRef` on `TrackRecord` and restores it during hydration.

### Evidence

- Read: `src/pages/playFiles/types.ts`
- Read: `src/pages/playFiles/hooks/usePlaybackController.ts`
- Read: `src/lib/config/applyConfigFileReference.ts`
- Read: `src/lib/config/configFileReferenceSelection.ts`
- Read: `src/lib/playlistRepository/types.ts`

### Next step

Inspect import handlers, hydration logic, and playlist UI to identify where discovery, resolution, and transparency state should be introduced.

---

## 2026-03-31T12:52:16Z - Phase 2 - Confirm import, hydration, playlist UI, disk, and config editor seams

### Action

Inspected the current add/import handler, playlist hydration and repository mapping, row rendering, Play page config picker UI, disk library models, and config browser/editor components.

### Result

- Confirmed sibling exact-name matching currently happens only inside `addFileSelections.ts`.
- Confirmed playlist repository query rows do not need config fields, but playlist-item records do.
- Confirmed disk collection state is stored separately in `useDiskLibrary` and currently has no config metadata.
- Confirmed `ConfigItemRow`, `useC64UpdateConfigBatch`, and the config browser page provide reusable value-editing primitives for overrides.

### Evidence

- Read: `src/pages/playFiles/handlers/addFileSelections.ts`
- Read: `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
- Read: `src/pages/playFiles/hooks/usePlaylistListItems.tsx`
- Read: `src/pages/PlayFilesPage.tsx`
- Read: `src/components/disks/HomeDiskManager.tsx`
- Read: `src/hooks/useDiskLibrary.ts`
- Read: `src/pages/ConfigBrowserPage.tsx`
- Read: `src/components/ConfigItemRow.tsx`

### Next step

Implement the core playback-config data model and discovery/resolution helpers, then move config persistence to playlist-item records.

---

## 2026-03-31T12:52:16Z - Phase 3/4 - Introduce playback-config core state and import-time discovery

### Action

Added the playback-config domain types and helper modules, updated playlist runtime and persistence types to carry config origin and overrides, and replaced import-time sibling-only resolution with explicit discovery plus deterministic resolution.

### Result

- Added `playbackConfig.ts` for candidate, origin, override, preview, UI-state, and signature helpers.
- Added `configResolution.ts` for deterministic precedence handling.
- Added `configDiscovery.ts` for exact-name, same-directory, and parent-directory candidate discovery.
- Updated playlist persistence so config state now lives on `PlaylistItemRecord` rather than only `TrackRecord`.
- Updated playlist hydration to restore config origin/overrides and default legacy attached configs to manual origin for stability.
- Updated Play page manual attach/remove flows to record explicit manual and manual-none origins.

### Evidence

- Added: `src/lib/config/playbackConfig.ts`
- Added: `src/lib/config/configResolution.ts`
- Added: `src/lib/config/configDiscovery.ts`
- Updated: `src/pages/playFiles/types.ts`
- Updated: `src/lib/playlistRepository/types.ts`
- Updated: `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
- Updated: `src/pages/PlayFilesPage.tsx`
- Updated: `src/pages/playFiles/handlers/addFileSelections.ts`
- Validation: editor diagnostics reported no file-level errors in the touched files after patching.

### Next step

Extend the playback pipeline to honor playback-config origins and overrides, then expose the new state in the playlist and disk UI.

---

## 2026-03-31T13:21:33Z - Phase 5 - Move playback-config application into the launch boundary

### Action

Extended the playback pipeline so playback-config application is part of the launch contract rather than an early side effect, and added regression coverage for disk ordering.

### Result

- Added accessibility checks for referenced configs before launch.
- Extended config application to support base `.cfg` plus REST override batches in one path.
- Added signature-based redundant-apply skipping and config-specific handled errors.
- Moved playback-config execution into `executePlayPlan(..., { beforeLaunch })` so disk playback applies config after reset/reboot and mount preparation rather than before a machine reset.
- Added a playback-time notification when config application begins.
- Added unit regression coverage proving `beforeLaunch` runs after disk reboot and mount but before autostart.

### Evidence

- Updated: `src/lib/config/applyConfigFileReference.ts`
- Updated: `src/pages/playFiles/hooks/usePlaybackController.ts`
- Updated: `src/lib/playback/playbackRouter.ts`
- Updated: `tests/unit/playFiles/usePlaybackController.test.tsx`
- Updated: `tests/unit/playFiles/usePlaybackController.concurrency.test.tsx`
- Updated: `tests/unit/lib/playback/playbackRouter.test.ts`
- Validation: targeted unit tests passed for the playback controller and playback router files.

### Next step

Expose playback-config resolution and candidate state on the Play page so users can inspect and change the resolved config instead of relying on hidden playlist metadata.

---

## 2026-03-31T13:21:33Z - Phase 6 - Add Play page playback-config transparency

### Action

Added playlist-row playback-config state indicators and a bottom-sheet workflow for reviewing resolved config state, candidate lists, and manual actions.

### Result

- Added a `PlaybackConfigSheet` bottom sheet with current state, origin, candidate list, and actions.
- Exposed playback-config status in playlist row metadata and action menu.
- Added row-level config badges for resolved, edited, candidate, and declined states.
- Added on-demand re-discovery for local and C64U playlist items.
- Added candidate-to-manual selection from the sheet.

### Evidence

- Added: `src/pages/playFiles/components/PlaybackConfigSheet.tsx`
- Updated: `src/pages/playFiles/hooks/usePlaylistListItems.tsx`
- Updated: `src/pages/PlayFilesPage.tsx`
- Validation: editor diagnostics reported no file-level errors in the touched UI files.

### Next step

Implement item-scoped override editing and the remaining failure-handling flows, then carry playback-config parity into disk collection surfaces.

---

## 2026-04-03T16:34:35Z - Phase 5 - Executed validation and hardware probes

### Action

Ran targeted HVSC validation across JS, browser, Android-native, ADB, and real C64 Ultimate endpoints.

### Result

- `npx vitest run tests/unit/hvsc tests/unit/lib/hvsc tests/unit/lib/playlistRepository/indexedDbRepository.test.ts tests/unit/lib/playlistRepository/localStorageRepository.test.ts tests/unit/playFiles/useHvscLibrary.test.tsx tests/unit/playFiles/useHvscLibrary.progress.test.tsx tests/unit/playFiles/useHvscLibrary.edges.test.tsx tests/unit/pages/playFiles/usePlaylistListItems.test.tsx tests/unit/pages/playFiles/handlers/addFileSelectionsArchive.test.ts` passed: 36 files, 568 tests.
- The Vitest run emitted repeated React `act(...)` warnings from `useHvscLibrary` edge tests; assertions still passed, but the warnings reduce trust in those tests as precise UI-behavior proof.
- `npx playwright test playwright/hvsc.spec.ts --reporter=line` passed: 17 HVSC Play page scenarios in a mocked/browser-safe path.
- `./gradlew :app:testDebugUnitTest --tests 'uk.gleissner.c64commander.HvscSevenZipRuntimeTest'` passed.
- `./gradlew :app:testDebugUnitTest --tests 'uk.gleissner.c64commander.HvscIngestionPluginTest' --tests 'uk.gleissner.c64commander.HvscSevenZipRuntimeTest'` failed in `HvscIngestionPluginTest` with `NoClassDefFoundError: android/webkit/RoboCookieManager` in Robolectric-generated test reports, while the pure SevenZip runtime test remained green.
- `adb version && adb devices -l` showed no attached Android devices, so Pixel 4 validation could not proceed.
- Real C64 Ultimate reachability was confirmed:
  - `ping -c 1 -W 2 c64u`
  - `curl -sS --max-time 5 http://c64u/v1/info`
  - `curl -sS --max-time 5 ftp://c64u/ --user :`
- Direct hardware playback probes succeeded at the API level:
  - `curl -sS --max-time 15 -D - -o /tmp/c64u-sidplay-response.txt -F file=@tests/fixtures/local-source-assets/demo.sid http://c64u/v1/runners:sidplay`
  - `curl -sS --max-time 5 ftp://c64u/Temp/ --user :` showed `demo.sid` in `/Temp`.
  - `curl -sS --max-time 10 -X PUT 'http://c64u/v1/runners:sidplay?file=%2FTemp%2Fdemo.sid'` returned an empty `errors` array.

### Evidence

- `java -version` => Corretto OpenJDK `25.0.1`.
- Android test report grep under `android/app/build/reports/tests/testDebugUnitTest/` showed repeated `NoClassDefFoundError: android/webkit/RoboCookieManager` and ASM `ClassReader` failures for `HvscIngestionPluginTest`.
- `adb devices -l` output was empty after the header line.
- `curl http://c64u/v1/info` returned product `C64 Ultimate`, firmware `1.1.0`, hostname `c64u`, unique id `5D4E12`.
- `curl ftp://c64u/Temp/ --user :` listed `demo.sid` after the upload probe.

### Next step

Convert the executed evidence and source findings into the final production-readiness audit document and update the task plan to match completed phases.

---

## 2026-04-03T16:34:35Z - Phase 6/7 - Audit artifact production

### Action

Produced the implementation-ready HVSC production-readiness audit and updated the task plan to reflect completed phases.

### Result

- Added the primary research document at `docs/research/hvsc/production-readiness-audit-2026-04-03.md`.
- Updated `PLANS.md` status to completed for phases 1 through 7.
- The audit document captures verified strengths, unverified areas, platform divergences, the issue register, recommended fixes, and exact validation commands.

### Evidence

- Added: `docs/research/hvsc/production-readiness-audit-2026-04-03.md`
- Updated: `PLANS.md`

### Next step

Use the audit document as the execution blueprint for the follow-up implementation and real-device convergence pass.

---

## 2026-04-03T17:11:14Z - Follow-up doc extension - playlist scalability review

### Action

Performed a deeper source audit of the playlist state, persistence, repository, query, and rendering paths to extend the HVSC production-readiness document specifically for 100k-entry mobile-scale playlists.

### Result

- Extended `docs/research/hvsc/production-readiness-audit-2026-04-03.md` with:
  - stronger executive-summary blockers for playlist persistence and snapshot repositories
  - additional findings under playlist model, persistence/storage adapters, lazy materialization, and filtering/lookup
  - two new high-severity issues covering full-dataset persistence rewrites and snapshot repository/query-index design
  - updated implementation-order and release-test recommendations for cursor/windowed access and incremental persistence

### Evidence

- Source inspection:
  - `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
  - `src/pages/playFiles/hooks/usePlaylistManager.ts`
  - `src/pages/PlayFilesPage.tsx`
  - `src/pages/playFiles/hooks/usePlaylistListItems.tsx`
  - `src/components/lists/SelectableActionList.tsx`
  - `src/lib/playlistRepository/indexedDbRepository.ts`
  - `src/lib/playlistRepository/localStorageRepository.ts`
  - `src/lib/playlistRepository/queryIndex.ts`
  - `src/lib/playlistRepository/factory.ts`
  - `src/lib/playlistRepository/types.ts`
- Test inventory cross-checks:
  - `playwright/playback.spec.ts`
  - `playwright/ui.spec.ts`
  - `tests/unit/playFiles/usePlaybackPersistence.test.tsx`

### Next step

Use the updated research document as the implementation planning baseline for replacing snapshot playlist persistence with a normalized, cursor-backed large-playlist path.

---

## 2026-04-03T17:49:44Z - Follow-up doc clarification - Web production scope and target envelope

### Action

Applied a user-provided clarification to the HVSC audit: Web is a required production path for full HVSC ingest and playback, and all platform recommendations should assume a maximum runtime envelope of `512 MiB RAM` and `2 CPU cores @ 2 GHz`.

### Result

- Updated the primary research document to:
  - state the shared production/runtime envelope in the executive summary and scope/method sections
  - remove the prior open question about whether Web support is required
  - tighten the Web findings and `HVSC-AUD-007` remediation guidance to treat browser-scale ingest as a launch requirement
  - add explicit memory and CPU/performance gate wording based on the shared `512 MiB` / `2-core @ 2 GHz` budget

### Evidence

- User clarification in task thread:
  - Web must support full HVSC ingest and playback, just as iOS and Android.
  - Assume max `512 MiB RAM` and `2 cores @ 2 GHz` for all environments.
- Updated:
  - `docs/research/hvsc/production-readiness-audit-2026-04-03.md`

### Next step

Use the clarified document as the implementation baseline for a cross-platform large-HVSC design that is explicitly viable on Web within the shared resource budget.

---

## 2026-04-03T17:49:44Z - Follow-up doc creation - implementation execution prompt

### Action

Authored a companion implementation prompt that turns the HVSC production-readiness audit into a concrete execution brief for a follow-up code-delivery pass.

### Result

- Added `docs/research/hvsc/implementation-execution-prompt-2026-04-03.md`.
- The prompt is anchored to the audit issue IDs, requires `PLANS.md` and `WORKLOG.md` discipline, and defines a multi-phase convergence workflow for storage/query redesign, ingest durability, playlist scaling, Web parity, and real-device validation.

### Evidence

- Added:
  - `docs/research/hvsc/implementation-execution-prompt-2026-04-03.md`

### Next step

Use the implementation prompt as the handoff artifact for the follow-up execution pass that must close the audit findings in code.
