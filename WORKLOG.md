# Diagnostics Overlay Redesign Worklog

Status: DONE
Date: 2026-03-20

## Entry 01 - Phase 1 Audit

Scope:

- audited current diagnostics implementation before product-code changes
- verified current tests and screenshot harness
- recorded scope and validation obligations

Evidence:

- read src/components/diagnostics/DiagnosticsDialog.tsx and confirmed first-open summary currently renders StatusSummaryCard plus optional PrimaryProblemSpotlight plus EvidencePreviewCard
- read src/components/diagnostics/DiagnosticsDialog.test.tsx and confirmed current tests already depend on show-details expansion before full diagnostics controls appear
- read tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.test.tsx and confirmed overlay tests exercise share and seeded health-check flows through DiagnosticsDialog
- read playwright/screenshots.spec.ts and confirmed diagnostics screenshot capture currently assumes immediate full-details flows, filters, and tools access after opening the dialog
- read doc/ux-guidelines.md and confirmed the app favors card-based, intention-driven, stable controls rather than console-like multi-surface layouts

Findings:

- first-open diagnostics view is not yet strict enough: more than one card can appear immediately
- evidence preview currently appears on first open, which violates the requested healthy-mode single-card rule
- filters remain a primary surface in full-details mode instead of living strictly inside an advanced tools layer
- existing advanced diagnostics capabilities already exist and should be retained behind deeper disclosure layers

Decision:

- proceed to Phase 2 data mapping without changing behavior outside the diagnostics overlay contract

Verification:

- Phase 1 plan tasks P1.1, P1.2, and P1.3 are complete based on direct file inspection

## Entry 02 - Phase 2 Data Mapping

Scope:

- mapped current diagnostics data, actions, and advanced capabilities to the requested five-layer disclosure model

Evidence:

- read src/components/diagnostics/GlobalDiagnosticsOverlay.tsx and confirmed the overlay already supplies logs, error logs, trace events, action summaries, share callbacks, clear callback, retry and switch-device flows, and health-check state
- read src/components/diagnostics/ConnectionActionsRegion.tsx and confirmed retry and switch-device interactions can be reused instead of rebuilding recovery logic from scratch
- read src/components/diagnostics/ActionSummaryListItem.tsx and src/components/diagnostics/DiagnosticsListItem.tsx to confirm existing evidence cards already support compact summaries plus expanded detail payloads
- read src/lib/diagnostics/healthModel.ts and confirmed current healthState already contains the exact inputs needed for summary, issue, offline, and technical detail layers

Layer mapping:

- Layer 1 SummaryCard: overall health, device label, host, calm reassurance copy, healthy and offline primary actions
- Layer 2 IssueCard: unhealthy problem explanation and supporting cause text
- Layer 3 EvidencePreviewCard: up to three human-readable recent items
- Layer 4 TechnicalDetailsCard: contributor breakdown, REST and FTP activity, latency, history, device detail, health-check detail, deeper recovery access
- Layer 5 ToolsCard: filters, raw evidence stream, share actions, config drift, heat maps, clear-all action

Verification:

- Phase 2 plan tasks P2.1, P2.2, and P2.3 are complete because every current capability has a defined target layer

## Entry 03 - Phase 3 UX Definition

Scope:

- locked the exact disclosure model and component responsibilities before implementation

Decision:

- first-open diagnostics will render SummaryCard only, regardless of mode
- unhealthy details will be revealed only after explicit `View issue` disclosure
- evidence preview and technical details will both be collapsed by default after disclosure
- full stream, filters, export, and advanced tools will live only inside ToolsCard nested under TechnicalDetailsCard

Visual alignment notes:

- diagnostics cards will use the same rounded card surfaces seen elsewhere in the app: `bg-card border border-border rounded-xl p-3/p-4`
- action buttons will reuse the shared Button component variants rather than bespoke console controls
- copy will separate calm user-facing language from technical detail language by layer

Verification:

- Phase 3 plan tasks P3.1, P3.2, P3.3, and P3.4 are complete because the behavior, hierarchy, and test contract are now explicit

## Entry 04 - Phases 4 and 5 Implementation + State Logic

Scope:

- implemented the new layered diagnostics surface and moved advanced controls behind explicit disclosure

Evidence:

- added SummaryCard, IssueCard, EvidencePreviewCard, EvidenceFullView, TechnicalDetailsCard, and ToolsCard under src/components/diagnostics/
- refactored src/components/diagnostics/DiagnosticsDialog.tsx to render SummaryCard first, then IssueCard only after unhealthy disclosure, then collapsed EvidencePreviewCard and TechnicalDetailsCard, and finally ToolsCard only inside TechnicalDetailsCard
- updated src/components/diagnostics/ConnectionActionsRegion.tsx with `mode="summary"` support so offline recovery actions remain available without exposing technical tooling
- preserved device detail, last health check detail, contributor rows, latency popup, history popup, config drift, heat maps, share actions, and clear-all actions behind deeper layers instead of removing them

Verification:

- first-open healthy, unhealthy, and offline states render without filters or the full evidence stream
- evidence preview is capped to preview items and advanced filters are reachable only after tools expansion

## Entry 05 - Phase 6 Testing

Scope:

- updated unit and Playwright coverage for the new disclosure hierarchy

Evidence:

- rewrote src/components/diagnostics/DiagnosticsDialog.test.tsx around first-open summary behavior and tools-only filter access
- updated tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx to expand technical details and tools before asserting legacy advanced controls
- updated tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.test.tsx for the split summary vs technical health-check controls
- updated tests/unit/pages/SettingsPage.test.tsx so page-level diagnostics tests open the tools layer before asserting filters, toggles, and sharing
- updated playwright/homeDiagnosticsOverlay.spec.ts, playwright/settingsDiagnostics.spec.ts, playwright/diagnosticsActions.spec.ts, and playwright/screenshots.spec.ts to follow explicit `show details -> technical details -> tools` expansion

Verification:

- targeted diagnostics unit suites passed after the contract updates
- targeted diagnostics Playwright flows passed after the test-id split between summary and technical health-check controls

## Entry 06 - Phase 7 Screenshots

Scope:

- regenerated only the diagnostics screenshots affected by the redesign

Evidence:

- updated doc/img/app/diagnostics/diagnostics/healthy-collapsed.png
- updated doc/img/app/diagnostics/diagnostics/healthy-expanded.png
- updated doc/img/app/diagnostics/diagnostics/unhealthy-collapsed.png
- updated doc/img/app/diagnostics/diagnostics/unhealthy-issue-expanded.png
- updated doc/img/app/diagnostics/diagnostics/full-drill-down-tools-visible.png
- fixed the screenshot harness in playwright/screenshots.spec.ts so it reuses an already-open diagnostics sheet instead of trying to click through the modal

Verification:

- screenshot capture succeeded through the five-state diagnostics flow required by the redesign brief

## Entry 07 - Phase 8 Validation

Scope:

- ran the required code-change validation set for this UI redesign

Evidence:

- `npm run lint` passed; existing warnings came only from generated `.cov-unit` artifacts left by prior isolated coverage output
- `npm run build` passed
- `npm run test` passed with 376 test files and 4476 tests green
- `npm run test:coverage` passed with global branch coverage at 91.01%
- `npx playwright test playwright/homeDiagnosticsOverlay.spec.ts playwright/settingsDiagnostics.spec.ts playwright/diagnosticsActions.spec.ts` passed with 9 tests green
- `npx playwright test playwright/screenshots.spec.ts -g "capture diagnostics screenshots" --reporter=line` passed after the screenshot-helper fix

Verification:

- Phase 8 plan tasks are complete because lint, build, tests, coverage, targeted Playwright, and screenshot capture all passed on the final code state

## Entry 08 - Phase 9 UX Consistency Audit

Scope:

- compared the redesigned diagnostics overlay against existing app card and action patterns

Evidence:

- verified Settings page uses the same `bg-card border border-border rounded-xl p-4 space-y-4` card language at multiple settings sections
- verified Play Files uses the same `bg-card border border-border rounded-xl p-4 space-y-4` card surface pattern for dense but calm grouped controls
- verified Home continues to use restrained, single-purpose status cards rather than multi-panel console chrome, which matches the new diagnostics summary direction
- retained shared Button variants and card spacing instead of reintroducing bespoke diagnostics-only tool chrome

Verification:

- diagnostics now reads like the rest of the app: card-first, action-led, and progressively technical instead of filter-first and console-like

## Entry 09 - Phase 10 Closeout

Scope:

- completed plan closure and recorded final proof

Verification:

- all PLANS.md phase rows and task rows are now marked DONE
- screenshot scope is recorded precisely and limited to the diagnostics files affected by this redesign
- validation proof is recorded in this worklog and matches the final repository state
