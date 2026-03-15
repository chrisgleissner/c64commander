# Display Profiles Audit Work Log - Review 9

## 2026-03-14

### Classification

- Audit classification: `UI_CHANGE`.
- Scope: the branch started as an audit, then continued into product code, test, screenshot, and documentation remediation for the Review 9 findings.

### Investigation Steps

1. Reviewed the source-of-truth documents:
   - `doc/display-profiles.md`
   - `doc/ux-guidelines.md`
   - `doc/ux-interactions.md`
   - `README.md`
   - `AGENTS.md`
2. Reviewed existing planning and prior display-profile research:
   - `PLANS.md`
   - `doc/plans/display-profiles/display-profiles-implementation-plan.md`
   - `doc/plans/display-profiles/work-log.md`
   - `doc/research/review-8/review-8.md`
3. Traced the current display-profile architecture in implementation files:
   - `src/lib/displayProfiles.ts`
   - `src/hooks/useDisplayProfile.tsx`
   - `src/components/layout/PageContainer.tsx`
   - `src/lib/modalPresentation.ts`
   - `src/components/ui/dialog.tsx`
   - `src/components/ui/alert-dialog.tsx`
   - `src/index.css`
4. Audited page and component surfaces:
   - `src/pages/HomePage.tsx`
   - `src/pages/PlayFilesPage.tsx`
   - `src/pages/DisksPage.tsx`
   - `src/pages/ConfigBrowserPage.tsx`
   - `src/pages/SettingsPage.tsx`
   - `src/components/disks/HomeDiskManager.tsx`
   - `src/components/itemSelection/ItemSelectionDialog.tsx`
   - `src/components/lists/SelectableActionList.tsx`
   - `src/components/QuickActionCard.tsx`
   - `src/components/ConfigItemRow.tsx`
   - `src/components/AppBar.tsx`
   - `src/pages/home/dialogs/SnapshotManagerDialog.tsx`
5. Audited verification and screenshot infrastructure:
   - `playwright/displayProfiles.spec.ts`
   - `playwright/layoutOverflow.spec.ts`
   - `playwright/displayProfileViewports.ts`
   - `playwright/screenshots.spec.ts`
   - `doc/img/app/**/profiles/`

### Confirmed Architecture Findings

- The resolver is centralized and threshold-compliant in `src/lib/displayProfiles.ts`.
- Profile state, persisted override handling, and root CSS-token publication are centralized in `src/hooks/useDisplayProfile.tsx`.
- Shared layout boundaries exist and are actively used by the main routed surfaces via `PageContainer`, `ProfileActionGrid`, and `ProfileSplitSection`.
- Shared modal presentation is centralized through `resolveModalPresentation()` and the dialog primitives.

### Confirmed Compliance Strengths

- Home, Play, Disks, Config Browser, and Settings all inherit profile-aware page-shell behavior.
- Compact-specific full-screen promotion is real for the selection browser and list browser surfaces.
- Expanded behavior is real, not purely nominal: root typography, shell spacing, and button height increase above Medium, and some pages use side-by-side composition.
- Profile-specific screenshots exist on disk for Home, Play, Play import, Disks, Config, Settings, and Diagnostics.
- Unit, component, and Playwright tests cover threshold resolution, provider behavior, modal policy, and a cross-profile viewport matrix.

### Contradictions And Residual Risks

- The specification says components should consume the resolved profile instead of ad hoc breakpoint logic, but shared/profile-sensitive surfaces still contain `sm:` or `md:` branching.
- `src/hooks/use-mobile.tsx` still exposes a binary mobile abstraction that collapses Compact and Medium into one branch for `src/components/ui/sidebar.tsx`.
- `src/components/ConfigItemRow.tsx` still adapts via direct DOM measurement and `ResizeObserver` rather than the centralized profile context.
- Compact keyboard safety is not fully proved end to end. Current Playwright evidence uses reduced viewport height for the diagnostics dialog, not a live keyboard-open or `visualViewport` scenario across all Compact full-screen editors.
- CTA reachability proof is partial. Diagnostics CTAs have strong reachability checks, but several UX-inventory CTAs remain untested or only partially tested.
- README does not explain the display-profile system or profile-specific screenshot organization even though the Settings UI exposes the feature and the screenshot infrastructure stores profile-specific captures.

### Files Where Remaining Breakpoint Debt Matters

- `src/components/itemSelection/ItemSelectionDialog.tsx`
- `src/components/lists/SelectableActionList.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/alert-dialog.tsx`
- `src/pages/home/components/DriveManager.tsx`
- `src/pages/home/components/StreamStatus.tsx`
- `src/pages/home/dialogs/SnapshotManagerDialog.tsx`
- `src/pages/playFiles/components/PlaybackControlsCard.tsx`
- `src/pages/playFiles/components/VolumeControls.tsx`
- `src/pages/SettingsPage.tsx`

### Convergence Decision

- Convergence reached for the audit scope.
- Every major page named in the prompt was inspected directly or through its profile-aware shared boundaries.
- Shared component inventory was completed for the high-value profile-sensitive surfaces.
- Compact, Medium, and Expanded behavior were assessed.
- Modal behavior, CTA reachability evidence, screenshot coverage, and test coverage gaps were documented in `doc/research/review-9/review-9.md`.

## 2026-03-15

### Remediation Summary

- Replaced the remaining audited raw-breakpoint layout debt across the targeted Home, Play, Settings, and shared list surfaces with profile-aware layout logic.
- Moved quick-action density selection behind shared profile-aware context and updated `QuickActionCard` call sites and tests to the new contract.
- Reconciled the UX inventory with the existing and newly added Playwright coverage for Add disks, Shuffle, Reshuffle, Recurse folders, Home quick actions, Refresh connection, and System theme.
- Added a raw-breakpoint guardrail plus focused regressions for profile overflow and shared quick-action behavior.
- Renamed diagnostics detail screenshots away from legacy `*-expanded.png` naming and regenerated the canonical screenshot set.
- Continued with follow-up polish for Compact spacing, Home full-page profile captures, and the Play Expanded transport layout.
