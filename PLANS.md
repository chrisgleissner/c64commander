# PLANS.md - Disks/Home REST Configuration, Streams, and RAM Control

## Execution Contract
- Status legend: `[ ] pending`, `[-] in progress`, `[x] completed`.
- Loop per phase: `plan -> implement -> targeted tests -> verify -> update this file`.
- REST is the source of truth for all new read/write behavior in this scope.
- No test weakening, no skipped failures, no bypasses.

## Phase 0 - Baseline and Scope Lock
- [x] Confirm current Disks/Home implementations, REST endpoints, and existing tests.
- [x] Define concrete data contracts for:
  - Drive Bus ID + Drive Type (REST-backed read/write)
  - Streams (REST-backed read-only ON/OFF + IP + port)
  - RAM actions (freeze/dump/load/reboot-clear)
  - RAM dump folder persistence and picker flow
- [x] Verification:
  - Captured impacted files and test suites before edits.

## Phase 1 - REST/API and Persistence Foundations
- [x] Add/extend REST client methods needed for stream and RAM workflows.
- [x] Implement RAM operations service with explicit retry handling, chunked reads/writes, and fail-fast error context.
- [x] Implement RAM dump folder persistence store and native/web picker adapters.
- [x] Extend Android FolderPicker plugin + TS bindings as needed to support writing RAM dumps to selected SAF folder.
- [x] Verification:
  - Targeted unit tests passed:
    - `tests/unit/ramOperations.test.ts`
    - `tests/unit/ramDumpFolderStore.test.ts`
    - `tests/unit/ramDumpStorage.test.ts`
  - Android Kotlin compile check passed with Gradle fallback from daemon to non-daemon mode.

## Phase 2 - Disks Page Drive Bus/Type UX (REST-Driven)
- [x] Add compact Drive Type indicator immediately right of Bus ID in each drive row.
- [x] Make Bus ID and Drive Type configurable inline via dropdowns (no modal/navigation).
- [x] Wire dropdown writes through REST; update UI only after success; on failure keep prior value and surface error.
- [x] Disable affected controls while requests are in-flight and preserve stable layout.
- [x] Ensure no regression to mount/eject/power/group workflows.
- [x] Verification:
  - Targeted `HomeDiskManager` suites all passed (base, UI, dialogs, extended).

## Phase 3 - Home Page Streams + Machine Controls Rework
- [x] Add `Streams` section below SID using REST-backed config values for VIC/Audio/Debug ON/OFF + IP + port.
- [x] Rework Machine Control layout to compact 4-column grid with 3-row footprint and 9 buttons.
- [x] Keep existing machine semantics and add:
  - Reboot (Clr Mem)
  - Save RAM
  - Load RAM
- [x] Enforce in-flight disabling and atomic UI behavior for RAM/reboot-clear flows.
- [x] Add RAM dump folder UI near Machine controls, including first-save folder prompt and change-folder action.
- [x] Visually separate Power Off and guard accidental activation.
- [x] Resize Config group action cards to match machine control density.
- [x] Verification:
  - Added/updated tests:
    - `tests/unit/pages/HomePage.test.tsx`
    - `tests/unit/pages/HomePage.ramActions.test.tsx`
    - `tests/unit/streamStatus.test.ts`
  - Re-ran targeted Disks/Home/RAM suites successfully.

## Phase 4 - Full Verification and Build/CI Parity
- [x] Run full web checks:
  - `npm run test`
  - `npm run lint`
  - `npm run build`
- [x] Run local helper build for CI parity:
  - `./build`
- [x] Validate touched docs remain accurate and update docs only if behavior changes require it.
- [x] Final pass for error handling consistency (no silent catches).

## Progress Log
- 2026-02-07: Re-initialized plan for requested Disks/Home REST UI + RAM operations scope.
- 2026-02-07: Phase 0 completed (scoped affected modules: `HomePage`, `HomeDiskManager`, `useC64Connection`, `c64api`, `FolderPicker` bridge, and related unit tests).
- 2026-02-07: Phase 1 completed. Added RAM operation service + RAM dump storage/persistence modules; extended Android `FolderPicker` with `writeFileToTree`; added targeted unit tests and verified Android Kotlin compilation.
- 2026-02-07: Phase 2 completed. Added REST-backed inline Drive Bus ID/Type controls in `HomeDiskManager`, with retry + error handling and in-flight disabling.
- 2026-02-07: Phase 3 completed. Added Home Streams section, compact 9-button machine control grid, RAM actions/folder management, and guarded Power Off flow; updated Home-page tests and UX documentation notes.
- 2026-02-07: Phase 4 completed. Verified `npm run test`, `npm run lint`, `npm run build`, and `./build` all pass. `./build` Playwright run passed (`312` tests) and Android Gradle tasks completed successfully via Kotlin non-daemon fallback after known JDK 25 daemon incompatibility warnings.
