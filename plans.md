# Android regressions fix plan

- [x] Identify code paths for local SID playback (SAF, playlist, host upload) and collect current error flows.
- [x] Add tests for local file URI resolution and error mapping (no host unreachable on local failure).
- [x] Fix local SID playback pipeline with persisted SAF permissions and reliable byte access.
- [x] Reorder Settings page sections and move network timing settings under Device Safety.
- [x] Add tests verifying Settings ordering and grouping.
- [x] Identify disk mount + keyboard injection path and implement bounded auto-run sequence.
- [x] Add tests for disk auto-run command generation and injection.
- [x] Update Songlengths picker to allow Songlengths.md5 and persist SAF permissions.
- [x] Implement Songlengths parsing + apply lengths to SIDs with UI feedback (name, size in KiB, entries count, errors).
- [x] Add unit tests for Songlengths parsing/lookup and UI state formatting.
- [x] Identify HVSC download/extraction state machine and streaming progress reporting.
- [x] Fix HVSC progress updates, state transitions, and crash on completion; add logging.
- [x] Add tests for HVSC progress reporting and state transitions.
- [ ] Update any related docs/troubleshooting text (only if needed).
- [ ] Run targeted tests, then full lint/test/build per repo guidance; capture evidence.
