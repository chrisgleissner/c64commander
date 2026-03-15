# Surface System Execution Plan

Classification: `UI_CHANGE`

## Task List

### Phase 1 - Planning

- [x] Design AppSheet architecture.
- [x] Design AppDialog architecture.
- [x] Identify all dialogs and sheets to migrate.
- [x] Design responsive surface selection rules.
- [x] Define screenshot regeneration scope using the existing `doc/img/` hierarchy.
- [x] Define CI and local verification scope.
- [x] Create a risk register.

### Phase 2 - Core Architecture

- [x] Implement reusable `AppSheet` component.
- [x] Implement reusable `AppDialog` component.
- [x] Verify rendering rules across Compact, Medium, and Expanded profiles.

### Phase 3 - Dialog Migration

- [x] Migrate the diagnostics viewer to `AppSheet`.
- [x] Migrate the playlist browser and Add items flow to `AppSheet` and `AppDialog`.
- [ ] Migrate the disk browser surfaces to `AppSheet` and `AppDialog`.
- [ ] Migrate the filesystem browser surfaces to `AppSheet` and `AppDialog`.
- [x] Migrate the RAM snapshot browser to `AppSheet`.
- [x] Migrate the file source selector to `AppDialog`.
- [x] Migrate the RAM snapshot save dialog to `AppDialog`.

### Phase 4 - Responsive Validation

- [x] Validate Compact bottom-sheet behavior.
- [x] Validate Medium bottom-sheet behavior.
- [x] Validate Expanded centered-modal behavior.
- [x] Validate sticky header, filter, tabs, and isolated scroll regions.

### Phase 5 - Screenshot Regeneration

- [x] Regenerate only the affected screenshots under `doc/img/`.
- [x] Preserve filenames and overwrite existing screenshots in place.
- [x] Verify screenshot paths and naming conventions remain unchanged.

### Phase 6 - Test Validation

- [x] Add or update focused regression tests for the migrated surfaces.
- [x] Run targeted unit tests.
- [x] Run targeted Playwright UI validation.
- [x] Run `npm run lint`.
- [x] Run `npm run test:coverage` and confirm global branch coverage is at least 91%.
- [x] Run `npm run build`.

### Phase 7 - CI Convergence

- [x] Confirm local validation is green.
- [ ] Record CI-ready status and any remaining blockers.

## Risk Register

- Sticky regions inside Radix dialogs may need a single shared scroll container to avoid clipped headers and duplicated scrollbars.
- Compact keyboard behavior can hide confirm CTAs unless sheet height and footer padding account for safe areas and viewport changes.
- Existing screenshot flows already target `doc/img/`; edits must keep capture paths unchanged and only rerun the affected cases.
- Existing modal tests assert current `Dialog` attributes; introducing `AppSheet` and `AppDialog` must preserve accessible roles and deterministic selectors.

## Worklog

- 2026-03-15 00:00 UTC: Replaced the stale review-specific plan with the surface-system execution plan. Confirmed the repository already writes screenshots directly into `doc/img/`, so the implementation must preserve that hierarchy and only refresh affected files in place.
- 2026-03-15 00:00 UTC: Audited the current surface layer. The repo has a profile-aware modal presentation helper in `src/lib/modalPresentation.ts` and several `Dialog`-based flows, but no explicit `AppSheet` or `AppDialog` components yet.
- 2026-03-15 00:00 UTC: Identified the first concrete migration targets already in use on current routes: diagnostics (`src/components/diagnostics/DiagnosticsDialog.tsx`), Add items (`src/components/itemSelection/ItemSelectionDialog.tsx`), and Home RAM dialogs (`src/pages/home/dialogs/*.tsx`).
- 2026-03-15 00:00 UTC: Added the shared surface layer in `src/components/ui/app-surface.tsx` with `AppSheet` for task surfaces and `AppDialog` for compact decision dialogs, plus focused regression coverage in `src/components/ui/app-surface.test.tsx`.
- 2026-03-15 00:00 UTC: Migrated diagnostics, Add items source selection and browser flow, Save RAM, Snapshot Manager, and Restore Snapshot onto the new surface primitives while keeping headers, filters, and controls outside the scrolling body regions.
- 2026-03-15 00:00 UTC: Updated profile-aware tests and Playwright assertions so Compact and Medium expect bottom-sheet task surfaces while Expanded expects centered modal presentation for `AppSheet`.
- 2026-03-15 00:00 UTC: Regenerated only the affected screenshots in place under the existing `doc/img/app/diagnostics`, `doc/img/app/home/dialogs`, and `doc/img/app/play/import` paths, preserving filenames and folder structure.
- 2026-03-15 00:00 UTC: Completed local validation with targeted unit tests, targeted Playwright surface checks, `npm run lint`, `npm run test:coverage` with 91.03% global branch coverage, and `npm run build`. CI was not run in this workspace.
