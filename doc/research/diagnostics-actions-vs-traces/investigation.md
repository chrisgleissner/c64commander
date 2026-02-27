# Diagnostics UI: Actions vs Traces – Investigation

## 1. Executive Summary

### Question

Can the Diagnostics UI safely hide raw Traces and expose only Action Summaries to end users, without sacrificing debuggability, data completeness, or long-term maintainability?

### Summary of Trade-Offs

| Dimension | Keep Traces Visible | Hide Traces |
|-----------|-------------------|-------------|
| UX clarity | Lower – two overlapping views create cognitive load | Higher – single coherent view |
| Data completeness | Full – all event types visible | Partial – per-event context, scoped traces, backend decisions, and intra-correlation ordering are lost |
| Debuggability | Maximum – raw events are directly inspectable | Reduced for developers; adequate for end users if export preserved |
| Maintenance burden | Moderate – two tabs require parallel UX evolution | Lower – single tab simplifies UI |
| Architectural integrity | Preserved – traces remain visible as source of truth | At risk if export is also removed; safe if export is preserved |

### Recommended Path

**Option D: Progressive disclosure via expandable Actions** – Make Action Summaries the primary (and default) view. Add an inline "Show raw trace events" expansion within each Action Summary row. Remove the standalone Traces tab from the default UI. Preserve full trace export in ZIP archives.

### Risk Level

**Low-to-moderate**: manageable with documented safeguards, no production-breaking potential. The primary risk is heuristic creep in Action Summaries if progressive disclosure is not implemented correctly. This risk is mitigated by inline trace expansion and the action-summary-spec's prohibition on heuristic grouping (§4.2). Contingent on preserving trace export integrity and not introducing heuristics into Action Summary derivation.

---

## 2. Current Architecture Overview

### Role of Traces (per tracing-spec)

Traces are the **single source of truth** for application behavior (tracing-spec §1). They provide:

- Structured, append-only, machine-readable records
- Strict causality via `correlationId` linking actions to all downstream events
- Deterministic, sequential `EVT-*` and `COR-*` identifiers
- Per-event context fields: `lifecycleState`, `sourceKind`, `localAccessMode`, `trackInstanceId`, `playlistItemId`
- Automatic enrichment: UI context (route, query, platform, feature flags), playback context, device context
- 10 distinct event types: `action-start`, `action-end`, `action-scope-start`, `action-scope-end`, `backend-decision`, `device-guard`, `rest-request`, `rest-response`, `ftp-operation`, `error`

### Role of Action Summaries (per action-summary-spec)

Action Summaries are a **derived, presentation-oriented projection** (action-summary-spec §1). They provide:

- One summary per `correlationId` grouping
- Collapsed origin mapping (`automatic` → `system`)
- REST and FTP effects with method, path, target, status, duration, error
- Outcome classification: `success`, `error`, `blocked`, `timeout`, `incomplete`
- Duration derived from wall-clock elapsed time

**Key constraint**: Action Summaries apply **no post-processing, heuristics, or cleanup logic** (action-summary-spec §4.2). They are a pure projection.

### Contractual Guarantees

| Guarantee | Traces | Action Summaries |
|-----------|--------|-----------------|
| Source of truth | Yes (tracing-spec §1) | No – derived projection (action-summary-spec §1) |
| Schema stability | Yes – CI-friendly export format (tracing-spec §16.3) | No formal export schema |
| Deterministic ordering | Yes – `relativeMs` primary key (tracing-spec §6) | Yes – `startTimestamp` + `correlationId` (action-summary-spec §9) |
| Golden trace participation | Yes (tracing-spec §19) | No (action-summary-spec §12) |
| Playwright assertion target | Yes – `assertRestTraceSequence`, `assertFtpTraceSequence` (tracing-spec §18.5) | No – not asserted by Playwright helpers |
| Redaction at capture | Yes (tracing-spec §15) | Inherited from traces |

### Where Each Is Source of Truth

- **Traces**: Source of truth for all application behavior, causality, ordering, and backend decisions.
- **Action Summaries**: Presentation convenience only. Never authoritative.

### Information That Exists Only in Traces

The following data is present in raw trace events but **absent from Action Summaries**:

1. **Per-event context fields**: `lifecycleState`, `sourceKind`, `localAccessMode`, `trackInstanceId`, `playlistItemId`
2. **Scoped sub-traces**: `action-scope-start`, `action-scope-end` events for multi-phase flows
3. **Backend decisions**: `backend-decision` events with `selectedTarget` and `reason`
4. **Device guard events**: `device-guard` events
5. **Error classification metadata**: `errorCategory` and `isExpected` flags on error events
6. **Intra-correlation event ordering**: Exact sequence of events within a correlation
7. **Full action context snapshots**: UI route, query params, platform, feature flags, playback state, device context captured at `action-start`
8. **Absolute timestamps and `relativeMs`** per event (not just per action)
9. **Raw request/response bodies**: Full REST request bodies and response payloads
10. **Event IDs** (`EVT-*`): Deterministic identifiers for individual events

---

## 3. Data Completeness Analysis

### 3.1 Causality

**Are correlation boundaries fully visible in Actions?**
Yes. Each Action Summary maps to exactly one `correlationId`. The grouping boundary is preserved.

**Is intra-correlation ordering preserved?**
No. Action Summaries collapse all events within a correlation into a flat summary. The sequence `action-start → backend-decision → rest-request → rest-response → action-end` is not visible. Only the derived effects (REST/FTP) and outcome are shown.

**Are sub-traces and scoped traces visible?**
No. `action-scope-start` and `action-scope-end` events (tracing-spec §9) are not surfaced in Action Summaries. These events represent logical phases within multi-phase flows (e.g., `playlist.add` → `scanFiles` → `resolveSongLengths` → `updatePlaylist`).

### 3.2 Backend Decisions

**backend-decision events**: Not surfaced in Action Summaries. The `selectedTarget` and `reason` fields (`reachable`, `fallback`, `demo-mode`, `test-mode`) are only visible in raw traces. Action Summaries include the `target` on each REST/FTP effect, but the *reason* for target selection is lost.

**Fallback reasoning**: Completely invisible in Action Summaries. When the system falls back from a real device to a mock, the `reason: "fallback"` event is only in traces. This is high-severity because fallback behavior is a primary diagnostic concern when users report connectivity issues – knowing *why* a target was selected (not just *which* target) is essential for root-cause analysis.

**Target selection visibility**: Partially preserved. The `target` field on each effect shows the *result* of target selection, but the *decision process* (why that target was chosen) requires traces.

### 3.3 Error Fidelity

**Multiple errors within a correlation**: Action Summaries include `errorCount` and `errorMessage` (first error from `action-end` or error events). However, if multiple distinct errors occur within one correlation, only the first error message is surfaced. The full set of error events with their individual metadata is lost.

**Error categories and isExpected flag**: `errorCategory` (`network`, `timeout`, `cancelled`, `user`, `integration`, `storage`, `unknown`) and `isExpected` (tracing-spec §14.1) are present only in raw trace error events. Action Summaries map outcomes to `error`, `blocked`, `timeout`, `incomplete` but do not expose the underlying error classification or expectedness.

**Low-level error metadata**: Full error event payloads (stack traces, nested error details) are available only in traces.

### 3.4 Timing Fidelity

**relativeMs**: Available per-event in traces. Action Summaries provide only `startTimestamp`, `endTimestamp`, and derived `durationMs`. Per-event relative timing within a correlation is lost.

**Per-event ordering**: Preserved in traces via monotonic `relativeMs`. Action Summaries collapse this into a single duration.

**Overlapping effects**: When multiple REST calls overlap in time within a correlation, traces show the exact interleaving. Action Summaries list effects sequentially without overlap visibility.

### 3.5 Non-Effect Semantic Events

**Lifecycle transitions**: `lifecycleState` (`foreground`, `background`, `locked`, `unknown`) is captured per-event in trace context fields. Not surfaced in Action Summaries.

**Routing context changes**: `action-start` captures the current route and query parameters. This context snapshot is not included in Action Summaries.

**Playback context snapshots**: `action-start` captures playback state (queue length, current index, `isPlaying`, `elapsedMs`, `durationMs`). Not surfaced in Action Summaries.

**Device guard events**: `device-guard` events are not surfaced.

**action-scope-start / action-scope-end**: Multi-phase flow boundaries are not surfaced.

### Data Completeness Table

| Data Type | Present in Traces | Present in Actions | Loss if Traces Hidden | Severity |
|-----------|:-:|:-:|---|---|
| Correlation boundaries | ✓ | ✓ | None | — |
| Intra-correlation event ordering | ✓ | ✗ | Full sequence lost | Medium |
| Sub-traces (scoped phases) | ✓ | ✗ | Phase boundaries invisible | Medium |
| Backend decision reason | ✓ | ✗ | Fallback/demo reasoning lost | High |
| Backend target (per effect) | ✓ | ✓ | None (target on effect) | — |
| Error count (aggregate) | ✓ | ✓ | None | — |
| Error category + isExpected | ✓ | ✗ | Classification lost | High |
| Multiple error details | ✓ | Partial (first only) | Subsequent errors lost | Medium |
| Per-event relativeMs | ✓ | ✗ | Fine-grained timing lost | Medium |
| Overlapping effect timing | ✓ | ✗ | Interleaving invisible | Low |
| Lifecycle state per event | ✓ | ✗ | Foreground/background context lost | Medium |
| Route/query context | ✓ | ✗ | UI navigation context lost | Medium |
| Playback context snapshot | ✓ | ✗ | Playback state at action time lost | Low |
| Device guard events | ✓ | ✗ | Guard decisions invisible | Low |
| Feature flag snapshot | ✓ | ✗ | Flag state at action time lost | Low |
| Full request/response bodies | ✓ | ✗ | Payload details lost | High |
| Event IDs (EVT-*) | ✓ | ✗ | Grepability lost | Low |
| Raw JSON structure | ✓ | ✗ | Machine-parseable records lost | Medium |

---

## 4. UX Analysis

### 4.1 User Personas

| Persona | Primary Need | Preferred View | Trace Need |
|---------|-------------|---------------|------------|
| **End user diagnosing connectivity** | "Is my device reachable? Why did this fail?" | Actions (outcome + error) | Rare – only if support escalation needed |
| **Power user** | "What REST calls did this action trigger? What was the target?" | Actions with effect detail | Occasional – when debugging fallback behavior |
| **Developer using production build** | "What is the exact event sequence? What was the backend decision?" | Traces | Frequent – raw events are the primary debugging tool |
| **QA tester** | "Does this match the expected trace sequence? Are golden traces correct?" | Traces | Always – golden trace validation is trace-based |

### 4.2 Cognitive Load Comparison

**Two tabs model (current)**
- Cognitive load: High. Users must understand the relationship between Traces and Actions.
- Discovery overhead: Users must decide which tab contains the information they need.
- Duplication concern: The same logical event (e.g., a REST call) appears in both views with different levels of detail, leading to potential confusion about which is authoritative.
- Benefit: Maximum flexibility for all personas.

**Single tab – Actions only**
- Cognitive load: Low. One coherent view with expandable detail.
- Risk: Developers and QA testers lose inline access to raw traces. They must export and inspect externally.
- Benefit: Simplified UX for the majority use case.

**Progressive disclosure (recommended)**
- Cognitive load: Low by default, scalable on demand.
- The Actions tab serves as the primary view. Each Action Summary can expand to show its constituent raw trace events inline.
- Default state: collapsed (Actions view). Expanded state: raw trace events visible per correlation.
- Benefit: No persona is blocked. End users see Actions; developers can drill into traces without switching tabs.

### 4.3 Discoverability vs Noise

The current two-tab model introduces noise for end users:
- Raw traces include `backend-decision`, `device-guard`, `action-scope-start/end` events that are meaningless to non-developers.
- Event IDs (`EVT-0042`) and correlation IDs (`COR-0007`) are opaque to end users.
- The volume of trace events (up to 10,000) overwhelms non-technical users.

Action Summaries are designed to filter this noise. Progressive disclosure preserves the noise-free default while making raw data accessible on demand.

### 4.4 Risk of User Misinterpretation

- **Current model**: Users may conflate Traces and Actions, believing one is more "correct" than the other. The distinction between source-of-truth (Traces) and derived view (Actions) is not obvious in the UI.
- **Actions-only model**: Users may miss critical debugging data and file incomplete bug reports.
- **Progressive disclosure**: Mitigates both risks. The default view is clear and correct. Expanding reveals the source data with appropriate labeling.

---

## 5. Test and CI Implications

### Playwright Trace Assertions

Trace assertions (`assertRestTraceSequence`, `assertFtpTraceSequence`, `assertTraceOrder`) operate on **raw trace events** retrieved via `getTraces(page)`. These assertions are entirely independent of the UI tab structure. Hiding the Traces tab has **no effect** on trace assertion infrastructure.

Reference: tracing-spec §18.5 lists all assertion helpers. They obtain trace data via `getTraces(page)` (which calls `window.__c64uTracing.getTraces()`; see `playwright/traceUtils.ts`), not directly from the Diagnostics UI tabs.

### Golden Trace Recording

Golden traces are recorded via `RECORD_TRACES=1` and compared via `npm run validate:traces`. The recording and comparison pipeline operates on `trace.json` files exported from the trace session, not from the Diagnostics UI. Hiding the Traces tab has **no effect** on golden trace workflows.

Reference: tracing-spec §19.

### Exported ZIP Contents

Two separate export mechanisms exist:

1. **Trace export** (`traceExport.ts`): Produces ZIP with `trace.json` + `app-metadata.json`. This is the CI-grade, schema-stable export. It is **independent of the Diagnostics UI tabs**.

2. **Diagnostics per-tab export** (`diagnosticsExport.ts`): Produces ZIP with tab-specific JSON (`traces.json`, `actions.json`, `logs.json`, `error-logs.json`). This export is scoped to the currently active tab.

If the Traces tab is hidden from the UI, the per-tab diagnostics export for traces would become inaccessible via the UI. However, the primary `traceExport.ts` mechanism remains available and is the authoritative export path.

**Safeguard**: Any option that hides the Traces tab must ensure that the full trace export (`trace.json` + `app-metadata.json`) remains accessible, either via a separate export button or included in the Actions export.

### Evidence Collection

Playwright evidence collection (`finalizeEvidence()`) captures `trace.json` independently of the UI. This is unaffected by UI changes.

### UI Hiding Is Purely Presentational

The Traces tab is a read-only view of `getTraceEvents()`. Hiding it changes only the `GlobalDiagnosticsOverlay.tsx` component. No architectural, storage, or export changes are required. The trace session, trace emission, trace export, and Playwright helpers are all independent of the UI tab structure.

---

## 6. Options Analysis

### Option A: Keep Both Tabs As-Is

**Description**: No change. Traces and Actions tabs remain side-by-side.

**Pros**:
- Zero migration risk
- Maximum data visibility for all personas
- No spec changes required

**Cons**:
- Cognitive load remains high for non-developers
- Users must understand the Traces/Actions relationship
- Two tabs compete for attention, creating discoverability friction

**Impact**:
- Debuggability: Maximum
- Support workflows: Adequate but noisy
- Documentation: No changes needed
- Future features: No blockers

**Migration complexity**: None
**Long-term maintainability**: Two parallel tab UX patterns must evolve together

---

### Option B: Hide Traces Behind "Advanced" Toggle

**Description**: Add a settings toggle (e.g., Settings → Diagnostics → Show Raw Traces) that controls Traces tab visibility. Default: off.

**Pros**:
- Clean default UX for end users
- Developers can enable traces when needed
- No data loss – traces remain fully accessible
- Minimal code change

**Cons**:
- Adds a settings item that most users will never find
- Developers must toggle a setting before debugging – adds friction
- Risk of support scenarios where "enable Advanced mode" becomes a rote instruction
- Settings state adds another dimension to test coverage

**Impact**:
- Debuggability: Preserved (when enabled)
- Support workflows: Requires "enable advanced mode" step
- Documentation: Must document the toggle
- Future features: Toggle pattern could generalize to other advanced views

**Migration complexity**: Low – add one boolean preference and conditional tab rendering
**Long-term maintainability**: Low – one additional preference to maintain

---

### Option C: Hide Traces Tab, Keep Export-Only

**Description**: Remove the Traces tab from the Diagnostics UI entirely. Traces remain available via the trace export ZIP and Playwright APIs.

**Pros**:
- Simplest possible UI – only Actions, Logs, and Errors tabs
- No cognitive load from trace/action duality
- Export-based debugging still possible

**Cons**:
- Developers cannot inspect traces in-app – must export and open externally
- Increases debugging cycle time for developers
- Live inspection during development is lost
- Power users lose the ability to quickly correlate trace events with UI state

**Impact**:
- Debuggability: Reduced for in-app scenarios; preserved for export-based analysis
- Support workflows: Users can share Actions export; full traces require separate export flow
- Documentation: Must document export-based trace inspection workflow
- Future features: May incentivize adding more detail to Actions to compensate

**Migration complexity**: Low – remove one `TabsTrigger` and `TabsContent` block
**Long-term maintainability**: Risk of "heuristic creep" – pressure to add trace-level detail into Action Summaries

---

### Option D: Make Actions Expandable to Show Raw Trace Events Inline

**Description**: Remove the standalone Traces tab. Each Action Summary row in the Actions tab gains an expandable section that shows the raw trace events belonging to that `correlationId`. The expansion renders the same JSON detail currently shown in the Traces tab, scoped to one action.

**Pros**:
- Single coherent view (Actions tab) with full drill-down capability
- Progressive disclosure: clean summary by default, raw detail on demand
- No data loss – all trace events remain accessible in context
- Causal relationship between action and its traces is visually explicit
- Eliminates the need to cross-reference between tabs

**Cons**:
- More complex UI implementation (expandable rows with raw JSON)
- Large expansions may affect scroll performance with many events per action
- Requires clear visual separation between summary and raw trace data
- Inline raw traces may be visually overwhelming if many events exist per correlation

**Impact**:
- Debuggability: Maximum – raw traces available in context of their action
- Support workflows: Users share Actions export; developers expand inline for detail
- Documentation: Must document expansion behavior
- Future features: Natural foundation for richer inline visualizations

**Migration complexity**: Moderate – requires adding expandable raw trace section to `DiagnosticsListItem`, fetching per-correlation events from trace session, and removing the Traces tab
**Long-term maintainability**: Good – single view unifies presentation and reduces parallel UX evolution

---

### Option E: Collapse Into a Unified Hierarchical View

**Description**: Replace both Traces and Actions tabs with a single hierarchical view. Top level shows Action Summaries (grouped by `correlationId`). Expanding an action shows its effects. Further expanding an effect shows the raw trace events.

**Pros**:
- Most structured and information-dense model
- Clear hierarchy: Action → Effects → Raw Events
- Eliminates all tab switching for diagnostics data

**Cons**:
- Highest implementation complexity
- Three-level hierarchy may be harder to navigate on mobile
- Requires significant UI redesign
- Performance risk with deep DOM trees for large trace sessions

**Impact**:
- Debuggability: Maximum (with good navigation)
- Support workflows: Excellent – hierarchical context is self-explanatory
- Documentation: Requires new UX documentation
- Future features: Strong foundation but high upfront cost

**Migration complexity**: High – full redesign of the diagnostics data presentation
**Long-term maintainability**: Good if well-implemented; risk of over-engineering for current needs

---

## 7. Architectural Integrity Assessment

### Does Hiding Traces Violate "Tracing Is the Source of Truth"?

**No, if and only if** the following conditions are met:

1. **Trace emission is unaffected** – traces continue to be captured, stored in memory, and exported regardless of UI visibility.
2. **Trace export remains available** – the ZIP archive (`trace.json` + `app-metadata.json`) is accessible via at least one UI path or programmatic API.
3. **Playwright helpers are unaffected** – `getTraces()`, `clearTraces()`, and all assertion helpers continue to work identically.
4. **Golden trace recording is unaffected** – the `RECORD_TRACES=1` workflow produces identical output.
5. **Action Summaries remain a pure projection** – no new heuristics, merging, or deduplication logic is added to compensate for hidden traces.

The tracing-spec establishes traces as the source of truth for *implementation, testing, and diagnostics* (§1). The UI is one *presentation* of diagnostics, not the sole access path. Hiding the UI presentation does not compromise the source of truth if all other access paths remain intact.

### Does It Risk Future Heuristic Creep in Actions?

**Yes, this is the primary architectural risk.** If traces are hidden and users/developers find Actions insufficient, there will be pressure to:

- Add `backend-decision` details to Action Summaries
- Add per-event timing to effects
- Add error classification (`errorCategory`, `isExpected`) to summaries
- Surface lifecycle state transitions in summaries

Each of these additions would violate the action-summary-spec's principle of being a **pure projection without heuristics** (§4.2). The risk is that Action Summaries gradually become a second, informal trace view – duplicating trace semantics in a less rigorous model.

**Mitigation**: Progressive disclosure (Option D) eliminates the incentive for heuristic creep by making raw traces accessible inline. The action-summary-spec boundary remains clean.

### Does It Incentivize Overloading Action Summaries?

Directly related to heuristic creep. If the only user-facing diagnostic view is Action Summaries, any gap in their coverage becomes a feature request to expand them. Over time, this risks:

- Schema instability in Action Summaries
- Coupling between summary derivation and UI requirements
- Loss of the "pure projection" contract

**Safeguard**: The progressive disclosure model avoids this by providing inline trace access, keeping Action Summaries minimal and focused.

---

## 8. Recommendation

### Position

**Adopt Option D: Progressive disclosure via expandable Actions.**

Remove the standalone Traces tab. Make each Action Summary expandable to reveal its constituent raw trace events inline. Preserve full trace export via ZIP.

### Preconditions

1. Each Action Summary must be able to resolve its constituent `TraceEvent[]` by `correlationId` from the live trace session.
2. The expansion must render raw JSON faithfully – no summarization or filtering of trace events within the expansion.
3. The `getTraceEvents()` and `clearTraceEvents()` APIs must remain unchanged.
4. The per-tab diagnostics export for the Actions tab must continue to export Action Summary JSON (not raw traces).
5. A separate "Export Full Traces" mechanism must remain accessible (either inline in the Actions tab or via the existing trace export path).

### Required Safeguards

1. **No heuristics in Action Summaries** – the action-summary-spec §4.2 prohibition on heuristic grouping, merging, and deduplication must remain enforced.
2. **Trace export integrity** – the ZIP export (`trace.json` + `app-metadata.json`) must be unmodified and accessible.
3. **Playwright helpers unchanged** – all trace assertion helpers must continue to function identically.
4. **Golden trace recording unchanged** – the `RECORD_TRACES=1` workflow must produce identical output.
5. **No schema changes to Action Summaries** – the data model defined in action-summary-spec §7 must not be extended to accommodate trace-level data.

### UI Model (If Progressive Disclosure Is Implemented)

**Default visibility state**: Action Summaries collapsed. No raw trace events visible.

**Expansion trigger**: A disclosure chevron control within each Action Summary's expanded detail panel (preferred over a text button for consistency with collapsible patterns elsewhere in the app). The specific control style is an open UX decision to be finalized during implementation.

**Expanded state**: Below the existing Action Summary detail (correlation, origin, outcome, effects), a new section labeled "Raw Trace Events" renders the `TraceEvent[]` for that `correlationId` as collapsible JSON nodes, consistent with the current Traces tab rendering.

**Labeling strategy**:
- Section header: "Trace Events (N)" where N is the count of events in the correlation
- Each event rendered identically to current Traces tab items (severity badge, title, timestamp, expandable JSON)

**Export behavior**:
- "Share" on the Actions tab exports Action Summary JSON (unchanged)
- A separate "Export Full Traces" option (button or menu) exports the standard `trace.json` + `app-metadata.json` ZIP

---

## 9. Non-Goals

This investigation does **not** change:

- Trace emission, storage, or session lifecycle
- Trace event types or schemas
- Action Summary derivation logic or data model
- Playwright trace assertion helpers or golden trace workflows
- Trace export format (`trace.json` + `app-metadata.json`)
- Error log or application log tabs
- The `diagnosticsExport.ts` or `traceExport.ts` modules
- The `actionSummaries.ts` derivation module
- CI validation pipelines
- Any application code (this is an investigation only)

---

## 10. Open Questions

1. **Performance of inline trace expansion**: For actions with many events (e.g., polling bursts with 50+ events per correlation), does inline JSON rendering cause scroll or rendering performance issues on mobile?

2. **Export UX for full traces**: If the Traces tab is removed, where does the "Export Full Traces" button live? Options include: a secondary button in the Actions tab header, a menu within the Clear All actions area, or a dedicated export-all option.

3. **Filter behavior across levels**: Should the existing filter input search within expanded raw trace events, or only within Action Summary fields? Searching within expanded traces would require filtering trace events per correlation.

4. **Developer workflow impact**: How frequently do developers currently use the Traces tab directly (vs. exporting and inspecting externally)? If in-app trace inspection is a high-frequency developer workflow, the progressive disclosure expansion must be fast and ergonomic.

5. **Trace count visibility**: The current Traces tab shows "Total traces: N". If the tab is removed, should the total trace event count appear somewhere in the Actions tab (e.g., in the header or as part of the activity indicator)?

6. **Settings → Diagnostics → Traces path**: The tracing-spec (§17.1) defines `Settings → Diagnostics → Traces` as the navigation path. If the Traces tab is removed from the overlay, this spec reference must be updated to reflect the new access model.

7. **Backward compatibility of diagnostics share overrides**: The `__c64uDiagnosticsShareOverride` mechanism in `diagnosticsExport.ts` is scoped by tab. If the Traces tab is removed, test infrastructure that specifically targets `tab: 'traces'` may need adjustment.
