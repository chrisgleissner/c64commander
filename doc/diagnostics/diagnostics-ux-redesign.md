# Diagnostics UX Specification

## 1. Purpose

This document defines the user experience for the unified diagnostics system in C64 Commander.

It covers:

- the unified header badge (connectivity + health in one element)
- the diagnostics overlay (investigation workspace)
- the health model (overall health + three contributors)
- connectivity integration (online, demo, offline states composed with health)
- the collapsible health summary (recency, contributors, primary problem)
- progressive disclosure from header signal to root cause
- filtering, search, export, and clear behavior
- presentation rules for `compact`, `medium`, and `expanded` display profiles

This specification is normative for UX behavior. It does not define implementation details.

## 2. Scope

Covered surfaces:

- **Unified header badge** — a single interactive element in the AppBar that communicates connectivity and overall health, and opens the diagnostics overlay
- **Diagnostics overlay** — the full investigation workspace opened from the header badge or Settings
- **Collapsible health summary** — inside the overlay, showing connectivity, overall health, last activity, contributor indicators, and primary problem
- **Event stream** — inside the overlay, showing problems, actions, logs, and traces

Not covered:

- Internal logging architecture
- Transport implementation details

### 2.1 Surface Consolidation

The unified header badge **replaces** both:

1. The `DiagnosticsActivityIndicator` (colored dots for REST/FTP/Error counts)
2. The `ConnectivityIndicator` (C64U button + Connection Status popover)

The Connection Status popover is **eliminated entirely**. There is exactly ONE header tap target and ONE overlay surface for all connectivity, health, and diagnostics information.

**Rationale:** Two header entry points (diagnostics badge + connectivity button) violate the Zero Confusion invariant — when something is wrong, two tap targets create "which do I tap?" ambiguity. Merging into one surface eliminates the duplication of REST/FTP counts that existed across both surfaces.

## 3. Design Principles

1. **Health first.** The first answer is "Is the system healthy?" — not a set of counters.
2. **Contributors explain health.** App, REST, and FTP explain why health is degraded. They do not replace the overall summary.
3. **Connectivity is context.** Connectivity state (real device, demo, offline) frames health interpretation. It is always visible alongside health, never separate.
4. **Progressive disclosure.** Information layers: header signal → summary (health + connectivity + recency) → problems → evidence. Each layer answers the next question.
5. **Minimal taps.** The default path from header to likely root cause requires: compact 1 tap, medium/expanded 2 taps.
6. **Human meaning first.** Health, impact, and cause before internal event types.
7. **Compact-safe.** Every path works on ≤360px without horizontal scrolling, hover, or dense jargon.
8. **No false green.** Lack of data shows `Idle`, never `Healthy`.
9. **Persistent orientation.** While investigating, the user always knows: what scope, what health state, what problem, how to go back.

## 4. Constraints

- Display profiles: `compact` (≤360px), `medium` (361–599px), `expanded` (≥600px).
- **Connectivity and health are unified in one badge.** No separate connectivity indicator exists.
- Meaning must never rely on color alone. Shape and text are primary carriers.
- In the diagnostics overlay: icons that carry meaning must be paired with a text label.
- In the header badge: leading text encodes connectivity, the glyph encodes health state, and trailing text encodes the health label when shown by the active profile. The badge is an interactive element with an `aria-label`. Text provides connectivity context; the glyph and optional count provide health context.
- Motion must not communicate health or severity.
- Light, Dark, and System themes must preserve the same information hierarchy.

## 5. Related Specifications

| Document                                                 | Relationship                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| [Tracing Specification](./tracing-spec.md)               | Trace event model, retention limits, export expectations       |
| [Action Summary Specification](./action-summary-spec.md) | Action summary derivation from trace data                      |
| [Trace Forensic Analysis](./trace-forensic-analysis.md)  | High-volume and recurring failure pattern context              |
| [UX Guidelines](../ux-guidelines.md)                     | App-wide clarity and interaction principles                    |
| [UX Interactions](../ux-interactions.md)                 | Interaction inventory and coverage expectations                |
| [Display Profiles](../display-profiles.md)               | Profile thresholds, layout invariants, and allowed adaptations |

This specification supersedes any prior requirement that diagnostics content be organized primarily through tabs. Diagnostics uses a health-summary-plus-filter model.

## 6. Definitions

### 6.1 Session

The currently retained diagnostics history. Retention limits are defined by the tracing specification (30-minute window, 10,000 events max).

### 6.2 Overall Health

The top-level summary state. Answers whether the system is operating normally from the user's perspective.

### 6.3 Health Indicator (Contributor)

A named contributor to overall health. Exactly three exist:

| Indicator | Meaning                                                                     |
| --------- | --------------------------------------------------------------------------- |
| `App`     | Application and workflow health not explained solely by a transport channel |
| `REST`    | Health of REST-based operations                                             |
| `FTP`     | Health of FTP-based operations                                              |

### 6.4 Problem

Any retained condition indicating the system is not operating normally. The primary user-facing concept for unhealthy conditions.

### 6.5 Evidence Types

Four types, ordered from highest user meaning to lowest abstraction:

1. `Problems` — unhealthy conditions
2. `Actions` — user or system operations
3. `Logs` — supporting log evidence
4. `Traces` — raw trace events

### 6.6 Root Cause

The most specific visible explanation a user can reach from the diagnostics overlay without leaving it.

### 6.7 Visible Set

The set of entries remaining after applying: evidence-type filters → health-indicator filter → origin filters → search → pagination.

### 6.8 Connectivity State

The device connection state. Exactly these values:

| State               | Meaning                                      |
| ------------------- | -------------------------------------------- |
| `Online`            | Connected to a real C64 Ultimate device      |
| `Demo`              | Running in simulated device mode             |
| `Offline`           | Device not reachable                         |
| `Not yet connected` | App started, no connection attempt completed |
| `Checking`          | Connection probe in flight (transient)       |

## 7. Health Model

### 7.1 Health States

| State         | Meaning                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| `Healthy`     | Recent activity exists and no recent problems are present                              |
| `Degraded`    | Problems exist, but the system is still partially functioning                          |
| `Unhealthy`   | Problems are frequent or likely blocking important tasks                               |
| `Idle`        | No recent activity; health state is not yet known. No cause for concern.               |
| `Unavailable` | Health state should be known but cannot be determined (e.g., device just went offline) |

These labels are fixed and must not be paraphrased in the UI.

### 7.2 Connectivity × Health Composition

Connectivity and health are independent dimensions that compose in the badge:

- **Shape** encodes health (5 states → 5 distinct shapes)
- **Leading label** encodes connectivity (`C64U`/`U64`/`U64E`/`U64E2`, `DEMO`, `Offline`, `—`)
- **Trailing label** encodes the health word when the active profile includes it

When connectivity is `Offline`: health state is overridden to display as `Unavailable` because no device communication is possible.

When connectivity is `Not yet connected`: health state displays as `Idle`.

When connectivity is `Checking`: the badge shows the previous connectivity label.

Badge reading order is always:

1. connectivity label
2. health glyph (and compact/medium count when present)
3. health label, when the active profile includes it

The badge must not insert a decorative separator dot between connectivity and health. Only the health glyph carries state color. All badge text remains neutral foreground text, including the inferred real-device label (`C64U`, `U64`, `U64E`, `U64E2`) and `DEMO`.

For real hardware, the leading label is inferred directly from `GET /v1/info.product` and normalized as follows:

- `C64 Ultimate` -> `C64U`
- `Ultimate 64` -> `U64`
- `Ultimate 64 Elite` -> `U64E`
- `Ultimate 64-II` and `Ultimate 64 Elite 2` style variants -> `U64E2`

### 7.3 Current Window

Current health is based on a trailing 5-minute window. Session totals provide context but do not override the current state label.

### 7.4 Overall Health Roll-Up

Overall health uses worst-contributor-wins:

1. `Unavailable` if diagnostics data cannot be determined
2. `Unhealthy` if any contributor is Unhealthy
3. `Degraded` if any contributor is Degraded (and none Unhealthy)
4. `Healthy` if at least one contributor has recent activity and all active contributors are Healthy
5. `Idle` if no contributor has recent activity

### 7.5 Cold-Start Behavior

At app startup before any diagnostics activity:

- Overall health: `Idle`
- Connectivity: `Not yet connected`
- All contributors: `Idle`
- Header badge: `— ○` (compact), `Not connected ○` (medium), `Not yet connected ○` (expanded)
- Overlay stream: empty session state message

### 7.6 Primary Problem Selection

When the current scope contains at least one visible Problem, the interface identifies exactly one Primary problem:

1. Highest health impact: Unhealthy before Degraded
2. User-blocking before non-blocking (same impact)
3. Most recent (same impact and blocking status)

## 8. Unified Header Badge

### 8.1 Purpose

The unified header badge is the sole first-level diagnostics and connectivity surface. It communicates both overall health and connectivity at a glance and provides one-tap access to the diagnostics overlay.

The badge **replaces** both:

- the `DiagnosticsActivityIndicator` (colored dots for REST/FTP/Error counts)
- the `ConnectivityIndicator` (C64U button + Connection Status popover)

### 8.2 Position in AppBar

The badge is the sole diagnostic/connectivity element in the AppBar flex row:

```
[Page Title]  [Unified Badge]
```

No other connectivity or diagnostics indicators exist in the header.

### 8.3 Encoding System

The badge encodes two independent dimensions:

- **Shape** → health state (5 distinct shapes, color-independent)
- **Leading label** → connectivity state (text, unambiguous)
- **Trailing label** → health state word when shown by the active profile

| Health State | Glyph | Shape description  |
| ------------ | ----- | ------------------ |
| Healthy      | ●     | Filled circle      |
| Degraded     | ▲     | Triangle (warning) |
| Unhealthy    | ◆     | Diamond (stop)     |
| Idle         | ○     | Empty circle       |
| Unavailable  | ◌     | Dashed circle      |

Shape alone disambiguates all five states. Color reinforces but is never the sole carrier.

Monochrome rendering: shapes remain distinct without any color information.

Colorblind safety: no two states share a shape, so no color pair matters.

### 8.4 State Matrix

Full encoding across connectivity × health × profile:

| Connectivity      | Health      | Compact     | Medium              | Expanded                         |
| ----------------- | ----------- | ----------- | ------------------- | -------------------------------- |
| Online            | Healthy     | `{MODEL} ●`    | `{MODEL} ● Healthy`    | `{MODEL} ● Healthy`                 |
| Online            | Degraded 3  | `{MODEL} ▲3`   | `{MODEL} ▲3 Degraded`  | `{MODEL} ▲ Degraded · 3 problems`   |
| Online            | Unhealthy 5 | `{MODEL} ◆5`   | `{MODEL} ◆5 Unhealthy` | `{MODEL} ◆ Unhealthy · 5 problems`  |
| Online            | Idle        | `{MODEL} ○`    | `{MODEL} ○ Idle`       | `{MODEL} ○ Idle`                    |
| Online            | Unavailable | `{MODEL} ◌`    | `{MODEL} ◌ ?`          | `{MODEL} ◌ Unavailable`             |
| Demo              | Healthy     | `DEMO ●`       | `DEMO ● Healthy`       | `DEMO ● Healthy`                    |
| Demo              | Degraded 2  | `DEMO ▲2`      | `DEMO ▲2 Degraded`     | `DEMO ▲ Degraded · 2 problems`      |
| Demo              | Unhealthy 5 | `DEMO ◆5`      | `DEMO ◆5 Unhealthy`    | `DEMO ◆ Unhealthy · 5 problems`     |
| Offline           | \*          | `Offline ◌` | `Offline ◌`         | `Offline ◌ Device not reachable` |
| Not yet connected | \*          | `— ○`       | `Not connected ○`   | `Not yet connected ○`            |

Text color rules:

- `C64U`, `Demo`, `Offline`, and all health words render in neutral foreground text.
- The state glyph uses the health color token.
- Compact and medium numeric problem counts inherit the glyph color because they are part of the health signal.

### 8.5 aria-label Matrix

| State                | aria-label                                        |
| -------------------- | ------------------------------------------------- |
| Online + Healthy     | "Connected to C64U, system healthy"               |
| Online + Degraded N  | "Connected to C64U, system degraded, N problems"  |
| Online + Unhealthy N | "Connected to C64U, system unhealthy, N problems" |
| Online + Idle        | "Connected to C64U, idle"                         |
| Online + Unavailable | "Connected to C64U, diagnostics unavailable"      |
| Demo + Healthy       | "Demo mode, system healthy"                       |
| Demo + Degraded N    | "Demo mode, system degraded, N problems"          |
| Demo + Unhealthy N   | "Demo mode, system unhealthy, N problems"         |
| Offline              | "Offline, device not reachable"                   |
| Not yet connected    | "Not yet connected"                               |

### 8.6 Compact Profile (≤360px)

**Renders:** connectivity label + gap + glyph + optional count (1–2 digits)

| State                 | Visual      | Max width |
| --------------------- | ----------- | --------- |
| Online + Healthy      | `C64U ●`    | ~62px     |
| Online + Degraded 3   | `C64U ▲3`   | ~76px     |
| Online + Unhealthy 12 | `C64U ◆12`  | ~83px     |
| Demo + Healthy        | `Demo ●`    | ~66px     |
| Offline               | `Offline ◌` | ~78px     |
| Not yet connected     | `— ○`       | ~42px     |

**Pixel budget:** glyph 24px + count 0–14px + gap 4px + label 28–48px = **56–90px max**.

The combined previous allocation was ~72px (DiagnosticsActivityIndicator) + ~50px (C64U button) = ~122px. The unified badge fits within a strict subset.

### 8.7 Medium Profile (361–599px)

**Renders:** connectivity label + gap + glyph + optional count (1–2 digits) + gap + health label

Examples: `C64U ● Healthy`, `C64U ▲3 Degraded`, `C64U ◆5 Unhealthy`, `Offline ◌`

**Character budget:** ~25 characters max. Pixel budget: ~170px.

### 8.8 Expanded Profile (≥600px)

**Renders:** connectivity label + gap + glyph + gap + health label + optional problem count (spelled out)

Examples: `C64U ● Healthy`, `C64U ▲ Degraded · 3 problems`, `C64U ◆ Unhealthy · 5 problems`, `Offline ◌ Device not reachable`

**Character budget:** 35 characters max. Truncate with ellipsis if exceeded.

### 8.9 Interaction

Tapping the badge opens the diagnostics overlay with the **header preset**:

- Evidence types: Problems + Actions
- Health indicator: All indicators
- Origin: none
- Search: empty
- Summary panel: expanded (default state on every open)
- Compact: if a Primary problem exists, auto-expand it
- Medium/expanded: Primary problem spotlight visible, not auto-expanded

### 8.10 Accessibility

- `role="button"` with `aria-label` as specified in §8.5
- Minimum tap target: 44×44px (padded if badge is smaller)
- `data-testid="unified-health-badge"`
- `data-health-state` attribute reflecting current health state
- `data-connectivity-state` attribute reflecting current connectivity state

## 9. Diagnostics Overlay

### 9.1 Purpose

The diagnostics overlay is the authoritative investigation workspace. It lets the user:

- Confirm overall health and connectivity
- See which contributors are causing degradation
- See last REST and FTP activity immediately
- Inspect current problems first
- Reach likely root cause with minimal taps
- Review related actions
- Access raw logs and traces when needed
- Retry connection when offline
- Export or clear diagnostics

### 9.2 Structure

Fixed order:

1. Title and description
2. Collapsible health summary (connectivity + health + last activity + contributors + primary problem)
3. Quick-focus controls
4. Event stream
5. Toolbar actions

### 9.3 Title

Title: `Diagnostics`

Description: `Health, connectivity, and supporting evidence.`

### 9.4 Dismiss

Closing the overlay returns focus to the opening control.

On compact, if Refine is open, back closes Refine before closing the overlay.

Dismissing the overlay discards temporary filter changes.

## 10. Collapsible Health Summary

The health summary lives inside the overlay, not in the header. It is the full-detail surface for health, connectivity, and recency.

### 10.1 Collapse Behavior

- **Default state on open:** expanded
- The user can collapse the summary to a single-line row showing overall health + connectivity label
- Collapsed state persists during the overlay session but **resets to expanded on each new open** from the header badge
- Collapse/expand is a tap on the summary header row or a dedicated chevron control

### 10.2 Expanded Layout

Fixed order within the expanded summary:

1. **Overall health row** — health state + connectivity state + host (read-only)
2. **Last activity rows** — REST last activity + FTP last activity (operation, result, relative time)
3. **Contributor rows** — App, REST, FTP health state + supporting phrase
4. **Primary problem spotlight** — when problems exist
5. **Retry connection action** — when offline only

All five sections are visible without scrolling when the summary is expanded. This satisfies I6 (Immediate Recency Visibility).

### 10.3 Collapsed Layout

Single row: `[connectivity label] [health glyph] [health label]`

Example: `C64U ▲ Degraded` or `Offline ◌`

Tapping the collapsed row expands the summary.

### 10.4 Overall Health Row

Shows:

- Label: `Overall health`
- Health state label (e.g., `Degraded`)
- Connectivity state label (e.g., `C64U`, `Demo`, `Offline`)
- Host value, read-only (e.g., `c64u.local`) — visible in expanded state only
- Explanation phrase when not Healthy (e.g., `REST failures detected`)

Truncation: explanation phrase max 50 characters on compact, 80 on medium, no limit on expanded.

Host display: shown as secondary text beneath the health + connectivity line. Not editable. Users who need to change the host are directed to Settings.

### 10.5 Last Activity Rows

Two rows, always visible in expanded summary:

| Row  | Content                                      | Example                               |
| ---- | -------------------------------------------- | ------------------------------------- |
| REST | Last REST operation + result + relative time | `GET /v1/machine/info · OK · 12s ago` |
| FTP  | Last FTP operation + result + relative time  | `LIST /music · OK · 45s ago`          |

Rules:

- Visible without scrolling
- Above the event stream
- Not behind expansion or additional taps
- Shows `No REST activity yet` / `No FTP activity yet` when no activity exists
- Relative time updates live while the overlay is open
- Truncation: operation description max 40 characters on compact

### 10.6 Contributor Rows

Fixed order: `App`, `REST`, `FTP`.

Each row shows:

- Contributor label (never abbreviated)
- Health state label
- Supporting phrase (e.g., `2 recent problems`, `8 requests, 5 failed`, `Idle`)

Expanded profile adds session totals as a secondary phrase (e.g., `· 32 session total`).

Truncation: supporting phrase max 30 characters on compact, 50 on medium, no limit on expanded.

### 10.7 Contributor Row Interaction

Each row (Overall health, App, REST, FTP) is an independent tap target.

Selecting `Overall health` applies the overall-health preset and focuses the stream.

Selecting a contributor applies that contributor's preset and focuses the stream.

The active row remains visually selected while its preset is active.

### 10.8 Primary Problem Spotlight

Present when the current scope contains at least one visible Problem.

Shows:

- Label: `Investigate now`
- Problem title in plain language (max 60 characters, truncate with ellipsis)
- Affected indicator badge
- Health impact marker
- Concise cause hint (max 40 characters)

Selecting the spotlight scrolls the stream to the matching problem row and expands it.

Omitted when no visible Problem exists.

### 10.9 Retry Connection Action

Present only when connectivity state is `Offline` or `Not yet connected`.

- Shows a `Retry connection` button inline within the expanded summary
- Tapping triggers a connection discovery attempt
- Button disappears when connectivity is restored
- Button is disabled while a connection probe is in flight (`Checking`)
- Host is shown read-only above the retry button for context

Host editing is not available in the overlay. Users who need to change the host are shown a text link: `Change host in Settings`.

## 11. Quick-Focus Controls

### 11.1 Controls

Toggle buttons for evidence types: `Problems`, `Actions`, `Logs`, `Traces`.

These are layered view filters, not competing tabs.

### 11.2 Default State on Open

- `Problems` active
- `Actions` active
- `Logs` inactive
- `Traces` inactive

At least one must remain active at all times.

### 11.3 Secondary Controls

Search and origin filters are secondary.

| Profile  | Search        | Origin filters | Refine button |
| -------- | ------------- | -------------- | ------------- |
| Compact  | Behind Refine | Behind Refine  | Visible       |
| Medium   | Visible       | Behind Refine  | Visible       |
| Expanded | Visible       | Visible        | Not needed    |

`Refine` label shows active count when refinements are active: `Refine (2)`.

The default path to root cause never requires secondary controls.

## 12. Filter Model

### 12.1 Principles

Filtering is inclusive, composable, and deterministic. The user always knows what evidence layer, indicator scope, and refinements are active.

### 12.2 Application Order

1. Evidence type
2. Health indicator
3. Origin
4. Search
5. Pagination

### 12.3 Evidence-Type Filters

`Problems`, `Actions`, `Logs`, `Traces`. At least one must remain active.

### 12.4 Health-Indicator Filter

`All indicators`, `App`, `REST`, `FTP`. Exactly one active at a time.

### 12.5 Origin Filters

`User`, `System`. Optional refinements. Both inactive = no restriction. Both active = no restriction (UI reflects this).

### 12.6 Search

Label: `Filter entries`. Substring match against visible text. Narrows the stream only — does not change health states or summary counts.

### 12.7 Presets

| Entry path              | Evidence types     | Indicator      | Origin | Search |
| ----------------------- | ------------------ | -------------- | ------ | ------ |
| Header badge            | Problems + Actions | All indicators | none   | empty  |
| Settings                | Problems + Actions | All indicators | none   | empty  |
| Summary: Overall health | Problems + Actions | All indicators | none   | empty  |
| Summary: App            | Problems + Actions | App            | none   | empty  |
| Summary: REST           | Problems + Actions | REST           | none   | empty  |
| Summary: FTP            | Problems + Actions | FTP            | none   | empty  |

### 12.8 Reset Behavior

`Reset filters` appears when the current filter state differs from the entry-path preset. Resets to the entry-path preset.

## 13. Event Stream

### 13.1 Order

Always newest first. Fixed across all profiles and filter states.

### 13.2 Root-Cause Prioritization

When a Primary problem exists, its row is the first problem row in the stream. It must not be buried beneath less-actionable evidence.

### 13.3 Entry Types

#### Problem Entry

Collapsed row:

- Badge: `Problem`
- Affected indicator: `App`, `REST`, or `FTP`
- Severity marker
- Relative timestamp
- Problem statement (max 80 characters, truncate with ellipsis)
- Next-clue phrase when available (e.g., `Request timed out`)

Expanded view:

- What happened
- What area it affected
- When it happened
- Likely cause, or `Cause not yet determined`
- Related action summary, or `No related action identified`
- Next evidence to inspect, or `Open logs or traces for deeper evidence`
- User impact when known

#### Action Entry

Collapsed row:

- Badge: `Action`
- Action name
- Origin: `User` or `System`
- Outcome
- Duration when available

Expanded view:

- Ordered effects
- Related problems
- Key outcome details

#### Log Entry

Collapsed row: Badge `Log`, timestamp, concise message.

Expanded view: full message and structured context.

#### Trace Entry

Collapsed row: Badge `Trace`, timestamp, event description.

Expanded view: readable raw event details.

### 13.4 Expansion Rules

- Rows expand inline
- Expanding one row does not collapse others
- Changing filters collapses all expanded rows
- Compact auto-expansion: when the overlay opens from the header badge and a Primary problem exists, that problem row is auto-expanded

### 13.5 Compact Inspection Rule

On compact, the first expanded problem view must expose the likely cause without another nested tap.

## 14. Empty, Loading, No-Result, and Unavailable States

### 14.1 Empty Session

- Overall health: `Idle`
- Connectivity: shown via badge label (e.g., `C64U`, `Demo`, `Not yet connected`)
- All contributors: `Idle`
- Last activity rows: `No REST activity yet` / `No FTP activity yet`
- Stream: `No diagnostics yet. Health information will appear here after activity occurs.`
- Export disabled, Clear disabled

### 14.2 Loading

- Overlay frame, title, summary, and quick-focus controls remain visible
- Stream shows `Loading diagnostics…`
- Previous results remain visible during filter changes until new results are ready
- Loading must not clear the screen or reposition the user

### 14.3 No Results

- Health summary unchanged
- Stream: `No entries match the current filters.`
- `Reset filters` shown in the empty state

### 14.4 Unavailable

- Overall health: `Unavailable`
- Connectivity: shown via badge label
- Persistent banner explains the issue in plain language
- Recovery action shown when retry is possible (e.g., `Retry connection` when offline)
- Previous visible set remains visible beneath the banner if valid

## 15. High-Volume Behavior

### 15.1 Render Window

Initial render: newest 200 visible entries. Older entries load in blocks of 200. Control label: `Load older entries`.

### 15.2 Pagination Rules

- Applied after all filters and search
- Health states and counts reflect the full retained session, not only the rendered page
- `Share filtered` exports the full filtered result, not only the rendered page
- Changing filters resets pagination to the newest page

### 15.3 Live Updates

While the overlay is open:

- Health summary, contributor indicators, and last activity rows update immediately
- At newest position: new entries appear at the top
- Reviewing older entries: position stays stable, `New entries` control appears at the top
- Expanded rows remain expanded if not invalidated
- Primary problem spotlight updates when the primary problem changes
- No automatic animated scrolling

## 16. Export and Clear

### 16.1 Toolbar Actions

- `Share all` — exports all retained evidence, ignores filters
- `Share filtered` — exports the full filtered result (enabled only when visible set is non-empty)
- `Clear all` — removes all retained evidence (requires confirmation)

### 16.2 Clear Confirmation

Text: `Clear all diagnostics? This removes health evidence, problems, actions, logs, and traces for the current session.`

After confirmation: overall health and all contributors change to `Idle`. Filters remain. Stream shows empty session state. Last activity rows reset to `No REST activity yet` / `No FTP activity yet`.

## 17. Entry Paths

### 17.1 From Header Badge (Primary)

- Overlay opens with header preset (§12.7)
- Summary panel starts expanded
- Stream starts at Primary problem (or newest Action)
- On compact: Primary problem auto-expanded if present

### 17.2 From Settings (Secondary)

- Overlay opens with Settings preset (§12.7)
- Summary panel starts expanded
- `Overall health` visible but not selected
- Stream starts at Primary problem (or newest Action)

### 17.3 From Summary Row (overlay already open)

- Filters replaced by the matching contributor preset
- Selected row becomes active
- Stream returns to Primary problem for that scope (or newest Action)

## 18. Display Profile Rules

### 18.1 Shared

All profiles preserve the same concepts, labels, states, and interaction model. Profiles change density only.

### 18.2 Compact

- Header badge: connectivity label + glyph + optional count (§8.6)
- Overlay: full-height sheet
- Summary panel: collapsible, stacked rows, short supporting phrases
- Note: compact badge omits health label text to save space; the shape + count is sufficient at small sizes
- Last activity rows: operation truncated at 40 characters
- Quick-focus visible; search and origin behind Refine
- Collapsed rows: relative timestamps only
- Primary problem auto-expanded on open
- Summary area and scope pinned while stream scrolls
- First expanded problem view shows likely cause without additional nested disclosure

### 18.3 Medium

- Header badge: connectivity label + glyph + count + health label (§8.7)
- Summary panel: collapsible, state + one supporting phrase per row
- Last activity rows: full operation description
- Quick-focus visible; search visible; origin behind Refine
- Collapsed rows: relative timestamps
- Expanded content: grouped metadata layout

### 18.4 Expanded

- Header badge: connectivity label + glyph + health label + problem count (§8.8)
- Summary panel: collapsible, state + supporting phrase + session totals
- Last activity rows: full operation description + absolute timestamp
- Timestamps: absolute + relative
- Quick-focus, search, and origin all visible
- Expanded entries show full detail without hidden sections
- Content order identical to smaller profiles

## 19. Interaction Flow Summary

### 19.1 Primary Path (header to root cause)

1. User sees degraded/unhealthy badge in header (e.g., `▲3 C64U` or `◆5 C64U`)
2. Taps badge → overlay opens with expanded summary showing health, connectivity, last REST/FTP activity
3. Compact: Primary problem auto-expanded (1 tap total)
4. Medium/expanded: Primary problem spotlight visible → tap to expand (2 taps total)

### 19.2 Secondary Path (Settings)

1. Settings → Diagnostics → overlay opens with default preset
2. Optional: tap contributor row to scope
3. Tap problem row to expand (1–3 taps depending on scoping)

### 19.3 Contributor Scoping (overlay open)

1. Tap contributor row in summary panel
2. Stream filters to that contributor
3. Compact: Primary problem auto-expanded for that scope
4. Medium/expanded: tap problem row to expand

### 19.4 Offline Recovery Path

1. User sees `◌ Offline` badge in header
2. Taps badge → overlay opens with expanded summary showing offline state, host, retry button
3. Taps `Retry connection` → connection probe fires
4. Badge updates when connectivity is restored

## 20. Terminology

Fixed user-facing terms (no paraphrasing):

`Overall health`, `App`, `REST`, `FTP`, `Healthy`, `Degraded`, `Unhealthy`, `Idle`, `Unavailable`, `Problems`, `Actions`, `Logs`, `Traces`, `Refine`, `Share all`, `Share filtered`, `Clear all`, `Reset filters`, `Investigate now`, `Filter entries`, `Load older entries`, `New entries`, `Retry connection`, `C64U`, `Demo`, `Offline`, `Not yet connected`

`error` and `failure` may appear in evidence details but are not competing top-level categories. The primary concept is always health.

## 21. Field Ownership Table

Each concept is assigned to exactly ONE surface. No duplication.

| Concept                                        | Surface                                           | Justification                                                                          |
| ---------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Connectivity state (online/demo/offline)       | Header badge label + overlay summary row          | Badge label is always visible; summary row provides detail. Same data, tiered density. |
| Demo vs real indication                        | Header badge label (`C64U` vs `Demo`)             | Label is unambiguous. No separate indicator needed.                                    |
| Overall health state                           | Header badge shape + overlay summary row          | Shape is always visible; summary row provides detail. Same data, tiered density.       |
| Last REST activity (operation + result + time) | Overlay summary last-activity row                 | Visible immediately on open. Not in header (no room).                                  |
| Last FTP activity (operation + result + time)  | Overlay summary last-activity row                 | Visible immediately on open. Not in header (no room).                                  |
| REST/FTP failure statistics                    | Overlay contributor rows (REST, FTP)              | Supporting phrases on contributor rows. Not in header.                                 |
| Problem count                                  | Header badge (count digit) + overlay summary      | Count in badge for at-a-glance severity. Detail in overlay.                            |
| Logs/issues                                    | Overlay event stream (Logs/Traces filters)        | Deep evidence. Never in header or summary.                                             |
| Host                                           | Overlay summary (read-only) + Settings (editable) | Read-only context in overlay. Editing in Settings.                                     |
| Retry connection                               | Overlay summary (contextual, offline only)        | Inline action for the most time-critical recovery.                                     |
| Change host                                    | Settings page only                                | Full connection management in Settings. Not in overlay.                                |

## 22. Popover Disposition

The Connection Status popover is eliminated. Every field is accounted for:

| Former popover field             | Disposition          | Final location                                                              | Reason                                                |
| -------------------------------- | -------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------- |
| Status: Online/Demo/Offline      | Moved                | Header badge label + overlay summary                                        | Integrated into unified badge                         |
| Host                             | Moved                | Overlay summary (read-only) + Settings (editable)                           | Read-only in overlay, edit in Settings                |
| Last activity (single timestamp) | Moved + enhanced     | Overlay summary (per-protocol REST/FTP rows with operation + result + time) | Richer than original; satisfies I6                    |
| REST failures (count)            | Moved                | Overlay REST contributor row + event stream                                 | No longer duplicated in two surfaces                  |
| FTP failures (count)             | Moved                | Overlay FTP contributor row + event stream                                  | No longer duplicated in two surfaces                  |
| Log issues (count)               | Moved                | Overlay event stream (Problems filter)                                      | No longer duplicated in two surfaces                  |
| Retry Now button                 | Moved                | Overlay summary (contextual, offline only)                                  | Per D4                                                |
| Change Host button               | Removed from overlay | Settings page only                                                          | Per D5 — full connection management lives in Settings |

## 23. Unified UX Model

The system works end-to-end as follows: A single badge in the header encodes overall health (via shape: ●/▲/◆/○/◌) and connectivity (via text label: C64U/Demo/Offline/—), giving the user an instant answer to "Is this healthy?" and "Am I connected?" without any interaction. Tapping the badge opens a single diagnostics overlay whose collapsible summary — expanded by default — immediately shows connectivity state, host, overall health, last REST and FTP activity (operation, result, relative time), contributor health states, and the primary problem if one exists. From there, the user can tap a contributor row to scope the event stream, tap a problem to expand it to root cause, or (when offline) tap "Retry connection" to recover — all within the same surface, with zero duplication across the entire system.

## Appendix A: Contradictions Resolved

| #   | Original Rule/State                                        | Problem                                                                  | Resolution                                                                                                                   |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| C1  | §12.1 (old): 4-row header layout                           | AppBar is single flex row; ≤360px has no room                            | Single unified badge glyph in header. Full detail in overlay.                                                                |
| C2  | §4 (old): "Icons must always be paired with text"          | Compact header has no room for full health text beside glyph             | Compact badge uses shape + count + connectivity label. Medium adds health label text. Overlay icons always paired with text. |
| C3  | §11.2 (old): header shows "overall + 3 contributors"       | No physical space for 4 items in header row                              | Header shows one composite badge. Overlay shows all contributors.                                                            |
| C4  | §11.5 (old): each header element is independent tap target | Cannot fit 4 tap targets in header                                       | Relocated to overlay summary panel. Header has one tap target.                                                               |
| C5  | §15.1 (old): "1 tap compact" to root cause                 | Opening overlay is a tap, so was actually 2                              | 1 tap on badge opens overlay with auto-expanded primary problem. Accurate.                                                   |
| C6  | "Header" vs "Summary Area" — same content described twice  | Unclear which surface each section describes                             | §8 = Badge (AppBar); §10 = Summary (overlay). Distinct surfaces.                                                             |
| C7  | Cold-start state not specified                             | No definition of pre-activity state                                      | §7.5: cold-start = "Idle" + "Not yet connected".                                                                             |
| C8  | DiagnosticsActivityIndicator not addressed                 | 3-dot indicator in production not mentioned                              | Badge replaces it. Per-protocol breakdown in overlay.                                                                        |
| C9  | No truncation rules for supporting text                    | Overflow on narrow screens                                               | Explicit character limits in §10.4, §10.5, §10.6, §10.8, §13.3.                                                              |
| C10 | Connectivity separate from diagnostics                     | Two entry points (C64U button + health badge) create ambiguity           | Eliminated. Single badge encodes both. Single overlay shows both.                                                            |
| C11 | REST/FTP/error counts duplicated                           | Shown in DiagnosticsActivityIndicator dots AND Connection Status popover | Single source: overlay contributor rows + event stream.                                                                      |
| C12 | Last activity not in diagnostics                           | Popover showed it, overlay did not                                       | Overlay summary shows per-protocol last activity (§10.5).                                                                    |
| C13 | Retry action placement unclear                             | Popover had "Retry Now", overlay had nothing                             | Retry action lives in overlay summary when offline (§10.9).                                                                  |
| C14 | Host editing in popover                                    | Connection management split between popover and Settings                 | Overlay: read-only host. Settings: editable host. No split.                                                                  |

## Appendix B: Rejected Approaches

| Approach                                                             | Rejection reason                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Keep both surfaces (popover + overlay)**                           | Violates I3 (two entry points: "which do I tap?") and I4 (REST/FTP counts in both surfaces). Users must learn two overlapping surfaces instead of one.                                                                                                                                                                                                                                     |
| **Partial merge (popover keeps connectivity, overlay keeps health)** | Violates I5 (connectivity outside disclosure ladder) and I2 (health not visible alongside connectivity in header). Connectivity and health are contextually linked — separating them forces the user to mentally merge two surfaces.                                                                                                                                                       |
| **Header-only solution (everything in header, no overlay)**          | Cannot show recency, contributors, evidence, or retry action in AppBar. Violates I6. Insufficient for any investigation beyond glance.                                                                                                                                                                                                                                                     |
| **Encode diagnostics in C64U indicator**                             | Multiplexes two independent concerns (connectivity + health) into one overloaded signal: "Is it red because offline or because REST failed?" Impossible to disambiguate without interaction. The REVERSE (encode connectivity in diagnostics badge) works because shape encodes health independently from label encoding connectivity — two distinct channels, not one overloaded channel. |
| **Multi-row header** (4 rows in AppBar for overall + 3 contributors) | Physically impossible in compact ≤360px. Would double header height. Contradicts single-row AppBar.                                                                                                                                                                                                                                                                                        |
| **Text-only health label in compact header** (e.g., "Degraded")      | "Degraded" = 8 chars at ~7px = 56px. No room for connectivity label. Glyph + count + label is more space-efficient.                                                                                                                                                                                                                                                                        |
| **Separate badge per contributor** (3 small badges for App/REST/FTP) | Returns to current 3-dot model. Users must interpret 3 independent signals before understanding overall health.                                                                                                                                                                                                                                                                            |
| **Color-coded header background**                                    | Violates "no color-only encoding." Visual instability — entire header changes meaning.                                                                                                                                                                                                                                                                                                     |
| **Animation for severity**                                           | §4 prohibits motion for health/severity. Accessibility concerns.                                                                                                                                                                                                                                                                                                                           |
| **Hover tooltip for badge details**                                  | Not available on mobile (primary platform). Violates compact-safe principle.                                                                                                                                                                                                                                                                                                               |

## Appendix C: Compact Layout Proof

The unified badge must fit within ≤360px alongside the page title.

**Available space:** 360px total − 16px left padding − 16px right padding − 8px gap = 320px usable. Page title (longest: "CONFIG") at ~55px. Remaining: ~265px. Badge needs 56–90px. **Proven: fits with ≥175px margin.**

**Previous allocation:** DiagnosticsActivityIndicator (~72px for 3 dots with counts) + gap (12px) + ConnectivityIndicator (~50px for "C64U" button) = ~134px. The unified badge at 56–90px is strictly smaller. **Proven: space reduction.**

**Single line:** Badge is a single flex row: `[glyph][count?][gap][label]`. No wrapping. No stacking. **Proven: single line.**

**No ambiguity:** Shape unambiguously identifies health state (5 distinct shapes). Label unambiguously identifies connectivity ("C64U" / "Demo" / "Offline" / "—"). No two states share appearance. **Proven: no ambiguity.**

**No hidden critical information:** Health state (shape) and connectivity (label) are both always visible in the header without interaction. **Proven: nothing hidden.**

## Appendix D: Invariant Compliance

| Invariant                           | How satisfied                                                                                                                                      | Section reference        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| I1 Zero Confusion                   | Single badge, single overlay, one click path. At any time, shape = health, count = problem quantity, label = connectivity.                         | §8.1, §8.4, §9           |
| I2 Always-Visible Global State      | Badge shape = health, badge label = connectivity, always in header across all profiles. No interaction required.                                   | §8.3, §8.6, §8.7, §8.8   |
| I3 Single Deterministic Click Path  | ONE badge → ONE overlay → primary problem. Compact: 1 tap. Med/expanded: 2 taps. No competing entry points.                                        | §8.9, §19.1, Appendix C  |
| I4 No Duplication                   | Field ownership table (§21) assigns each concept to exactly one surface. Popover eliminated (§22).                                                 | §21, §22                 |
| I5 Progressive Disclosure Integrity | Header signal (badge) → summary (health + connectivity + recency + contributors) → problems → evidence. Connectivity is integrated at every level. | §3 principle 4, §10, §13 |
| I6 Immediate Recency Visibility     | Summary starts expanded (§10.1). Last REST/FTP activity rows (§10.5) are visible without scrolling, above the event stream, not behind expansion.  | §10.1, §10.2, §10.5      |
