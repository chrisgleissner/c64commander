# Playback Configuration System - Execution Plan

## Change Classification

- Classification: `DOC_PLUS_CODE`, `CODE_CHANGE`, `UI_CHANGE`
- Authoritative spec: `docs/research/config/playback-config.md`
- Goal: implement playback config end-to-end across playlist import, persistence, playback, UI, overrides, diagnostics, and disk-related surfaces without introducing unrelated churn.

## PHASE 1: Read spec and map scope

- Scope: confirm the implementation contract, classify the change, identify all affected subsystems and validation obligations.
- Files/modules expected to change: `PLANS.md`, `WORKLOG.md`, `docs/research/config/playback-config.md`, `src/pages/playFiles/**`, `src/lib/config/**`, `src/lib/playlistRepository/**`, `src/pages/DisksPage.tsx`, related tests.
- Invariants:
  - The spec remains the source of truth.
  - No behavior is weakened for convenience.
  - Validation scope is driven by actual touched layers.
- Validation steps:
  - Read the spec and relevant implementation files.
  - Confirm existing plan/worklog files are replaced with execution artifacts.
- Exit criteria:
  - Execution plan exists and reflects real repository seams.
  - Worklog is active and timestamped.

## PHASE 2: Inspect existing playback-config-related code paths

- Scope: inspect current data model, playlist hydration/persistence, import discovery, playback config application, diagnostics hooks, and current config UI affordances.
- Files/modules expected to change: `src/pages/PlayFilesPage.tsx`, `src/pages/playFiles/handlers/addFileSelections.ts`, `src/pages/playFiles/hooks/usePlaybackController.ts`, `src/pages/playFiles/hooks/usePlaybackPersistence.ts`, `src/pages/playFiles/hooks/usePlaylistListItems.tsx`, `src/pages/playFiles/components/PlaylistPanel.tsx`, `src/pages/playFiles/types.ts`, `src/lib/config/applyConfigFileReference.ts`, `src/lib/config/configFileReferenceSelection.ts`, `src/lib/playlistRepository/types.ts`, `src/pages/DisksPage.tsx`.
- Invariants:
  - Existing playback sequencing remains serialized through the machine transition queue.
  - Existing config browser and picker flows are reused where possible.
  - No config is applied during browse/import/mount flows.
- Validation steps:
  - Read the concrete modules and identify extension seams.
  - Verify whether disks reuse playlist playback or need dedicated state.
- Exit criteria:
  - Affected code paths are confirmed with concrete files/symbols.
  - Open implementation questions are reduced to code-level choices, not discovery gaps.

## PHASE 3: Implement core data model and persistence changes

- Scope: add config candidate, resolution, origin, decline, and override structures to runtime and persisted playlist data with backward-compatible hydration.
- Files/modules expected to change: `src/pages/playFiles/types.ts`, `src/lib/playlistRepository/types.ts`, `src/pages/playFiles/hooks/usePlaybackPersistence.ts`, `src/lib/playlistRepository/localStorageRepository.ts`, `src/lib/playlistRepository/indexedDbRepository.ts`, `src/lib/playlistRepository/queryIndex.ts`, `src/pages/PlayFilesPage.tsx`.
- Invariants:
  - Existing stored playlists load without data loss.
  - Manual-none is distinct from no-config-found.
  - Persisted state remains deterministic and serializable.
- Validation steps:
  - Add unit coverage for hydration/migration and repository round-trip behavior.
  - Verify legacy playlists restore with sensible defaults.
- Exit criteria:
  - Runtime types can represent all playback-config states.
  - Persistence round-trips config origin and overrides correctly.

## PHASE 4: Implement discovery and resolution behavior

- Scope: build multi-strategy discovery and deterministic resolution with ambiguity preserved instead of auto-selecting.
- Files/modules expected to change: new `src/lib/config/configDiscovery.ts`, new `src/lib/config/configResolution.ts`, `src/pages/playFiles/handlers/addFileSelections.ts`, `src/lib/config/configFileReferenceSelection.ts`, related helpers and tests.
- Invariants:
  - Manual decisions always outrank automatic discovery.
  - Only exact-name and single-directory candidates may auto-resolve.
  - Parent-directory candidates never silently auto-select.
- Validation steps:
  - Unit tests for strategy ordering, distance/confidence values, and precedence.
  - Integration tests for import-time attachment behavior across local and ultimate sources.
- Exit criteria:
  - Discovery emits candidate lists with expected metadata.
  - Resolution behavior matches the spec exactly.

## PHASE 5: Implement application pipeline changes

- Scope: extend pre-playback config handling to support resolution objects, unavailable-config handling, redundant-apply skipping, base config plus override application order, and playback-only triggering.
- Files/modules expected to change: `src/lib/config/applyConfigFileReference.ts`, new config apply helpers, `src/pages/playFiles/hooks/usePlaybackController.ts`, possibly `src/lib/c64api.ts` or config API helpers.
- Invariants:
  - Config applies only immediately before playback.
  - Base `.cfg` loads before REST overrides.
  - Redundant applies are skipped only when resolved config and overrides are identical.
- Validation steps:
  - Unit tests around apply ordering and skip logic.
  - Integration tests proving no application during import/mount/browse flows.
- Exit criteria:
  - Playback path consumes playback-config state safely.
  - Failure behavior is explicit and blocks or prompts as required.

## PHASE 6: Implement UI surfaces and interaction flows

- Scope: expose config status indicators, detail sheet, candidate chooser, manual attach/decline flows, current config visibility, and cross-surface UI parity.
- Files/modules expected to change: `src/pages/PlayFilesPage.tsx`, `src/pages/playFiles/hooks/usePlaylistListItems.tsx`, `src/pages/playFiles/components/PlaylistPanel.tsx`, new playback-config UI components under `src/pages/playFiles/components/`, `src/pages/DisksPage.tsx`, shared dialog/sheet components if needed.
- Invariants:
  - Health badge and overlay visibility contracts remain intact.
  - Decision points use modals; workflows use bottom sheets.
  - UI makes auto vs manual vs declined state explicit.
- Validation steps:
  - Component/UI tests for indicators, menus, chooser actions, and modal flows.
  - Targeted end-to-end tests for playlist and disk surfaces.
- Exit criteria:
  - Users can inspect, choose, change, or decline configs from the required surfaces.
  - Active config visibility is present during playback.

## PHASE 7: Implement editing/override behavior

- Scope: add override data model, editing UI, base-config change safeguards, and playback-time REST override application.
- Files/modules expected to change: new config override/editor helpers, `src/lib/config/applyConfigFileReference.ts`, `src/pages/PlayFilesPage.tsx`, new editor components, reuse of config browser widgets and normalizers.
- Invariants:
  - Overrides are item-scoped and deterministic.
  - Changing the base config clears overrides only with explicit confirmation.
  - Override-only mode works without a base config file.
- Validation steps:
  - Unit and component tests for override persistence and base-change confirmation.
  - Integration tests for override-only playback and base-plus-override ordering.
- Exit criteria:
  - Users can create, edit, clear, and persist overrides.
  - Playback applies overrides correctly after base config.

## PHASE 8: Integrate diagnostics and failure handling

- Scope: log discovery, resolution, apply, skip, override, unavailable, and failure events through existing diagnostics/logging surfaces and implement explicit user-safe failures.
- Files/modules expected to change: `src/lib/config/**`, `src/pages/playFiles/hooks/usePlaybackController.ts`, `src/lib/logging.ts` consumers, diagnostics-related UI hooks, relevant tests.
- Invariants:
  - No caught exception is swallowed.
  - Failures remain diagnosable with item, source, and config context.
  - User-facing errors are deterministic and actionable.
- Validation steps:
  - Tests asserting logs/error handling for unavailable configs and apply failures.
  - Manual inspection of diagnostics payloads where automated assertions are impractical.
- Exit criteria:
  - Playback-config operations are visible in diagnostics.
  - Failure handling matches the spec across primary edge cases.

## PHASE 9: Add and strengthen tests

- Scope: add regression coverage for precedence, ambiguity, persistence, playback-only triggering, unavailable files, redundant applies, UI transparency, and disk parity.
- Files/modules expected to change: unit tests under `src/lib/config/**`, hook/component tests under `src/pages/playFiles/**`, Playwright tests under `playwright/**`, possibly repository tests.
- Invariants:
  - Every bug fix or edge case addressed by implementation has focused regression coverage.
  - Tests prove behavior instead of merely covering lines.
- Validation steps:
  - Run relevant unit/integration/UI/E2E suites.
  - Run coverage and keep branch coverage at or above repository thresholds.
- Exit criteria:
  - Critical playback-config flows are covered.
  - No uncovered major spec requirement remains.

## PHASE 10: Validate end-to-end behavior and finalize

- Scope: run lint/build/test/coverage and targeted UI validation, update docs tightly coupled to shipped behavior, and bring plan/worklog to completion.
- Files/modules expected to change: `PLANS.md`, `WORKLOG.md`, relevant docs if code behavior requires user/developer documentation updates.
- Invariants:
  - Repository stays buildable.
  - Completion claims match actual command results.
  - Screenshots are regenerated only if documentation images became inaccurate.
- Validation steps:
  - `npm run lint`
  - `npm run test`
  - `npm run build`
  - `npm run test:coverage`
  - smallest honest targeted UI validation for touched surfaces
- Exit criteria:
  - All required validation passes.
  - PLANS.md phases are marked complete.
  - WORKLOG.md contains a continuous execution trace.

## Status

- Phase 1: completed
- Phase 2: completed
- Phase 3: completed
- Phase 4: completed
- Phase 5: in progress
- Phase 6: in progress
- Phase 7: pending
- Phase 8: pending
- Phase 9: in progress
- Phase 10: pending
