# Diagnostics Overlay Redesign Plan

Status: COMPLETE
Classification: UI_CHANGE + DOC_PLUS_CODE
Date: 2026-03-21

## Objective

Deliver a diagnostics experience that surfaces evidence first, keeps configuration secondary, removes redundant wording, and converges through deterministic tests and screenshots.

## Phases

### Phase 1 - Audit

- Identify current layout violations against the target overlay structure.
- Identify redundant copy, duplicated state, and nested-surface confusion.
- Map deterministic seed points for evidence, latency, and health history.

Acceptance criteria:

- Existing diagnostics surfaces and screenshot hooks are mapped.
- Violations are recorded in this plan and then addressed in later phases.

### Phase 2 - Header + Connection

- Replace the header with the required four-line compact health block.
- Make the health block collapsible and default-collapsed in activity scenarios.
- Implement tap-to-view and long-press-to-edit connection details.
- Stage host, HTTP port, and FTP port changes and save atomically.

Acceptance criteria:

- Header matches the required structure.
- Connection details open in view mode on tap and edit mode on long press.
- Host and port validation rejects invalid input.

### Phase 3 - Filter System

- Replace inline filter expansion with a one-line collapsed filter bar.
- Add a dedicated filter editor surface.
- Keep state visibility separate from configuration.

Acceptance criteria:

- Filter chips are visible in one line.
- Filter editor opens in one tap.
- Mobile uses a sheet and expanded layouts use a side panel.

### Phase 4 - Evidence Visibility

- Reorder the overlay to header, evidence, then controls.
- Keep evidence visible in the default screenshot without scrolling.
- Keep Problems and Actions useful by default while Logs and Traces remain opt-in.

Acceptance criteria:

- Evidence is visible without scrolling.
- Controls do not obscure the evidence panel.

### Phase 5 - Text Cleanup + Latency

- Remove all explanatory prose and duplicated labels.
- Rename surfaces to Diagnostics, Evidence, and Latency.
- Simplify latency to chart plus P50, P90, and P99 with filter sheet access.

Acceptance criteria:

- No diagnostic UI contains purpose, interpretation, in view, or current scope wording.
- Latency contains zero descriptive paragraphs.

### Phase 6 - Timeline + Data

- Use deterministic diagnostics seeds with realistic severity variation.
- Render continuous health bars with healthy, degraded, unhealthy, and recovery segments.
- Show timestamp and cause on timeline selection.

Acceptance criteria:

- Timeline contains realistic variation and at least one unhealthy segment.
- Selected timeline segments show timestamp and cause.

### Phase 7 - Screenshots + Validation

- Update screenshot capture flow for the required diagnostics artifacts.
- Add and update unit tests for the new overlay behavior.
- Run targeted UI validation plus repository-required validation.

Acceptance criteria:

- Required screenshots are generated.
- Relevant unit tests, coverage, lint, and build pass.
- Diagnostics-specific Playwright validation passes.

## Risks

- Existing diagnostics tests and screenshots are coupled to the previous summary/details/tools model.
- Connection state currently stores HTTP host and port together, so the edit sheet must split and recompose safely.
- Evidence visibility can regress across compact and medium layouts if sheet height is not controlled tightly.

## Rollback Strategy

- Revert the diagnostics component files and screenshot capture changes as one unit.
- Restore the previous diagnostics test expectations if the redesign must be backed out.
- Keep storage keys unchanged so rollback does not require migration.
