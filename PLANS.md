# Diagnostics Overlay Redesign Plan

Status: DONE
Classification: UI_CHANGE + DOC_PLUS_CODE
Owner: GitHub Copilot
Date: 2026-03-20

## Objective

Redesign the Diagnostics overlay so it behaves like a calm, hobby-friendly status surface rather than a diagnostics console.

Required outcomes:

- first-open state answers device health in under 2 seconds
- strict progressive disclosure from summary to tools
- visual alignment with the rest of the app
- zero loss of existing diagnostics capabilities or data access
- updated unit tests, Playwright coverage, screenshots, build, and validation

## Non-Negotiable UX Rules

- First-open healthy state shows one dominant card only.
- First-open unhealthy state shows one dominant card only.
- First-open offline state shows one dominant card only.
- No filters, raw logs, evidence stream, or tools are visible on first open.
- Evidence preview is collapsed by default and may not exceed three human-readable items.
- Raw diagnostics activity and filters appear only after explicit layer expansion.
- No child layer is visible before its parent is expanded.

## Authoritative Phase Plan

| Phase | Name | Scope | Status | Verification Gate |
| --- | --- | --- | --- | --- |
| 1 | Audit | Inspect current diagnostics dialog, tests, screenshots, and UX constraints. No product code changes. | DONE | Current behavior, gaps, and impacted files documented in WORKLOG. |
| 2 | Data Mapping | Map existing diagnostics data and capabilities into summary, issue, evidence, technical, and tools layers. | DONE | Every existing capability has a destination layer. |
| 3 | UX Definition | Lock exact healthy, unhealthy, offline, and expansion behavior plus component contract. | DONE | Component responsibilities and disclosure rules documented in WORKLOG. |
| 4 | Implementation | Refactor dialog and add new card components with app-aligned layout. | DONE | Overlay renders required layered structure. |
| 5 | State Logic | Enforce progressive disclosure and preserve all existing actions, detail views, and advanced tools. | DONE | No forbidden first-open content remains. |
| 6 | Testing | Update unit and Playwright tests for new structure and flows. | DONE | Required tests exist and pass locally. |
| 7 | Screenshots | Regenerate targeted diagnostics screenshots for required states only. | DONE | Required screenshot set updated under doc/img/app/diagnostics. |
| 8 | Validation | Run lint, unit tests, coverage, build, and targeted Playwright validations. | DONE | Validation commands pass with required coverage threshold. |
| 9 | UX Consistency Audit | Review rendered diagnostics UI against Home, Play, Disks, and Settings language. | DONE | WORKLOG records final UX audit findings and any corrective fixes. |
| 10 | CI Green | Confirm repo is green for touched scope and close execution. | DONE | All plan rows marked DONE and WORKLOG contains proof. |

## Atomic Task Breakdown

### Phase 1 - Audit

| ID | Task | Status |
| --- | --- | --- |
| P1.1 | Read repo instructions, UX guidance, current diagnostics dialog, related tests, and screenshot harness. | DONE |
| P1.2 | Identify current anti-patterns against requested UX. | DONE |
| P1.3 | List impacted files and validation obligations. | DONE |

### Phase 2 - Data Mapping

| ID | Task | Status |
| --- | --- | --- |
| P2.1 | Inventory existing diagnostics inputs, actions, popups, detail views, filters, and exports. | DONE |
| P2.2 | Map each current capability to one of the five disclosure layers. | DONE |
| P2.3 | Define which data becomes human-readable summary copy versus technical detail copy. | DONE |

### Phase 3 - UX Definition

| ID | Task | Status |
| --- | --- | --- |
| P3.1 | Define SummaryCard behavior for healthy, unhealthy, and offline modes. | DONE |
| P3.2 | Define IssueCard visibility and copy rules. | DONE |
| P3.3 | Define EvidencePreviewCard, EvidenceFullView, TechnicalDetailsCard, and ToolsCard expansion rules. | DONE |
| P3.4 | Define required test IDs and expansion flow contract. | DONE |

### Phase 4 - Implementation

| ID | Task | Status |
| --- | --- | --- |
| P4.1 | Add SummaryCard component. | DONE |
| P4.2 | Add IssueCard component. | DONE |
| P4.3 | Add EvidencePreviewCard component. | DONE |
| P4.4 | Add EvidenceFullView component. | DONE |
| P4.5 | Add TechnicalDetailsCard component. | DONE |
| P4.6 | Add ToolsCard component. | DONE |
| P4.7 | Refactor DiagnosticsDialog to render strict parent-child layers only. | DONE |

### Phase 5 - State Logic

| ID | Task | Status |
| --- | --- | --- |
| P5.1 | Remove first-open filters, raw stream, and tools from initial view. | DONE |
| P5.2 | Preserve issue drill-down, health check, connection recovery, device detail, history, latency, config drift, heat maps, sharing, and clear actions. | DONE |
| P5.3 | Ensure evidence preview shows at most three human-readable entries. | DONE |
| P5.4 | Ensure filters appear only inside ToolsCard. | DONE |
| P5.5 | Ensure layer visibility obeys parent expansion rules. | DONE |

### Phase 6 - Testing

| ID | Task | Status |
| --- | --- | --- |
| P6.1 | Update unit tests for healthy first-open state. | DONE |
| P6.2 | Update unit tests for unhealthy first-open state. | DONE |
| P6.3 | Update unit tests for disclosure flow and Tools-only filters. | DONE |
| P6.4 | Update GlobalDiagnosticsOverlay tests if dialog contract changes. | DONE |
| P6.5 | Update Playwright diagnostics tests for new expansion flow. | DONE |

### Phase 7 - Screenshots

| ID | Task | Status |
| --- | --- | --- |
| P7.1 | Capture healthy collapsed screenshot. | DONE |
| P7.2 | Capture healthy expanded screenshot. | DONE |
| P7.3 | Capture unhealthy collapsed screenshot. | DONE |
| P7.4 | Capture unhealthy issue-expanded screenshot. | DONE |
| P7.5 | Capture full drill-down screenshot with tools visible. | DONE |

### Phase 8 - Validation

| ID | Task | Status |
| --- | --- | --- |
| P8.1 | Run lint. | DONE |
| P8.2 | Run unit tests. | DONE |
| P8.3 | Run coverage and confirm global branch coverage >= 91%. | DONE |
| P8.4 | Run build. | DONE |
| P8.5 | Run targeted Playwright diagnostics coverage. | DONE |

### Phase 9 - UX Consistency Audit

| ID | Task | Status |
| --- | --- | --- |
| P9.1 | Compare diagnostics spacing, card structure, and actions against the app’s existing pages. | DONE |
| P9.2 | Fix any remaining console-like or cluttered behavior. | DONE |

### Phase 10 - CI Green

| ID | Task | Status |
| --- | --- | --- |
| P10.1 | Verify all plan tasks are DONE and WORKLOG proof is complete. | DONE |
| P10.2 | Summarize completed validation and screenshot scope accurately. | DONE |

## Phase 1 Audit Findings

- Current first-open state still renders more than one conceptual block: the dominant status card, an optional standalone problem spotlight, and an evidence preview card.
- Current first-open state violates the requested healthy-mode rule because healthy sessions can immediately show recent activity.
- Current full-details state still uses a filter-first mental model with QuickFocusControls placed before the evidence stream.
- Filters are available before the deepest tool layer, which violates the requested disclosure hierarchy.
- Existing technical data and advanced capabilities are already present and should be preserved, not reimplemented from scratch.

## Phase 2 Data Mapping

| Current capability | Target layer | Notes |
| --- | --- | --- |
| Overall health state, connectivity, host, connected device label | Layer 1 - SummaryCard | First-answer content only; human-readable copy. |
| Primary problem title and cause hint | Layer 1 summary copy and Layer 2 IssueCard | Summary gets plain-language headline; IssueCard gets fuller explanation. |
| Run health check | Layer 1 primary action in healthy mode, Layer 2 secondary action in unhealthy mode | Last health check detail remains deeper. |
| Retry connection and switch device | Layer 1 offline actions and Layer 4 technical access | Recovery stays available without exposing tools first. |
| Device detail view, health check detail view | Layer 4 - TechnicalDetailsCard | Kept as navigable detail views from deeper layer. |
| Last REST and FTP activity | Layer 4 - TechnicalDetailsCard | Technical phrasing stays out of the first-open surface. |
| Contributor health rows | Layer 4 - TechnicalDetailsCard | Remains available as technical breakdown. |
| Latency percentiles and latency popup | Layer 4 - TechnicalDetailsCard | Shown only after explicit expansion. |
| Health history shortcut and popup | Layer 4 - TechnicalDetailsCard | Shown only after explicit expansion. |
| Evidence preview | Layer 3 - EvidencePreviewCard | Human-readable top three entries, collapsed by default. |
| Full evidence stream | Layer 5 - ToolsCard via EvidenceFullView | Existing stream preserved in deep view. |
| Filters, search, severity, contributor, origin toggles | Layer 5 - ToolsCard | No longer visible before tools expansion. |
| Share all, share filtered, config drift, heat maps, clear all | Layer 5 - ToolsCard | Advanced actions remain grouped at the deepest layer. |

## Phase 3 UX Definition

### Disclosure contract

- First open renders SummaryCard only.
- Clicking the healthy summary link reveals Layer 3 and Layer 4 as collapsed cards.
- Clicking the unhealthy primary action reveals Layer 2, then Layer 3 and Layer 4 beneath it.
- Layer 5 is rendered only inside Layer 4 after TechnicalDetailsCard is expanded.
- Filters and the raw event stream are rendered only inside ToolsCard.

### Component contract

- SummaryCard
	- healthy: title `Healthy`, calm copy, primary `Run health check`, secondary `Show details`
	- unhealthy: title `Needs attention`, plain-language issue headline, secondary technical cause, primary `View issue`, secondary `Run health check`
	- offline: title `Device not reachable`, host target, primary `Retry connection`, secondary `Switch device`
- IssueCard
	- visible only for unhealthy states after disclosure
	- repeats the problem in clear language and optionally exposes the technical cause
- EvidencePreviewCard
	- collapsed by default
	- when expanded, shows up to three human-readable items only
	- contains CTA `View all activity` to reveal ToolsCard
- TechnicalDetailsCard
	- collapsed by default
	- contains contributor breakdown, REST/FTP activity, latency, health history, device detail, and health-check detail access
- ToolsCard
	- collapsed by default and visible only from inside an expanded TechnicalDetailsCard
	- contains filters, EvidenceFullView, sharing actions, advanced tools, and destructive clear action

### Test contract

- `status-summary-card` remains the first-open anchor test id.
- `show-details-button` remains the disclosure control for healthy mode and secondary disclosure flows.
- add `issue-card`, `evidence-preview-card`, `technical-details-card`, `tools-card`, and `evidence-full-view` test ids.
- `refine-button` and `diagnostics-filter-input` must not exist in the DOM until ToolsCard is expanded.

## Impacted Files

- src/components/diagnostics/DiagnosticsDialog.tsx
- src/components/diagnostics/GlobalDiagnosticsOverlay.tsx
- src/components/diagnostics/ConnectionActionsRegion.tsx
- src/components/diagnostics/DiagnosticsListItem.tsx
- src/components/diagnostics/ActionSummaryListItem.tsx
- src/components/diagnostics/DeviceDetailView.tsx
- src/components/diagnostics/HealthCheckDetailView.tsx
- src/components/diagnostics/HealthHistoryPopup.tsx
- src/components/diagnostics/LatencyAnalysisPopup.tsx
- src/components/diagnostics/ConfigDriftView.tsx
- src/components/diagnostics/HeatMapPopup.tsx
- src/components/diagnostics/DiagnosticsDialog.test.tsx
- tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.test.tsx
- playwright/homeDiagnosticsOverlay.spec.ts
- playwright/settingsDiagnostics.spec.ts
- playwright/diagnosticsActions.spec.ts
- playwright/screenshots.spec.ts
- playwright/visualSeeds.ts
- doc/img/app/diagnostics/*
- WORKLOG.md

## Completion Gate

This plan is complete only when all of the following are true:

- all phase and task rows are marked DONE
- WORKLOG contains verification proof for every completed phase
- healthy first-open view contains one dominant card only
- filters and raw logs are absent until the tools layer is opened
- all existing diagnostics capabilities remain accessible
- targeted diagnostics screenshots are updated
- lint, tests, coverage, Playwright, and build pass