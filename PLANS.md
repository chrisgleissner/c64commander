# HVSC Workflow Convergence Plan

## Classification

- `CODE_CHANGE`
- escalate to `DOC_PLUS_CODE` only if validation or operator docs must change to match the final implementation

## Required Outcome

- Fix the real HVSC workflow so the app uses one reliable ingestion and browse source of truth.
- Preserve HVSC metadata through selection, playlist import, persistence, and playback.
- Strengthen CI-safe regression coverage across web/runtime, playlist scale, and Android-native ingest.
- Attempt real HIL validation on a physical Pixel 4 against a real C64U with `c64scope` audio proof.
- End only in `COMPLETE`, `FAILED`, or `BLOCKED`.

## Execution Plan

1. Read the mandated repo, UX, Maestro, HVSC, playback, playlist, Android, Playwright, and `c64scope` files.
2. Map the current source of truth for HVSC ingest, browse, import, playlist persistence, playback routing, and HIL proof.
3. Identify the concrete root cause(s), especially metadata loss, store divergence, or large-list materialization.
4. Implement the smallest coherent fix in app and native layers.
5. Add dedicated regression coverage for every confirmed bug fixed.
6. Run CI-safe validation: `npm run lint`, `npm run test`, `npm run test:coverage`, `npm run build`, `cd android && ./gradlew test`, plus any focused suites needed while iterating.
7. Run HIL preflight for attached Android hardware and C64U reachability.
8. If preflight passes, execute cold, warm-cache, and large-playlist HIL runs with `c64scope` audio capture and archive artifacts.
9. Record all evidence in `WORKLOG.md` and report the terminal state precisely.

## Open Questions To Resolve During Audit

- Does the JS HVSC browser query the same native-ingested store that Android ingest populates?
- Where do duration, song length, and subsong fields first enter the app model, and where can they be dropped?
- Does the current HVSC browser or playlist flow materialize too much data in memory for large folders or playlists?
- What existing coverage proves only mock/web behavior versus native ingest and true hardware playback?
- Are current HIL primitives sufficient to correlate app-driven playback with captured C64U audio?

# Health Badge Overflow Fix Plan

## Classification

- `UI_CHANGE`
- `CODE_CHANGE`
- documentation asset refresh limited to `docs/img/app/settings/header/`

## Affected Files

- `src/components/UnifiedHealthBadge.tsx`
- `src/lib/diagnostics/healthModel.ts`
- `src/components/AppBar.tsx` only if required for badge shrink behavior
- `tests/unit/components/UnifiedHealthBadge.test.tsx`
- `tests/unit/lib/diagnostics/healthModel.test.ts`
- `playwright/connectionStatusLayout.spec.ts` or `playwright/layoutOverflow.spec.ts`
- `playwright/screenshots.spec.ts`
- `playwright/displayProfileViewports.ts` if existing helpers require extension
- `docs/img/app/settings/header/`
- `WORKLOG.md`

## Implementation Order

1. Read the required repo guidance, badge implementation, shared formatter, tests, and screenshot harness.
2. Confirm the exact badge text contract and the smallest badge-local overflow containment change.
3. Refactor the shared formatter in `healthModel.ts` so visible text rules and count capping live in one place.
4. Update `UnifiedHealthBadge.tsx` to consume the shared formatter contract and add badge-local overflow safety.
5. Touch `AppBar.tsx` only if the current flex row prevents the badge from shrinking.
6. Add deterministic unit regression coverage for formatter output and rendered badge DOM behavior.
7. Add one targeted Playwright overflow regression for the header on `/settings`.
8. Extend the screenshot harness to capture only the settings header badge matrix into `docs/img/app/settings/header/`.
9. Run required validation: `npm run lint`, `npm run test`, `npm run test:coverage`, `npm run build`, targeted Playwright regression, targeted screenshot generation.
10. Update `WORKLOG.md` with evidence, outputs, screenshot paths, and any issues resolved.

## Test Plan

- Unit: expand `tests/unit/lib/diagnostics/healthModel.test.ts` with profile, health-state, and count-capping coverage.
- Unit: expand `tests/unit/components/UnifiedHealthBadge.test.tsx` with DOM assertions for nowrap, overflow containment, text rendering, and click behavior.
- Browser: add one deterministic `/settings` header overflow regression proving no badge, header-row, or page-level horizontal overflow in compact and medium worst cases.
- Validation: run `npm run lint`, `npm run test`, `npm run test:coverage`, and `npm run build`.

## Screenshot Plan

- Use the existing Playwright screenshot harness.
- Capture only the settings header area containing the title and badge.
- Regenerate only `docs/img/app/settings/header/`.
- Cover the required compact, medium, and expanded cases for healthy, degraded, and unhealthy visible outputs, including `999+` capping.

## Completion Checklist

- [x] Shared visible badge formatter caps visible counts at `999+`.
- [x] Compact, medium, and expanded badge outputs match the required grammar.
- [x] Offline and not-yet-connected badge text remains unchanged.
- [x] Badge remains single-line and shrink-safe within the header.
- [x] Regression tests cover formatter, DOM rendering, and browser overflow behavior.
- [x] Targeted header screenshots exist under `docs/img/app/settings/header/`.
- [x] `npm run lint` passes.
- [x] `npm run test` passes.
- [x] `npm run test:coverage` passes with global branch coverage `>= 91%`.
- [x] `npm run build` passes.
- [x] `WORKLOG.md` records inspections, edits, commands, results, and screenshot outputs.

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
