# Display Profiles Review

## Executive Summary

This audit confirms that the display-profile system is materially implemented and not a placeholder. The current repository state uses one shared resolver, one provider, shared layout primitives, shared modal-presentation rules, a single routed UI codebase, a manual override in Settings, and dedicated unit and Playwright profile validation.

The system does not yet fully guarantee that all profile-sensitive behavior is centralized. Several audited surfaces still depend on raw `sm:` or `md:` breakpoint classes, parent-supplied `compact` props, or local width measurement instead of the resolved profile context. Those gaps do not prove a current user-visible failure on 360x480-class screens, but they do prove that the architecture has not fully met the specification rule that profile branching must happen at shared layout boundaries.

Verdict: partially compliant. The single-codebase requirement is satisfied, duplication remains low, and medium and expanded behavior have direct non-regression evidence. The remaining gaps are architectural normalization debt and incomplete proof for some high-risk compact interactions.

## Architecture Overview Of The Current Display Profile System

The current system is structured around a centralized width-based resolver in `src/lib/displayProfiles.ts:1-91`.

- `resolveDisplayProfile` maps CSS-pixel widths to `compact`, `medium`, and `expanded` using the specified thresholds.
- `resolveEffectiveDisplayProfile` applies manual override values without creating a separate profile model.
- `getDisplayProfileLayoutTokens` provides root font size, page width, spacing, action-grid, and modal sizing tokens per profile.

Runtime application is centralized in `src/hooks/useDisplayProfile.tsx:61-186`.

- `DisplayProfileProvider` reads viewport width and height.
- The provider writes `data-display-profile` and CSS custom properties to the document root.
- Override persistence is handled through `src/lib/uiPreferences.ts:37-56`.
- The app shell mounts the provider once in `src/App.tsx:131-151`.

Shared layout consumption is concentrated in `src/components/layout/PageContainer.tsx:13-89`.

- `PageContainer` enforces bounded page widths.
- `ProfileActionGrid` changes column count by resolved profile.
- `ProfileSplitSection` keeps medium and compact single-column while enabling expanded multi-panel layout.

Shared modal behavior is centralized in `src/lib/modalPresentation.ts:39-83`, `src/components/ui/dialog.tsx:49-90`, and `src/components/ui/alert-dialog.tsx:43-79`.

- Selection browsers and list browsers become full-screen in compact mode.
- Secondary editors and command palettes also use profile-sensitive presentation.
- Confirmation dialogs remain centered.

This architecture preserves a single routed codebase. The audited pages reuse shared containers and shared dialog primitives rather than maintaining profile-specific page forks.

## Verified Strengths

### Centralized detection and override model

- Thresholds and labels match the specification exactly in `src/lib/displayProfiles.ts:1-31`.
- The Settings override is wired to centralized state in `src/pages/SettingsPage.tsx:633-651`.
- Provider lifecycle, storage sync, and root-token application are covered in `src/hooks/useDisplayProfile.test.tsx:37-240`.

### Shared layout boundaries instead of duplicated page variants

- Home, Play, Disks, Config, and Settings all use `PageContainer`, `PageStack`, or `ProfileSplitSection` rather than separate per-profile pages: `src/pages/HomePage.tsx`, `src/pages/PlayFilesPage.tsx:951-1177`, `src/pages/DisksPage.tsx:1-19`, `src/pages/ConfigBrowserPage.tsx:614-646`, `src/pages/SettingsPage.tsx:591-984`.
- Play and Disks explicitly use `ProfileSplitSection` for expanded composition in `src/pages/PlayFilesPage.tsx:953` and `src/components/disks/HomeDiskManager.tsx:1278-1719`.

### Medium and expanded non-regression evidence exists

- Playwright proves that medium keeps the existing four-column Home quick-action layout in `playwright/displayProfiles.spec.ts:212`.
- Playwright proves that expanded increases root font size, shell padding, and button height above medium in `playwright/displayProfiles.spec.ts:229`.
- Playwright proves that a compact viewport can be overridden to expanded and keeps that profile across navigation in `playwright/displayProfiles.spec.ts:262`.

### Compact full-screen browser flows are implemented

- `ItemSelectionDialog` uses the shared `selection-browser` surface in `src/components/itemSelection/ItemSelectionDialog.tsx:286-455`.
- `SelectableActionList` uses the shared `list-browser` surface in `src/components/lists/SelectableActionList.tsx:447-528`.
- Modal resolver tests cover compact full-screen promotion in `src/lib/modalPresentation.test.ts:5-37`.
- Component tests confirm selection and filter state survive profile changes in `src/components/itemSelection/ItemSelectionDialog.test.tsx:58-85`.

### Screenshot and visual-validation infrastructure is real and profile-scoped

- Canonical viewports are defined in `playwright/displayProfileViewports.ts:1-16`.
- Playwright profile coverage includes overflow, dialog presentation, text scaling, reduced height, zoom, and route matrix checks in `playwright/displayProfiles.spec.ts:212-524`.
- Screenshot generation writes profile-specific captures via `profileScreenshotPath` in `playwright/screenshots.spec.ts:48-49`.
- Profile-specific assets exist under `doc/img/app/**/profiles/**`, including Home, Play, Play import, Disks, Config, Settings, and Diagnostics.

### Current source-of-truth documentation is aligned

- `doc/display-profiles.md:46-55`, `doc/architecture.md:20-31`, and `README.md:210-216` consistently describe the same three-profile model and override behavior.
- `README.md:262-263` and `doc/display-profiles.md:268-277` consistently describe screenshot storage rules.

## Identified Issues

### Issue 1: Profile branching is not fully centralized

- Severity: High
- Impacted files:
  - `src/components/lists/SelectableActionList.tsx:472`
  - `src/pages/home/components/DriveManager.tsx:141`
  - `src/pages/home/components/StreamStatus.tsx:102`
  - `src/pages/home/dialogs/SnapshotManagerDialog.tsx:112`
  - `src/pages/playFiles/components/PlaybackControlsCard.tsx:81-88`
  - `src/pages/playFiles/components/VolumeControls.tsx:55`
  - `src/pages/SettingsPage.tsx:1281`
- Evidence:
  - `SelectableActionList` still adds `sm:w-full sm:max-w-[36rem]` for non-compact view-all dialogs.
  - Home drive grouping still uses `grid-cols-2 md:grid-cols-3`.
  - Stream and snapshot inline editors still switch layout with `md:` grid classes.
  - Playback controls and volume controls still use `sm:` width rules.
  - Settings still contains at least one `md:grid-cols-2` layout branch.
- UX impact:
  - Current layout behavior is harder to reason about and easier to regress because some profile-sensitive changes bypass the shared profile model.
  - This directly violates the specification rule in `doc/display-profiles.md:46-55` that components should consume the resolved profile instead of performing ad hoc breakpoint checks.
- Proposed fix:
  - Move remaining breakpoint-conditioned layout branches into profile-aware helpers or profile-token variants.
  - Reserve raw responsive utility classes for non-profile concerns only.

### Issue 2: Some shared components still depend on local adaptation contracts instead of direct profile context

- Severity: Medium
- Impacted files:
  - `src/components/QuickActionCard.tsx:13-69`
  - `src/components/ConfigItemRow.tsx:49-86`
  - `src/components/ConfigItemRow.tsx:220-499`
- Evidence:
  - `QuickActionCard` still exposes a caller-supplied `compact?: boolean` prop and does not read the display-profile context itself.
  - `ConfigItemRow` still uses `useAdaptiveLabelLayout` and `ResizeObserver` to choose horizontal or vertical composition.
- UX impact:
  - The UI remains single-codebase and currently usable, but profile behavior is partly enforced by caller discipline and local measurement rather than by one architectural contract.
  - That weakens long-term consistency across compact, medium, and expanded surfaces.
- Proposed fix:
  - Either make these components profile-aware directly or wrap them in thin profile-aware adapters that own the variant selection.
  - Keep measurement only where label fit genuinely cannot be expressed by profile tokens alone.

### Issue 3: Compact keyboard-safe verification is still approximation-heavy

- Severity: Medium
- Impacted files:
  - `playwright/displayProfiles.spec.ts:402-487`
  - `doc/display-profiles.md:95-106`
- Evidence:
  - Playwright reduces viewport height for diagnostics, item selection, and snapshot-manager checks.
  - The test matrix does not simulate a live soft keyboard or assert visual-viewport-driven layout changes.
- UX impact:
  - The repository has evidence that compact dialogs survive reduced height, but it does not fully prove the specification requirement that the title, primary field, and primary action remain visible with the keyboard open.
- Proposed fix:
  - Add profile tests that focus a live input inside compact full-screen dialogs and assert visibility using `visualViewport` changes or platform-specific keyboard emulation.

### Issue 4: CTA coverage gaps are now concentrated in secondary and native-only controls

- Severity: Medium
- Impacted files:
  - `doc/ux-interactions.md:35-110`
  - `doc/ux-interactions.md:129-181`
  - `doc/ux-interactions.md:326-367`
- Evidence:
  - The UX inventory now marks Shuffle, Reshuffle, Home quick actions, Add disks, Refresh connection, Recurse folders, and System theme as covered.
  - The remaining uncovered or partial entries are concentrated in secondary controls such as Android folder picking, file-type filtering, some per-item menus, and lower-priority navigation paths.
- UX impact:
  - The primary display-profile-sensitive CTA paths are now covered, but the inventory still cannot claim exhaustive interaction coverage while native picker flows and secondary controls remain outside the validated set.
- Proposed fix:
  - Prioritize the remaining native-picker and filter/menu interactions in the UX inventory rather than re-auditing the already-covered primary CTA flows.

### Issue 5: Legacy diagnostics screenshot naming now persists mainly in supporting docs and duplicate assets

- Severity: Low
- Impacted files:
  - `docs/diagnostics/index.md:1-13`
  - `doc/img/app/diagnostics/`
- Evidence:
  - `README.md` now references the newer `*-detail.png` diagnostics screenshots, but the supporting diagnostics index and duplicate assets under `doc/img/app/diagnostics/` still preserve the legacy `*-expanded.png` naming.
- UX impact:
  - End-user documentation is aligned, but the remaining duplicate filenames still make the screenshot corpus harder to reason about because `expanded` can describe either an expanded row state or the Expanded display profile.
- Proposed fix:
  - Keep converged docs on the `*-detail.png` naming and clean up the remaining duplicate `*-expanded.png` assets in a focused follow-up.

## UX Risks For Small Displays

- Compact behavior is architecturally less stable on surfaces that still depend on raw `md:` or `sm:` branches because those rules can drift away from the centralized profile model without failing the resolver tests.
- Compact slider-heavy controls still rely on horizontal space assumptions in `src/pages/playFiles/components/VolumeControls.tsx:31-62`.
- Home stream and snapshot editors are validated by reduced-height tests only after the layout is already open; there is still no live keyboard-viewport proof for every compact editor class.
- CTA discoverability on compact layouts is not fully closed until the missing UX-inventory tests are implemented.

## Engineering Recommendations

1. Enforce profile branching at shared boundaries only.
   Replace the remaining `sm:` and `md:` branches in audited profile-sensitive surfaces with explicit profile-aware helpers or token variants.

2. Normalize shared-component contracts.
   Remove caller-owned `compact` styling flags where the component can safely derive its own profile behavior.

3. Treat compact keyboard safety as a first-class test category.
   Reduced-height tests are useful, but they should be supplemented with focused-input and visual-viewport assertions.

4. Use the UX interactions inventory as the authoritative CTA audit backlog.
   Missing profile-sensitive CTA tests should be closed in the same order the inventory marks them as critical or high value.

5. Keep screenshot semantics unambiguous.
   Profile-specific captures should consistently live under `profiles/<profile>/`, and non-profile screenshots should avoid profile words in filenames.

## Concrete Remediation Steps

1. Refactor `SelectableActionList`, Home `DriveManager`, `StreamStatus`, `SnapshotManagerDialog`, `PlaybackControlsCard`, `VolumeControls`, and the remaining Settings grid rows to remove direct `sm:` and `md:` branching.
2. Decide whether `QuickActionCard` and `ConfigItemRow` should consume `useDisplayProfile` directly or be wrapped by profile-aware adapters.
3. Add Playwright tests for live-input compact dialogs using actual focused fields and `visualViewport` assertions where supported.
4. Add CTA coverage for Add disks, Shuffle, Reshuffle, Home quick actions, Recurse folders, and Test connection.
5. Rename or reorganize legacy diagnostics screenshots whose filenames reuse `expanded` outside the profile-folder structure.

## Potential Regression Risks

- Medium display regression risk:
  - Home quick actions are explicitly protected by `playwright/displayProfiles.spec.ts:212`, so any refactor must keep the four-column medium layout unchanged.
  - Residual `md:` branches in Home and Settings create a moderate regression risk if they are changed without replacing them with equivalent medium-profile rules.

- Expanded display regression risk:
  - Expanded scaling is explicitly protected by `playwright/displayProfiles.spec.ts:229`, so token changes must preserve increased font size, spacing, and button height relative to medium.
  - Pages that rely mostly on global scaling rather than explicit expanded composition, especially Config Browser, are more sensitive to token-only regressions.

- Compact display regression risk:
  - Compact dialog promotion and overflow are well covered, but keyboard-safe behavior remains less fully proved than other profile behaviors.

## Follow-Up Tasks

1. Add a lint or review rule forbidding new raw breakpoint logic in profile-sensitive surfaces.
2. Close the CTA test gaps listed in `doc/ux-interactions.md:326-367`.
3. Add live keyboard or visual-viewport compact dialog tests.
4. Normalize `QuickActionCard` and `ConfigItemRow` profile contracts.
5. Clean up legacy diagnostics screenshot naming.
6. Preserve the current strengths that are already verified: centralized resolver, shared provider, shared layout primitives, manual override, profile-specific screenshots, and medium/expanded non-regression tests.

## Verification Notes

- Verification pass 1 completed: implementation, consumer, and validation files in the mapped display-profile scope were inspected.
- Verification pass 2 completed: required display-profile, UX, architecture, README, and screenshot-policy documentation was rechecked against the current implementation and validation evidence.
