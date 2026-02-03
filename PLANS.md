# PLANS.md - Authoritative Execution Plan

## Mission
Fix critical, user-visible correctness and state-management bugs in the C64 Commander Android app (Capacitor). Work is tracked here and updated after every meaningful action.

## Phase 0: Baseline + Instrumentation Check

### Actions
- [x] Inspect relevant HVSC download/extraction, REST client, volume, disk mount, trace/log timestamp, and UI label code paths.
- [x] Identify current logging/tracing hooks available for state transitions.

### Verification
- [ ] Confirm current behaviors in code match reported failures before changes.

## Phase 1: HVSC Download Progress + Crash (Task A)

### Actions
- [x] Bind download slider to `bytesReceived / totalBytes` continuously.
- [x] Ensure download completion transitions to deterministic “downloaded” state without crash/background.
- [x] Persist and restore download state after process death.
- [x] Stop elapsed time at completion and prevent post-completion increments.

### Verification
- [ ] Download progress moves smoothly and finishes at 100%.
- [ ] App remains foreground on completion.
- [ ] Restart restores correct “downloaded” state and elapsed time is frozen.

## Phase 2: HVSC Extraction + Indexing Progress + Cancel (Task B)

### Actions
- [x] Replace indeterminate progress with real file counts and elapsed time.
- [x] Implement explicit START/FINISH/CANCEL transitions.
- [x] Cancel stops workers/animations and re-enables “Ingest HVSC” when download present.
- [x] Restore clean idle state after restart when canceled.

### Verification
- [ ] Progress shows files processed/total and elapsed time.
- [ ] Cancel stops activity and re-enables ingest immediately.
- [ ] Restart after cancel shows idle state.

## Phase 3: REST Host Stability (Task C)

### Actions
- [x] Identify why REST base URL regresses to localhost after ingestion/file picker.
- [x] Enforce invariant: REST host always equals configured C64U host.
- [x] Add defensive assertions + trace logging when host changes.

### Verification
- [ ] Playback works after local file ingestion.
- [ ] Logs/traces never show localhost host regression.

## Phase 4: Diagnostics Labeling (Task D)

### Actions
- [x] Rename button label “Logs” → “Logs and Traces”.

### Verification
- [ ] UI shows updated label.

## Phase 5: Songlengths.md5 Discovery (Task E)

### Actions
- [x] Walk upward directory hierarchy to find nearest `Songlengths.md5`.
- [x] Log discovery and apply lengths to playlist immediately.

### Verification
- [ ] Nearest file is discovered and logged.
- [ ] Playlist displays correct lengths without restart.

## Phase 6: Volume Control Correctness (Task F)

### Actions
- [x] Define single authoritative volume state (level + muted + previous volume).
- [x] Ensure slider updates volume deterministically.
- [x] Ensure mute preserves previous volume and unmute restores it.
- [x] Prevent double inversion/race conditions.

### Verification
- [ ] Repeat play → pause → resume → mute → unmute → adjust volume works reliably.

## Phase 7: Disk Mount POST Payload (Task G)

### Actions
- [x] Ensure mount POST body matches API contract (drive, path, type, mode).
- [x] Validate inputs and log request payload before send.

### Verification
- [ ] Mount succeeds; no timeout; no “Host unreachable”.

## Phase 8: Trace Timestamp Format (Task H)

### Actions
- [x] Update logs/traces/events to show local wall-clock time `HH:mm:ss.SSS`.

### Verification
- [ ] All logs/traces/events show local time format (no relative millis).

## Phase 9: Tests + Build Verification

### Actions
- [x] Extend/adjust tests to cover fixed behaviors.
- [x] Run `npm run test`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.

### Verification
- [ ] All tests pass.
- [ ] Build passes.
