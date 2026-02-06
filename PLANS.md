# PLANS.md — Diagnostics Density & Timestamp Consistency

## Scope
- Improve collapsed diagnostics entry density and alignment across Errors, Logs, Traces, Actions.
- Enforce one canonical timestamp format and typography across all tabs.
- Preserve rounded borders, existing theme, and expand/collapse behavior.

## Assumptions
- Diagnostics tabs share reusable list item rendering or can be normalized to a shared component.
- Playwright + screenshot harnesses are the source of visual verification.

## Execution Plan
1. [x] Audit current diagnostics UI, layout, and timestamp formatting per tab.
2. [x] Define shared severity + timestamp utilities with deterministic output.
3. [x] Implement compact collapsed layout: single-line severity glyph, shared left column, reduced padding.
4. [x] Add expanded severity label mapping to full names.
5. [x] Normalize Errors/Logs/Traces/Actions to shared layout + timestamp component.
6. [x] Add/update unit tests for severity mapping, timestamp formatting, and no-wrap glyph.
7. [x] Add/update integration + visual tests and capture diagnostics screenshots.
8. [x] Run full local test suite and Android build.

## Test Gates
- [x] `npm run test`
- [x] `npm run lint`
- [x] `npm run build`
- [x] `./build`

## Verification Notes
- `./build` completed with Playwright + Gradle tests green.
- Diagnostics screenshots updated and stored under `doc/img/app/diagnostics`.
