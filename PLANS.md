# Diagnostics UX Redesign Plan

Status: IN PROGRESS
Classification: UI_CHANGE + CODE_CHANGE

## Goal

Redesign the Diagnostics overlay to match the existing app UX language (Home, Play, Disks, Settings).
This is a hobby-facing status screen — not a developer tool.

## Three Modes

**HEALTHY / IDLE**
First screen: ONE card — "Healthy", device name, "All systems working", Run health check, "View activity and details" link.

**UNHEALTHY / DEGRADED**
First screen: ONE card — "Needs attention", plain-language issue, contributor, "View issue" CTA.

**OFFLINE**
First screen: ONE card — "Device not reachable", host, Retry / Switch device.

## Progressive Disclosure Layers

| Layer | Card                 | Content                                                                  |
| ----- | -------------------- | ------------------------------------------------------------------------ |
| 1     | StatusSummaryCard    | Mode title, device, primary action, show-details link                    |
| 2     | IssueCard            | Primary problem title + contributor (visible when showDetails=true)      |
| 3     | EvidencePreviewCard  | Max 3 recent Problems/Actions (no filters)                               |
| 4     | TechnicalDetailsCard | Contributors, latency, health history, health check                      |
| 5     | ToolsCard            | Filters, full stream, Share all/filtered, heat maps, config drift, clear |

`showDetails=false` (default): only Layer 1 + Layer 3 preview.
`showDetails=true`: all layers, each individually expandable.

## Key Implementation Changes

- `DiagnosticsDialog.tsx`: add `showDetails` state, add `StatusSummaryCard` + `EvidencePreviewCard` sub-components
- `DiagnosticsDialog.test.tsx`: update filter-visibility tests, add mode-based card tests
- Playwright tests: add `show-details-button` expansion steps before accessing Technical/Tools layers

## Termination Criteria

- [ ] First view shows ONE status card only
- [ ] No filters/logs visible initially
- [ ] All data accessible via progressive disclosure
- [ ] All unit tests pass + ≥91% branch coverage
- [ ] Screenshots updated
- [ ] Build + CI green

---

# Health History Timeline Plan (ARCHIVED — COMPLETE)

Status: COMPLETE
Classification: DOC_PLUS_CODE, UI_CHANGE

## Objective

- Replace the diagnostics Health History scatter chart with a deterministic single-state timeline.
- Keep the existing health-history store and diagnostics overlay plumbing unless a thin mapping layer is required.
- Migrate all diagnostics screenshot assumptions and regenerated outputs to `doc/img/app/diagnostics`.

## Constraints

- Exactly one state exists at any timestamp.
- Adjacent identical states must merge.
- Rendering must be deterministic and pixel-stable.
- No symbol, marker, circle, gradient, outline, or external dependency may be introduced.
- Degraded and unhealthy intervals must remain visible at every zoom level.

## Task Breakdown

| ID  | Task                                                                                                 | Status    | Notes                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Audit current popup, history store, screenshot paths, and tests                                      | completed | Scatter/glyph renderer confirmed in `HealthHistoryPopup.tsx`; stale screenshot path assumptions limited to `.vscode/tasks.json`.                            |
| H2  | Define deterministic timeline mapping and update this plan                                           | completed | Timeline will be derived from existing history entries plus a thin details mapper.                                                                          |
| H3  | Implement pure segment builder for last-4h window continuity                                         | completed | `healthHistoryTimeline.ts` now derives continuous source segments, carries the pre-window state, and fills missing leading history with `Idle`.             |
| H4  | Implement pixel-column aggregation and high-severity visibility pass                                 | completed | Worst-state aggregation plus reserved red/amber columns shipped in the timeline renderer utility.                                                           |
| H5  | Replace scatter popup with contiguous timeline renderer and simplified legend                        | completed | `HealthHistoryPopup.tsx` now renders measured solid segments with a color-only legend and no glyph charting.                                                |
| H6  | Add tap-based detail overlay with aggregated interval support                                        | completed | Detail card shows segment or aggregated interval metadata, severity, timestamps, reason, subsystem, and event count.                                        |
| H7  | Update screenshot path assumptions and diagnostics screenshot capture stability                      | completed | Diagnostics screenshot task wiring now targets `doc/img/app/diagnostics` and uses corrected Playwright grep quoting.                                        |
| H8  | Add regression tests for segment logic, aggregation, visibility, tap resolution, and overlay content | completed | Added utility, popup, dialog, overlay, and diagnostics bridge regression coverage plus updated Playwright diagnostics coverage.                             |
| H9  | Regenerate affected diagnostics screenshots                                                          | completed | Regenerated the targeted diagnostics screenshot subset under `doc/img/app/diagnostics`.                                                                     |
| H10 | Run validation and update this plan to complete                                                      | completed | `npm run lint`, `npm run test`, `npm run test:coverage`, `npm run build`, targeted diagnostics Playwright, and targeted diagnostics screenshots all passed. |

## Rendering Algorithm

1. Sort `HealthHistoryEntry` values by timestamp ascending.
2. Define a visible time window using the selected zoom duration with a default of 4 hours ending at `max(Date.now(), lastHistoryTimestamp)`.
3. Build contiguous source segments across the entire visible window.
   - Use the last sample at or before `windowStart` as the carried state when available.
   - Otherwise fill from `windowStart` until the first in-window sample with `Idle`.
   - Each interval is `[t_i, t_{i+1})` and the sample state persists until the next sample.
4. Merge adjacent source intervals with the same state.
5. Measure the track width in CSS pixels and build one deterministic rendered column per pixel.
6. For each pixel column interval, collect all overlapping source segments and choose the worst state using:
   - `Unhealthy > Degraded > Healthy > Idle > Unavailable`
7. Apply a second visibility pass for high-severity source segments.
   - Every `Unhealthy` and `Degraded` source segment is assigned at least one deterministic rendered column.
   - `Unhealthy` overrides `Degraded` when both contend for the same column.
8. Merge adjacent rendered columns with the same displayed state and same underlying selection payload into rendered display segments.
9. Render each display segment as a solid rectangle spanning the full track height.

## Aggregation Logic

- Source segments are duration-based intervals built from health-history timestamps.
- Rendered columns are derived from the current measured width and visible time window.
- Aggregated display segments are any rendered segments backed by multiple source segments or by a reserved visibility override.
- Aggregated detail overlay must show:
  - `Aggregated interval`
  - worst state
  - underlying event count
  - optional expandable event list

## Visibility Guarantees

- Any rendered segment has `widthPx = max(1, computedWidthPx)`.
- Any `Degraded` or `Unhealthy` source segment is guaranteed at least one rendered pixel column.
- Worst-state aggregation determines the base fill.
- The visibility pass may reserve a specific column for a high-severity segment to prevent amber/red loss during compression.
- Allocation order is deterministic and stable for identical inputs.

## Interaction Flow

1. User taps or clicks the timeline track.
2. X coordinate maps to a rendered display segment through the measured pixel-column model.
3. The popup opens a dismissible detail card inside the analytic popup.
4. Non-aggregated selection shows:
   - start timestamp
   - end timestamp
   - state text and color
   - duration
   - root cause / diagnostic reason
   - subsystem (`REST`, `FTP`, or `App`)
   - error message or code when present
5. Aggregated selection shows the aggregated summary plus event list.

## Risks

| Risk                                                                                  | Impact | Mitigation                                                                  | Status    |
| ------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------- | --------- |
| The health-history store is sample-based, not interval-based                          | High   | Derive intervals in a pure mapping layer instead of changing the core model | mitigated |
| Extreme compression can collapse multiple high-severity intervals into the same pixel | High   | Reserve deterministic red/amber columns after the worst-state base pass     | mitigated |
| JSDOM measurement can make renderer tests flaky                                       | Medium | Keep the layout algorithm pure and stub measurements in component tests     | mitigated |
| Screenshot path migration could leave stale task wiring                               | Low    | Search globally and update all references before regeneration               | mitigated |

## Validation Steps

- Unit tests for timeline segment construction, merge behavior, severity aggregation, and reserved-column visibility.
- Component tests for legend rendering, segment rectangles, tap resolution, and overlay content.
- Playwright diagnostics overlay coverage for history popup behavior and deterministic screenshot capture.
- Screenshot regeneration for diagnostics images under `doc/img/app/diagnostics` only.
- Required commands before completion:
  - `npm run lint`
  - `npm run test`
  - `npm run test:coverage`
  - `npm run build`
  - targeted Playwright diagnostics runs, including screenshots

## Completion Snapshot

- Complete.
- Implemented deterministic segment derivation, worst-state aggregation, and reserved high-severity visibility in `src/lib/diagnostics/healthHistoryTimeline.ts`.
- Replaced the Health History scatter chart with a contiguous timeline and tap-driven detail overlay in `src/components/diagnostics/HealthHistoryPopup.tsx`.
- Updated diagnostics Playwright coverage and regenerated the targeted diagnostics screenshots under `doc/img/app/diagnostics`.
- Validation passed with `npm run lint`, `npm run test`, `npm run test:coverage` at 91.01% global branch coverage, `npm run build`, targeted diagnostics Playwright, and targeted diagnostics screenshot capture.

---

# Diagnostics Overlay Progressive-Disclosure UX Redesign

Status: IN PROGRESS
Classification: UI_CHANGE, CODE_CHANGE

## Objective

Redesign the Diagnostics overlay to achieve progressive-disclosure UX:

1. Answer "is the device healthy?" immediately
2. Apply strict layer structure: Summary → Problem → Technical → Evidence → Tools
3. Compact devices: no scrolling for core answer
4. Preserve ALL existing diagnostic information; nothing removed

## Phased Execution

### PHASE 1 — BASELINE ANALYSIS ✅ COMPLETE

**Data surfaces in DiagnosticsDialog.tsx:**

| Element                   | testId                           | Location           |
| ------------------------- | -------------------------------- | ------------------ |
| Overall health row        | `overall-health-row`             | HealthSummary      |
| Device detail button      | `open-device-detail`             | HealthSummary      |
| Explanation phrase        | `health-explanation`             | HealthSummary      |
| Last REST activity        | (text)                           | HealthSummary      |
| Last FTP activity         | (text)                           | HealthSummary      |
| Contributor rows ×3       | `contributor-row-{app,rest,ftp}` | HealthSummary      |
| Primary problem spotlight | `primary-problem-spotlight`      | HealthSummary      |
| Latency P50/P90/P99       | `latency-summary-row`            | HealthSummary      |
| Health history shortcut   | `health-history-row`             | HealthSummary      |
| Run health check          | `run-health-check-button`        | HealthSummary      |
| Last health check         | `open-health-check-detail`       | HealthSummary      |
| Connection actions        | (region)                         | HealthSummary      |
| Evidence type toggles     | `evidence-toggle-*`              | QuickFocusControls |
| Filters / Refine          | `refine-button`                  | QuickFocusControls |
| Evidence stream           | `activity-help`                  | Stream section     |
| Share all/filtered/tools  | `diagnostics-share-all` etc.     | Action shelf       |

**Display profiles:**

- compact: ≤360px (unit tests use 360, screenshots use 360)
- medium: 361–599px (unit tests use some 900px = expanded; screenshots use 393px)
- expanded: ≥600px (all Playwright tests use 800px default)

### PHASE 2 — INFORMATION ARCHITECTURE ✅ COMPLETE

**Layer model:**

| Layer                | Content                                                                     | Default visibility                   |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------------ |
| L1 Summary           | Overall health + connectivity, explanation, primary problem spotlight, host | Always visible                       |
| L2 Primary Actions   | Run health check, connection actions                                        | Always visible                       |
| L3 Technical Details | REST/FTP activity, contributor rows, latency, health history                | compact=closed, medium/expanded=open |
| L4 Evidence          | "Recent evidence" stream + filters                                          | Visible but collapsed detail         |
| L5 Tools             | Share, Tools menu                                                           | Always visible (action shelf)        |

**Key decision:** Technical details default = open on medium/expanded so all existing tests at 800px and 600px pass without modification.

### PHASE 3 — COMPONENT REFACTOR ✅ COMPLETE

Changes to `DiagnosticsDialog.tsx`:

1. State `techDetailsExpanded` in DiagnosticsDialog, default `!isCompact`, reset on open
2. Pass to HealthSummary as `techDetailsExpanded`/`onTechDetailsExpandedChange`
3. HealthSummary: add `technical-details-toggle` button
4. Wrap in `{techDetailsExpanded && ...}`: LastActivityRows, ContributorRows, latency row, history row
5. Stream header: rename "Activity" → "Recent evidence" (testId `activity-help` unchanged)

### PHASE 4 — STATE-DRIVEN RENDERING ✅ COMPLETE

`techDetailsExpanded` reset on dialog open → compact always starts closed → medium/expanded starts open

### PHASE 5 — TEST ADAPTATION

Unit tests:

- No existing tests need modification (all at 600px = expanded = open by default)
- Add new tests:
  - "technical details collapsed by default on compact profile"
  - "technical details toggle expands and collapses the technical section"

### PHASE 6 — SCREENSHOT REGENERATION

Re-run diagnostics screenshot Playwright task (targeted). Updates:

- New "Technical details" toggle button visible in screenshots
- "Recent evidence" label instead of "Activity"

### PHASE 7 — FULL VALIDATION

- `npm run lint`
- `npm run test`
- `npm run test:coverage` (≥91% branch)
- `npm run build`

### PHASE 8 — CONSISTENCY PASS

Review alignment with Home screen language and information hierarchy.

### PHASE 9 — CI CONVERGENCE

All pipelines green; no skipped tests.

## Termination Criteria

- [ ] 1. All diagnostics data accessible via progressive disclosure
- [ ] 2. Technical details behind disclosure toggle on compact
- [ ] 3. Healthy compact = minimal (no contributor rows on first view)
- [ ] 4. Unhealthy = primary problem spotlight always visible
- [ ] 5. Offline = recovery actions prominent (unchanged)
- [ ] 6. All unit tests pass
- [ ] 7. All Playwright tests pass
- [ ] 8. Screenshots updated
- [ ] 9. Build succeeds
- [ ] 10. PLANS.md final state reached
