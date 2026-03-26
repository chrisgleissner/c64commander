# Online Archive Multi-Source Integration Plan

Status: IN PROGRESS
Date: 2026-03-25
Classification: UI_CHANGE + CODE_CHANGE

## Completed Prior Phases (1-16)

Phases 1-16 delivered: archive abstraction model, configuration system, generic client + subclasses,
HTTP implementation, query builder, file execution pipeline, hook integration, settings UI,
platform configuration, state machine + error handling, mock infrastructure, testing, diagnostics,
screenshots, and final validation. See git history for details.

## Phase 17 - Multi-Source Interstitial + Online Archive Import

### Task 17.1 - Extend source types
- Status: TODO
- Add "commoserve" and "assembly64" to SourceLocationType
- Add labels/explanations to sourceTerms.ts
- Files: src/lib/sourceNavigation/types.ts, src/lib/sourceNavigation/sourceTerms.ts

### Task 17.2 - Extend FileOriginIcon
- Status: TODO
- Support "commoserve" and "assembly64" origins with appropriate icons
- File: src/components/FileOriginIcon.tsx

### Task 17.3 - Update settings for dual source enablement
- Status: TODO
- Replace mutually-exclusive archive backend dropdown with dual toggles
- Use existing commoserveEnabled / assembly64Enabled flags from appSettings.ts
- Files: src/pages/SettingsPage.tsx

### Task 17.4 - Create archive source adapter
- Status: TODO
- Create SourceLocation adapter for archive backends (CommoServe + Assembly64)
- Must implement listEntries/listFilesRecursive matching SourceLocation contract
- File: src/lib/sourceNavigation/archiveSourceAdapter.ts

### Task 17.5 - Update ItemSelectionDialog interstitial
- Status: TODO
- Add CommoServe and Assembly64 buttons below HVSC
- Conditional on enabled state from app settings
- File: src/components/itemSelection/ItemSelectionDialog.tsx

### Task 17.6 - Wire archive sources into PlayFilesPage
- Status: TODO
- Build archive source locations from settings and add to sourceGroups
- Files: src/pages/PlayFilesPage.tsx, src/pages/home/components/DriveManager.tsx

### Task 17.7 - Adapt Online Archive as import source
- Status: TODO
- Ensure archive browser works within ItemSelectionDialog flow
- Single shared component for both backends
- Files: src/components/archive/OnlineArchiveDialog.tsx (or adapt ItemSelectionView)

### Task 17.8 - Add/update tests
- Status: TODO
- Tests for dual source enablement, interstitial rendering, archive source adapter
- Coverage ≥ 91%
- Files: tests/unit/**

### Task 17.9 - Lint, build, coverage validation
- Status: TODO
- npm run lint && npm run test:coverage && npm run build

### Task 17.10 - Regenerate screenshots
- Status: TODO
- Only affected screenshots: interstitial with online sources visible

### Dependencies
- 17.1 → 17.2, 17.4, 17.5
- 17.3 → 17.6
- 17.4 → 17.6, 17.7
- 17.5 → 17.6
- 17.6, 17.7 → 17.8
- 17.8 → 17.9 → 17.10

### Risks
- Archive search is async and network-dependent; source adapter must handle errors gracefully
- ItemSelectionDialog expects directory-based browsing; archive search is query-based (different paradigm)
- Screenshots require demo mode to show all sources

### Screenshot Impact
- play/import/01-import-interstitial.png (new sources visible)
- Potential new screenshots for archive search/results flow

- Produced artifacts: WORKLOG.md final entries, validation evidence
