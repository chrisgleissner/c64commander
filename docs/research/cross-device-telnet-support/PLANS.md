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
  - `docs/c64/devices/u64e/3.14e/c64u-telnet.yaml`
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

- [ ] Harden `scripts/dump_c64_telnet_screens.py` for overlapping nested U64 menus
- [ ] Fix selected-directory `F5` action-menu capture on U64
- [ ] Improve handling for direct-entry screens such as `Assembly 64`
- [ ] Preserve C64U scrape compatibility
- [ ] Add targeted dump-script and parser regression coverage
- [ ] Regenerate `docs/c64/devices/u64e/3.14e/c64u-telnet.yaml`

### Phase 3 - Runtime capability discovery

- [ ] Introduce a discovered Telnet menu graph and per-action capability resolution
- [ ] Cache discovery by connected device identity and firmware
- [ ] Handle category renames and menu reordering without device-family hard-coding
- [ ] Expose `supported`, `unsupported`, and discovery-failed states to callers

### Phase 4 - Action execution refactor

- [ ] Execute actions through discovered capabilities instead of static category paths
- [ ] Upgrade config and REU workflows to use discovered action/menu resolution where needed
- [ ] Distinguish unsupported-action failures from discovery failures and navigation failures

### Phase 5 - Home UI convergence

- [ ] Keep app-supported Telnet actions visible even when unsupported on the current device
- [ ] Render disabled controls with explanatory text/tooltips/inline copy
- [ ] Make `Power Cycle` visibly disabled on U64 3.14e

### Phase 6 - Validation and closure

- [ ] Add targeted regression tests for discovery, parser, workflows, and disabled-state UX
- [ ] Run `npm run lint`
- [ ] Run `npm run test`
- [ ] Run `npm run test:coverage` and confirm global branch coverage `>= 91%`
- [ ] Run `npm run build`
- [ ] Re-verify live U64 and C64U behavior on device
- [ ] Update only the necessary docs and screenshots

## Success Criteria

- Runtime support is keyed by connected device identity plus firmware, not a single fixed family assumption.
- U64 and C64U use the same discovery/execution architecture.
- Unsupported actions remain visible and disabled with clear explanation.
- `powerCycle` resolves unsupported on U64 3.14e and supported on C64U 1.1.0.
- U64 Telnet YAML is fully refreshed from the improved scraper.
