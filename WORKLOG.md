# Playback Configuration System - Execution Worklog

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
