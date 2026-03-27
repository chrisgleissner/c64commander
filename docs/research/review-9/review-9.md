# Display Profiles Audit — Review 9

## 1 Executive Summary

Verdict: Partially implemented.

This review started as an audit of the repository's current state and then continued into implementation on the same branch. Evidence in this document reflects the current post-remediation code, tests, screenshots, and documentation state rather than a documentation-only snapshot.

The repository has a real display-profile foundation: one centralized resolver with the specified thresholds, a provider that applies profile tokens at the document root, shared page/layout primitives, a manual override in Settings, profile-aware modal routing, profile-aware screenshots, and targeted unit plus Playwright coverage. The strongest evidence is in [src/lib/displayProfiles.ts](../../../src/lib/displayProfiles.ts#L1-L31), [src/hooks/useDisplayProfile.tsx](../../../src/hooks/useDisplayProfile.tsx#L61-L186), [src/components/layout/PageContainer.tsx](../../../src/components/layout/PageContainer.tsx#L1-L89), [src/lib/modalPresentation.ts](../../../src/lib/modalPresentation.ts#L1-L83), and [playwright/displayProfiles.spec.ts](../../../playwright/displayProfiles.spec.ts#L110-L384).

It is not fully compliant because a small amount of profile polish and validation still remains, but the largest structural gaps identified at the start of the audit have been remediated. The remaining gaps are:

- Compact keyboard-open safety is only approximated through reduced viewport-height tests, not a live visual-viewport or soft-keyboard scenario, despite the requirement in [doc/display-profiles.md](../../../doc/display-profiles.md#L142-L150)
- Home profile screenshots still need full-page captures for the canonical Compact, Medium, and Expanded documentation set
- Compact modal spacing still needs a small amount of final tuning so dialog chrome remains comfortably visible in the narrowest screenshots

## 2 Architecture Compliance

Compliant foundations:

- The architecture note explicitly states that display-profile resolution is centralized in [doc/architecture.md](../../../doc/architecture.md#L20-L31).
- Thresholds, labels, and override types are defined once in [src/lib/displayProfiles.ts](../../../src/lib/displayProfiles.ts#L1-L24).
- Runtime resolution and root token application happen in [src/hooks/useDisplayProfile.tsx](../../../src/hooks/useDisplayProfile.tsx#L61-L186).
- Shared layout boundaries are exposed by [src/components/layout/PageContainer.tsx](../../../src/components/layout/PageContainer.tsx#L1-L89).
- Shared modal behavior is exposed by [src/lib/modalPresentation.ts](../../../src/lib/modalPresentation.ts#L1-L83), [src/components/ui/dialog.tsx](../../../src/components/ui/dialog.tsx#L1-L118), and [src/components/ui/alert-dialog.tsx](../../../src/components/ui/alert-dialog.tsx#L1-L118).

Architecture compliance gaps:

- The specification requires components to consume the resolved profile instead of ad hoc breakpoint checks in [doc/display-profiles.md](../../../doc/display-profiles.md#L46-L55). The audited Home, Play, Settings, and shared list surfaces have been moved onto profile-aware layout logic, but follow-up verification still needs to keep new regressions out.
- Compact keyboard-safe proof remains narrower than the architecture target because current automated coverage still relies on reduced-height validation rather than a real soft-keyboard/visualViewport scenario.

## 3 Profile Detection Implementation

Confirmed compliant behavior:

- Thresholds match the specification exactly: Compact `<= 360`, Medium `361-599`, Expanded `>= 600` in [src/lib/displayProfiles.ts](../../../src/lib/displayProfiles.ts#L1-L31).
- User-facing labels match the spec mapping in [src/lib/displayProfiles.ts](../../../src/lib/displayProfiles.ts#L14-L24).
- Width is read from CSS-pixel viewport width through `window.innerWidth` in [src/hooks/useDisplayProfile.tsx](../../../src/hooks/useDisplayProfile.tsx#L61-L68).
- The provider persists and refreshes overrides, updates root dataset and CSS variables, and recomputes on resize/orientation change in [src/hooks/useDisplayProfile.tsx](../../../src/hooks/useDisplayProfile.tsx#L130-L186).
- Unit coverage exists for thresholds, override behavior, root token application, and storage events in [src/lib/displayProfiles.test.ts](../../../src/lib/displayProfiles.test.ts#L9-L41) and [src/hooks/useDisplayProfile.test.tsx](../../../src/hooks/useDisplayProfile.test.tsx#L37-L240).
- Playwright uses the canonical validation matrix from [playwright/displayProfileViewports.ts](../../../playwright/displayProfileViewports.ts#L1-L16).

Observed issues:

- `resolveDisplayProfile` falls back to `medium` for non-finite or non-positive widths in [src/lib/displayProfiles.ts](../../../src/lib/displayProfiles.ts#L27-L31). That is pragmatic for SSR/tests, but it is an implementation convenience rather than a specification detail.
- The provider is centralized, but enforcement is social rather than structural. The codebase has no lint rule or abstraction boundary preventing new raw breakpoint usage.

## 4 Page-Level Findings

Home:

- Strong: page shell uses shared profile-aware boundaries in [src/pages/HomePage.tsx](../../../src/pages/HomePage.tsx#L438-L469) and [src/pages/HomePage.tsx](../../../src/pages/HomePage.tsx#L838-L907).
- Strong: quick config uses `ProfileSplitSection` and machine/config quick actions use `ProfileActionGrid`.
- Strong: drive, stream, and drive-card detail layouts now route their structural variants through display-profile-aware logic rather than raw `md:` breakpoints.

Play:

- Strong: page shell uses `ProfileSplitSection` for wide composition in [src/pages/PlayFilesPage.tsx](../../../src/pages/PlayFilesPage.tsx#L951-L1107).
- Strong: item selection uses the shared modal policy in [src/pages/PlayFilesPage.tsx](../../../src/pages/PlayFilesPage.tsx#L1144-L1158) and [src/components/itemSelection/ItemSelectionDialog.tsx](../../../src/components/itemSelection/ItemSelectionDialog.tsx#L286-L455).
- Strong: playlist uses a query-backed virtualized view-all list in [src/components/lists/SelectableActionList.tsx](../../../src/components/lists/SelectableActionList.tsx#L447-L528).
- Strong: playback controls and volume controls now consume display-profile-aware layout decisions instead of raw `sm:` minimum-width behavior.

Disks:

- Strong: Disks uses the shared page shell in [src/pages/DisksPage.tsx](../../../src/pages/DisksPage.tsx#L1-L19).
- Strong: the main surface, [src/components/disks/HomeDiskManager.tsx](../../../src/components/disks/HomeDiskManager.tsx#L113-L214) and [src/components/disks/HomeDiskManager.tsx](../../../src/components/disks/HomeDiskManager.tsx#L1343-L1619), has explicit `profile === "compact"` branches for dense rows, mounted path presentation, and control grouping.
- Gap: the core Add disks flow remains under-tested according to [doc/ux-interactions.md](../../../doc/ux-interactions.md#L95-L95) and [doc/ux-interactions.md](../../../doc/ux-interactions.md#L246-L246).

Config Browser:

- Strong: the page is bounded through the shared reading-width container in [src/pages/ConfigBrowserPage.tsx](../../../src/pages/ConfigBrowserPage.tsx#L600-L646).
- Strong: config rows use measured adaptive layout, not fixed CSS breakpoints, in [src/components/ConfigItemRow.tsx](../../../src/components/ConfigItemRow.tsx#L41-L86) and [src/components/ConfigItemRow.tsx](../../../src/components/ConfigItemRow.tsx#L193-L229).
- Gap: Config Browser does not introduce an Expanded-specific secondary-panel composition; Expanded benefits here come mostly from root token scaling and bounded width rather than page-specific composition.

Settings:

- Strong: Settings uses shared reading and split-section primitives in [src/pages/SettingsPage.tsx](../../../src/pages/SettingsPage.tsx#L591-L765) and [src/pages/SettingsPage.tsx](../../../src/pages/SettingsPage.tsx#L767-L984).
- Strong: the user override control is present and wired to centralized state in [src/pages/SettingsPage.tsx](../../../src/pages/SettingsPage.tsx#L633-L651).
- Strong: the reviewed Settings subsections now use display-profile-aware layout branching instead of the previously audited raw `md:grid-cols-2` structure.

Selection browser, list browser, dialogs, and overlays:

- Strong: `ItemSelectionDialog` and SelectableActionList view-all surfaces map to full-screen on Compact through the shared resolver in [src/components/itemSelection/ItemSelectionDialog.tsx](../../../src/components/itemSelection/ItemSelectionDialog.tsx#L286-L307) and [src/components/lists/SelectableActionList.tsx](../../../src/components/lists/SelectableActionList.tsx#L465-L474).
- Strong: shared dialog primitives and consumer surfaces now derive their header, footer, and width behavior from modal presentation mode and display profile rather than the previously audited `sm:` classes.

## 5 Compact Profile Findings

Confirmed strengths:

- Compact thresholds and canonical viewport are implemented in [src/lib/displayProfiles.ts](../../../src/lib/displayProfiles.ts#L1-L31) and [playwright/displayProfileViewports.ts](../../../playwright/displayProfileViewports.ts#L1-L16).
- Compact action grids collapse to two columns through [src/components/layout/PageContainer.tsx](../../../src/components/layout/PageContainer.tsx#L45-L61) and are exercised on Home in [src/pages/HomePage.tsx](../../../src/pages/HomePage.tsx#L838-L907).
- Compact selection browsers are promoted to full-screen via [src/lib/modalPresentation.ts](../../../src/lib/modalPresentation.ts#L39-L63), [src/components/ui/dialog.test.tsx](../../../src/components/ui/dialog.test.tsx#L22-L44), and [src/components/itemSelection/ItemSelectionDialog.test.tsx](../../../src/components/itemSelection/ItemSelectionDialog.test.tsx#L58-L85).
- Playwright verifies no horizontal overflow across Home, Play, Disks, Config, and Settings in [playwright/displayProfiles.spec.ts](../../../playwright/displayProfiles.spec.ts#L371-L384).

Confirmed Compact gaps or residual risks:

- Keyboard-safe proof is still approximation-heavy.
  Evidence: [doc/display-profiles.md](../../../doc/display-profiles.md#L95-L106) and [playwright/displayProfiles.spec.ts](../../../playwright/displayProfiles.spec.ts#L319-L487).
  Why it matters: reduced viewport height is not the same as a live keyboard reducing the visual viewport and obscuring focused inputs.
  Recommended remediation: add a follow-up test that asserts Compact dialog safety against a real keyboard-open or `visualViewport` change when possible.

- Secondary control coverage is still incomplete.
  Evidence: [doc/ux-interactions.md](../../../doc/ux-interactions.md#L58-L73), [doc/ux-interactions.md](../../../doc/ux-interactions.md#L99-L110), and [doc/ux-interactions.md](../../../doc/ux-interactions.md#L326-L367).
  Why it matters: primary CTA coverage is stronger now, but native picker and lower-priority controls can still regress unnoticed.
  Recommended remediation: prioritize native picker, file-type filter, and remaining menu/navigation interactions in the follow-up interaction backlog.

## 6 Expanded Profile Findings

Expanded improvements that are clearly implemented:

- Root font size, page padding, section gap, panel gap, action grid minimum width, and modal max width all scale above Medium in [src/lib/displayProfiles.ts](../../../src/lib/displayProfiles.ts#L60-L91).
- Playwright explicitly checks that Expanded increases root font size, shell padding, and button height relative to Medium in [playwright/displayProfiles.spec.ts](../../../playwright/displayProfiles.spec.ts#L146-L177).
- Shared page-level bounded width is implemented via [src/components/layout/PageContainer.tsx](../../../src/components/layout/PageContainer.tsx#L13-L23).
- Optional secondary-panel layouts exist through `ProfileSplitSection` in [src/components/layout/PageContainer.tsx](../../../src/components/layout/PageContainer.tsx#L63-L89) and are used on Home, Play, and Settings in [src/pages/HomePage.tsx](../../../src/pages/HomePage.tsx#L469-L789), [src/pages/PlayFilesPage.tsx](../../../src/pages/PlayFilesPage.tsx#L951-L1107), and [src/pages/SettingsPage.tsx](../../../src/pages/SettingsPage.tsx#L593-L984).

Expanded limitations:

- Config Browser does not appear to add any Expanded-specific secondary composition; it relies on bounded reading width and global token scaling in [src/pages/ConfigBrowserPage.tsx](../../../src/pages/ConfigBrowserPage.tsx#L614-L646).
- Several lower-level components continue to style around generic breakpoints rather than the Expanded profile directly, so the architecture is only partially normalized.

Assessment: Expanded is implemented beyond “stretched Medium”, but not uniformly. The foundation is real and visible, especially on Home, Play, Settings, and modal sizing, yet some pages still rely mostly on global scaling rather than page-specific Expanded composition.

## 7 Component Compliance Matrix

- `DisplayProfileProvider`, `PageContainer`, `ProfileActionGrid`, and `ProfileSplitSection` remain the strongest shared boundaries: they consume centralized profile state directly and continue to deliver the expected Compact and Expanded variants with low regression risk.
- `SelectableActionList` and `ItemSelectionDialog` now use the shared sheet/modal surface contract directly, giving Compact full-screen behavior and non-Compact modal-sheet behavior without the previously audited `sm:` width branching.
- `QuickActionCard` and `ConfigItemRow` still rely on parent wiring or adaptive measurement for part of their behavior, so they remain more indirect consumers of the profile model than the shared layout primitives.
- `DriveCard`, `HomeDiskManager`, `Dialog` / `AlertDialog`, and `Sidebar` now align more closely with the centralized profile model than they did at the start of the review, with the remaining risk concentrated in future regressions rather than the audited raw-breakpoint debt.

## 8 Modal Compliance

What is compliant:

- The modal resolver distinguishes `confirmation`, `selection-browser`, `list-browser`, `secondary-editor`, `popover`, and `command-palette` in [src/lib/modalPresentation.ts](../../../src/lib/modalPresentation.ts#L1-L83).
- Compact selection and list browsers go full-screen, while confirmation dialogs stay centered, matching the specification in [doc/display-profiles.md](../../../doc/display-profiles.md#L95-L106) and [src/lib/modalPresentation.ts](../../../src/lib/modalPresentation.ts#L39-L63).
- Unit tests confirm Compact full-screen promotion and sticky footers in [src/components/ui/dialog.test.tsx](../../../src/components/ui/dialog.test.tsx#L22-L44) and [src/lib/modalPresentation.test.ts](../../../src/lib/modalPresentation.test.ts#L6-L37).
- Playwright validates viewport-safe dialog geometry in [playwright/displayProfiles.spec.ts](../../../playwright/displayProfiles.spec.ts#L233-L290).

What remains incomplete:

- Compact keyboard-safe proof is still approximation-heavy: the suite now covers diagnostics, item selection, and snapshot manager with focused inputs and reduced viewport height, but it does not yet assert a live soft-keyboard or `visualViewport` transition.

## 9 CTA Reachability

Verified reachability:

- Playwright proves diagnostics CTAs remain reachable in Compact under increased text size, reduced height, and browser zoom in [playwright/displayProfiles.spec.ts](../../../playwright/displayProfiles.spec.ts#L293-L369).
- Source chooser ordering and scoped-selection semantics are preserved across profiles in [playwright/displayProfiles.spec.ts](../../../playwright/displayProfiles.spec.ts#L212-L231).
- Compact Home machine-control grid changes from four to two columns, which helps primary CTA reachability, in [playwright/displayProfiles.spec.ts](../../../playwright/displayProfiles.spec.ts#L122-L144) and [src/pages/HomePage.tsx](../../../src/pages/HomePage.tsx#L838-L907).

Coverage gaps:

- The UX inventory is now reconciled for Home quick actions, Add disks, Shuffle, Reshuffle, Recurse folders, Refresh connection, and System theme in [doc/ux-interactions.md](../../../doc/ux-interactions.md#L42-L44) and [doc/ux-interactions.md](../../../doc/ux-interactions.md#L95-L95).
- Remaining gaps are concentrated in secondary controls such as Android folder picking, some filter controls, and lower-priority Home navigation paths rather than the previously flagged primary display-profile flows.

Assessment: CTA reachability is partially verified, not comprehensively verified. The highest-confidence proof is on diagnostics and broad overflow checks, not on the full CTA inventory.

## 10 Screenshot Coverage

Strengths:

- The screenshot system explicitly supports profile-specific paths through `profileScreenshotPath` in [playwright/screenshots.spec.ts](../../../playwright/screenshots.spec.ts#L45-L49).
- Automated profile captures exist for Home, Disks, Config, Play, Play import, Settings, and Diagnostics in [playwright/screenshots.spec.ts](../../../playwright/screenshots.spec.ts#L478-L483), [playwright/screenshots.spec.ts](../../../playwright/screenshots.spec.ts#L732-L740), [playwright/screenshots.spec.ts](../../../playwright/screenshots.spec.ts#L769-L773), [playwright/screenshots.spec.ts](../../../playwright/screenshots.spec.ts#L804-L812), [playwright/screenshots.spec.ts](../../../playwright/screenshots.spec.ts#L858-L876), [playwright/screenshots.spec.ts](../../../playwright/screenshots.spec.ts#L900-L904), and [playwright/screenshots.spec.ts](../../../playwright/screenshots.spec.ts#L980-L987).
- The repository contains actual profile screenshot folders such as `doc/img/app/home/profiles/compact/`, `doc/img/app/play/profiles/expanded/`, `doc/img/app/config/profiles/medium/`, and similar directories for settings, disks, diagnostics, and play/import.

Gaps:

- Markdown references to profile-specific screenshot folders are still concentrated in specification and planning documents more than the end-user docs.
- Home profile documentation screenshots still need the full-page refresh described in the remediation plan.

## 11 Test Coverage

Strong coverage exists in:

- resolver thresholds and layout token behavior: [src/lib/displayProfiles.test.ts](../../../src/lib/displayProfiles.test.ts#L9-L41)
- provider and override lifecycle: [src/hooks/useDisplayProfile.test.tsx](../../../src/hooks/useDisplayProfile.test.tsx#L37-L240)
- layout primitives: [src/components/layout/PageContainer.test.tsx](../../../src/components/layout/PageContainer.test.tsx#L15-L102)
- modal presentation primitives: [src/components/ui/dialog.test.tsx](../../../src/components/ui/dialog.test.tsx#L22-L68)
- item-selection state persistence across profile changes: [src/components/itemSelection/ItemSelectionDialog.test.tsx](../../../src/components/itemSelection/ItemSelectionDialog.test.tsx#L58-L85)
- end-to-end overflow, source chooser order, modal geometry, and a subset of CTA reachability: [playwright/displayProfiles.spec.ts](../../../playwright/displayProfiles.spec.ts#L110-L384)

Coverage gaps remain in:

- live keyboard-open compact dialogs; current evidence uses reduced viewport height instead of a focused input plus actual visual viewport changes
- live keyboard-safe proof currently centers on the diagnostics dialog path in `playwright/displayProfiles.spec.ts`; equivalent end-to-end proof was not found for selection-browser, snapshot, or other secondary-editor surfaces
- direct end-to-end proof remains incomplete for the secondary CTA paths still open in [doc/ux-interactions.md](../../../doc/ux-interactions.md#L326-L367), especially drive navigation from Home, the disk browser source-selection path, file-type filtering, HVSC installation cancel, drive configuration, disk group management, auto-connect, and log expansion
- explicit tests proving Compact alternatives for slider-heavy or drag-sensitive controls beyond the diagnostics CTA case

## 12 Technical Debt

- Most high-value raw-breakpoint debt identified in the audit has been removed from the targeted Review 9 surfaces, but Compact visual tuning and screenshot stewardship remain active work.
- Some components adapt through parent-provided booleans or generic measured layout rather than consuming the profile context directly. This is workable but inconsistent.
- There is no automated enforcement preventing future reintroduction of independent breakpoint logic.
- Documentation still needs to keep the regenerated profile screenshots aligned with the current UI output.

## 13 Required Remediation

Priority 1:

- Remove remaining ad hoc breakpoint branching from shared modal, list, selection, stream, snapshot, drive, and playback components; route those decisions through display-profile-aware helpers.
- Add true keyboard-open Compact dialog tests that focus live inputs and assert title, primary field, and primary action visibility.

Priority 2:

- Make `DriveCard` explicitly profile-aware so Compact metadata stacking is guaranteed by component contract rather than page composition.
- Keep eliminating measurement- or caller-owned layout branching where the component can derive Compact vs Medium vs Expanded behavior directly from the display-profile contract.

Priority 3:

- Close the remaining CTA coverage gaps documented in the UX interactions inventory, prioritizing Home drive navigation, disk-browser source selection, filter controls, HVSC cancel, drive configuration, disk groups, auto-connect, and log expansion.
- Update README to describe the display-profile override, the meaning of Small/Standard/Large display, and how profile-specific screenshots are organized.

## 14 Final Verdict

The Display Profiles system is real and materially implemented, not superficial. The centralized resolver, provider, shared layout primitives, modal routing, Expanded scaling, Compact full-screen dialog promotion, profile screenshots, and dedicated Playwright matrix all prove that the feature exists.

It still does not fully meet the specification because the repository has not finished centralizing profile branching and has not fully closed the verification gap for Compact keyboard safety and CTA reachability. The current state should be described as: architecturally sound, largely functional, but not fully compliant.
