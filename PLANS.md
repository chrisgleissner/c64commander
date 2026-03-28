# Overlay And Scroll Containment Plan

## Classification

- `UI_CHANGE`
- `CODE_CHANGE`

## Task Breakdown

1. Audit the shared app shell and all overlay primitives.
2. Introduce a deterministic global overlay stack manager with depth-aware backdrops and badge-safe layering.
3. Move page scrolling into a single bounded app viewport with explicit header and tab-bar offsets.
4. Update shared overlay and layout tests to lock in the new behavior.
5. Regenerate only the screenshots whose rendered output changed.
6. Run the required validation matrix and record evidence.

## Affected Components

- App shell and navigation:
  - `src/App.tsx`
  - `src/components/SwipeNavigationLayer.tsx`
  - `src/components/TabBar.tsx`
  - shared app header component(s)
- Overlay primitives:
  - `src/components/ui/dialog.tsx`
  - `src/components/ui/sheet.tsx`
  - `src/components/ui/alert-dialog.tsx`
  - `src/components/ui/popover.tsx`
  - `src/components/ui/app-surface.tsx`
  - `src/components/ui/interstitial-state.tsx`
  - `src/components/ui/interstitialStyles.ts`
- Pages and page containers that currently own scrolling.
- Regression tests and screenshot capture specs.

## Detection Strategy

1. Enumerate every overlay entry point from the shared primitives and all direct usages.
2. Trace the current z-index and backdrop model to find places where nested overlays reuse a single dim layer.
3. Trace the app shell to find where header and bottom-nav offsets are currently implicit.
4. Search for page-level `overflow`, `min-h-screen`, `h-screen`, `100vh`, `100dvh`, and fixed-position assumptions that can bypass a bounded scroll frame.
5. Use targeted Playwright coverage to prove nested overlay depth and scroll containment on representative flows.

## Verification Steps

1. Unit tests for overlay depth registration, z-index assignment, and backdrop opacity per depth.
2. Unit tests for shared app shell offsets and bounded scroll viewport behavior.
3. Playwright tests for popup-over-sheet, popup-over-popup, and nested modal flows.
4. Playwright screenshot regeneration only for changed surfaces.
5. Validation runs:
   - `npm run lint`
   - `npm run test`
   - `npm run test:coverage`
   - `npm run build`
   - targeted Playwright flows
   - Maestro validation if executable in this environment
