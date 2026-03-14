# Display Profiles Gap Analysis

## 1 Baseline Architecture Summary

This baseline analysis captures the repository state before the display-profile implementation landed.

- The only shared viewport helper is `src/hooks/use-mobile.tsx`, which exposes a binary `window.innerWidth < 768` check. That threshold conflicts with the specification thresholds of Compact `<= 360`, Medium `361-599`, and Expanded `>= 600`.
- Responsive behavior is currently expressed through scattered Tailwind breakpoint classes such as `sm:`, `md:`, and `lg:` in page and component markup.
- `src/components/ConfigItemRow.tsx` is the only shared component that performs runtime width measurement. It uses a `ResizeObserver` to choose horizontal or vertical layout per row, which is valuable for narrow widths but is still component-local and not profile-driven.
- The shared dialog primitives in `src/components/ui/dialog.tsx` and `src/components/ui/alert-dialog.tsx` enforce viewport-safe centered modals, but they do not have profile-aware presentation modes such as Compact full-screen promotion.
- Playwright already has dual-resolution infrastructure and horizontal-overflow checks through `playwright.config.ts`, `playwright/layoutOverflow.spec.ts`, `playwright/viewportValidation.ts`, and `doc/testing/dual-resolution.md`. That provides a starting point for verification, but it validates viewport behavior rather than an explicit display-profile contract.

Baseline status:

- Medium has the strongest implicit support because most surfaces were built around a standard single-column phone baseline.
- Compact support is partial and defensive rather than intentional.
- Expanded support is largely absent beyond generic extra whitespace and a few `lg:` column splits.

## 2 Profile Resolution Gaps

### Missing central resolver

- There is no shared `resolveDisplayProfile(width)` function.
- There is no app-level profile context or hook that pages and components consume.
- There is no token layer for profile-scoped spacing, max width, grid counts, dialog presentation, or typography.

### Existing scattered breakpoint logic

- `src/hooks/use-mobile.tsx` hard-codes a 768 px breakpoint and only answers “mobile or not”.
- `src/pages/HomePage.tsx` uses `lg:grid-cols-2` for top-level content grouping and fixed `grid-cols-4` action groups with no Compact override.
- `src/components/itemSelection/ItemSelectionDialog.tsx` uses `sm:grid-cols-2`, `sm:flex-row`, `max-w-md`, and `max-w-3xl` dialog assumptions rather than a profile model.
- `src/components/lists/SelectableActionList.tsx` uses fixed dialog widths for the “View all” surface.
- `src/components/diagnostics/DiagnosticsDialog.tsx` uses a fixed four-tab row and centered dialog defaults.

### Component-level width checks that should be absorbed into profile infrastructure

- `src/components/ConfigItemRow.tsx` measures container width and flips between horizontal and vertical row composition.
- `src/lib/ui/pathDisplay.ts` and related path/text components use element width for truncation/wrapping decisions.

### Where profile resolution should be introduced

- App root: establish a shared display-profile provider close to the route shell.
- Shared layout boundaries: add reusable page containers and section/grid helpers for Home, Play, Disks, Config, Settings, and dialog surfaces.
- Modal primitives: unify Compact full-screen promotion and viewport-safe modal sizing in the dialog layer instead of repeating width classes per feature.
- Shared action/list components: consume the resolved profile rather than guessing from local breakpoints.

## 3 Page-Level Compliance

### Home

Current status:

- Medium: partially compliant.
- Compact: non-compliant in several control clusters.
- Expanded: underdeveloped.

Evidence:

- `src/pages/home/components/MachineControls.tsx` renders eight quick actions in a fixed `grid grid-cols-4 gap-2`.
- `src/pages/HomePage.tsx` renders the Config quick actions in another fixed `grid grid-cols-4 gap-2`.
- `src/pages/home/DriveCard.tsx` keeps mounted path, bus ID, type, and status information in tight inline rows with `whitespace-nowrap` labels.

Assessment:

- Medium works because the existing cards were tuned for typical phone widths around the current Playwright default phone project.
- Compact breaks the spec expectation that dense multi-control rows should stack when narrow widths become unreliable.
- Expanded has no bounded reading surface or secondary-panel strategy beyond incidental spacing.

Required change direction:

- Compact: reduce action-grid density, stack drive metadata rows, and ensure all labels/values remain reachable without clipped CTAs.
- Expanded: bound main content width and allow secondary cards or grouped status surfaces to sit beside the primary flow without changing task order.

### Play

Current status:

- Medium: broadly compliant.
- Compact: partially compliant with important gaps.
- Expanded: mostly baseline-only.

Evidence:

- `src/pages/PlayFilesPage.tsx` keeps the main page single-column and delegates most surface rendering to shared panels.
- `src/components/itemSelection/ItemSelectionDialog.tsx` preserves source order and scoped selection flow, which aligns with the UX invariants.
- `src/components/lists/SelectableActionList.tsx` already preserves virtualization for “View all” via `Virtuoso`.

Assessment:

- The workflow remains correct across sources: choose source, select items, add to playlist.
- Compact still relies on centered dialog geometry instead of the required full-screen selection browser behavior.
- Expanded does not intentionally use available width for better grouping of playback controls, playlist metadata, and secondary settings.

Required change direction:

- Keep the source-selection workflow intact.
- Promote selection browser surfaces to Compact full-screen.
- Introduce expanded layout boundaries for the playback controls, settings, and playlist context without altering CTA semantics.

### Disks

Current status:

- Medium: mostly compliant.
- Compact: partially compliant.
- Expanded: baseline-only.

Evidence:

- `src/components/disks/HomeDiskManager.tsx` uses `SelectableActionList` and dialog-based disk management, which is directionally aligned with the spec.
- `playwright/layoutOverflow.spec.ts` already covers long disk names, overflow, and dialog-in-viewport checks.

Assessment:

- Medium preserves collection semantics and avoids crossing into selection-view mounting, which is correct.
- Compact still inherits centered modal defaults for selection and management surfaces.
- Expanded has no dedicated side-panel or bounded-width treatment for drive controls and disk collection context.

Required change direction:

- Compact: audit drive controls, mount/eject action group density, and full-screen modal promotion.
- Expanded: allow drive status and library context to share width more intentionally without becoming a desktop-style table.

### Config Browser

Current status:

- Medium: strongest compliance today.
- Compact: partially compliant.
- Expanded: limited enhancement.

Evidence:

- `src/components/ConfigItemRow.tsx` already adapts row structure when labels and widgets no longer fit horizontally.
- `src/pages/ConfigBrowserPage.tsx` remains a single-column hierarchical surface, which matches the canonical information architecture.

Assessment:

- This page is closest to the desired profile model because it already avoids many hard width assumptions.
- Compact still lacks explicit rules for promoting secondary editors out of cramped inline layouts when a field remains unreadable.
- Expanded does not use width for better grouping or more legible category presentation.

Required change direction:

- Preserve the adaptive row behavior.
- Add profile-aware editor presentation and spacing rules.
- Add an expanded container and category grouping strategy that improves scanability without making rows denser.

### Settings

Current status:

- Medium: partially compliant.
- Compact: at risk.
- Expanded: baseline-only.

Evidence:

- `src/pages/SettingsPage.tsx` contains many inline inputs, selects, toggles, and modal surfaces in one long single-column document.
- Hostname, password, diagnostics, safety controls, and advanced settings all live in the same baseline layout with no profile consumption.

Assessment:

- Medium is serviceable because the page is already vertical.
- Compact is vulnerable to crowded inline control groups and long setting values.
- Expanded wastes width and lacks bounded grouping for readability.

Required change direction:

- Compact: stack dense rows and audit all inline control clusters for keyboard-safe behavior.
- Expanded: introduce bounded section widths and clearer grouping for connection, diagnostics, appearance, HVSC, and safety sections.

### Selection Browser, Dialogs, and Overlays

Current status:

- Medium: mostly usable.
- Compact: specification gap.
- Expanded: not standardized.

Evidence:

- `src/components/itemSelection/ItemSelectionDialog.tsx` uses a large centered dialog with `max-w-3xl` when a source is active.
- `src/components/lists/SelectableActionList.tsx` uses a centered dialog for “View all”.
- `src/components/diagnostics/DiagnosticsDialog.tsx` uses a centered dialog with a fixed four-tab row.
- `src/components/ConnectivityIndicator.tsx` and Home dialog components reuse the same shared dialog primitives.

Assessment:

- Modal surfaces are viewport-safe but not profile-aware.
- Compact full-screen promotion rules are not yet implemented.
- There is no unified modal taxonomy that maps confirmation, selection browser, and secondary editor surfaces to the spec.

## 4 Component-Level Compliance

### Widget adaptation matrix

| Component                             | Current Behavior                                        | Compact Viability                                             | Medium Baseline | Expanded Scaling                                                        | Gap Summary                                                                  |
| ------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `SelectableActionList`                | Query/filter UI, preview list, `Virtuoso` in “View all” | Good text wrapping; dialog is still centered and width-capped | Good            | No profile-specific row density, preview-height, or side-panel behavior | Needs profile-aware dialog presentation and optional expanded preview tuning |
| `ItemSelectionDialog`                 | Shared source chooser and scoped browser                | Workflow correct, presentation wrong for Compact              | Good            | Large dialog but not explicitly expanded-aware                          | Needs Compact full-screen mode and standardized modal policy                 |
| `QuickActionCard`                     | Single component with `compact` boolean prop            | Card itself is viable; calling grids are not                  | Good            | No expanded variant or profile binding                                  | Needs profile-derived variants instead of an ad hoc prop                     |
| `ConfigItemRow` / config widgets      | ResizeObserver flips horizontal to vertical layout      | Best existing Compact story                                   | Strong          | No explicit expanded spacing or editor policy                           | Should be preserved and fed by profile tokens                                |
| `DriveCard`                           | Inline path/status/select rows                          | At risk because of nowrap labels and inline controls          | Acceptable      | No richer expanded composition                                          | Needs stacked Compact rows and more intentional expanded grouping            |
| `MachineControls`                     | Fixed four-column action grid                           | Non-compliant at 360 px                                       | Acceptable      | No profile-aware scaling                                                | Needs explicit column variants per profile                                   |
| Diagnostics dialog                    | Centered dialog with fixed tab row                      | At risk on Compact                                            | Acceptable      | No expanded dialog or side-panel behavior                               | Needs full-screen Compact treatment and better tab composition               |
| Home/Play/Disks quick-action clusters | Fixed dense grids                                       | At risk                                                       | Acceptable      | No profile-specific balance                                             | Needs shared action-grid helper                                              |

### Surfaces that already comply or are closest to compliance

- `SelectableActionList` already protects list virtualization and deterministic rendering.
- `ItemSelectionDialog` already preserves the correct source-selection workflow and source ordering.
- `ConfigItemRow` already has meaningful structural adaptation for narrow widths.
- Dialog primitives already prevent basic viewport clipping and account for safe-area measurements.

### Shared components lacking profile awareness

- `QuickActionCard`
- `MachineControls`
- `DriveCard`
- `DiagnosticsDialog`
- `ItemSelectionDialog`
- `SelectableActionList` modal presentation
- page headers and top-level action areas that currently depend on raw Tailwind breakpoints

## 5 Compact Profile Violations

### Fixed dense action grids

- `src/pages/home/components/MachineControls.tsx` uses a fixed four-column control grid.
- `src/pages/HomePage.tsx` uses a fixed four-column Config action grid.

Why this violates the spec:

- The Compact profile allows dense multi-control rows to become stacked rows.
- Fixed four-column grids at 360 px leave too little width for reliable one-handed tap targets and legible labels.

Required adaptation:

- Introduce a shared action-grid helper with Compact column reduction and stable action ordering.

### Inline drive metadata and selectors

- `src/pages/home/DriveCard.tsx` keeps several labels on `whitespace-nowrap` and uses paired inline rows for bus ID, type, path, and status.

Why this violates the spec:

- Long values and compact widths compete for horizontal space.
- CTA reachability becomes fragile when select triggers, path buttons, and status buttons share one row.

Required adaptation:

- Stack the metadata rows in Compact, keep mounted-path CTA readable, and preserve status CTA visibility.

### Selection browser remains a centered dialog

- `src/components/itemSelection/ItemSelectionDialog.tsx` remains a centered dialog even when showing the active source browser.

Why this violates the spec:

- The specification explicitly requires the selection browser to be full-screen in Compact.

Required adaptation:

- Add Compact full-screen presentation at the shared dialog boundary without changing source flow or CTA semantics.

### Diagnostics tabs are width-sensitive

- `src/components/diagnostics/DiagnosticsDialog.tsx` renders a fixed four-column tab strip.

Why this violates the spec:

- Compact width plus long or translated labels can make primary diagnostics actions harder to reach or scan.

Required adaptation:

- Promote the diagnostics surface to full-screen in Compact and review the tab-strip composition.

### Centered “View all” dialogs stay width-capped

- `src/components/lists/SelectableActionList.tsx` uses a centered dialog with `w-[min(92vw,32rem)]` for the full list view.

Why this violates the spec:

- Compact allows wide dialogs and panels to become full-screen when that preserves usability.

Required adaptation:

- Reuse modal-presentation rules for list expansion surfaces.

## 6 Expanded Profile Opportunities

### Introduce bounded content width

- Home, Play, Disks, Config, and Settings currently rely on whatever width the viewport provides.
- Expanded should apply page-level max widths to primary reading surfaces rather than stretching cards and forms indefinitely.

### Use width for supporting context, not semantic changes

- Play can place playlist context, playback controls, and secondary settings in a more balanced composition.
- Disks can place drive state beside collection context.
- Settings can improve section grouping and readability.
- Config can use width for better grouping or more comfortable label-value spacing.

### Improve spacing and typography intentionally

- Expanded currently inherits mostly the same card density as Medium.
- The spec allows larger spacing, larger targets, and better typography, but the repository does not yet define profile tokens for those changes.

### Increase list preview height where safe

- `SelectableActionList` already uses virtualized rendering in the large list dialog.
- Expanded can safely increase preview count or viewport height as long as deterministic ordering and virtualization remain intact.

## 7 Modal Surface Issues

### Shared modal primitives are safe but not profile-sensitive

Evidence:

- `src/components/ui/dialog.tsx` centers all dialogs and caps them at `max-w-lg` by default.
- `src/components/ui/alert-dialog.tsx` follows the same centered-dialog pattern.

Gaps:

- No Compact full-screen promotion.
- No shared surface-type mapping for confirmation vs selection browser vs secondary editor.
- No shared keyboard-safe footer policy beyond general viewport sizing.

### Feature-level dialog overrides are inconsistent

- `ItemSelectionDialog` overrides width for source browsing.
- `SelectableActionList` overrides width and height for “View all”.
- Home dialogs such as snapshot and config managers provide their own sizing classes.

Impact:

- Modal rules are distributed across feature components rather than declared in one modal policy layer.
- Compact compliance work will sprawl if it is implemented file by file.

### Primary action visibility needs a standardized footer rule

- Many dialogs already use sticky or bottom-padded footers, but there is no single rule ensuring the primary action remains visible with keyboard open and Compact full-screen presentation.

## 8 CTA Reachability Risks

The UX Interactions inventory is strong enough to identify high-value CTA surfaces, but display-profile-specific reachability is not yet validated.

Highest-risk CTA surfaces:

- Home quick actions: `Reset`, `Reboot`, `Pause/Resume`, `Menu`, `Save RAM`, `Load RAM`, `Reboot (Clear RAM)`, `Power Off`
- Home config quick actions: `Save`, `Load`, `Reset`, `Save To App`, `Load From App`, `Revert`, `Manage`
- Play selection flow CTAs: source chooser buttons, `Root`, `Up`, `Refresh`, selection toggles, `Add to playlist`
- Disks drive controls: `Mount`, `Eject`, `Prev`, `Next`, drive selection, `Add disks`
- Settings diagnostics actions: `Diagnostics`, `Share All`, `Clear All`, tab-level `Share`

Current risk summary:

- The CTA inventory confirms what must remain reachable.
- Existing tests prove many CTAs functionally, but they do not prove that every CTA remains reachable in Compact after layout adaptation.
- Fixed grids and centered modal widths are the most likely sources of Compact CTA clipping or crowding.

## 9 Screenshot Coverage Gaps

### What exists today

- Documentation screenshots live under `doc/img/app/` with page-oriented folders for Home, Play, Disks, Config, Settings, Docs, and Diagnostics.
- `playwright/screenshots.spec.ts` and `playwright/screenshotCatalog.ts` provide deterministic screenshot capture and section ordering.
- `doc/testing/dual-resolution.md` documents phone and tablet test evidence separation.

### Gaps against the display-profile spec

- There is no display-profile naming or folder structure under `doc/img/app/`.
- There are no explicit Compact screenshots.
- There are no explicit Expanded screenshots demonstrating profile-specific differences.
- The existing “expanded” diagnostics image names refer to expanded accordion/content state, not the Expanded display profile.
- Medium is not explicitly designated as the default documentation profile, even though that is what the specification requires.

### Deterministic screenshot structure to introduce

Recommended structure:

- Keep the current page-first folder layout for baseline Medium screenshots.
- Add profile-specific subfolders only where the visible UI meaningfully differs, for example:
  - `doc/img/app/home/profiles/compact/`
  - `doc/img/app/home/profiles/expanded/`
  - `doc/img/app/play/profiles/compact/`
  - `doc/img/app/settings/profiles/expanded/`
- Encode the profile in screenshot generation metadata and file naming so the same surface can be regenerated deterministically.

## 10 Test Coverage Gaps

### Current strengths

- `playwright/layoutOverflow.spec.ts` covers long-name overflow, dialog-in-viewport checks, and list overflow conditions at narrow widths.
- `playwright.config.ts` already runs phone and tablet projects, with `@layout` tests on the tablet project by default.
- `doc/ux-interactions.md` gives a CTA inventory that can anchor profile-specific reachability tests.

### Gaps

- No tests assert profile resolution itself because no profile layer exists.
- No tests verify Compact full-screen promotion for selection browser, diagnostics, or secondary editor surfaces.
- No tests verify Expanded-specific layout intent such as bounded width or optional secondary panels.
- No tests verify CTA reachability as a display-profile concern.
- No tests verify profile changes preserve selections, filters, and in-progress edits.
- No tests verify keyboard-safe modal layouts under Compact or with increased text size.

### Recommended new coverage areas

- Unit tests for a centralized profile resolver.
- Component tests for action-grid, modal-presentation, and layout-boundary helpers.
- Playwright profile matrix tests for Compact `360 x 640`, Medium `393 x 727`, and Expanded `800 x 1280`.
- CTA reachability checks tied to the UX inventory for Home, Play, Disks, Settings, and Config.
- Modal tests that explicitly verify Compact full-screen promotion and primary action visibility.

## 11 Risk Summary

### Highest-risk gaps

1. No centralized display-profile resolver or context.
2. Fixed dense action grids on Home that do not satisfy Compact structural adaptation rules.
3. Selection and list-expansion dialogs remain centered and width-capped instead of using Compact full-screen presentation.
4. Expanded is not defined as a real UI mode; it is mostly accidental extra space.
5. Screenshot and Playwright coverage are viewport-aware but not profile-aware.

### Surfaces closest to compliance

- The source-selection workflow itself.
- `SelectableActionList` virtualization and deterministic ordering.
- `ConfigItemRow` adaptive label/widget layout.
- Existing viewport-safe modal primitives.

### Overall conclusion

The repository is ready for display-profile implementation work, but it is not yet compliant with the Display Profiles Specification. Medium is the effective baseline. Compact and Expanded both need a shared profile layer, shared layout boundaries, and a unified modal policy before page-level polishing will converge.
