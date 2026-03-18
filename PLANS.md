# Diagnostics UX Specification Rewrite Plan

Classification: `DOC_ONLY`

## Objective

Produce a single, unified, internally consistent, and fully implementable diagnostics UX specification that eliminates duplication between diagnostics and connection status, unifies connectivity/health/diagnostics into one system, and satisfies all six invariants (I1–I6).

## Binding Design Decisions

- **D1**: Diagnostics absorbs Connection Status (Option 1A). Single badge, single overlay.
- **D2**: Collapsible health summary in overlay (Option 2B). Expanded by default on open.
- **D3**: Badge encoding uses shape + label (Option 3A). Shape = health, label = connectivity.
- **D4**: Retry action inline in overlay summary when offline (Option 4A).
- **D5**: Host editing remains in Settings. Overlay shows host read-only.
- **D6**: All popover fields moved into unified badge + overlay. Popover eliminated.
- **D7**: Eleven spec sections identified for modification.
- **D8**: All six invariants satisfied by design.

## Phases

### Phase 1 — Current System Decomposition

- [x] Read existing diagnostics UX spec (`doc/diagnostics/diagnostics-ux-redesign.md`)
- [x] Read Connection Status popover (`src/components/ConnectivityIndicator.tsx`)
- [x] Read DiagnosticsActivityIndicator (`src/components/DiagnosticsActivityIndicator.tsx`)
- [x] Read AppBar layout (`src/components/AppBar.tsx`)
- [x] Catalog all fields, surfaces, and interaction paths

### Phase 2 — Duplication Mapping

- [x] Map every concept to its current surface(s)
- [x] Identify all duplicated data across diagnostics and connection status
- [x] Document field-level ownership conflicts

Duplication found:
| Concept | Diagnostics surface | Connection Status popover | Conflict |
|---|---|---|---|
| Connectivity (online/demo/offline) | Not shown | Popover status + header label | Separate surface |
| REST failure counts | DiagnosticsActivityIndicator dot | Popover diagnostics row | Duplicated |
| FTP failure counts | DiagnosticsActivityIndicator dot | Popover diagnostics row | Duplicated |
| Error/log counts | DiagnosticsActivityIndicator dot | Popover diagnostics row | Duplicated |
| Last activity | Not shown in diagnostics | Popover row | Missing from diagnostics |
| Host | Not shown | Popover row | Not in diagnostics |
| Health state | Not yet implemented (spec only) | Not shown | Missing from both live surfaces |

### Phase 3 — Invariant Enforcement

- [x] Validate I1 (Zero Confusion) against current system → FAIL: two entry points
- [x] Validate I2 (Always-Visible Global State) → FAIL: connectivity not visible in health badge
- [x] Validate I3 (Single Deterministic Click Path) → FAIL: badge + C64U button compete
- [x] Validate I4 (No Duplication) → FAIL: REST/FTP/error counts in two places
- [x] Validate I5 (Progressive Disclosure Integrity) → FAIL: connectivity outside ladder
- [x] Validate I6 (Immediate Recency Visibility) → FAIL: last activity not in diagnostics

### Phase 4 — Header + Indicator Redesign

- [x] Design unified badge encoding (shape × connectivity matrix per D3)
- [x] Prove compact fit (≤360px, single line)
- [x] Define glyph system (5 shapes, color-independent)
- [x] Define pixel budget (56–90px, within 122px formerly used by both indicators)

### Phase 5 — Surface Consolidation

- [x] Confirm: diagnostics absorbs connection status (D1)
- [x] Eliminate ConnectivityIndicator popover as a surface
- [x] Eliminate DiagnosticsActivityIndicator as a surface
- [x] Design single unified badge replacing both
- [x] Assign every field to exactly one surface (D6)

### Phase 6 — Summary Layer Integration (Recency)

- [x] Design collapsible summary panel (D2)
- [x] Define summary field order: health → last activity → contributors → primary problem
- [x] Place last REST/FTP activity on contributor rows (I6 compliance)
- [x] Add connectivity row with host (read-only) and retry action (D4, D5)

### Phase 7 — Full Spec Rewrite

- [x] Write complete rewritten spec

### Phase 8 — Final Consistency Audit

- [x] Verify all 6 invariants against final spec
- [x] Verify no duplication remains
- [x] Verify compact layout feasibility
- [x] Verify single interaction path
- [x] Verify field ownership table completeness
- [x] Verify popover disposition completeness

## Decisions Log

| Decision              | Choice                                     | Rationale                                                           |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| Surface consolidation | Diagnostics absorbs Connection Status (1A) | Single entry point satisfies I3. Existing overlay is 90% complete.  |
| Overlay space         | Collapsible summary (2B)                   | Preserves I6 (expanded default) while maximizing event stream space |
| Badge encoding        | Shape + label (3A)                         | Unambiguous text labels. Shape is color-independent.                |
| Retry action          | In overlay summary when offline (4A)       | Immediate action after tapping offline badge. Minimal friction.     |
| Host editing          | Settings page only (D5)                    | Overlay shows read-only context. Full editing in Settings.          |

## Invariant Validation Log (Final)

| Invariant                           | Status | Evidence                                                                        |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------- |
| I1 Zero Confusion                   | PASS   | Single badge, single overlay, one click path                                    |
| I2 Always-Visible Global State      | PASS   | Badge shape = health, label = connectivity, always in header                    |
| I3 Single Deterministic Click Path  | PASS   | ONE badge → ONE overlay. Compact: 1 tap. Medium/expanded: 2 taps                |
| I4 No Duplication                   | PASS   | Field ownership table assigns each concept to exactly one surface               |
| I5 Progressive Disclosure Integrity | PASS   | Header signal → summary (health + connectivity + recency) → problems → evidence |
| I6 Immediate Recency Visibility     | PASS   | Summary expanded by default — last REST/FTP activity visible without scrolling  |

## Rejected Approaches

| Approach                                                         | Reason rejected                                                                                                                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep both surfaces (popover + overlay)                           | Violates I3 (two entry points create "which do I tap?" ambiguity), violates I4 (REST/FTP counts duplicated)                                                |
| Partial merge (popover keeps connectivity, overlay keeps health) | Violates I5 (connectivity outside disclosure ladder), violates I2 (health not visible alongside connectivity)                                              |
| Header-only solution (encode everything in header, no overlay)   | Cannot show recency, contributors, or evidence in header. Violates I6. Insufficient for investigation.                                                     |
| Encode diagnostics in C64U indicator                             | Multiplexes two independent concerns (connectivity + health) into one signal. "Is it red because offline or because REST failed?" Violates zero confusion. |
| Color-coded header background                                    | Violates "no color-only encoding." Creates visual instability.                                                                                             |
| Separate badge per contributor                                   | Returns to 3-dot model. Users interpret 3 signals before understanding overall health.                                                                     |
| Hover tooltip for badge details                                  | Not available on mobile. Violates compact-safe.                                                                                                            |
| Animation for severity                                           | Spec prohibits motion for health/severity. Accessibility concerns.                                                                                         |
