# Page Header Density Fix Prompt

## Role

You are a senior UI engineer working on the C64 Commander React + Vite + Capacitor app at `/home/chris/dev/c64/c64commander`.

Implement a minimal, deterministic fix for the main page-header density regression across all display profiles.

Read and follow `AGENTS.md` and `.github/copilot-instructions.md` first.

## Mandatory Read Order

Read only this minimum set before editing:

1. `README.md`
2. `.github/copilot-instructions.md`
3. `AGENTS.md`
4. `docs/ux-guidelines.md`
5. `docs/plans/ux/page-header-density-research.md`
6. `src/components/AppBar.tsx`
7. `src/components/UnifiedHealthBadge.tsx`
8. `src/components/layout/AppChromeContext.tsx`
9. `src/components/layout/PageContainer.tsx`
10. `src/hooks/useDisplayProfile.tsx`
11. `src/lib/displayProfiles.ts`
12. `src/pages/HomePage.tsx`
13. `tests/unit/components/AppBar.test.tsx`
14. `tests/unit/components/AppBar.layout.test.tsx`
15. `tests/unit/pageShellClearance.test.ts`
16. `playwright/layoutOverflow.spec.ts`
17. `playwright/screenshots.spec.ts`
18. `playwright/displayProfileViewports.ts`
19. `src/components/TabBar.tsx`
20. `src/index.css`
21. `src/components/ui/interstitialStyles.ts`
22. `tests/unit/components/ui/interstitialStyles.test.ts`
23. `src/components/ui/app-surface.tsx`
24. `playwright/modalConsistency.spec.ts`

## Task Classification

Classify this as `UI_CHANGE`.

This is a code change with documentation screenshot impact. Follow the minimal screenshot update rule from `.github/copilot-instructions.md`.

## Problem Statement

The current main page header wastes too much vertical space above and below the page title, especially outside the `compact` profile.

The product decision from `docs/plans/ux/page-header-density-research.md` is:

- all display profiles should converge on the dense `compact` header approach
- the health badge must remain always visible
- the badge must not become a free-floating overlay on top of scrollable content
- the page title must not fully disappear in this pass
- the badge should feel like calm, integrated status chrome rather than a separate bordered button if that can be achieved without harming discoverability or accessibility
- the header must visually align with the fixed footer/tab bar so the app feels deliberately framed top and bottom

## Current Repo Reality You Must Account For

- `src/components/AppBar.tsx` currently applies:
  - `paddingTop: 0px` only for `compact`
  - `paddingTop: var(--app-header-top-inset, env(safe-area-inset-top))` for the other profiles
- `src/hooks/useDisplayProfile.tsx` currently writes:
  - `--app-header-top-inset = 0px` for `compact`
  - `--app-header-top-inset = env(safe-area-inset-top)` for `medium` and `expanded`
- `src/components/AppBar.tsx` also adds profile-dependent internal vertical padding through the shell container.
- The footer is not generic page content. It is the fixed primary navigation rail:
  - `src/components/TabBar.tsx`
  - `.tab-bar` in `src/index.css`
  - `--app-tab-bar-reserved-height: calc(5rem + env(safe-area-inset-bottom))`
- This means the app already has a strong bottom frame, while the top frame is currently less disciplined and more profile-dependent.
- `src/pages/HomePage.tsx` uses custom leading content with the C64 Commander logo and title, so Home must not be forgotten.
- `tests/unit/components/AppBar.test.tsx`, `tests/unit/components/AppBar.layout.test.tsx`, and `playwright/layoutOverflow.spec.ts` currently encode the old “compact only gets zero top inset” contract and must be updated honestly.
- The persistent badge already has important constraints that must stay intact:
  - `src/components/UnifiedHealthBadge.tsx`
  - `data-testid="unified-health-badge"` remains stable
  - click still opens diagnostics
  - the badge remains always visible
- Bottom-sheet safe-zone behavior is already enforced through:
  - `src/components/ui/interstitialStyles.ts`
  - the badge/title safe-zone assertions and sheet-top calculations in that file
- The app shell already reserves vertical space for the app bar via:
  - `src/components/layout/AppChromeContext.tsx`
  - `src/components/layout/PageContainer.tsx`

## Goal

Make the main page header materially denser and more consistent without introducing surprise, overlap, or navigation ambiguity.

The user-visible goal is:

- no extra blank band above the title on `medium` and `expanded`
- no more “taller than necessary” page headers outside `compact`
- same dense header approach on all display profiles
- health badge always visible in a stable position
- health badge visually integrated into the header rather than boxed off from it
- title and badge still read as one coherent header row
- visible header chrome feels balanced with the footer/tab bar chrome
- no badge floating over the page body
- bottom sheets extend upward to reclaim newly freed space but still never overlap the title or badge

## Non-Negotiables

- Do not introduce a free-floating badge overlay on top of page content.
- Do not let the badge cover tappable controls, focusable controls, or first-row content.
- Do not fully hide the page title on scroll in this pass.
- Do not create bespoke per-page header logic.
- Do not break `Home` page leading-content behavior.
- Do not break badge click behavior or diagnostics integration.
- Do not remove button semantics, keyboard focus visibility, or a sufficiently large badge hit target.
- Do not break `--app-bar-height` publication.
- Do not make the header/footer match by changing the footer into a different navigation pattern.
- Do not remove the shared header background/scrim.
- Do not weaken overflow protections already added for the badge.
- Do not leave bottom sheets using stale top-clearance math after the header height changes.
- Do not refresh screenshots outside the pages whose visible header chrome actually changed.

## Implementation Direction

### 1. Converge the top inset contract

Implement the product decision that the app window already starts below device chrome for the supported runtime configuration used by this app.

Converge the main page header to the same top-inset behavior across `compact`, `medium`, and `expanded`.

That means:

- remove the special-case “extra top inset only for non-compact profiles” behavior from the main page header path
- update the display-profile root token contract if needed so the app header no longer reintroduces redundant top chrome outside `compact`

If local validation reveals a real cutout/system-bar regression on a supported runtime, add the narrowest explicit exception and document it. Do not keep the old blanket spacing as a fallback.

### 2. Reduce header-internal vertical padding

Make the `AppBar` use a dense single-row layout across all display profiles.

Aim for:

- top and bottom internal padding that are closer to current `compact`
- no visibly larger “air gap” above the title than below it
- one stable row with title left and badge right

Do not compress the badge hit target below accessibility expectations.

### 3. Align header rhythm with the footer rail

Treat the header and fixed tab bar as the app’s two framing rails.

The requirement is optical alignment of visible chrome, not naive equality of total measured box height, because top and bottom safe-area compensation differ.

That means:

- align the visible header band with the visible footer band as closely as practical
- align the header’s internal top/bottom padding rhythm with the footer’s internal top/bottom padding rhythm
- keep the same disciplined horizontal shell feel top and bottom
- make the app feel intentionally framed rather than top-light and bottom-heavy

Ground this in the actual footer contract:

- `src/components/TabBar.tsx`
- `.tab-bar` and `.tab-item` in `src/index.css`

Prefer introducing shared app-chrome tokens if that makes the result clearer and more maintainable.

### 4. Keep the badge inside dedicated header chrome

The badge must remain:

- pinned
- visible
- inside the app bar
- visually associated with the page title

The badge must not:

- hover over the scrollable page body
- occlude content beneath it
- intercept taps intended for content beneath it

### 5. Quiet the badge chrome

Treat the health badge as persistent status with secondary action behavior, not as a primary call-to-action button.

Calm-design direction:

- reduce unnecessary visual chrome
- avoid a heavy always-visible capsule/border treatment if a quieter treatment works
- make the badge feel integrated with the header title row rather than detached from it

Preferred outcome:

- remove or substantially soften the default rounded bordered-button look
- preserve the existing minimum touch target
- preserve keyboard-visible focus styling
- preserve clear pressed/hover behavior where applicable
- preserve affordance that the badge opens diagnostics

Do not solve this by making the badge ambiguous, too low-contrast, or too small to interact with reliably.

### 6. Reclaim space for workflow sheets

Once the page header becomes shorter, workflow sheets should use the recovered vertical space.

That means:

- extend bottom sheets upward to the new safe top position
- update any sheet-top and overlap math that still assumes the old taller header
- keep the existing invariant that sheets may not overlap the header title or badge critical content

Ground this work in the existing shared overlay system, not per-screen hacks:

- `src/components/ui/interstitialStyles.ts`
- `src/components/ui/app-surface.tsx`

If the badge loses its visible border, do not keep a stale “badge border” overlap rule purely for historical reasons. Preserve the real safe zone around title and badge content.

### 7. Add the smallest calm-design refinements that reinforce balance

Without redesigning the app, prefer small high-signal refinements that make the new header feel calmer and more premium:

- reduce unnecessary shadow weight if the current header shadow feels heavier than the footer divider
- keep one restrained border/divider language between header and footer rather than mixed heavy effects
- preserve stable vertical centering for title, badge, and Home logo
- keep horizontal alignment crisp so title start and content start feel intentional
- avoid decorative flourishes that add visual noise

These refinements must stay within header/footer chrome and must not cascade into a broader app redesign.

### 8. Preserve stable page identity

Keep the visible page title in the header for this pass.

You may make the header denser. You may not turn the page into a “badge-only while scrolling” experience in this change.

If you need to trim visual weight, prefer:

- smaller padding
- tighter Home leading-content sizing
- tighter vertical alignment

Do not solve this by removing the visible title.

## Files Most Likely to Change

- `src/components/AppBar.tsx`
- `src/hooks/useDisplayProfile.tsx`
- `src/lib/displayProfiles.ts`
- `src/pages/HomePage.tsx`
- `src/components/TabBar.tsx`
- `src/index.css`
- `src/components/ui/interstitialStyles.ts`
- `src/components/ui/app-surface.tsx`
- `tests/unit/components/AppBar.test.tsx`
- `tests/unit/components/AppBar.layout.test.tsx`
- `tests/unit/components/ui/interstitialStyles.test.ts`
- `playwright/modalConsistency.spec.ts`
- `playwright/layoutOverflow.spec.ts`
- `playwright/screenshots.spec.ts`

Only touch other files if strictly necessary.

## Test Requirements

You must add or update targeted regression coverage.

### Unit

Update `tests/unit/components/AppBar.test.tsx` and `tests/unit/components/AppBar.layout.test.tsx` so they prove:

- the header no longer uses the old “non-compact safe-area top padding” contract
- all profiles use the dense header approach
- the header still renders one stable row
- the badge remains present
- the badge chrome is quieter and no longer reads as the old heavy bordered capsule if you change that styling
- the visible header-band rhythm is intentionally aligned with the footer/tab-bar rhythm, excluding platform safe-area padding
- sticky and fixed app-chrome modes still work

Update `tests/unit/components/ui/interstitialStyles.test.ts` if needed so it proves:

- workflow-sheet top clearance tracks the new shorter header
- the title safe zone remains protected
- the badge safe zone remains protected
- sheet math does not rely on stale old-header assumptions

### Playwright

Update or add the smallest honest layout coverage in `playwright/layoutOverflow.spec.ts` to prove:

- all display profiles use the new dense header top-inset behavior
- the app bar and badge still avoid horizontal overflow
- the badge remains visible after page scroll
- the badge stays within the header region rather than overlapping the page body
- workflow sheets reclaim the freed space and open higher than before without intersecting title or badge safe zones
- the visible header band is balanced against the visible footer/tab bar instead of feeling noticeably taller or looser

Prefer deterministic assertions using bounding boxes and computed metrics.

If `playwright/modalConsistency.spec.ts` is the better seam for proving the page remains correctly framed between header and fixed tab bar, extend it there instead of duplicating the same proof elsewhere.

### Coverage and Build

Because this is a code change, before completion run the required validation set:

1. `npm run lint`
2. `npm run test:coverage`
3. `npm run build`
4. the smallest targeted Playwright suite that honestly proves the header change

Do not skip failures. Fix root causes.

## Screenshot Requirements

This change affects visible app-header chrome, so documentation screenshots that clearly show the main page header must be refreshed.

Before regenerating screenshots:

1. map only the screenshots where the changed header is clearly visible
2. refresh only those files
3. keep filenames and folder structure stable unless a repo-local reason requires otherwise

Expected scope:

- main page overview screenshots whose top app header is visible
- any dedicated header screenshot coverage already maintained in `docs/img/app/settings/header/`
- the smallest bottom-sheet screenshots whose visible top edge changes because the sheet now opens higher
- only the smallest screenshots needed to show the improved header/footer framing if that framing is visible in the captured surface

Do not bulk-refresh section screenshots that crop out the changed header area.

Use the existing screenshot harness in `playwright/screenshots.spec.ts`.

## Acceptance Criteria

The change is complete only when all of the following are true:

1. `compact`, `medium`, and `expanded` all use the same dense main-header top-inset strategy.
2. The visible blank space above the page title is drastically reduced on non-compact profiles.
3. The header remains a single coherent row with title left and badge right.
4. The health badge is always visible.
5. The badge no longer feels like unnecessarily heavy bordered button chrome if that styling is changed.
6. The badge never becomes a free-floating overlay on top of page content.
7. The visible page title remains present in this pass.
8. Home’s custom logo/title leading content still looks intentional and vertically aligned.
9. Bottom sheets reclaim the newly available space and open higher without overlapping the title or badge.
10. The visible header rail feels balanced with the fixed footer/tab bar rail, with safe-area padding treated separately from visible chrome.
11. Any added calm-design refinements stay restrained and limited to header/footer framing.
12. Updated tests prove the new contract instead of the old one.
13. Screenshot refresh is limited to the affected header-visible surfaces only.

## Completion Notes

When you finish, report:

- what changed
- which tests and builds were run
- which screenshot files or folders were updated
- why broader screenshot refresh was not needed
