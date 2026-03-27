# Agentic Action Model

## Purpose

This file defines how an autonomous agent discovers surfaces, chooses actions, and exits safely without relying on a hard-coded playback-only path.

## Global Discovery Rules

1. Start on `/` and confirm the public tab set from `src/components/TabBar.tsx`.
2. Treat `/docs` and `/settings/open-source-licenses` as explicit read-only coverage targets.
3. Ignore `/__coverage__` unless the current case is a lab-only probe or heartbeat check.
4. Before mutating anything, read the safety class for the action family in `agentic-safety-policy.md`.

## Conditional Surface Rules

- If the demo interstitial is visible, handle it before page assertions. The app can be usable while still in demo mode.
- If connection state is `DISCOVERING`, wait for either `REAL_CONNECTED`, `DEMO_ACTIVE`, or `OFFLINE_NO_DEMO` before judging page completeness.
- If feature flags change surface area, record the active flag state as evidence before treating missing controls as failures.
- If Android-only affordances are absent on web or non-native builds, do not infer Android runtime behavior from that absence.

## Generic Action Contract

For every mutating step, record:

- route and feature area
- preconditions checked
- action performed through the app
- primary oracle to prove success
- fallback oracle if the primary signal is weak
- cleanup action, if any

Stop and classify the run as blocked or inconclusive when:

- the required safety budget is exhausted
- the route cannot be entered after one recovery attempt
- the action outcome is not provable with an allowed oracle pair

## Dialog And Disclosure Rules

- Expand accordions or dialogs only when their header or trigger is visible.
- Close transient dialogs before route changes unless the case explicitly validates persistence across navigation.
- Prefer single-surface exploration: do not stack Home, Settings, and global diagnostics dialogs at once.
- When a dialog performs destructive work, capture both the confirmation surface and the post-action state.

## Route Catalog

### Home `/`

Preconditions:

- Connection state is known.
- For machine or RAM actions, target device mode and safety budget are recorded.

Action families:

- Machine controls.
- RAM save/load/clear.
- Quick config changes.
- LED, SID, drive, printer, and stream controls.
- App config snapshot save/load/manage.

Postconditions:

- Use UI state plus REST/state-ref or diagnostics confirmation.
- For destructive actions, require a second oracle after the toast or button state.

Recovery:

- Refresh route data once.
- Re-run manual discovery once if the device dropped unexpectedly.

Escape:

- Abort the Home mutation sequence if power, reset, RAM clear, or flash-config effects are no longer attributable to the current case.

### Play `/play`

Preconditions:

- Source availability is known: Local, C64U, HVSC, or any combination required by the case.
- Background execution expectations are set for Android cases.

Action families:

- Open add-items flows and browse sources.
- Build or edit a playlist.
- Start, stop, pause, resume, next, previous.
- Toggle shuffle and repeat.
- Edit duration, subsong, and songlength metadata.
- Adjust volume or mute.
- Run HVSC download, install, browse, and play flows.

Postconditions:

- Playlist changes need UI confirmation plus durable state or transport evidence.
- Playback changes need UI transport state and, for physical cases, A/V or other approved playback oracles.
- HVSC changes need progress evidence plus filesystem or status evidence.

Recovery:

- Cancel a long-running add-items or HVSC flow once before retrying.
- Re-enter the route if a source dialog becomes stale.

Escape:

- Stop if add-items recursion, HVSC ingestion, or background auto-advance becomes non-deterministic after one bounded retry.

### Disks `/disks`

Preconditions:

- Test-owned disk fixtures or namespaces are known.
- Mounted-state baseline is captured before destructive operations.

Action families:

- Import from Local or C64U.
- Mount and eject.
- Toggle drive power or reset drives.
- Change drive bus ID or drive type.
- Set Soft IEC default path.
- Rename, regroup, delete, or bulk delete library entries.

Postconditions:

- Mount/eject needs drive-state confirmation, not only toast text.
- Delete and bulk delete need library diff confirmation and mounted-state confirmation when relevant.

Recovery:

- Refresh drive data once.
- Re-open the mount dialog once if it loses selection state.

Escape:

- Abort if the target disk set is not isolated from user data.

### Config `/config`

Preconditions:

- Category names are discovered from the live page, not assumed from prior runs.
- The agent knows whether the case is read-only browsing or mutation.

Action families:

- Search categories.
- Expand categories and inspect items.
- Edit text, select, switch, and slider values.
- Use Audio Mixer solo and reset flows.
- Trigger clock synchronization.

Postconditions:

- Require the edited value to round-trip through the live config state.
- For Audio Mixer, confirm adjacent items did not change unexpectedly.

Recovery:

- Re-open the category once if the data refetches during editing.

Escape:

- Stop when the expected hardware-visible effect of a category is not specified well enough to tell success from risk.

### Settings `/settings`

Preconditions:

- Decide whether the case is read-only, guarded mutation, or destructive.
- For settings transfer or diagnostics export, define the target folder or artifact namespace first.

Action families:

- Connection host/password and manual reconnect.
- Automatic demo mode and discovery timing settings.
- Appearance, list preview, disk autostart, debug logging, HVSC enablement.
- Diagnostics dialog, clear, and export.
- Settings export and import.
- Device Safety preset and advanced knobs.
- Developer mode unlock and support links.

Postconditions:

- Persistence changes must survive route changes or relaunch when the case requires persistence.
- Diagnostics changes must be reflected in logs, traces, or exported artifacts.

Recovery:

- Re-open the diagnostics dialog once.
- Re-run manual discovery once after connection changes.

Escape:

- Stop if a settings mutation would affect later cases and no cleanup path is defined.

### Docs `/docs`

Preconditions:

- None beyond route entry.

Action families:

- Open and close each accordion section.
- Validate that key help topics render.

Postconditions:

- UI-only oracle is sufficient.

Recovery:

- Re-open a section once if it collapses due to route-level rerender.

### Licenses `/settings/open-source-licenses`

Preconditions:

- Enter through Settings navigation or direct route navigation, depending on case goals.

Action families:

- Open the page.
- Validate the bundled notice rendering path.
- Navigate back to Settings.

Postconditions:

- UI-only oracle is sufficient, plus error-log absence if the page failed to load.

## Exploration Order

Default feature exploration order:

1. Connection and route shell.
2. Home read-only visibility.
3. Play read-only and playlist construction.
4. Disks read-only and mount-safe actions.
5. Config read-only discovery before any mutation.
6. Settings persistence and diagnostics.
7. Docs and Licenses.

Only then move into destructive or long-running flows such as:

- HVSC install and ingest
- RAM load or clear
- flash config load or reset
- disk delete or bulk delete
- device-safety changes
