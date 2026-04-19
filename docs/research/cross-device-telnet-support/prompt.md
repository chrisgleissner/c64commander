# Cross-Device Telnet Support Implementation Prompt

Date: 2026-04-18  
Type: Strict execution prompt  
Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## Primary inputs

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- `docs/c64/c64u-telnet.yaml`
- `docs/c64/devices/c64u/1.1.0/c64u-telnet.yaml`
- `docs/c64/devices/u64e/3.14e/u64e-config.yaml`
- `docs/c64/devices/u64e/3.14e/u64e-telnet.yaml`
- `scripts/dump_c64u_config.py`
- `scripts/dump_c64_telnet_screens.py`
- `src/lib/telnet/telnetTypes.ts`
- `src/lib/telnet/telnetMenuNavigator.ts`
- `src/lib/telnet/telnetScreenParser.ts`
- `src/hooks/useTelnetActions.ts`
- `src/pages/HomePage.tsx`
- `src/pages/home/components/MachineControls.tsx`
- `src/pages/home/components/DriveManager.tsx`
- `src/pages/home/components/PrinterManager.tsx`
- `src/lib/config/configTelnetWorkflow.ts`
- `src/lib/reu/reuTelnetWorkflow.ts`
- `tests/unit/telnet/`
- `tests/unit/hooks/useTelnetActions.test.tsx`
- `tests/unit/pages/HomePage.ramActions.test.tsx`

## Planning and work-log rule

This implementation must be run as a convergent multi-phase task with live planning artifacts.

Required behavior:

1. Create or extend `docs/research/cross-device-telnet-support/PLANS.md`.
2. Create or extend `docs/research/cross-device-telnet-support/WORKLOG.md`.
3. If the repository root `PLANS.md` or `WORKLOG.md` are already occupied by another in-flight task, do not overwrite them.
4. If the root planning files are clearly dedicated to this task and safe to extend, keep them aligned as secondary mirrors.
5. Update the plan before major implementation phases.
6. Append the work log during execution with real findings, blockers, device evidence, and validation results.

## Objective

Implement robust cross-device Telnet support so the app dynamically supports both C64U and U64-class devices at runtime instead of assuming the C64U menu model.

The implementation must:

- obtain and preserve authoritative live Telnet/config documentation for U64 3.14e
- support every Telnet-backed app feature that the U64 actually exposes
- disable unsupported actions visibly instead of hiding them
- discover live menu capabilities by scanning and probing the Telnet UI at runtime
- stop relying on hard-coded click paths such as fixed top-level category names like `Power & Reset`
- preserve current C64U support and not regress existing Telnet workflows

## Verified live facts from research

Treat the following as already verified starting assumptions:

- `u64` responds as `Ultimate 64 Elite`, firmware `3.14e`
- `c64u` responds as `C64 Ultimate`, firmware `1.1.0`
- U64 uses `F5`, not `F1`
- U64 top-level `F5` categories are:
  - `Assembly 64`
  - `C64 Machine`
  - `Built-in Drive A`
  - `Built-in Drive B`
  - `Software IEC`
  - `Printer`
  - `Configuration`
  - `Streams`
  - `Developer`
- U64 `C64 Machine` submenu contains:
  - `Reset C64`
  - `Reboot C64`
  - `Reboot (Clr Mem)`
  - `Power OFF`
  - `Save C64 Memory`
  - `Save REU Memory`
  - `Save MP3 Drv B`
- U64 `Power Cycle` is absent on firmware `3.14e`
- U64 Drive A/B, Software IEC, Printer, and Configuration menus do expose the app-relevant actions already modeled today
- U64 `Developer` exposes:
  - `Clear Debug Log`
  - `Save Debug Log`
  - `Save EDID to file`
  - `Debug Stream`
- The current `docs/c64/devices/u64e/3.14e/u64e-telnet.yaml` is only partially complete:
  - file-entry context menus are populated
  - top-level category list is populated
  - initial `F5` submenu details are missing
  - selected-directory `F5` action menu is missing

## Current code gaps you must treat as real

- `src/lib/telnet/telnetTypes.ts` hard-codes action paths against the C64U menu shape, especially `Power & Reset`.
- `src/hooks/useTelnetActions.ts` only exposes global Telnet availability, not action-level support.
- `MachineControls` omits `Power Cycle` when no handler exists instead of rendering a disabled control.
- `DriveManager` and `PrinterManager` hide Telnet controls when `telnetAvailable` is false instead of representing unsupported actions explicitly.
- The current dump script and runtime parser both struggle with overlapping nested U64 menu boxes.
- Current selected-directory action-menu scraping for U64 is incomplete.
- Existing workflows for config and REU rely on deterministic menu/file-browser assumptions and need to be upgraded to use discovered capabilities and discovered paths where possible.

## Non-negotiable rules

1. Do not solve U64 support by adding another static registry of U64-specific click paths.
2. Do not special-case action support with one-off boolean flags like `isU64 && actionId !== "powerCycle"` as the primary mechanism.
3. Runtime capability discovery must inspect the live Telnet menu graph and derive support from what the device actually exposes.
4. A button for an app-supported Telnet feature must remain visible but disabled when the current device/firmware lacks the backing Telnet capability.
5. Disabled state must be obvious in the UI and accompanied by user-readable explanation text, tooltip text, or inline supporting text.
6. Preserve current C64U behavior unless the live discovery model shows a safer path that still passes regression coverage.
7. Do not silently swallow Telnet parse, navigation, or discovery failures.
8. Every bug fix or discovered compatibility edge case must get a targeted regression test.
9. Do not claim U64 Telnet support complete until the U64 documentation artifacts are fully refreshed from improved tooling.

## Required end state

The task is complete only when all of the following are true:

- the app discovers Telnet capabilities per connected device at runtime
- the discovered capability model is keyed by device identity and firmware, not by a single hard-coded product family assumption
- app-supported Telnet actions are available on U64 wherever the live menu graph confirms them
- unsupported U64 actions are visible but disabled
- `Power Cycle` is visibly disabled on U64 3.14e because the live `C64 Machine` menu does not expose it
- U64 and C64U both work through the same discovery/execution architecture
- config-file and REU Telnet workflows survive U64 menu naming/layout differences
- `docs/c64/devices/u64e/3.14e/u64e-telnet.yaml` is regenerated with fully populated initial submenu data and selected-directory action-menu data
- the Telnet dump tooling itself can capture those U64 details reproducibly

## Implementation phases

### Phase 1: Baseline, plan, and artifact control

- Read the primary inputs.
- Update local `PLANS.md` and `WORKLOG.md`.
- Confirm task classification as `DOC_PLUS_CODE` and `UI_CHANGE`.
- Record the current Telnet action surface in code and the current U64 live evidence.
- Identify every touched layer before editing:
  - dump scripts
  - parser
  - runtime capability model
  - action execution
  - Home UI
  - docs/tests/screenshots

Completion criteria:

- planning docs reflect the actual execution path
- impact map is explicit
- current gaps are written down before code changes begin

### Phase 2: Scraper and parser hardening for U64

Make the documentation capture trustworthy first.

Required work:

- harden `scripts/dump_c64_telnet_screens.py` so it can correctly serialize U64 nested `F5` submenus
- fix the selected-directory `F5` action-menu capture for U64
- handle overlapping menu boxes without corrupting parent-menu item extraction
- handle direct-entry screens like `Assembly 64` forms without mistaking them for missing menus
- preserve C64U output compatibility
- regenerate:
  - `docs/c64/devices/u64e/3.14e/u64e-telnet.yaml`
- refresh U64 config snapshot only if scraper changes require it or live evidence changed

Important:

- the current U64 scrape succeeded only after targeting `/USB2/test-data`
- do not regress that path-resolution logic
- do not rely on leaving temporary files on the device after scraping

Completion criteria:

- regenerated U64 Telnet YAML contains populated initial submenu data
- regenerated U64 Telnet YAML contains populated selected-directory action-menu data
- scraper behavior is covered by tests where feasible

### Phase 3: Capability graph and runtime discovery

Replace the current static menu-path mindset with a discovered capability graph.

Required behavior:

- perform a bounded discovery pass against the live Telnet UI
- discover:
  - top-level categories
  - submenu items
  - direct-entry items
  - file-browser context-menu actions that the app depends on
- model action support as discovered capabilities, not only as static `menuPath` strings
- cache discovery results per device identity plus firmware version
- invalidate or refresh cache when product/firmware changes
- tolerate:
  - alternate category labels such as `C64 Machine` vs `Power & Reset`
  - overlapping nested boxes
  - menu reordering
  - extra menu items unrelated to the app

Prefer a model like:

- discovered menu graph
- action-to-capability matcher
- action executor that resolves current target from discovered graph

Do not keep the existing `TELNET_ACTIONS` registry as the sole source of truth for executable navigation.

Completion criteria:

- runtime can explain whether each app action is:
  - supported
  - unsupported
  - unknown or discovery-failed
- discovery is reusable across Home and workflow-heavy paths

### Phase 4: Action execution refactor

Refactor Telnet execution to use discovered capabilities.

Required work:

- replace fixed category assumptions such as `Power & Reset`
- route machine, drive, IEC, printer, config, developer, REU, and config-file workflows through the discovered capability model
- preserve label-based navigation where appropriate, but resolve labels from discovery rather than from hard-coded family-specific paths
- improve error reporting when discovery says an action is unsupported
- ensure discovery failures are surfaced distinctly from execution failures

Specific U64 requirement:

- `powerCycle` must resolve to unsupported on U64 3.14e
- `rebootClearMemory`, `saveReuMemory`, `driveAReset`, `driveBTurnOn`, `iecTurnOn`, `iecReset`, `iecSetDir`, `printerFlush`, `printerReset`, `printerTurnOn`, `saveConfigToFile`, `clearFlashConfig`, `clearDebugLog`, `saveDebugLog`, and `saveEdidToFile` should be supported if discovery confirms them

Completion criteria:

- all app-supported U64 actions execute through discovered capabilities
- unsupported actions fail cleanly and predictably without bogus navigation attempts

### Phase 5: Home and workflow UX convergence

Update the UI to reflect capability truth instead of simple Telnet yes/no.

Required behavior:

- `MachineControls` must render `Power Cycle` visibly disabled on U64 3.14e
- drive and printer Telnet controls must be rendered based on per-action support, not only hidden by global availability
- disabled controls must communicate why they are disabled
- keep platform-level gating honest:
  - web can still hide or separately explain Telnet where raw TCP is impossible
  - native U64/C64U action differences must be shown as disabled, not hidden

Also update any overflow menus or dialogs that currently omit unsupported actions entirely when they should be visible but disabled.

Completion criteria:

- the user can tell which Telnet actions exist but are unavailable on the connected device
- unsupported U64 actions no longer disappear silently

### Phase 6: Tests and regression coverage

Add targeted regression tests for every compatibility behavior you fix.

Required minimum coverage areas:

- parser handles overlapping nested menus
- discovery tolerates category renaming and reordering
- discovery distinguishes direct-entry items from submenu categories
- U64 `C64 Machine` maps to app machine actions without assuming `Power & Reset`
- `powerCycle` resolves unsupported on U64 3.14e
- UI renders visible disabled controls for unsupported actions
- C64U still resolves `powerCycle` as supported
- REU and config workflows still function through the discovery model
- dump-script tests lock in U64 submenu and selected-directory capture

Prefer:

- unit tests for parser and capability matching
- hook tests for capability state
- Home component tests for visible disabled controls
- targeted workflow tests for REU/config Telnet paths

### Phase 7: Documentation and screenshot closure

Update documentation so it matches the final implementation.

Required docs to update as relevant:

- `README.md`
- in-app docs content if it references Telnet-backed controls
- `docs/ux-interactions.md` if action visibility/disabled semantics change
- `docs/c64/devices/u64e/3.14e/u64e-telnet.yaml`
- any Telnet integration/spec docs that describe action assumptions

Screenshot policy:

- regenerate only the screenshots whose visible UI changed
- if the Home quick actions or drive/printer cards visibly change, update only those relevant screenshot files under `docs/img/`

### Phase 8: Validation and real-device proof

Required validation for this executable task:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

Also run the smallest honest additional validation needed to prove:

- U64 discovery works on the attached `u64` device
- C64U discovery still works on `c64u`
- `Power Cycle` is disabled on U64 but available on C64U
- at least one supported U64 machine action executes successfully
- at least one supported U64 drive or printer action executes successfully
- U64 REU/config workflow discovery does not regress if those workflows are still in scope

If scraper behavior changed, regenerate and verify the U64 Telnet YAML before completion.

## Suggested file targets

You will likely need to touch some combination of:

- `scripts/dump_c64_telnet_screens.py`
- `scripts/test_dump_c64_telnet_screens.py`
- `src/lib/telnet/telnetScreenParser.ts`
- `src/lib/telnet/telnetTypes.ts`
- `src/lib/telnet/telnetMenuNavigator.ts`
- `src/lib/telnet/telnetActionExecutor.ts`
- `src/hooks/useTelnetActions.ts`
- `src/pages/HomePage.tsx`
- `src/pages/home/components/MachineControls.tsx`
- `src/pages/home/components/DriveManager.tsx`
- `src/pages/home/components/PrinterManager.tsx`
- `src/lib/config/configTelnetWorkflow.ts`
- `src/lib/reu/reuTelnetWorkflow.ts`
- relevant tests under `tests/unit/telnet/`, `tests/unit/hooks/`, and `tests/unit/pages/home/`

## Failure rules

Stop and report a blocker instead of guessing if:

- the live U64 Telnet UI contradicts the current verified evidence
- selected-directory or file-browser action discovery cannot be made deterministic without a broader product decision
- visible disabled-state requirements conflict with existing UX rules in a way that needs product clarification
- the U64 Telnet UI exposes app-supported features only through unstable non-menu interactions that cannot be safely automated

## Output requirements

At completion, report:

- which phases were completed
- which planning/worklog files were maintained
- which code paths changed
- which live device facts were re-verified
- which tests and builds were run
- which screenshots were updated, if any
- any remaining known limitations or follow-up items
