# Display Profiles Audit Plan

Classification: `DOC_ONLY`

Scope: rigorous UX and frontend architecture audit of the current display-profile system, with evidence limited to repository documentation, source code, tests, and screenshot infrastructure.

## Progress

- Status: In progress
- Status: Complete
- Started: 2026-03-15
- Convergence pass 1: complete
- Convergence pass 2: complete

## Phases And Tasks

### Phase 1 - Control Documents

- [x] Read `doc/display-profiles.md`.
- [x] Read `doc/ux-guidelines.md`.
- [x] Read `doc/ux-interactions.md`.
- [x] Read `doc/architecture.md`.
- [x] Review prior display-profile planning and review artifacts for implemented-vs-planned boundary.
- [x] Initialize `doc/research/review-9/worklog.md`.
- [x] Initialize `doc/research/review-9/display-profiles-review.md`.

### Phase 2 - Implementation Inventory

- [x] Inspect display-profile definitions and tokens.
- [x] Inspect profile selection, override persistence, and root token application.
- [x] Inspect modal presentation policy.
- [x] Inspect page-shell and shared layout containers.
- [x] Inspect remaining viewport-responsive helpers that may bypass profile context.

### Phase 3 - Surface Audit

- [x] Audit Home surfaces for compact usability and medium/expanded stability.
- [x] Audit Play surfaces for list density, CTA reachability, and scroll behavior.
- [x] Audit Disks surfaces for drive controls, list density, and overflow handling.
- [x] Audit Config surfaces for typography, row wrapping, inline editors, and touch targets.
- [x] Audit Settings surfaces for override UX and compact dialog behavior.

### Phase 4 - Shared Component Audit

- [x] Audit `SelectableActionList`.
- [x] Audit `ItemSelectionDialog`.
- [x] Audit `QuickActionCard`.
- [x] Audit `ConfigItemRow`.
- [x] Audit dialog primitives and presentation wrappers.
- [x] Audit page headers, app shell, and action clusters.

### Phase 5 - Verification Audit

- [x] Inspect unit tests for resolver, provider, and modal policy.
- [x] Inspect Playwright coverage for compact, medium, expanded, overflow, and CTA reachability.
- [x] Inspect screenshot generation and profile-specific visual evidence.
- [x] Check documentation-to-implementation consistency.
- [x] Record regression-risk assessment for medium and expanded profiles.

### Phase 6 - Convergence

- [x] Verification pass 1: confirm every implementation file in scope was inspected.
- [x] Verification pass 2: confirm every required documentation file and validation file was inspected.
- [x] Finalize findings, severity, evidence, remediation, and follow-up tasks.
- [x] Mark all plan tasks complete.

## Files To Inspect

### Required Documentation

- `doc/display-profiles.md`
- `doc/ux-guidelines.md`
- `doc/ux-interactions.md`
- `doc/architecture.md`
- `doc/plans/display-profiles/display-profiles-gap-analysis.md`
- `doc/plans/display-profiles/display-profiles-implementation-plan.md`
- `doc/plans/display-profiles/work-log.md`

### Core Implementation

- `src/lib/displayProfiles.ts`
- `src/hooks/useDisplayProfile.tsx`
- `src/lib/uiPreferences.ts`
- `src/lib/modalPresentation.ts`
- `src/App.tsx`
- `src/index.css`

### Profile-Aware Surfaces And Shared Components

- `src/components/layout/PageContainer.tsx`
- `src/components/SelectableActionList.tsx`
- `src/components/itemSelection/ItemSelectionDialog.tsx`
- `src/components/QuickActionCard.tsx`
- `src/components/ConfigItemRow.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/alert-dialog.tsx`
- `src/components/AppBar.tsx`
- `src/components/DriveManager.tsx`
- `src/pages/home/components/DriveManager.tsx`
- `src/pages/home/components/StreamStatus.tsx`
- `src/pages/home/dialogs/SnapshotManagerDialog.tsx`

### Routed Pages

- `src/pages/HomePage.tsx`
- `src/pages/PlayFilesPage.tsx`
- `src/pages/DisksPage.tsx`
- `src/pages/ConfigBrowserPage.tsx`
- `src/pages/SettingsPage.tsx`

### Responsive Debt / Alternate Heuristics

- `src/components/ui/sidebar.tsx`
- any file using `ResizeObserver`, width measurement, or ad hoc viewport checks on audited surfaces

### Tests And Visual Validation

- `src/lib/displayProfiles.test.ts`
- `src/hooks/useDisplayProfile.test.tsx`
- `src/lib/modalPresentation.test.ts`
- `playwright/displayProfileViewports.ts`
- `playwright/displayProfiles.spec.ts`
- relevant viewport/overflow Playwright specs touching audited surfaces
- screenshot assets under `doc/img/` that are profile-specific

## Verification Passes

### Pass 1 Checklist

- [x] Every profile-definition and profile-consumer file reviewed.
- [x] Every major routed surface reviewed.
- [x] Every shared component named in `doc/display-profiles.md` reviewed.

### Pass 2 Checklist

- [x] Required docs rechecked against implementation evidence.
- [x] Test and screenshot evidence rechecked against findings.
- [x] No additional uncited issues remain in mapped scope.

## Open Questions

- None.

## Progress Log

- 2026-03-15: Established `DOC_ONLY` audit classification, reviewed the mandatory display-profile and UX source-of-truth documents, and mapped the initial implementation surface for display-profile resolution, profile-aware layouts, and validation files.
- 2026-03-15: Completed the implementation inventory across `src/lib/displayProfiles.ts`, `src/hooks/useDisplayProfile.tsx`, `src/lib/modalPresentation.ts`, `src/index.css`, shared layout containers, routed page shells, and key profile-sensitive components.
- 2026-03-15: Completed the first validation inventory across resolver/provider/modal unit tests, `playwright/displayProfiles.spec.ts`, `playwright/screenshots.spec.ts`, and the generated `doc/img/app/**/profiles/` screenshot tree.
- 2026-03-15: Rechecked README and source-of-truth docs against the current implementation, finalized the audit report, and completed both required convergence passes.
