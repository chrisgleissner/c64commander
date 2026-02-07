# PLANS.md - Home/Disks Interactivity, SID Silencing, and Import UX Coverage

## Execution Contract
- Status legend: `[ ] pending`, `[-] in progress`, `[x] completed`.
- Loop per phase: `plan -> implement -> targeted tests -> verify -> update this file`.
- Scope locked to requested areas only: import UX/screenshots, drive reset, SID info+reset, Home interactivity, unit/E2E/screenshot coverage.
- No silent exception handling; all caught errors must be reported or rethrown with context.
- No test weakening/skipping.

## Phase 0 - Baseline and Scope Lock
- [x] Confirm current behavior and impacted modules for:
  - Home `Drives`, `SID`, `Streams`
  - Disks page drive controls
  - Item import UX (Play + Disks)
  - Existing screenshot and Playwright flows
- [x] Define concrete contracts:
  - Global drive reset behavior and failure semantics
  - SID metadata mapping (volume/pan/address + ordering)
  - SID silence write plan (register offsets + per-SID error aggregation)
  - Home interaction rules (toggle/select/input + validation)
- [x] Verification:
  - Impacted files + tests captured before edits.

## Phase 1 - Core Logic: Drive Reset + SID Mapping + SID Silence
- [x] Implement global drive reset service that resets all connected drives in one action and reports partial failures with context.
- [x] Implement SID metadata mapping helpers for ordered rows:
  1. SID Socket 1
  2. SID Socket 2
  3. UltiSID 1
  4. UltiSID 2
  with formatted `Volume`, `Pan`, `Address`.
- [x] Implement SID silence operation service:
  - CTRL writes at offsets `$04`, `$0B`, `$12` -> `0x00`
  - MODE/VOL write at `$18` -> `0x00`
  - AD/SR writes at `$05/$06`, `$0C/$0D`, `$13/$14` -> `0x00`
  - Apply per configured SID base address; continue on per-SID failure; aggregate/report failures.
- [x] Verification:
  - New/updated unit tests for drive reset service, SID mapping, SID silence writes pass.

## Phase 2 - UI Wiring: Home + Disks
- [x] Add `Reset Drives` button on Disks page (global action).
- [x] Add `Reset Drives` button in Home `Drives` section (global action).
- [x] Expand Home `SID` section:
  - Show per-SID `Volume`, `Pan`, `Address` in required order.
  - Add `Reset` button wired to SID silence service.
- [x] Implement Home interactivity in groups `Drives`, `SID`, `Streams`:
  - 2-value settings use toggle interactions.
  - finite >2 settings use dropdown interactions.
  - free-form settings use input interactions.
  - Writes are REST-backed, reflect updates immediately after success, and report failures.
  - Invalid inputs are validated and rejected with explicit user-visible errors.
- [x] Verification:
  - Updated Home/Disks unit tests pass for wiring, REST calls, and error paths.

## Phase 3 - Import UX and Screenshot Coverage
- [x] Ensure import interstitial explicitly presents both choices:
  - Local file import
  - C64U file import
- [x] Ensure local and C64U picker flows are reachable via normal Play flow.
- [x] Add/extend Playwright coverage for:
  - import interstitial
  - local file picker flow
  - C64U file picker flow
- [x] Add reproducible screenshots (at least one each) for:
  - toggle interaction
  - dropdown interaction
  - input field interaction
  - local file picker
  - C64U file picker
  - import interstitial
  - SID reset interaction (post-silence)
- [x] Verification:
  - Screenshot files generated under `doc/img/app/**` and linked to deterministic Playwright flows.

## Phase 4 - E2E + Full Validation
- [x] Add/extend Playwright tests for:
  - Home toggle/dropdown/input interactions
  - Reset Drives (Home + Disks)
  - SID Reset invocation and no regressions to SID metadata controls
  - Import flow coverage requested above
- [x] Run targeted suites for changed areas.
- [x] Run full local checks:
  - `npm run test`
  - `npm run lint`
  - `npm run build`
  - `npm run test:e2e`
  - `./build`
- [x] Verification:
  - All tests pass locally.
  - CI-equivalent local flow passes (`./build`).

## Progress Log
- 2026-02-07: Plan re-initialized for requested Home/Disks/SID/import scope and verification constraints.
- 2026-02-07: Added core services for global drive reset, SID detail mapping, and deterministic SID silence register writes with unit coverage.
- 2026-02-07: Wired Home + Disks UI for Reset Drives, SID Reset, ordered SID volume/pan/address display, and REST-backed Drives/SID/Streams interactions.
- 2026-02-07: Added import interstitial and picker test ids; expanded Playwright coverage for Home interactivity + import flows.
- 2026-02-07: Captured deterministic screenshots for toggle/dropdown/input, SID reset post-state, and import interstitial/local/C64U pickers under `doc/img/app/**`.
- 2026-02-07: Verification complete locally via `npm run screenshots`, `npm run test`, `npm run lint`, `npm run build`, `npm run test:e2e`, and `./build` (all passing).
