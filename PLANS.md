# Diagnostics UX Production-Grade Plan

Status: IN PROGRESS
Classification: UI_CHANGE
Date: 2026-03-21

## Objective

Fix all remaining Diagnostics UX and layout issues to production-grade quality by enforcing evidence-first layout, unified filtering, maximum density, strict progressive disclosure, zero redundant text, and deterministic testable UI behavior.

## Phases

### Phase 1 - Header Replacement

- Replace header with compact 4-line block: health glyph+state, device+address, last check time, run health check button.
- Remove "Diagnostics" subtitle, "Health summary", "Technical details" from default view.
- Header default: collapsed. Tap to expand for latency percentiles.

Acceptance criteria:
- Header matches 4-line spec exactly.
- No legacy header elements remain.

### Phase 2 - Evidence-First Layout

- Strict vertical order: header (collapsed ~80px), evidence (immediately visible), controls.
- Remove latency summary and technical details from top.
- Evidence shows at least 2 entries without scrolling on compact viewport.

Acceptance criteria:
- Evidence visible without scrolling.
- No placeholder rows.

### Phase 3 - Filter System Unification

- Remove tabs (Problems/Actions/Logs/Traces).
- Remove inline severity and contributor filters.
- Replace with single collapsed filter bar with chips.
- Max 2 visible chips, overflow as +N.

Acceptance criteria:
- Only ONE filtering mechanism exists.
- No wrapping, no horizontal scroll.

### Phase 4 - Filter Editor (Bottom Sheet)

- Keep bottom sheet pattern.
- Show count summary, type/contributor/severity chips (inline layout).
- Add quick filters: Errors only, Problems only, Reset.
- Immediate apply (no Apply button).
- Reduce vertical spacing ~30%.

Acceptance criteria:
- Filter editor dense and non-scrolling on standard mobile.
- No explanatory text.

### Phase 5 - Text Elimination

- Remove all explanatory/descriptive text.
- Remove "Showing X of Y", "Latest HH:MM", "Purpose", "Interpretation", etc.
- Replace "Recent evidence" with "Evidence".

Acceptance criteria:
- Zero explanatory sentences in any diagnostics surface.

### Phase 6 - Density Optimization

- Reduce vertical spacing globally ~20-30%.
- Compact section headers.
- Inline buttons where possible.
- Move Share/Clear into overflow menu.

Acceptance criteria:
- No visible empty vertical space > 25% of screen.

### Phase 7 - Evidence List Cleanup

- Remove letter + colored dot severity indicators.
- Use severity color dot only.
- Consistent alignment, minimal horizontal noise.

Acceptance criteria:
- No mixed severity indicators.

### Phase 8 - Overlay Consistency

- All secondary screens use back arrow + title header.
- Consistent navigation style.

Acceptance criteria:
- No mixed modal + navigation patterns.

### Phase 9 - Data Realism

- Health history: ≥70% healthy, ≥2 degraded spikes, ≥1 unhealthy, recovery present.
- Latency: non-zero realistic values, multiple percentiles.

Acceptance criteria:
- Data appears realistic and varied (already satisfied by existing seeds).

### Phase 10 - Final Validation

- Generate required screenshots.
- Run lint, test, build, coverage.

Acceptance criteria:
- All screenshots pass.
- Branch coverage ≥91%.

## Risks

- Tab removal affects evidence-tab test selectors in Playwright.
- Filter unification changes test data-testid references.
- Density changes may affect compact viewport evidence visibility.

## Rollback Strategy

Revert DiagnosticsDialog.tsx to prior commit. All changes are isolated to this component and its direct sub-components.

- Revert the diagnostics component files and screenshot capture changes as one unit.
- Restore the previous diagnostics test expectations if the redesign must be backed out.
- Keep storage keys unchanged so rollback does not require migration.
