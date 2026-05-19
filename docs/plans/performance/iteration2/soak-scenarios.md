# Soak Scenarios

## Conventions

- Every scenario has a stable `id` (e.g. `H1`, `P3`).
- Every scenario has a target device family: `U64`, `C64U`, or `both`. `both` means the scenario must run once with `u64` selected and once with `c64u` selected. The agent records the active device in every step.
- Every scenario has an `oracle` that names the **strongest cheap** evidence per the rules in `docs/testing/agentic-tests/agentic-oracle-catalog.md`. UI alone is not an oracle for hardware-mutating steps.
- Every scenario has an `abort` condition. If hit, the scenario stops and reports inconclusive; it does not retry blindly.
- "Fast cadence" means the human user we are simulating is impatient. Typical inter-action delays are 250-500 ms, not the artificial 1000 ms+ delays test code sometimes uses. Sliders are dragged through their full range without sub-step delays. Tabs are tapped within 100-200 ms of each other. The intent is to surface races, not to mimic measured product usage.

## Pre-soak preflight

The agent must complete the preflight before any scenario runs. Failure means the soak does not start.

1. `adb devices` lists exactly one device whose serial starts with `9B0` (Pixel 4). Record the serial.
2. From the Pixel 4 shell, `curl -m 2 http://u64/v1/info` returns 200 in < 1000 ms.
3. From the Pixel 4 shell, `curl -m 2 http://c64u/v1/info` returns 200 in < 1000 ms. If this fails, `c64u` is already degraded - run only `U64` scenarios this round and emit an explicit "c64u-skipped-degraded-preflight" annotation in the worklog.
4. App version on the Pixel 4 includes Auto safety mode (verify by entering Settings -> Device Safety; `Auto` appears as the first option).
5. App has both `u64` and `c64u` as saved devices, each with a verified product (`U64`/`U64E`/`U64E2` and `C64U` respectively). If a saved device is missing, add it before the soak begins and verify it once.
6. Active stored safety mode is `AUTO` at the start of the soak.

## Navigation scenarios

### `N1` - Fast tab cycling (both)

- Tap each tab in turn: `Home -> Play -> Disks -> Config -> Settings -> Home`. Inter-tap delay 150 ms.
- Repeat 20 cycles.
- Insert a `SWIPE_NAV` between every other cycle (alternating direction).
- Oracle: tab indicator state + tap-to-paint timing from screen recording.
- Abort: any tab takes > 1500 ms to first paint, or any tap leaves the indicator visually behind.

### `N2` - Diagnostics indicator long-press quick-switch (both)

- Long-press the app bar activity indicator.
- Pick the *other* saved device from the picker.
- Verify the active device switched within 500 ms (healthy `u64` leg) or 1500 ms (cold `c64u` leg).
- After switching, confirm via Diagnostics dialog that the effective safety preset is now the one Auto mode dictates (`CONSERVATIVE` after switching to `c64u`, `BALANCED` after switching to `u64`).
- Repeat 5 alternating switches.
- Oracle: saved-device store delta + diagnostics dialog effective-preset line.
- Abort: any switch fails or returns to a previous device unintentionally.

### `N3` - Diagnostics open soak (both)

- Open and close the diagnostics dialog 10 times in rapid succession.
- Measure open-to-first-visible. Must satisfy Iteration 1 Stage 3 budget (p50 < 250 ms, p95 < 400 ms).
- Oracle: diagnostics open timing marker + screen recording.

### `N4` - Background / foreground (both)

- Mid-soak (after at least 30 s of activity), press Android Home.
- Wait 10 s.
- Re-open the app.
- Connection state must remain on the same active device, no error toast on resume.
- Repeat 3 times.
- Oracle: connection state log + foreground app state + screen recording.

## Home scenarios

### `H1` - Quick action carousel (both, U64-priority)

- On Home, tap in fast sequence: `Reset`, then wait for completion (REST round-trip), then `Pause`, then `Resume`, then `Menu` (if Telnet is enabled). 300 ms between taps where a prior action is still in flight; otherwise immediate.
- After each action, capture machine state through `Diagnostics -> current device` or via direct REST probe.
- Repeat the sequence 3 times.
- Oracle: REST/state-ref + diagnostics log line for each machine action.
- Abort: any action surfaces an error toast or returns 5xx from REST; abort and record.
- Special: `MACHINE_MENU` consumes 1 destructive budget per safety policy. Only run if budget permits.

### `H2` - Drive / printer / SID toggles (both)

- For each drive card, toggle enable -> disable -> enable. Inter-toggle delay 200 ms.
- For the printer card, toggle enable -> disable -> enable.
- For each SID slider, drag through the full range and back twice. Drag without delays.
- Oracle: REST-visible config delta after each settled state.
- Abort: any toggle visually disagrees with the REST round-trip after 2 s.

### `H3` - RAM lifecycle (U64 only)

- Pick a SAF folder via the RAM dump folder card. Use a test-owned subdirectory.
- Save RAM. Wait for completion.
- Load the just-saved RAM. Wait for completion.
- Oracle: SAF file present after save + machine recovers after load.
- Safety: only U64. C64U is not asked to RAM-cycle in this soak; the c64u soak is read-mostly because of firmware risk.
- Cleanup: delete the saved RAM file from the test-owned subdirectory.

### `H4` - Stream lifecycle (U64 only)

- Edit the audio stream endpoint to a known-good test endpoint.
- Start the stream.
- Stop the stream within 5 s.
- Oracle: REST-visible stream state delta.
- Safety: only U64.

## Play scenarios

### `P1` - Import-from-source soak (both)

- For each source available (`Local`, `C64U`, `HVSC` if installed), open the source dialog, navigate two folder levels deep, toggle 3 items, confirm.
- Inter-action delay 200 ms.
- Oracle: playlist row count delta + source attribution per row.
- Abort: source dialog stops responding within 2 s.

### `P2` - Playlist manipulation (both)

- Filter to a non-empty subset.
- Select all -> deselect all -> select all.
- Remove selected.
- Toggle view-all once.
- Inter-action delay 200 ms.
- Oracle: playlist row count + persistence (after navigation away and back, playlist matches).

### `P3` - Transport soak (both, c64u read-only)

- Start a known-good item. For `c64u`, this must be a SID that is documented to play without writing to expensive endpoints (no disk mount).
- Pause then resume immediately.
- Drag volume slider through full range.
- Mute, unmute.
- Skip next, then prev.
- Lock screen for 30 s, then unlock. Verify background-execution log was armed.
- Stop.
- Inter-action delay 250 ms unless an action has not yet completed.
- Oracle: runner state + audio-mixer REST state + background-execution log + (optional) c64scope A/V if signal evidence is requested.
- Abort: any transport action leaves the runner in an inconsistent state for > 3 s.

### `P4` - Songlength file binding (U64 only)

- Pick a `Songlengths.md5` file from a known fixture path on device.
- Verify durations apply to matching playlist items.
- Oracle: per-item duration delta + persisted songlengths reference.

### `P5` - HVSC lifecycle (U64 only, optional)

- If HVSC is not yet installed: download, then ingest. Cancel halfway through ingest at least once and resume to completion.
- If HVSC is already installed: skip download, perform a browse and add 3 items to playlist.
- Oracle: filesystem evidence of HVSC artifacts + ingestion status events + final ready state.
- Safety: long-running. Counts as 1 destructive budget per safety policy. Skip if hardware/time budget is tight.

## Disks scenarios

### `D1` - Mount / eject soak (both)

- Import 2 disks from `Local`.
- Mount one to Drive A. Wait for state.
- Eject Drive A. Wait for state.
- Mount the second one to Drive B. Wait.
- Scroll the disk library full view for at least 200 rows of motion (or to end of list).
- Oracle: REST `/v1/drives` snapshot delta + library row count.
- Abort: any mount/eject diverges from REST state for > 2 s.

### `D2` - Library housekeeping (both)

- Filter to a non-empty subset.
- Rename one entry via item menu.
- Group two entries.
- Rotate next/prev within the group.
- Remove an entry that is *not* mounted.
- Oracle: persisted library delta + REST drive state unchanged for non-mount steps.

## Config scenarios

### `C1` - Category browse (both)

- Type into Config category search; verify client-side filter result.
- Open / close at least 5 different category accordions.
- For one accordion, change one value and refresh.
- Oracle: REST-visible config value round-trip.

### `C2` - Audio Mixer + clock (both, c64u read-only Solo only)

- Reset Audio Mixer category to defaults.
- Solo each SID channel once. Unsolo each.
- Sync clock.
- Oracle: per-channel mute state via REST + clock items REST round-trip.

## Settings scenarios

### `S1` - Saved-device editor (both)

- Add a throwaway saved device (test-owned name). Set hostname to a known-bad value, save (must show clear error, not silent failure).
- Correct the hostname, save again, verify connect.
- Delete the throwaway device.
- Oracle: saved-devices store transitions + UI error visibility for bad hostname.

### `S2` - Preferences sliders and inputs (both)

- Change the list preview limit slider in 3 steps.
- Change the discovery probe timeout via numeric input + Enter.
- Oracle: persisted values + downstream behavior (preview list reflects new limit).

### `S3` - Safety mode dialog gauntlet (both)

- Open the Safety Mode select.
- Pick `RELAXED` -> confirm dialog appears -> cancel -> mode unchanged.
- Pick `RELAXED` -> confirm -> mode is now `RELAXED`.
- Pick `AUTO` -> mode is now `AUTO`, effective preset line shows the correct preset for the currently active device.
- Pick `CONSERVATIVE`, `BALANCED`, `TROUBLESHOOTING` in turn; each persists, no dialog.
- Return to `AUTO` and leave it there.
- Oracle: persisted mode after each step + effective-preset diagnostics line.

### `S4` - Device row switch (both)

- From Settings, tap the *other* saved device row.
- Verify switch completes within 500 ms (healthy `u64`) or 1500 ms (`c64u`).
- Verify effective safety preset switched per Auto rules.
- Repeat 5 alternating switches.
- Oracle: as `N2` + active row visual state.

### `S5` - Theme + developer mode (both)

- Cycle theme Light -> Dark -> System.
- Tap About card 7 times in 3 seconds.
- Oracle: DOM theme attribute + developer-mode flag.
- Cleanup: leave the system at its starting theme; disable developer mode if it was off at start.

### `S6` - Settings export / import (U64 only)

- Export settings to file.
- Modify one non-destructive setting (e.g. list preview limit).
- Import the exported file.
- Verify the modified setting reverted.
- Oracle: setting value pre/post + exported JSON parseable.

### `S7` - Diagnostics share + clear (both)

- Open diagnostics, share Logs tab, then clear it.
- Verify the share artifact handle (cache path) was captured, even if the OS share sheet's final destination cannot be observed.
- Oracle: cache-written ZIP path + post-clear empty logs.

### `S8` - Licenses overlay + back (both)

- Open Settings -> Open Source Licenses.
- Press Android system back.
- Verify return to Settings.
- Oracle: route history + first paint of Settings.

## Docs scenarios

### `X1` - Docs accordion smoke (both)

- Open and close each accordion section.
- Tap each external link once. Use a stub intent handler so the soak does not actually launch a browser away from the app. If a stub is not available, skip this sub-step and annotate.
- Oracle: accordion state + intent fired (if testable).

## Stop conditions for the whole soak

The agent must stop the soak and report inconclusive (not pass) if any of the following happens:

- `c64u` becomes unreachable mid-soak via direct REST probe.
- Any non-trivial scenario times out twice in a row.
- The agent observes any error toast, any error log row from the app package, any crash, or any ANR.
- Hardware lock is forcibly broken by a competing agent (should not be possible, but record if it happens).
