# Telnet Convergence Implementation Plan

Status: IN PROGRESS
Date: 2026-03-26
Classification: DOC_PLUS_CODE
Visible UI impact: YES

## Objective

Implement the Review 13 Telnet convergence work across the canonical action registry, tracing, diagnostics, Home quick actions and overflow, device cards, health/capability modeling, tests, documentation, and the minimal screenshot set for the changed surfaces.

## Execution Phases

### Phase 1 - Required reading and impact map

- Status: COMPLETE
- Re-read the review, plan/worklog, Telnet specs and addendum, stale docs surfaces, and the runtime/UI/diagnostics/tests that currently own Telnet behavior.
- Classify the task as `DOC_PLUS_CODE` with visible UI changes.
- Lock the implementation slices around the canonical Telnet capability model instead of continuing the old incremental button-by-button approach.

### Phase 2 - Canonical Telnet capability model

- Status: IN PROGRESS
- Extend the runtime action registry to match the Telnet-only firmware actions in scope, including the Developer submenu.
- Add a canonical metadata model for UI surfacing, diagnostics classification, and menu-key/device-family handling so runtime, UI, and tests consume the same inventory.
- Replace platform-only availability checks with a real capability decision derived from device state and supported platforms.

### Phase 3 - Tracing, diagnostics, and health convergence

- Status: NOT STARTED
- Emit `telnet-operation` trace entries for every Telnet action with action id, visible label, menu path, duration, result, and normalized failure data.
- Extend diagnostics action summaries, contributors, filters, evidence rows, counters, and health rollups to treat Telnet as a first-class subsystem beside REST and FTP.
- Preserve existing REST/FTP behavior while making Telnet visible in steady-state health and activity models.

### Phase 4 - Home quick actions and device-card integration

- Status: NOT STARTED
- Replace the current Home machine controls with the required eight primary actions in the required order.
- Map visible `Reboot` to Telnet clear-memory semantics, move secondary actions into a `...` overflow, and preserve the compact 2x4 layout.
- Converge drive and printer card Telnet actions into a consistent device-card action model.

### Phase 5 - Regression coverage

- Status: NOT STARTED
- Add or update focused unit coverage for the registry, Telnet tracing, diagnostics Telnet effects/contributors, Home ordering and overflow rules, and device-card controls.
- Add or update the minimal honest Playwright coverage for the changed Home and Diagnostics surfaces.
- Add Maestro or equivalent native evidence only where it is required for real-device Telnet behavior.

### Phase 6 - Documentation and screenshots

- Status: NOT STARTED
- Update `README.md`, `src/pages/DocsPage.tsx`, `doc/features-by-page.md`, `doc/ux-interactions.md`, and the affected diagnostics docs so they describe the shipped Telnet behavior.
- Refresh only the screenshot files needed for Home quick actions/overflow, device-card Telnet controls, and Diagnostics Telnet visibility.

### Phase 7 - Validation and convergence

- Status: NOT STARTED
- Run `npm run test:coverage` and keep global branch coverage at or above 91%.
- Run `npm run lint`.
- Run `npm run build`.
- Run the smallest targeted Playwright and screenshot generation flows needed for the impacted Telnet surfaces.

## Constraints

- Do not narrow the review scope to avoid the hard parts of diagnostics or Home convergence.
- Do not regress or special-case REST/FTP diagnostics while adding Telnet.
- Do not bulk-refresh screenshots outside the Telnet-affected documentation surfaces.
- Preserve Addendum 1 behavior: CommoServe search/browse remains direct HTTP plus device REST, not a new Telnet dependency.

## Acceptance Checklist

- The Telnet registry covers the in-scope Telnet-only action inventory and is canonical across runtime and tests.
- Home primary quick actions are exactly `Reset`, `Reboot`, `Pause/Resume`, `Menu`, `Save RAM`, `Load RAM`, `Power Cycle`, `Power Off`.
- Home overflow exists to the right of Quick Actions, includes `Reboot (Keep RAM)` and `Save REU`, and does not duplicate primary actions.
- Drive and printer cards expose the required Telnet controls intentionally rather than ad hoc.
- Every Telnet action emits trace data and appears in Diagnostics action summaries and traces.
- Diagnostics and health models expose Telnet as a first-class contributor/filter/effect.
- Docs and screenshots reflect the implemented Telnet behavior without contradictions.
- Validation passes, including coverage at `>= 91%` branch coverage.
