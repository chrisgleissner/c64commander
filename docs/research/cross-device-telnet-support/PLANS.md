# Plan

## Classification

- `DOC_PLUS_CODE`
- `UI_CHANGE`

## Objective

Implement cross-device Telnet support so runtime action support is discovered from the live Telnet menu graph per connected device and firmware instead of being hard-coded to the C64U menu layout.

## Planning Scope

- Maintain planning artifacts only under `docs/research/cross-device-telnet-support/`.
- Do not modify root `PLANS.md` or `WORKLOG.md` because they are currently in use by another task.

## Impact Map

- Documentation and planning:
  - `docs/research/cross-device-telnet-support/PLANS.md`
  - `docs/research/cross-device-telnet-support/WORKLOG.md`
  - `README.md`
  - `docs/c64/devices/u64e/3.14e/u64e-telnet.yaml`
  - Telnet integration docs if discovery/execution semantics need explanation updates
- Tooling and parser:
  - `scripts/dump_c64_telnet_screens.py`
  - `scripts/test_dump_c64_telnet_screens.py`
  - `src/lib/telnet/telnetScreenParser.ts`
  - `tests/unit/telnet/telnetScreenParser.test.ts`
- Runtime discovery and execution:
  - `src/lib/telnet/telnetTypes.ts`
  - `src/lib/telnet/telnetMenuNavigator.ts`
  - `src/lib/telnet/telnetActionExecutor.ts`
  - `src/hooks/useTelnetActions.ts`
  - `src/lib/config/configTelnetWorkflow.ts`
  - `src/lib/reu/reuTelnetWorkflow.ts`
  - related Telnet unit tests
- Home UI:
  - `src/pages/HomePage.tsx`
  - `src/pages/home/components/MachineControls.tsx`
  - `src/pages/home/components/DriveManager.tsx`
  - `src/pages/home/components/PrinterManager.tsx`
  - related Home and hook tests
- Screenshots:
  - update only the smallest affected Home screenshot subset if visible documented UI changes make current images inaccurate

## Current Findings

- `src/lib/telnet/telnetTypes.ts` still uses static `menuPath` pairs such as `["Power & Reset", "Power Cycle"]` as the execution source of truth.
- `src/lib/telnet/telnetActionExecutor.ts` executes only through those static paths.
- `src/hooks/useTelnetActions.ts` exposes global availability, but not per-action support, discovery state, or unsupported reasons.
- `MachineControls` hides `Power Cycle` when no handler is passed instead of rendering a visible disabled action.
- `DriveManager` and `PrinterManager` currently gate Telnet controls with a single availability boolean and hide unsupported actions.
- `src/lib/config/configTelnetWorkflow.ts` and `src/lib/reu/reuTelnetWorkflow.ts` still rely on fixed browser/menu assumptions around action menus.
- `scripts/dump_c64_telnet_screens.py` and `src/lib/telnet/telnetScreenParser.ts` both need stronger handling for overlapping nested menu boxes and direct-entry screens on U64.
- Current U64 YAML evidence is incomplete:
  - initial `F5` submenu details are missing
  - selected-directory `F5` action menu details are missing

## Phases

### Phase 1 - Baseline and artifact control

- [x] Read repo guidance and required implementation inputs
- [x] Confirm classification as `DOC_PLUS_CODE` and `UI_CHANGE`
- [x] Confirm root planning files are occupied by another task
- [x] Update task-local planning and work-log artifacts
- [x] Record current gaps and touched layers before code changes

### Phase 2 - Scraper and parser hardening

- [x] Harden `scripts/dump_c64_telnet_screens.py` for overlapping nested U64 menus
- [x] Fix selected-directory `F5` action-menu capture on U64
- [x] Improve handling for direct-entry screens such as `Assembly 64`
- [x] Preserve C64U scrape compatibility
- [x] Add targeted dump-script and parser regression coverage
- [x] Regenerate `docs/c64/devices/u64e/3.14e/u64e-telnet.yaml`

### Phase 3 - Runtime capability discovery

- [x] Introduce a discovered Telnet menu graph and per-action capability resolution
- [x] Cache discovery by connected device identity and firmware
- [x] Handle category renames and menu reordering without device-family hard-coding
- [x] Expose `supported`, `unsupported`, and discovery-failed states to callers

### Phase 4 - Action execution refactor

- [x] Execute actions through discovered capabilities instead of static category paths
- [x] Upgrade config and REU workflows to use discovered action/menu resolution where needed
- [x] Distinguish unsupported-action failures from discovery failures and navigation failures

### Phase 5 - Home UI convergence

- [x] Keep app-supported Telnet actions visible even when unsupported on the current device
- [x] Render disabled controls with explanatory text/tooltips/inline copy
- [x] Make `Power Cycle` visibly disabled on U64 3.14e

### Phase 6 - Validation and closure

- [x] Add targeted regression tests for discovery, parser, workflows, and disabled-state UX
- [x] Run `npm run lint`
- [x] Run `npm run test`
- [ ] Re-run `npm run test:coverage` and confirm global branch coverage `>= 91%` on the current tree
- [x] Run `npm run build`
- [x] Re-verify live U64 behavior on device and record the current C64U reachability state
- [x] Decide whether screenshot refresh is required
- [ ] Update only the necessary docs and screenshots

## Current Status

- Core implementation phases 2 through 5 are complete.
- Targeted parser, scraper, discovery, workflow, hook, and Home UI regressions are in place.
- Backlog extension added during execution:
  - mirrored extracted artifacts under `docs/c64/devices/u64e/**` must use `u64e-*` filenames instead of `c64u-*`
  - the config and Telnet extraction tools must infer that filename prefix automatically from the probed device family
  - existing mirrored files under the U64E subtree must be renamed retroactively
- Remaining closure work is:
  - decide whether to pursue the live U64 `/Temp` workflow/browser observability gap as a follow-up task
  - obtain a fresh `npm run test:coverage` result once the unrelated jsdom timeout regressions and shard-write flake are resolved

## Closure Delta

- `npm run lint` now passes on the current tree, with only existing warnings about unused eslint-disable directives in unrelated tests.
- Screenshot refresh is not required for this task closure:
  - existing Home documentation screenshots still depict a connected C64U-supported state accurately
  - no documentation screenshot currently claims or demonstrates the U64-specific disabled Telnet state
- Live-device status changed after the earlier handover:
  - immediately before the final proof pass, both `u64` and `c64u` were reachable over REST and raw Telnet
  - after direct `saveReuMemory` execution on `u64`, only `c64u` remained reachable from this environment
- Live U64 app-side discovery is now closed:
  - the repo-root `vite-node` probe path works
  - `powerCycle` resolves `unsupported` as expected on `u64` `3.14e`
  - `rebootClearMemory`, `saveReuMemory`, `printerFlush`, and `driveAReset` resolve `supported` with concrete discovered targets
- Live U64 action execution is now closed at the action-executor layer:
  - `printerFlush` executed successfully via a discovered `Printer -> Flush/Eject` target
  - direct `saveReuMemory` executed successfully via a discovered `C64 Machine -> Save REU Memory` target
- Remaining live U64 limitation is narrower and workflow-specific:
  - `saveRemoteReuFromTemp(...)` still cannot find `Temp` because the live U64 Telnet browser emits no observable file-browser redraw frames after `HOME` or `DOWN` through the current `readScreen(...)` path
  - post-save REU file verification was blocked because the device dropped off the network before FTP confirmation could be captured

## Success Criteria

- Runtime support is keyed by connected device identity plus firmware, not a single fixed family assumption.
- U64 and C64U use the same discovery/execution architecture.
- Unsupported actions remain visible and disabled with clear explanation.
- `powerCycle` resolves unsupported on U64 3.14e and supported on C64U 1.1.0.
- U64 Telnet YAML is fully refreshed from the improved scraper.
