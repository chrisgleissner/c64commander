# C64 Commander Fixes

## What This Is

C64 Commander is a React + Vite + Capacitor app for controlling a C64 Ultimate device. This initiative focuses on stabilizing core functionality by fixing critical bugs in disk playback, volume control, and diagnostics to ensure a reliable user experience.

## Core Value

Reliable control of the C64 Ultimate device, ensuring disks play, volume works, and issues can be diagnosed.

## Requirements

### Validated

- ✓ Control C64 Ultimate device (Core) — existing
- ✓ HVSC management and playback — existing
- ✓ File system navigation — existing
- ✓ Configuration management — existing
- ✓ Error logging infrastructure — existing
- ✓ Tracing infrastructure — existing

### Active

- [ ] **Play Page Fixes**: Disks execute correctly; resolve "Host unreachable" on Android.
- [ ] **Disk Page Fixes**: Resolve "Local Disk is missing a readable URI" error when mounting.
- [ ] **Audio Control Fixes**: Volume slider/mute only affects active SIDs (socket/UltiSID) as temporary override.
- [ ] **Diagnostics UI**: Add "Traces" section to Settings (parity with Logs) to view/share collected traces.

### Out of Scope

- New feature development unrelated to these fixes
- Major architectural refactoring

## Context

- **Technical Stack**: React, Vite, Capacitor, Ionic/Tailwind.
- **Current State**: Core features exist but are buggy or incomplete (traces UI).
- **Environment**: Web and Android (Capacitor).
- **Verification**: Changes must be verified locally and on CI.

## Constraints

- **Platform**: Must work on both Web and Android.
- **Verification**: Tests must pass; local and CI verification required.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| | | — Pending |

---
*Last updated: 2026-02-02 after initialization*
