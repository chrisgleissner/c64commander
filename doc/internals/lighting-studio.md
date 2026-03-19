# Lighting Studio Spec

## 1. Scope

This document defines the required `Lighting Studio` feature set for C64 Commander.

- Source of truth for product rationale: `doc/research/light-feature-extended-research.md`
- This document is narrower and implementation-facing
- `Lighting Studio` is a secondary light editor and automation surface
- It must ship with these required features:
  - `Surface Split Composer`
  - `Profile Library`
  - `Connection Sentinel`
  - `Quiet Launch`
  - `Source Identity Map`
  - `Circadian Palette`
- `Context Lens` is required as a supporting explainability pattern, not as a standalone flagship feature

## 2. Entry Points And Surface Model

- Primary entry point: Home lighting section header
- Secondary contextual entry points:
  - active lighting chip on Home
  - active source-context chip on Play and Disks when `Source Identity Map` is enabled
- No new bottom-navigation tab is allowed
- Presentation by display profile:
  - Compact: full-screen secondary editor
  - Medium: large centered dialog
  - Expanded: wide dialog or side panel without changing workflow order
- Raw hardware-only lighting fields such as `LedStrip Type`, `LedStrip Length`, and legacy raw RGB channels remain in Config and are not surfaced as first-class `Lighting Studio` controls

## 3. Studio Information Architecture

`Lighting Studio` must stay shallow.

- Header:
  - paired live preview
  - active profile chip
  - active automation chip
  - `Why this look?` action opening `Context Lens`
- Sections:
  - `Profiles`
  - `Compose`
  - `Automation`
- `Automation` contains:
  - `Connection Sentinel`
  - `Quiet Launch`
  - `Source Identity Map`
  - `Circadian Palette`
- Home must gain only lightweight summary elements and a `Studio` action; it must not gain new permanent rows of advanced controls

## 4. Required Feature Specs

### 4.1 Surface Split Composer

- Purpose: treat case and keyboard lighting as coordinated but independent surfaces
- Entry: `Lighting Studio` -> `Compose`
- Required controls:
  - link mode: `Linked`, `Mirrored`, `Independent`
  - pair presets: `Mirror`, `Contrast`, `Keyboard Focus`, `Case Halo`
  - per-surface edit controls for supported fields
- Required behavior:
  - if keyboard lighting is unsupported, the composer collapses to case-only editing
  - unsupported fields are hidden, not shown as dead controls
  - composed state can be saved into `Profile Library`

### 4.2 Profile Library

- Purpose: provide reusable manual base states
- Entry: Home active profile chip or `Lighting Studio` -> `Profiles`
- Required operations:
  - apply
  - save current as new
  - duplicate
  - rename
  - delete
  - pin favorite
- Required behavior:
  - profiles may target one or both surfaces
  - partial-compatibility profiles must apply the supported subset and show a visible compatibility badge
  - hardware-topology fields are never stored in profiles

### 4.3 Connection Sentinel

- Purpose: express connection and diagnostics state through lighting
- Entry: `Lighting Studio` -> `Automation` -> `Device Status`
- Required states:
  - `Connected`
  - `Connecting`
  - `Retrying`
  - `Disconnected`
  - `Demo`
  - `Error`
- Required behavior:
  - `Disconnected` and `Error` may raise critical temporary overrides
  - `Connected`, `Connecting`, `Retrying`, and `Demo` are ambient states
  - if fresh status is unavailable, fall back to the active base profile after a short hold

### 4.4 Quiet Launch

- Purpose: enforce a conservative startup lighting state before normal automation resumes
- Entry: `Lighting Studio` -> `Automation` -> `Startup`
- Required configuration:
  - enable or disable
  - launch profile or launch modifier
  - handoff target: `normal resolver`
- Required behavior:
  - activates on app startup or device reconnect
  - exits automatically after the startup window or after an explicit user lighting change
  - if the app attaches after the startup window has already passed, it must not late-fire

### 4.5 Source Identity Map

- Purpose: map active content source to lighting identity
- Entry: `Lighting Studio` -> `Automation` -> `By Source`
- Required source buckets:
  - `Local`
  - `C64U`
  - `HVSC`
  - `Disks`
  - `Idle`
- Required behavior:
  - Play and Disks show a contextual chip when this automation owns the state
  - mixed playlists use the currently playing item as the active source owner
  - if no source is active, fall back to `Idle` and then to the base profile if `Idle` is unset

### 4.6 Circadian Palette

- Purpose: apply solar-aware palette shaping without introducing a full rule engine
- Entry: `Lighting Studio` -> `Automation` -> `Circadian`
- Status: required for first implementation wave
- Inputs:
  - current time
  - resolved location
- Non-inputs:
  - no weather dependency
- Period model:
  - exactly four cyclic periods: `Morning`, `Day`, `Evening`, `Night`
  - boundaries are recomputed daily from solar events for the resolved location
  - end time is implicitly the next period's start time, wrapping at midnight
- Location source priority:
  1. granted device location permission
  2. user-entered latitude and longitude
  3. selected city from an app-bundled list of large cities around the world
- Required location UX:
  - `Use device location`
  - `Enter latitude/longitude`
  - `Choose city`
  - visible display of the currently active location source
- Required solar boundary rules:
  - `Morning` starts at local sunrise
  - `Day` starts `2 hours` after sunrise
  - `Evening` starts `2 hours` before sunset
  - `Night` starts `45 minutes` after sunset
- Solar fallback rule:
  - if sunrise or sunset cannot be resolved for the date and location, use fixed fallback boundaries `06:00`, `09:00`, `18:00`, `22:00`
  - when fallback is active, the UI must show `Fallback schedule`
- Modifier payload:
  - per-surface intensity multiplier
  - tint override when tint is supported
- Default period modifiers:
  - `Morning`: intensity `1.00`, tint `Bright`
  - `Day`: intensity `1.00`, tint `Pure`
  - `Evening`: intensity `0.75`, tint `Pastel`
  - `Night`: intensity `0.35`, tint `Whisper`
- Scope limits:
  - `Circadian Palette` may change intensity and tint only
  - it may not change mode, pattern, SID select, strip type, strip length, or legacy RGB topology fields
- Runtime behavior:
  - current period is resolved immediately on open, startup, reconnect, resume, timezone change, and location-source change
  - solar boundaries are recomputed at midnight and whenever the resolved location changes
  - at a period boundary, only the newly active period is applied; missed boundaries are not replayed
  - if tint is unsupported, only intensity scaling is applied
- Location permission behavior:
  - location permission is optional
  - if permission is denied or unavailable, the feature remains usable through manual latitude/longitude or city selection
  - the city list must be app-internal and searchable
- State representation:
  - Home automation chip shows `Circadian: <Period>`
  - `Lighting Studio` shows current period, current location source, and next boundary time

### 4.7 Solar Calculation Module

- Purpose: provide the deterministic offline solar calculations required by `Circadian Palette`
- Implementation form:
  - one small standalone TypeScript module
  - directly importable by the lighting domain without UI coupling
  - no persistence, no global state, no side effects
- Required library:
  - `suncalc`
- Runtime constraints:
  - no network calls under any circumstances
  - must work fully offline on web, Android, and iOS
  - accuracy within a few minutes is sufficient
  - deterministic behavior only from explicit inputs
  - no timezone library beyond native `Date`
  - no large geolocation dataset
- Required separation of concerns:
  1. location resolution
  2. sun-time calculation
  3. circadian phase resolution
- Required input types:
  - coordinates input: `{ lat: number, lon: number }`
  - city input: `{ city: string }`
- Required location resolution behavior:
  - direct passthrough for `{ lat, lon }`
  - city lookup from a bundled curated city map
  - case-insensitive city matching
  - fail fast with a clear error for unknown city input
  - city dataset must stay small, approximately `10-30` major cities maximum
- Required calculated outputs:
  - `sunrise`
  - `sunset`
  - `dawn`
  - `dusk`
  - `solarNoon`
- Required normalized result shape:
  - resolved coordinates
  - requested date
  - computed sun times
  - explicit indication when fallback logic is in use
- Required circadian helper:
  - accepts current time plus computed sun times
  - returns one phase from `night`, `dawn`, `day`, `sunset`
  - may additionally return normalized progress `0.0-1.0` through the active phase
- Polar and missing-event behavior:
  - the module must detect missing or invalid solar events from `suncalc`
  - it must not return partial undefined semantics to callers
  - it must return a deterministic fallback result that allows `Circadian Palette` to use the fixed fallback schedule already defined in this spec
- Recommended ownership:
  - the solar module is a pure domain utility consumed by the lighting resolver
  - location permission handling and city-selection UI stay outside the module
  - the module only receives resolved user intent and time inputs
- Non-goals:
  - no UI
  - no persistence
  - no external configuration
  - no external APIs
  - no large city or geolocation database

## 5. Unified State Model

- Base layer: active `Profile Library` profile
- Supporting layer: optional paired-surface composition edits before save or apply
- Automation layer:
  - `Quiet Launch`
  - `Source Identity Map`
  - `Circadian Palette`
  - `Connection Sentinel`
- Explainability layer: `Context Lens`
- Trust layer: manual lock may pause non-critical automations

Hardware-only strip topology remains outside this model.

## 6. Priority Resolution

Priority order, highest first:

1. editor preview
2. critical `Connection Sentinel` override
3. manual lock
4. `Quiet Launch`
5. `Source Identity Map`
6. `Circadian Palette`
7. ambient `Connection Sentinel`
8. active base profile
9. raw device-read fallback

Rules:

- resolution happens per surface
- one owner wins per surface at each priority band
- unresolved or unsupported fields are stripped during capability normalization
- no device write is emitted when the resolved output has not changed

## 7. Acceptance Constraints

- `Lighting Studio` must not create a new primary navigation destination
- Home must remain a quick-control dashboard
- all required features must resolve through the same priority model
- `Circadian Palette` must ship in the first implementation wave
- `Circadian Palette` must support permission-based location, manual latitude/longitude, and bundled city-list fallback
- `Circadian Palette` must rely on one small standalone `suncalc`-based solar module rather than ad hoc date logic scattered through UI code
- the app must not attempt frame-by-frame app-driven lighting animation
