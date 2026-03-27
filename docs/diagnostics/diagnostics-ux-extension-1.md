# Diagnostics UX Extension 1 Specification

## 1. Purpose

This document extends
[Diagnostics UX Specification](./diagnostics-ux-redesign.md).

The redesign specification remains the source of truth for:

- the unified header badge in the AppBar
- the diagnostics overlay as the single first-level diagnostics surface
- the base health model, contributor model, and fixed top-level terms
- the collapsible summary, event stream, filtering, export, and clear behavior

This extension defines the next layer of behavior inside that same overlay:

- fast recovery actions from the status-badge entry path
- inline device switching
- deterministic active health checks
- latency analysis drilled down from the percentile summary
- health history and advanced health analysis
- config drift and transport-activity diagnostics
- export enrichment for recovery and health evidence

The goal is one surface that supports both of these user intents:

1. `Recover now`
2. `Explain what is wrong`

The overlay must handle both intents without splitting diagnostics across
multiple first-level surfaces.

## 2. Scope

### 2.1 Covered

- contextual `Retry connection`
- contextual `Switch device` inside the diagnostics overlay
- recovery feedback and post-recovery transitions
- mapping recovery attempts into diagnostics evidence
- deterministic health-check execution and presentation
- high-level latency summary with drill-down charting
- checkbox-based latency scope filtering
- health-history storage and visualization
- firmware, FPGA, core, and uptime detail
- config-drift inspection
- REST and config activity heat maps
- export payload enrichment for recovery and health data

### 2.2 Not Covered

- the badge encoding system itself
- the overlay top-level section order
- full Settings-based connection management
- additional header buttons, header popovers, or alternate first-level
  diagnostics windows

## 3. Relationship To The Base Diagnostics Spec

### 3.1 Authority

The redesign spec remains authoritative unless this extension explicitly says
otherwise.

This extension intentionally adds one behavioral override:

- host and optional port may be edited inside diagnostics through
  `Switch device`

That override replaces the earlier Settings-only host-editing boundary. Settings
remains the broader connection-management surface, but it is no longer the only
place where target changes can begin.

### 3.2 Inherited Terms

This extension inherits the redesign terms unchanged:

- `Overall health`
- `App`
- `REST`
- `FTP`
- `Healthy`
- `Degraded`
- `Unhealthy`
- `Idle`
- `Unavailable`
- `Problems`
- `Actions`
- `Logs`
- `Traces`
- `Retry connection`
- `Share all`
- `Share filtered`
- `Clear all`

This extension must not reintroduce competing top-level labels such as
`Unknown`.

### 3.3 Inherited Overlay Order

The redesign spec remains authoritative for the diagnostics overlay order:

1. title and description
2. collapsible summary
3. quick-focus controls
4. event stream
5. toolbar actions

Everything in this extension must fit into that structure using:

- summary-region behavior
- contextual disclosure inside the summary
- stream entries and expanded rows
- overlay-local secondary detail views
- nested analytic popups when analysis needs focused chart or grid space
- export payload content

### 3.4 Related Specifications

| Document | Relationship |
| --- | --- |
| [Diagnostics UX Specification](./diagnostics-ux-redesign.md) | Base diagnostics model and first-level surface |
| [Tracing Specification](./tracing-spec.md) | Event model, retention, export expectations |
| [Action Summary Specification](./action-summary-spec.md) | Action derivation used by diagnostics evidence |
| [Trace Forensic Analysis](./trace-forensic-analysis.md) | Endpoint classes and contention patterns that inform latency and heat-map views |

## 4. Design Intent

### 4.1 Core Tension

The overlay opened from the status badge must serve two user intents:

1. `Recover now`
2. `Explain what is wrong`

If recovery controls dominate the surface, diagnostics turns into a control
panel and root-cause investigation gets buried.

If diagnostics dominates completely, the user must leave the overlay to perform
obvious recovery actions such as reconnecting or switching targets. That is too
slow and breaks the one-surface mental model.

### 4.2 Resolution

The overlay uses two coordinated lanes inside the same summary-first model:

- `Investigation lane`: health summary, contributor rows, primary problem
  spotlight, event stream
- `Recovery lane`: compact, contextual connection actions that expand only when
  needed

The investigation lane remains the default mental model.

The recovery lane becomes more prominent only when connection state or recent
recovery failures suggest that quick intervention is the most likely next step.

### 4.3 Governing Principles

1. One badge, one overlay, one mental model.
2. Root cause remains visible before advanced controls.
3. Recovery actions must be available without navigating to Settings.
4. Device switching must be safe: validate first, commit only on success.
5. Recovery must not erase investigation context or filter state.
6. Advanced health tools must remain secondary and must never replace the
   problem stream.

## 5. Interaction Architecture

### 5.1 Interaction Layers

This extension uses three fixed interaction layers.

| Layer | Definition | Allowed Uses |
| --- | --- | --- |
| `Diagnostics overlay` | The primary overlay opened from the unified header badge or Settings | Summary, quick-focus controls, event stream, toolbar actions |
| `Inline disclosure` | Expansion inside the diagnostics overlay with no new backdrop, route, or focus trap | `Switch device`, expanded stream rows, short summary detail |
| `Nested analytic popup` | One popup above the diagnostics overlay for chart-heavy or matrix-heavy analysis | Latency analysis, health history, REST activity heat map, config activity heat map |

The layers are fixed and must not be mixed informally.

### 5.2 Surface Assignment Rules

Use direct summary-region actions for:

- `Retry connection`

Use `inline disclosure` for:

- `Switch device`
- expanded problem rows
- expanded action rows
- short detail revealed from summary rows

Use `secondary detail view` inside the diagnostics overlay for:

- lightweight read-only detail such as firmware, FPGA, core, and uptime
- dense but non-chart detail such as health-check results when inline expansion
  is insufficient

Use `nested analytic popup` for:

- latency analysis over time
- health-history charts
- REST activity heat maps
- config activity heat maps
- other advanced analytic views that need focused chart or grid space

### 5.3 Stack Invariants

The window model is a strict stack, not a free-form modal system.

Allowed stack states:

1. base app only
2. base app + diagnostics overlay
3. base app + diagnostics overlay + one nested analytic popup

Forbidden stack states:

- base app + nested analytic popup without the diagnostics overlay
- base app + diagnostics overlay + two analytic popups
- base app + diagnostics overlay + analytic popup + any third overlay

Only one nested analytic popup may be open at a time.

### 5.4 Open, Close, And Replacement Order

Open order:

1. user taps the status badge
2. diagnostics overlay opens
3. user may expand inline disclosures inside that overlay
4. user may open one nested analytic popup from within that overlay

Close order:

1. close nested analytic popup if present
2. collapse inline disclosure only when the user explicitly collapses it
3. close diagnostics overlay

If the user requests a different analytic popup while one is already open:

1. close the current analytic popup
2. open the requested analytic popup
3. keep the diagnostics overlay mounted throughout

The app must not momentarily drop the user back to the base app during that
replacement.

### 5.5 Layer Behavior

#### Diagnostics Overlay

- remains the primary diagnostics and recovery surface
- never closes implicitly because a nested analytic popup was opened or
  dismissed

#### Inline Disclosure

- is part of the diagnostics-overlay layout
- does not create a new window, route, layer, backdrop, or focus trap
- may reflow overlay content when expanded
- does not change the overlay backdrop
- collapses only through its own disclosure control

Back behavior:

- browser/system back closes the diagnostics overlay, not the inline
  disclosure, unless a narrower control explicitly owns back behavior

#### Secondary Detail View

- remains inside the diagnostics overlay
- replaces a portion of overlay content, not the whole app
- keeps diagnostics title and context visually evident
- adds no new backdrop
- adds no new focus layer
- dismisses back to the prior state inside the same overlay

#### Nested Analytic Popup

- opens above the diagnostics overlay
- dims the diagnostics overlay further but keeps it recognizable underneath
- owns focus while open
- has its own title, close affordance, and scroll region
- makes the diagnostics overlay inert while open
- restores focus to the invoking control when closed

### 5.6 Visual Hierarchy And Motion

Visual emphasis order:

1. base app
2. diagnostics overlay
3. nested analytic popup

The user must never be unsure whether they are:

- in the main app
- in the diagnostics overlay
- in a nested analytic popup opened from diagnostics

Motion must reinforce that hierarchy.

Required behavior:

- diagnostics overlay enters as the primary modal surface from the app
- inline disclosures expand within layout rather than appearing as separate
  modal sheets
- nested analytic popups enter above the diagnostics overlay as a distinct
  second layer

Forbidden behavior:

- using the same animation for inline disclosure and nested analytic popup
- animating a nested analytic popup in a way that suggests the diagnostics
  overlay was replaced
- transitions that imply a route change away from diagnostics

### 5.7 Back, Escape, Focus, And State Restoration

Dismissal priority is fixed:

1. nested analytic popup
2. diagnostics overlay
3. underlying app route

Therefore:

- if a nested analytic popup is open, back closes only that popup
- if no nested analytic popup is open, back closes the diagnostics overlay
- back must never jump directly from nested analytic popup to the app while
  leaving the diagnostics overlay in an undefined state

Focus restoration:

- opening the diagnostics overlay moves focus into the overlay
- closing the diagnostics overlay returns focus to the status badge
- opening a nested analytic popup moves focus into that popup
- closing a nested analytic popup returns focus to the invoking control inside
  the diagnostics overlay

State restoration while a nested analytic popup is open:

- parent-overlay filters are preserved
- parent-overlay scroll position is preserved
- expanded stream rows remain expanded unless the user changed parent filters
- open inline disclosures remain in their prior state after the popup closes

### 5.8 Canonical Transition Scenarios

1. `Status badge -> diagnostics overlay -> Switch device expand -> Connect`
   The user stays in one overlay the whole time. No second popup appears.
2. `Status badge -> diagnostics overlay -> tap latency summary -> latency popup`
   The latency popup opens above diagnostics. Closing it returns to the same
   diagnostics state.
3. `Status badge -> diagnostics overlay -> tap health history -> history popup`
   The history popup opens as the one allowed analytic popup. Closing it
   returns without losing summary or stream context.
4. `Status badge -> diagnostics overlay -> open heat map`
   The heat map opens as a nested analytic popup. It replaces any existing
   analytic popup instead of stacking above it.

## 6. Summary-First Model

### 6.1 Summary Responsibility

The expanded summary remains the first screenful and keeps the redesign's fixed
order:

1. `Overall health`
2. last-activity rows
3. contributor rows
4. `Investigate now`
5. connection actions

This extension defines item 5 as a small, contextual `Connection actions`
region. It must not displace the first four investigation-oriented sections.

### 6.2 Investigation-First State

When connectivity is stable and the user is primarily diagnosing degraded or
unhealthy behavior:

- `Overall health`, last activity, contributors, and `Investigate now` remain
  visually primary
- connection actions remain visible but secondary
- advanced tooling stays behind detail disclosures, not in the first screenful

### 6.3 Recovery-First State

The `Connection actions` region becomes more prominent when recovery is the
likely next step.

Recovery-first mode applies when:

- connectivity is `Offline`
- connectivity is `Not yet connected`
- connectivity is `Demo` and the user intends to switch to real hardware
- a reconnect attempt just failed
- a target-switch attempt just failed

In recovery-first mode:

- the connection-actions region is expanded by default
- inline status feedback is shown directly in that region
- the event stream remains visible below and keeps accumulating evidence

### 6.4 No Context Loss

Using reconnect or switch-device controls must not:

- close the overlay
- reset the active filter preset
- clear the visible stream
- discard the current primary problem

Recovery attempts add evidence. They do not replace existing investigation
context.

## 7. Connection Actions Region

### 7.1 Placement And Contents

The `Connection actions` region lives in the expanded summary, after
`Investigate now`.

It is part of the diagnostics overlay, not a nested dialog and not a route
change.

The region may contain:

- primary action: `Retry connection`
- secondary action: `Switch device`
- read-only current target context
- inline transient status and failure feedback
- optional recent-target shortcuts

### 7.2 Visibility Rules

| Connectivity or context | Retry connection | Switch device | Default state |
| --- | --- | --- | --- |
| `Offline` | visible | visible | expanded |
| `Not yet connected` | visible | visible | expanded |
| `Demo` | visible | visible | expanded |
| `Online` + healthy | hidden or subtle | visible | collapsed |
| `Online` + degraded due to transport instability | visible | visible | collapsed |
| recent reconnect or switch failure | visible | visible | expanded |

On compact layouts, the region defaults to a single collapsed summary row:

`Connection actions`

Tapping that row expands the inline controls.

### 7.3 Busy State

While a connection probe or target switch is in flight:

- `Retry connection` is disabled
- `Switch device` inputs and action buttons are disabled
- one inline progress message is shown
- the rest of the overlay remains readable

## 8. Recovery Flows

### 8.1 Retry Connection

#### Purpose

`Retry connection` is the fastest recovery action when the currently configured
target is still believed to be correct.

#### Flow

1. user taps `Retry connection`
2. the action enters a busy state with inline progress text such as
   `Connecting...`
3. a manual connection-discovery attempt runs
4. on success, the overlay remains open and updates in place
5. on failure, inline failure feedback appears in the same region

#### Success Behavior

On success:

- show a short inline success message such as `Connected to U64E2`
- update connectivity and health in the summary immediately
- append an `Action` entry for the reconnect attempt
- auto-trigger a health check after connection is re-established

#### Failure Behavior

On failure:

- show inline failure text in plain language
- include the current target for context
- keep `Switch device` available directly below
- append an `Action` entry and a `Problem` entry when appropriate

Example failure copy:

`Connection failed to c64u.local`

#### Frequency

Repeated retries must remain explicit user actions unless a separately defined
auto-recovery feature is enabled elsewhere.

No hidden retry loop is allowed in this spec.

### 8.2 Switch Device

#### Purpose

`Switch device` is the fast target-change workflow inside diagnostics. It
exists for the case where recovery is blocked because the current target is
wrong, stale, unavailable, or the user wants to jump to another device
immediately.

#### Disclosure Model

`Switch device` is an inline disclosure, collapsed by default unless the
summary is in recovery-first mode.

Collapsed label:

`Switch device`

Expanded content:

- host input
- optional port input
- `Connect` action
- `Cancel` action
- optional recent successful targets

#### Form Behavior

Defaults:

- host is prefilled from the current configured target
- port is prefilled from the current configured target and defaults to `80`

Rules:

- normalize the entered host before validation
- validate the candidate target before committing it
- commit only on success
- preserve the previously configured target on failure

#### Connect Flow

1. user expands `Switch device`
2. user edits host and optionally port
3. user taps `Connect`
4. the candidate device is probed first
5. if validation succeeds, the candidate becomes the active target
6. reconnect completes against that target
7. the overlay updates in place and a health check auto-runs

#### Failure Flow

If validation or connection fails:

- do not persist the candidate target
- keep the switcher open
- show inline failure details in plain language
- preserve previous investigation context in the stream

Example failure copy:

`Could not reach 192.168.1.42:80`

#### Success Flow

On success:

- show a short inline success message such as `Switched to 192.168.1.42`
- update host and connectivity shown in the summary
- append an `Action` entry describing the target switch
- append any resulting `Problems` if the new device is reachable but degraded

#### Recent Targets

The expanded switcher may show up to three recent successful targets as one-tap
chips.

Rules:

- show host and optional model label
- selecting a chip still performs validation
- failed chip selection must not overwrite the current target

### 8.3 Relationship To Settings

Settings remains the full connection-management surface.

The in-overlay switcher is intentionally narrower:

- optimized for fast switching
- validation-first
- limited to host and port
- avoids broader settings context

If the user needs advanced editing beyond host and port, the switcher may show
the secondary text link:

`Open connection settings`

## 9. Recovery Evidence Model

### 9.1 Evidence Emission

Recovery actions must produce diagnostics evidence.

Each reconnect or switch-device attempt may generate:

- an `Action`
- one or more `Problems`
- refreshed contributor recency
- updated primary-problem selection

### 9.2 Contributor Attribution

| Event | Contributor |
| --- | --- |
| reconnect transport failure | `REST` or `FTP`, based on the failing channel |
| target validation failure | `REST` unless FTP-specific validation fails later |
| commit or restore mismatch during switching | `App` |
| successful reconnect or switch | no downgrade; records recovery action only |

### 9.3 Root-Cause Continuity

If a recovery attempt fails, the resulting problem becomes eligible for
`Investigate now` immediately under the normal primary-problem rules.

This preserves the fast path from attempted recovery to root cause.

## 10. Health Model Extension

### 10.1 Base Model

Overall health, contributor health, connectivity composition, current window,
and worst-contributor-wins roll-up remain defined by the redesign spec.

### 10.2 Role Of Active Health Checks

Active health checks add deterministic evidence. They do not replace the base
health model.

They may:

- generate `Actions`
- generate `Problems`
- refresh contributor recency
- enrich supporting phrases and exports

They must not:

- invent a new top-level health state
- force `Healthy` over fresher problem evidence
- bypass the redesign roll-up logic

### 10.3 Contributor Mapping

| Probe | Primary contributor | Notes |
| --- | --- | --- |
| `REST` | `REST` | Direct transport reachability and response validation |
| `FTP` | `FTP` | Direct transport reachability and listing validation |
| `JIFFY` | `App` | Capability and status evidence above raw transport |
| `RASTER` | `App` | Optional capability evidence above raw transport |
| `CONFIG` | `App` | Semantic roundtrip integrity unless failure is clearly transport-level |

For `CONFIG`:

- transport failure maps to `REST`
- semantic mismatch after successful transport maps to `App`

### 10.4 Result Contribution Rules

| Outcome | Effect |
| --- | --- |
| `Success` | positive evidence only; no downgrade |
| `Partial` | contributor is at least `Degraded` for the current window |
| `Fail` | contributor is at least `Degraded`; may become `Unhealthy` when blocking or repeated |
| `Skipped` | no state change; skip reason must be recorded |

### 10.5 No False Green

If no recent diagnostics evidence exists, overall health remains `Idle`.

A manually run health check can move the system out of `Idle`, but only through
normal contributor evidence and roll-up rules.

## 11. Deterministic Health Check System

### 11.1 Execution Model

A health check is one strict sequential pass:

`REST -> JIFFY -> RASTER -> CONFIG -> FTP`

Constraints:

- no parallel execution
- no hidden retries
- no probabilistic sampling
- one recorded pass per trigger

Dependent probes may be recorded as `Skipped` with explicit reasons when an
earlier prerequisite failed.

### 11.2 Triggers

Health checks may be triggered by:

- manual user action from the diagnostics overlay
- automatic run after successful reconnect
- automatic run after successful device switch
- scheduled execution when explicitly enabled

Scheduled execution defaults to `Off`.

Allowed interval range:

- minimum: 3 seconds
- maximum: 10 minutes

### 11.3 Probe Definitions

#### REST

- endpoint: `GET /v1/info`
- `Success`: HTTP 200 with parseable device info
- `Fail`: timeout, network error, non-success response, or invalid payload

#### JIFFY

- validates advanced timing and uptime-source availability
- `Success`: required timing fields are present and parseable
- `Fail`: required fields are missing or unreadable

#### RASTER

- optional capability check
- `Skipped` is acceptable when unsupported by device or firmware
- `Fail` is reserved for attempted checks that should have worked

#### CONFIG

Roundtrip verification proves safe write-read-revert behavior.

Mutation-target priority:

1. LED strip intensity
2. SID volume with the smallest safe reversible delta

Required steps:

1. read current value
2. write temporary value
3. read back
4. revert to original value
5. verify the reverted value

`Success` requires consistent write, readback, and revert verification.

`Fail` includes:

- write error
- readback mismatch
- revert error
- post-revert mismatch

#### FTP

- operation: `LIST /`
- timeout: 1000 ms
- `Success`: valid directory listing returned
- `Fail`: timeout, auth failure, connection error, or invalid listing

### 11.4 Recorded Run

Each run records:

- start timestamp
- end timestamp
- total duration
- per-probe outcome
- per-probe duration when attempted
- contributor attribution
- concise failure reason or skip reason
- latency snapshot

### 11.5 Presentation

Health-check results must appear inside the existing diagnostics UX.

Allowed presentation patterns:

- an `Action` entry in the stream with expandable per-probe details
- a secondary detail view opened from that action entry
- a secondary detail view reached from `Overall health`

Presentation order is fixed and intentionally differs from execution order.

Display probe results in this order:

1. `REST`
2. `FTP`
3. `CONFIG`
4. `RASTER`
5. `JIFFY`

`RASTER` remains optional. When unsupported, it may appear as `Skipped` at the
end of the presented list.

Example dense detail:

```text
REST    Success   200 OK          52 ms
FTP     Success   LIST /          95 ms
CONFIG  Success   Roundtrip       180 ms
RASTER  Skipped   Unsupported
JIFFY   Success   Timing ready    78 ms
----------------------------------------
Latency  p50 60 ms · p90 140 ms · p99 220 ms
Result   Healthy · 312 ms
```

This detail does not change the overlay's top-level order.

## 12. Latency Analysis

### 12.1 Measurement Model

Latency is collected for:

- `REST`
- `CONFIG`
- `FTP`

Rolling latency statistics cover a trailing 5-minute window.

Reported metrics:

- `p50`
- `p90`
- `p99`

Streaming percentile estimation is allowed only if it remains deterministic for
the same input sequence.

### 12.2 Summary Use

Latency may enrich contributor supporting phrases, but it remains secondary to
health state and visible problems.

Example:

`REST · Healthy · p90 140 ms`

The diagnostics overlay may also show a compact high-level latency summary
using:

- `P50`
- `P90`
- `P99`

This summary is a tappable analysis affordance, not static text.

### 12.3 Popup Model

Selecting the latency summary opens a `nested analytic popup` above the
diagnostics overlay.

Rules:

- the popup opens above the existing diagnostics overlay
- the diagnostics overlay remains mounted and unchanged
- closing the popup returns the user to the same diagnostics state they came
  from
- no parent filters, scroll position, or expanded rows are reset

This is an intentional exception to the normal preference for inline detail
views because multi-series latency analysis needs focused space.

### 12.4 Popup Title And Purpose

Title:

`Latency analysis`

Description:

`Request latency over time for the current diagnostics session.`

Purpose:

- compare `P50`, `P90`, and `P99` together
- inspect percentile spread over time
- narrow the chart to relevant call families without leaving diagnostics

### 12.5 Chart Content

The popup chart shows all three percentile lines together over time:

- `P50`
- `P90`
- `P99`

Default view:

- all call types enabled

The chart must make percentile separation legible without relying on color
alone.

Required secondary carriers:

- line labels in the legend or filter area
- distinct stroke patterns or point markers when necessary
- textual hover or focus details

### 12.6 Scope Filters

The popup supports checkbox-based scope filters using the existing app checkbox
pattern.

The filter model is inclusive:

- multiple boxes may be checked at once
- unchecked groups are excluded from the chart
- at least one checkbox must remain enabled

The popup must use the same checkbox control concept already used elsewhere in
the app, not custom segmented controls or pills that imitate checkbox
behavior.

The popup supports three scope levels inside one checkbox set:

1. all call types
2. transport-family subsets
3. specific endpoint classes

These levels must not be split into separate tabs.

Initial checked state:

- `All call types`

When `All call types` is checked, the specific family and endpoint-class boxes
are visually subordinate and may be disabled or auto-selected for clarity.

#### Transport Family Filters

The first breakdown beneath `All call types` is:

- `REST`
- `FTP`

This supports comparison of:

- all traffic
- REST only
- FTP only
- REST and FTP together

#### Endpoint Classifications

Endpoint classes must be grounded in existing request behavior and governance
already present in the codebase.

Starting classification model:

- `Info`
  `GET /v1/info`
- `Configs (full tree)`
  `GET /v1/configs`
- `Config items`
  `GET /v1/configs/<category>/<item>` and similar targeted config reads
- `Drives`
  `GET /v1/drives`
- `Machine control`
  `/v1/machine:*`, `/v1/runners:*`, and `/v1/streams/*:(start|stop)`
- `FTP list`
  `/v1/ftp/list`
- `FTP read`
  `/v1/ftp/read`
- `Other`
  any traced REST or FTP request not matching the classes above

Rationale:

- the forensic analysis already identifies `/v1/info`, `/v1/configs`,
  `/v1/drives`, and `/v1/ftp/list` as meaningful latency and contention
  classes
- the device-interaction layer already recognizes `/v1/info`,
  `/v1/configs`, `/v1/drives`, machine-control paths, and FTP operations as
  distinct policy surfaces

### 12.7 Checkbox Layout

Recommended checkbox grouping:

- `All call types`
- `REST`
- `FTP`
- `Info`
- `Configs (full tree)`
- `Config items`
- `Drives`
- `Machine control`
- `FTP list`
- `FTP read`
- `Other`

Layout rules:

- use a stacked list on compact
- use two columns on medium when space allows
- use wrapped multi-column layout on expanded
- labels must remain fully readable without horizontal scrolling

### 12.8 Filter Semantics

Filter semantics:

- checking `REST` includes all REST endpoint classes
- checking `FTP` includes all FTP endpoint classes
- checking a specific endpoint class includes only that class
- checking specific classes automatically implies the parent transport family
  for display logic, but the chart dataset is still built from the explicit
  checked set
- unchecking a transport family clears its specific child classes

If both `REST` and `FTP` are unchecked, the UI must prevent the final uncheck
or immediately restore the last valid checked state.

### 12.9 Time-Series And Inspection Behavior

The latency chart is plotted across the current diagnostics-session timeline.

Each visible time bucket shows:

- `P50`
- `P90`
- `P99`

for the currently checked dataset.

When too little data exists for a percentile line, the chart shows a gap rather
than inventing values.

Selecting or hovering a point on the chart shows:

- time bucket
- `P50`
- `P90`
- `P99`
- sample count
- active filter summary

### 12.10 Empty, Sparse, And Close Behavior

If the checked dataset has no samples:

- keep the popup frame and filters visible
- show `No latency samples match the current filters.`
- offer a lightweight `Reset filters` action inside the popup

If the dataset is sparse:

- keep the chart visible
- annotate that percentile lines are based on limited samples

The latency popup provides:

- close button
- system back or escape dismissal

Closing it returns focus to the control that opened it inside diagnostics.

## 13. Health History

### 13.1 Storage

Health-check history uses a ring buffer with:

- maximum entries: 500

Entry schema:

```text
{
  timestamp,
  overallHealth,
  durationMs,
  probes: {
    rest,
    jiffy,
    raster,
    config,
    ftp
  },
  latency: { p50, p90, p99 }
}
```

This complements, but does not replace, the retained diagnostics session.

### 13.2 Surface Role

Health history uses the `nested analytic popup` layer because the chart needs
focused space and should not compete with the stream.

It must not replace:

- the summary
- `Investigate now`
- the event stream as the main investigation surface

### 13.3 Chart Model

The chart uses:

- X-axis: time
- Y-axis: categorical health bands

Recommended band order from top to bottom:

1. `Unavailable`
2. `Unhealthy`
3. `Degraded`
4. `Healthy`
5. `Idle`

### 13.4 Interaction

Allowed interactions:

- pinch-to-zoom
- horizontal pan
- explicit zoom controls

### 13.5 Optional Overlays

Optional overlays:

- failed health checks
- reconnect events
- target switches
- config roundtrip failures

## 14. Secondary Detail Views

### 14.1 Overall Health Detail

Firmware, FPGA, core, and uptime belong in a secondary detail view reached from
`Overall health`, not in the always-visible summary.

Sources:

- firmware, FPGA, and core: `GET /v1/info`
- uptime: JIFFY-derived timing data

Display example:

```text
Firmware  vX
FPGA      vY
Core      vZ
Uptime    2h 14m
```

### 14.2 Uptime Derivation

When uptime is derived from JIFFY:

`uptimeSeconds = jiffy / 60`

If JIFFY data is unavailable, show a plain-language unavailable value rather
than guessing.

### 14.3 Last-Activity Rows

The redesign requirement remains unchanged:

- REST and FTP last-activity rows stay visible in the expanded summary
- relative time updates live while the overlay is open
- empty states remain `No REST activity yet` and `No FTP activity yet`

Probe data may enrich those details, but must not replace live last-activity
reporting.

## 15. Config Drift And Activity Analysis

### 15.1 Config Drift

Config drift is an advanced investigation view, not a top-level replacement for
the summary or stream.

Default surface:

- secondary detail view inside the diagnostics overlay

Escalation:

- if the drift view requires dense comparison across many categories, it may
  open in the `nested analytic popup` layer instead

Algorithm:

1. fetch runtime config
2. fetch persisted config
3. diff item by item
4. show changed values only

Presentation rules:

- group by category
- show only changed values
- prefer stacked layouts over forced horizontal scrolling on compact

Example:

```text
Audio Mixer
  Vol UltiSid 1: -6 dB -> -3 dB

LED Strip
  Intensity: 25 -> 26
```

### 15.2 Shared Heat-Map Model

REST, FTP, and config activity analysis must use one shared heat-map
visualization model.

There is one heat map each for:

- `REST`
- `FTP`
- `CONFIG`

Heat maps use the `nested analytic popup` layer because they need focused grid
space and filter affordances.

Allowed adaptations:

- row grouping rules
- column labels
- value formatter
- tooltip content
- cell-detail content

### 15.3 Shared Matrix Layout

All three heat maps use the same matrix structure.

Rows:

- aggregate related endpoint families or config categories
- show the group label to the left of the matrix

Columns:

- represent concrete items within the selected grouping model
- show the concrete item label above the matrix
- render the concrete item label diagonally from top left to bottom right for
  compact, readable dense matrices

Cells:

- represent one grouped row plus one concrete column intersection
- remain clickable even when the current value is zero or sparse
- may render an empty or low-intensity state when no samples exist for that
  intersection

### 15.4 Heat Metric Modes

Heat color defaults to call-count intensity.

The user may switch the heat metric to latency intensity without changing the
underlying row or column structure.

Metric modes:

- `Count`
  Color encodes total call count for REST and FTP, and total access count for
  config
- `Latency`
  Color encodes latency for the cell dataset

When `Latency` mode is active, the encoded latency metric is `p90`.

Switching between `Count` and `Latency`:

- updates cell coloring only
- keeps the same grid layout
- keeps the same row and column labels
- keeps the user in the same heat-map popup

### 15.5 Config Activity View

The config heat map groups rows by config category and columns by concrete
config item.

It shows, per cell:

- total access count in `Count` mode
- `p90` latency in `Latency` mode

Cell detail may additionally show:

- read count
- write count
- normalized intensity

### 15.6 REST Activity View

The REST heat map groups rows by related endpoint families and columns by
concrete endpoints.

It shows, per cell:

- call count in `Count` mode
- `p90` latency in `Latency` mode

Cell detail may additionally show:

- failure rate
- latency detail on inspection

### 15.7 FTP Activity View

The FTP heat map groups rows by related FTP operation families and columns by
concrete FTP operations or traced path constituents.

It shows, per cell:

- call count in `Count` mode
- `p90` latency in `Latency` mode

Cell detail may additionally show:

- failure rate
- operation result mix
- latency detail on inspection

### 15.8 Cell Detail Overlay

Selecting a heat-map cell opens a detail overlay for that cell.

This overlay is local to the active heat-map popup. It does not create another
app-level modal layer and must not violate the global stack model defined in
Section 5.

The cell-detail overlay must identify:

- the row group
- the concrete item
- the active metric mode and value

The overlay may additionally show:

- call or access count
- failure rate
- `p50`, `p90`, and `p99` latency
- read and write split for config
- recent samples or recent related actions

Closing the cell-detail overlay returns the user to the same heat-map state.

### 15.9 Accessibility

Heat maps must not rely on color alone.

Required secondary carriers:

- numeric values for the active metric
- text labels
- structural headers

### 15.10 Heat-Map Popup Behavior

Heat-map analytic popups follow the same nested-popup rules as latency
analysis:

- diagnostics overlay stays mounted underneath
- only one analytic popup is open at once
- closing returns to the exact prior diagnostics state
- no parent filters or parent scroll state are reset

## 16. Export Enrichment

### 16.1 Entry Points

This extension does not add new export actions.

It enriches:

- `Share all`
- `Share filtered`

### 16.2 Supplemental Recovery And Health Data

When present, exports may include:

- current health snapshot
- reconnect attempts and outcomes
- target-switch attempts and outcomes
- health-check history
- firmware, FPGA, and core details
- latency statistics
- config roundtrip results
- connection timeline
- config-drift findings

`Share filtered` must still respect the redesign filter model for stream
content.

## 17. Constraints

### 17.1 Determinism

- sequential execution only
- no hidden retries
- no probabilistic behavior
- identical inputs must produce identical recorded health-check outputs

### 17.2 Safety

- validate candidate targets before commit
- preserve the previous target on switch failure
- avoid destructive target changes during a busy recovery attempt

### 17.3 Reuse

| Component | Requirement |
| --- | --- |
| heat maps | single shared implementation |
| charts | single shared implementation |
| recovery feedback row | single reusable summary-region pattern |
| diff view | shared presentation model across diagnostics and export |

### 17.4 Observability

Failures during reconnect, target validation, switching, health-check
execution, history persistence, drift calculation, or export preparation must
produce diagnosable evidence. They must not fail silently.

## 18. Design Outcomes

### 18.1 Fast Recovery

The status-badge overlay becomes the fastest place to reconnect or switch
devices without forcing a trip to Settings.

### 18.2 Root-Cause Integrity

The primary diagnostics path remains summary first, problem first, evidence
second. Recovery tools support that flow instead of replacing it.

### 18.3 Safer Device Switching

Target changes become fast but still non-destructive through validation-first
commit behavior.

### 18.4 Better Temporal Understanding

Health history and enriched recovery evidence make intermittent failures easier
to understand over time.

### 18.5 One Surface

Connectivity recovery, health status, and deep diagnostics remain unified in
the same overlay opened from the status badge.
