# Page Header Density and Persistent Badge Research

## Question

Should C64 Commander:

1. drastically reduce the vertical padding above and below the page title on every page
2. use the current `compact` header approach for every display profile
3. let the page title scroll away so only the health badge stays visible
4. allow that badge to float over the page content beneath it

## Current Repo Reality

- The main page header is `src/components/AppBar.tsx`.
- The persistent status control is `src/components/UnifiedHealthBadge.tsx`.
- The page scroll container is `src/components/layout/PageContainer.tsx`.
- The fixed/sticky page-shell clearance is managed by `src/components/layout/AppChromeContext.tsx`.
- `src/hooks/useDisplayProfile.tsx` currently writes `--app-header-top-inset` as:
  - `0px` for `compact`
  - `env(safe-area-inset-top)` for `medium` and `expanded`
- `src/components/AppBar.tsx` then adds extra vertical shell padding inside the header on top of that inset.
- Because the page shell already starts below the app bar, the current issue is not missing clearance below the header. The issue is wasted vertical chrome inside the header itself.

## External Findings

### 1. A small, stable top bar is the standard answer when a screen does not need heavy top-level navigation

Android’s top app bar guidance says:

- the top app bar is the place for current-screen information and key actions
- a `Small` top app bar is for screens that do not require much navigation or many actions
- scroll behavior should be an explicit choice such as `pinned`, `enterAlways`, or `exitUntilCollapsed`

That is directionally important here. Most C64 Commander pages have one page title and one persistent status control, so they match the “small top app bar” case more than the “large hero header” case.

Source:

- https://developer.android.com/develop/ui/compose/components/app-bars

### 2. Edge-to-edge guidance supports reducing wasted top chrome, but only if overlaps are handled deliberately

Android’s edge-to-edge guidance says:

- the top app bar should stretch to the top edge of the screen
- it may shrink when content scrolls
- tappable views that must not be visually obscured need inset handling
- visual overlaps must be handled explicitly

This supports reducing redundant top padding. It does not support letting important interactive UI float randomly over other interactive content.

Source:

- https://developer.android.com/develop/ui/views/layout/edge-to-edge

### 3. Persistent overlays that cover focusable or tappable content are an accessibility and usability risk

W3C’s WCAG 2.2 guidance on Focus Not Obscured explicitly calls out sticky headers, sticky footers, and persistent disclosures as common overlap risks. It recommends approaches that avoid overlap, including:

- reflowing or displacing content
- constraining focus to the overlay if it behaves like a modal
- using `scroll-padding`
- auto-dismissing non-persistent overlays on focus loss

That is directly relevant to the proposed “badge stays on top of scrolling content” idea. A persistent floating badge can obscure focused controls, cover tap targets, and make the UI feel unpredictable.

Source:

- https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html

### 4. Consistent placement matters, especially for users who depend on predictability and low cognitive load

W3C’s cognitive accessibility guidance recommends:

- a consistent visual design across groups of pages
- consistent layout across content blocks
- consistent positions for interactive elements and navigational controls

That aligns with the user’s concern about surprise, safety, and single-tasking. A badge that changes from “part of the header” into “floating over arbitrary content” risks breaking that consistency.

Source:

- https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p03-consistent-design/

### 5. Small persistent controls still need spacing so they do not interfere with adjacent targets

WCAG 2.2 Target Size guidance says undersized targets need enough spacing so their interaction zones do not intersect adjacent targets. A badge that sits directly over scrollable content can create the same practical problem even if the badge itself is valid: it occupies tap space that the user expects to belong to the content below.

Source:

- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum

### 6. The “digital detox / single-tasking” audience is better served by calm peripheral status than by attention-grabbing overlay tricks

Calm Tech Institute’s principles emphasize:

- requiring the smallest possible amount of attention
- informing and creating calm
- making use of the periphery
- using the minimum tech needed to solve the problem

This is a strong fit for C64 Commander’s target audience. A quiet, always-visible badge in a stable position fits that model. A badge that hovers over changing content does not.

Source:

- https://www.calmtech.institute/calm-tech-principles

## Synthesis

### What the research supports

- Yes: reduce the wasted vertical space in the page header.
- Yes: converge all display profiles toward a single dense top-bar pattern.
- Yes: keep the health status always visible.
- Yes: use a stable, peripheral location for that status control.

### What the research does not support

- No: let the health badge float directly over arbitrary page content.
- No: create a persistent overlay that can block taps or hide keyboard focus.
- No: introduce a scroll effect that changes the page from “header + badge” into “random badge over content”.

## Recommendation

### Recommended product decision

Adopt the `compact` header density model across all display profiles, but do not ship a free-floating badge overlay.

That means:

- remove the extra top inset behavior that currently only affects `medium` and `expanded`, assuming real validation still confirms the app window already starts below device chrome
- materially reduce header-internal vertical padding on every profile
- keep one stable header row with title on the left and health badge on the right
- keep the health badge always visible inside reserved header chrome, not on top of the page body

### Recommendation on title-on-scroll behavior

Do not make the page title fully disappear in the first fix.

Reason:

- most of the space win comes from removing redundant top padding, not from hiding one text line
- the footer already tells the user which page they are on, so the header can be smaller without becoming invisible
- a stable title plus stable badge is calmer and more predictable than a dynamic badge-only overlay

### If a later experiment is still desired

If a later iteration still needs more vertical space, the safer pattern is:

- keep a reserved pinned header strip with its own background
- let the header compress within that strip
- keep the badge inside that strip
- only de-emphasize the title if the transition is subtle, reversible, and never causes overlap with the page body

That is materially safer than a badge floating directly over content.

## Repo-Level Implications

- The main behavioral seam is `src/components/AppBar.tsx`.
- The profile-level inset contract currently lives in `src/hooks/useDisplayProfile.tsx`.
- `src/lib/displayProfiles.ts` defines the per-profile padding tokens and may need to be updated if the header density should become profile-independent.
- `src/pages/HomePage.tsx` has custom leading content with a logo, so it must be checked explicitly.
- Existing tests already lock in the current behavior:
  - `tests/unit/components/AppBar.test.tsx`
  - `tests/unit/components/AppBar.layout.test.tsx`
  - `playwright/layoutOverflow.spec.ts`
- Existing screenshot coverage already includes page headers and settings badge captures:
  - `playwright/screenshots.spec.ts`

## Final Recommendation

Ship this as a compact, stable header change:

- all profiles use the same dense top-header approach
- no extra blank space above the title
- no badge-over-content overlay
- no full title disappearance in this pass
- badge remains always visible, always in the same place, always inside dedicated header chrome

## Sources

- Android Developers, App bars: https://developer.android.com/develop/ui/compose/components/app-bars
- Android Developers, Display content edge-to-edge in views: https://developer.android.com/develop/ui/views/layout/edge-to-edge
- W3C, Understanding SC 2.4.11 Focus Not Obscured (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- W3C, Use a Consistent Visual Design: https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p03-consistent-design/
- W3C, Understanding SC 2.5.8 Target Size (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- Calm Tech Institute, Principles: https://www.calmtech.institute/calm-tech-principles
