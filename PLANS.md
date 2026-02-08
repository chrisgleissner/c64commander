# PLANS.md

This file is the authoritative execution contract for the fixes requested in the prompt.
Strict loop: plan -> execute -> verify. A task is checked only after implementation and verification.

## 1. Global Button Interaction Fix (App-wide)
- [ ] Locate the shared button component(s), theme styles, and focus handling paths used across Home/Play/Choose File.
- [ ] Implement `StatelessButton` defaults with immediate focus/selection clearing after click.
- [ ] Implement `StatefulButton` opt-in that binds illumination strictly to explicit state variables.
- [ ] Audit and update Home Machine/Config buttons, Play Previous/Next, and Choose File to stateless.
- [ ] Bind Play (and Pause if applicable) to stateful illumination only while real state is active.
- [ ] Add emulator tests for stateless reset and stateful illumination behavior.

## 2. Homepage SID Group - Type Display (Minimal, Consistent)
- [ ] Identify Home SID header row layout and data sources for SID type, address, and enablement.
- [ ] Insert SID type between name and base address with aligned columns across rows.
- [ ] Ensure SID socket types are read-only and non-interactive.
- [ ] Add UltiSID profile dropdown for Alt SIDs only, exposing only the sound-defining profile.
- [ ] Preserve existing header + sliders structure and avoid advanced UltiSID settings here.
- [ ] Add emulator tests for layout consistency and editable vs read-only behavior.

## 3. RAM Dump (Save RAM) Fix (Real C64U Required)
### 3.1 RAM Dump Robustness and Correctness
- [ ] Reproduce RAM dump behavior against real c64u with small, large, and full ranges.
- [ ] Capture request/response details, chunk sizes, and failure modes (short reads, zero-length).
- [ ] Update RAM dump logic for empirically correct chunk sizes, retries, and fail-fast diagnostics.
- [ ] Add event traces for chunk start, expected length, actual length, and completion/failure.
- [ ] Implement recovery behavior: reset/reboot, re-verify liveness, and retry safely.
- [ ] Clean up any temporary device state or files created during experiments.
- [ ] Add integration tests for chunk size, monotonic progression, and full coverage.

### 3.2 Strengthened C64 Availability and Liveness Check
- [ ] Implement two-level liveness check (jiffy clock and raster) with 50ms wait for clock advance.
- [ ] Define decision logic for healthy vs IRQ-disabled vs wedged states.
- [ ] Replace REST-only availability checks where correctness matters (RAM dump, post-reset).
- [ ] Add event traces for jiffy/raster samples and decision outcomes.
- [ ] Add integration tests for liveness outcomes and failure conditions.

## 4. SID Slider Stability Fix (Homepage)
- [ ] Identify current slider state flow and async REST update handling.
- [ ] Decouple UI slider state from async updates to prevent value snap-back.
- [ ] Ensure full value range remains reachable after release.
- [ ] Add emulator tests for drag-release stability.
- [ ] Add unit tests for state sequencing and async update logic.

## 5. LED Group Rework (Homepage)
- [ ] Identify LED group UI structure and navigation triggers.
- [ ] Remove navigation; keep all LED edits on Home.
- [ ] Match layout/interaction model to Video/Analog/Digital/HDMI Scanlines.
- [ ] Add inline dropdowns for each LED attribute and remove duplicate tint display.
- [ ] Add emulator tests for inline editing and no navigation.

## 6. HVSC Download/Ingestion/Indexing Rework
- [ ] Map current HVSC states and crash point for Ingest action.
- [ ] Introduce explicit domain states/events: DOWNLOAD, EXTRACT, INDEX, READY, FAILED.
- [ ] Refactor UI to strictly reflect state, collapse after completion, and support reset/retry.
- [ ] Fix crash on Ingest and add event trace ordering assertions.
- [ ] Add emulator E2E test for HVSC ingestion and storage snapshot assertions.

## 7. Playback Song Length Handling (Local vs C64U)
- [ ] Identify playback strategy selection points and current endpoint usage.
- [ ] Implement Local source: always POST with .ssl.
- [ ] Implement C64U source: FTP fetch + .ssl + POST when possible, else PUT.
- [ ] Add integration tests for endpoint selection and event trace assertions.

## 8. Add Items Interstitial Regression Fix
- [ ] Locate dialog state initialization and stale state source.
- [ ] Reset dialog state on open and restrict options to exactly two entries.
- [ ] Add emulator test asserting only C64U import and Local import options appear.

## 9. Play Page Volume Slider + Mute Rework (Real C64U Required)
- [ ] Refactor to single authoritative volume/mute state machine.
- [ ] Ensure slider updates volume reliably and UI reflects true mute state.
- [ ] Validate behavior against real c64u via API and audible verification.
- [ ] Add emulator tests and unit tests for volume/mute state machine.
- [ ] Add event trace assertions for volume/mute command flow.

## 10. Testing & CI Requirements (Mandatory)
- [ ] Add emulator-based tests covering all major fixes and regressions.
- [ ] Ensure event traces are primary oracle where applicable.
- [ ] Run unit, emulator, and Playwright tests as required.
- [ ] Run full build and confirm all checks pass locally.
- [ ] Verify CI status after push and address any failures.

