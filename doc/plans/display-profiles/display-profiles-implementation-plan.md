# Display Profiles Implementation Plan

## Required reading

This is MANDATORY reading before any work is done:

- doc/display-profiles.md
- doc/architecture.md
- doc/ux-guidelines.md
- doc/ux-interactions.md

## Phase 0 — Baseline Alignment

- [x] Confirm the authoritative profile contract from `doc/display-profiles.md` and freeze the first implementation thresholds: Compact `<= 360`, Medium `361-599`, Expanded `>= 600`.
- [x] Record the change classification for the implementation work as `CODE_CHANGE` and flag UI-affecting phases as `UI_CHANGE` once code work starts.
- [x] Add a short architecture note describing how profile resolution relates to existing viewport-validation and dual-resolution Playwright infrastructure.
- [x] Identify the exact page shells, shared components, dialogs, and screenshot paths that will be touched before any code changes begin.
- [x] Define the first-pass list of profile-sensitive shared surfaces: page container, action-grid container, modal presentation helper, list/dialog container, and section spacing tokens.

## Phase 1 — Display Profile Infrastructure

- [x] Add a centralized display-profile resolver that maps CSS width to `compact`, `medium`, and `expanded`.
- [x] Add a display-profile provider and consumer hook at the app shell so pages and components stop using ad hoc width checks.
- [x] Add a persisted explicit display-profile control with `Auto`, `Small display`, `Standard display`, and `Large display` options so the chosen profile can be overridden intentionally.
- [x] Replace the binary `useIsMobile` assumption with profile-aware consumers where display branching is required.
- [x] Add unit tests for resolver thresholds and provider behavior.
- [x] Define profile-scoped layout tokens for max width, grid density, spacing, and modal presentation.

## Phase 2 — Layout Boundary Refactors

- [x] Create a reusable page container that enforces Medium single-column flow and Expanded bounded width.
- [x] Create a shared action-grid helper for quick-action clusters and top-level CTA areas.
- [x] Create a profile-aware section/container utility for panels that need optional Expanded side-by-side composition.
- [x] Migrate Home, Play, Disks, Config, and Settings page shells to the shared layout boundaries without changing workflow order.
- [x] Add focused component tests or visual assertions for the shared layout helpers.

## Phase 3 — Compact Adaptations

- [x] Change Home machine controls from a fixed four-column grid to a Compact-safe stacked layout while preserving action order.
- [x] Change Home config quick actions to the same Compact-safe action-grid behavior.
- [x] Stack or restructure `DriveCard` metadata rows so mounted path, status, bus ID, and type remain reachable at 360 px.
- [x] Promote the item-selection browser to Compact full-screen presentation.
- [x] Promote other cramped secondary editors and list-expansion dialogs to Compact full-screen or sheet presentation where required.
- [x] Audit and fix dense Settings and Config inline control clusters that still rely on narrow horizontal composition.
- [x] Ensure the manual display-profile override does not reset in-progress selection, filtering, or edits when toggled while a surface remains open.

## Phase 4 — Expanded Enhancements

- [x] Apply bounded content widths to primary page reading surfaces.
- [x] Introduce Expanded spacing and typography adjustments that improve scanability without changing CTA semantics.
- [ ] Ensure Expanded scales typography and control chrome above Medium so larger screens gain both readability and additional visible content.
- [x] Add optional secondary-panel layouts for Play, Disks, and Settings where supporting context can sit beside the main flow.
- [x] Review list preview limits and visible heights for safe Expanded improvements that preserve virtualization.
- [x] Add visual or integration coverage proving Expanded improves composition intentionally rather than only adding whitespace.

## Phase 5 — Modal Compliance

- [ ] Introduce a shared modal-presentation helper that maps surface type and display profile to centered, full-screen, or large-dialog behavior.
- [ ] Update the shared `Dialog` and `AlertDialog` usage patterns to consume the modal-presentation helper instead of hard-coded widths.
- [ ] Standardize footer behavior so primary actions remain visible with keyboard open and safe-area padding applied.
- [ ] Audit all dialogs and overlays used by Home, Play, Disks, Settings, Config, Diagnostics, and connectivity surfaces.
- [ ] Add regression tests for Compact full-screen promotion and viewport-safe modal geometry.

## Phase 6 — Screenshot System

- [ ] Define screenshot naming and folder rules that treat Medium as the default documentation profile.
- [ ] Add explicit Compact and Expanded screenshot generation only for surfaces whose visible behavior differs from Medium.
- [ ] Update `playwright/screenshots.spec.ts` and screenshot catalog metadata so profile-specific captures are deterministic.
- [ ] Map each profile-specific screenshot to its corresponding `doc/img/app/` destination before regenerating assets.
- [ ] Update documentation references and captions so profile-specific screenshots are not confused with state-specific screenshots.

## Phase 7 — Test Coverage

- [ ] Add resolver unit tests for all threshold boundaries.
- [ ] Add component tests for action-grid, layout-boundary, and modal-presentation helpers.
- [ ] Add Playwright display-profile tests for Compact `360 x 640`, Medium `393 x 727`, and Expanded `800 x 1280`.
- [ ] Add CTA reachability assertions tied to the UX interactions inventory for the highest-value CTA surfaces.
- [ ] Add modal tests for Compact full-screen behavior, footer visibility, and keyboard-safe layouts.
- [ ] Add state-persistence tests proving profile changes do not discard selection, filter, or in-progress edit state.

## Phase 8 — Verification

- [ ] Verify no horizontal overflow on Home, Play, Disks, Config, Settings, selection browser, diagnostics, and major dialogs across all three profiles.
- [ ] Verify source chooser order remains `Local`, `C64U`, `HVSC` across all profiles.
- [ ] Verify selection views remain scoped to one source and do not gain playback or mounting actions.
- [ ] Verify playlist and disk list virtualization still holds after profile-aware changes.
- [ ] Verify primary CTAs remain reachable at increased text size and browser zoom.
- [ ] Verify screenshots and tests cover every intentionally different Compact or Expanded surface.
- [ ] Run the smallest honest validation set for the touched layers, including `npm run lint`, `npm run test`, `npm run test:coverage`, `npm run build`, and targeted Playwright coverage for profile-specific UI work.

## Execution Notes

Implementation order should converge on shared infrastructure before page-by-page polishing.

- Start with resolver, provider, layout tokens, and modal policy.
- Refactor the highest-leverage shared surfaces next: action grids, dialog presentation, and page containers.
- Finish with page-specific Compact and Expanded adjustments, then regenerate only the screenshots that changed.
- Use the UX interactions inventory as the acceptance list for CTA reachability so visual changes cannot silently hide actions.
