# Work Log

## 2026-04-18

### Repository and codebase orientation

- Read `README.md`, `.github/copilot-instructions.md`, and `docs/ux-guidelines.md`.
- Classified this task as `DOC_ONLY`.
- Traced the current Telnet implementation through:
  - `src/lib/telnet/telnetTypes.ts`
  - `src/lib/telnet/telnetMenuNavigator.ts`
  - `src/lib/telnet/telnetScreenParser.ts`
  - `src/hooks/useTelnetActions.ts`
  - `src/pages/HomePage.tsx`
  - `src/pages/home/components/MachineControls.tsx`
  - `src/pages/home/components/DriveManager.tsx`
  - `src/pages/home/components/PrinterManager.tsx`

### Live device evidence

- Probed the preferred real device first:
  - `http://u64/v1/info` returned `Ultimate 64 Elite`, firmware `3.14e`
- Probed the fallback/baseline device second:
  - `http://c64u/v1/info` returned `C64 Ultimate`, firmware `1.1.0`
- Dumped live U64 config to `docs/c64/devices/u64e/3.14e/u64e-config.yaml`.

### Telnet scrape work

- Initial U64 Telnet scrape failed because the script only searched `/USB0/test-data` and `/USB1/test-data`.
- FTP inspection showed this U64 exposes test fixtures at `/USB2/test-data`.
- Re-ran the Telnet scrape successfully against `/USB2/test-data`.
- The scrape still left two important holes:
  - U64 initial `F5` action submenus were not expanded into the YAML
  - U64 selected-directory `F5` action menu was captured as empty
- Added `docs/c64/devices/u64e/3.14e/u64e-telnet.yaml` with the current script output so the gap is explicit and reproducible.

### Live U64 Telnet confirmation

- Used short direct Telnet probes to confirm the U64 menu structure that the script failed to serialize fully.
- Confirmed top-level `F5` categories:
  - `Assembly 64`
  - `C64 Machine`
  - `Built-in Drive A`
  - `Built-in Drive B`
  - `Software IEC`
  - `Printer`
  - `Configuration`
  - `Streams`
  - `Developer`
- Confirmed U64 `C64 Machine` submenu:
  - `Reset C64`
  - `Reboot C64`
  - `Reboot (Clr Mem)`
  - `Power OFF`
  - `Save C64 Memory`
  - `Save REU Memory`
  - `Save MP3 Drv B`
- Key compatibility finding:
  - `Power Cycle` is absent on U64 3.14e and must therefore be rendered as unsupported, not assumed present.
- Confirmed app-relevant submenu parity for:
  - `Built-in Drive A`
  - `Built-in Drive B`
  - `Software IEC`
  - `Printer`
  - `Configuration`
- Confirmed `Developer` submenu includes:
  - `Clear Debug Log`
  - `Save Debug Log`
  - `Save EDID to file`
  - `Debug Stream`

### Implementation-prompt shaping findings

- The current runtime is still built around a fixed `TELNET_ACTIONS` registry with hard-coded menu paths.
- The current UI only models Telnet as globally available/unavailable; it does not expose per-action support.
- Unsupported action UX is currently mostly omission:
  - `MachineControls` omits `Power Cycle` when no handler is passed
  - `DriveManager` and `PrinterManager` hide Telnet controls when unavailable
- The prompt needs to force:
  - firmware-aware runtime menu discovery
  - per-action capability modeling
  - visible disabled states for unsupported U64 actions
  - improved U64 menu scraping/parsing before claiming completion

### Cleanup and artifact discipline

- A temporary 1-byte `.reu` placeholder was uploaded into `/USB2/test-data/snapshots/` only to expose the U64 REU context menu during scraping.
- Removed the temporary placeholder and the empty `snapshots` directory immediately after the scrape.
- Restored accidental local C64U mirror writes from the first config scrape attempt so only the intended U64 research artifacts remain.

### Follow-up extractor hardening

- A later review correctly pointed out that `docs/c64/devices/c64u/3.14e/...` was invalid because the live C64U firmware is `1.1.0`, not `3.14e`.
- The root cause was tool wiring that still assumed a C64U-only mirror root while only substituting the firmware version.
- Updated the extraction toolchain so it always probes `/v1/info` first and uses that response as the source of truth for both:
  - firmware version
  - device family
- Added explicit device-family inference for known products:
  - `C64 Ultimate` -> `c64u`
  - `Ultimate 64` -> `u64`
  - `Ultimate 64 Elite` -> `u64e`
  - `Ultimate 64-II` and Elite II variants -> `u64e2`
- Updated default mirror templates in both scripts and the `build` wrapper so extracts now land under:
  - `docs/c64/devices/{device_family}/{firmware_version}/c64u-config.yaml`
  - `docs/c64/devices/{device_family}/{firmware_version}/c64u-config.cfg`
  - `docs/c64/devices/{device_family}/{firmware_version}/c64u-telnet.yaml`
- Added regression coverage for both scripts so the placeholder expansion and product-to-family mapping stay locked in.

### Validation

- Ran targeted tool tests:
  - `python3 -m unittest scripts/test_dump_c64u_config.py scripts/test_dump_c64_telnet_screens.py`
  - Result: `Ran 16 tests in 0.008s` and `OK`
- Started the repository coverage gate because the follow-up changed executable files:
  - `npm run test:coverage`
  - Final aggregate result was still pending while this work log entry was written.

## 2026-04-19

### 00:55 BST

- Re-read `README.md`, `.github/copilot-instructions.md`, and `docs/ux-guidelines.md` for the implementation task.
- Reclassified the active work as:
  - `DOC_PLUS_CODE`
  - `UI_CHANGE`
- Confirmed the repository root `PLANS.md` and `WORKLOG.md` are occupied by unrelated in-flight work and must not be touched for this task.
- Replaced the task-local `docs/research/cross-device-telnet-support/PLANS.md` with the implementation-phase plan for this execution.

### 01:00 BST

- Re-traced the current Telnet execution path through:
  - `src/lib/telnet/telnetTypes.ts`
  - `src/lib/telnet/telnetMenuNavigator.ts`
  - `src/lib/telnet/telnetActionExecutor.ts`
  - `src/hooks/useTelnetActions.ts`
  - `src/lib/config/configTelnetWorkflow.ts`
  - `src/lib/reu/reuTelnetWorkflow.ts`
  - `src/pages/HomePage.tsx`
  - `src/pages/home/components/MachineControls.tsx`
  - `src/pages/home/components/DriveManager.tsx`
  - `src/pages/home/components/PrinterManager.tsx`
- Current implementation findings locked in before edits:
  - action execution still depends on static `menuPath` pairs, especially `Power & Reset`
  - the hook exposes global availability, not discovered per-action support
  - `MachineControls` hides `Power Cycle` when no handler exists
  - drive and printer Telnet controls are still gated as present-or-hidden via global availability
  - config and REU workflows still assume deterministic context-menu labels without discovery support

### 01:07 BST

- Re-traced the current parser and scraper behavior through:
  - `src/lib/telnet/telnetScreenParser.ts`
  - `tests/unit/telnet/telnetScreenParser.test.ts`
  - `scripts/dump_c64_telnet_screens.py`
  - `scripts/test_dump_c64_telnet_screens.py`
- Tooling findings locked in before edits:
  - runtime parser currently assigns menu nesting purely by discovery order instead of parent/child geometry
  - runtime parser extracts menu rows from the full inner box width, which is vulnerable to nested overlay contamination
  - dump-script overlay capture still falls back to splitting parent rows and misses real nested submenu structure on U64
  - current U64 YAML still shows empty `selected_directory_action_menus.action_menu.items`
  - current U64 YAML still lacks populated initial submenu trees

### 01:35 BST

- Hardened `scripts/dump_c64_telnet_screens.py` so live U64 captures now preserve nested `F5` submenus, direct-entry screens, and selected-directory action menus without corrupting parent menu extraction.
- Added targeted dump-script regression coverage in `scripts/test_dump_c64_telnet_screens.py` for:
  - nested menu overlays
  - direct-entry form detection
  - selected-directory action-menu capture
  - temporary REU probe fixture lifecycle
- Regenerated `docs/c64/devices/u64e/3.14e/u64e-telnet.yaml` from the improved scraper.
- Preserved C64U compatibility and restored an accidental write to the generic `docs/c64/c64u-telnet.yaml` mirror.

### 01:55 BST

- Reworked `src/lib/telnet/telnetScreenParser.ts` to derive menu nesting from box geometry instead of discovery order.
- Locked in parser behavior with new unit coverage for:
  - overlapping nested menu boxes
  - parent-row extraction that excludes child overlay columns
  - direct-entry screens that should not be treated as empty submenus
- Validation:
  - `python3 -m unittest scripts/test_dump_c64_telnet_screens.py` -> passed
  - `npm run test -- --run tests/unit/telnet/telnetScreenParser.test.ts` -> passed

### 02:10 BST

- Added runtime capability discovery in `src/lib/telnet/telnetCapabilityDiscovery.ts`.
- Discovery now:
  - scans the live top-level action menu for the current menu key
  - probes submenu and direct-entry nodes
  - resolves app action support from discovered labels instead of fixed category names
  - caches results by host, product, firmware, and menu key
- Updated `src/lib/telnet/telnetTypes.ts` so actions can provide label/category hints without making static `menuPath` the sole source of truth.
- Updated `src/lib/telnet/telnetActionExecutor.ts` to prefer discovered targets when executing actions.
- Updated `src/hooks/useTelnetActions.ts` to expose:
  - discovery state
  - per-action support
  - explicit unsupported and discovery-failed errors
- Updated config and REU workflows to pass resolved Telnet targets into execution.

### 02:18 BST

- Updated Home UI and workflow surfaces so Telnet actions now reflect per-action capability truth instead of a single global yes/no:
  - `MachineControls` keeps `Power Cycle` visible and disabled with an explanatory note when unsupported
  - `DriveManager` and `PrinterManager` keep app-supported Telnet actions visible and disabled when unsupported
  - `SaveRamDialog` keeps REU save visible and disabled with explanation when unsupported
  - `HomePage.tsx` routes save-config and save-REU workflows through discovered capability targets
- This locks in the required U64 behavior:
  - `Power Cycle` stays visible but disabled on `Ultimate 64 Elite` firmware `3.14e`
  - supported U64 machine, drive, printer, config, and developer actions execute through the shared discovery architecture

### 02:24 BST

- Added targeted regression coverage for:
  - discovery category renaming and reordering tolerance
  - direct-entry node handling
  - U64 `C64 Machine` action resolution without assuming `Power & Reset`
  - `powerCycle` unsupported on U64 and supported on C64U
  - hook-level support state and unsupported-action errors
  - config and REU workflow target resolution
  - visible disabled-state UX for machine, drive, printer, and RAM-save actions
- Fixed a follow-on mock gap in `tests/unit/pages/HomePage.test.tsx` after `useTelnetActions` began resolving the device host from storage.

### 02:28 BST

- Repository validation results:
  - `npm run lint` -> passed, with existing unrelated warnings about unused eslint-disable directives in diagnostics/HVSC tests
  - `npm run test` -> passed (`525` test files, `6072` tests)
  - `npm run build` -> passed, with existing non-fatal Vite chunking/browser externalization warnings
- Coverage gate status:
  - `npm run test:coverage` still fails inside the repository coverage harness before thresholds are reported
  - observed failures:
    - `ENOENT: no such file or directory, open '.cov-unit/jsdom-11/.tmp/coverage-0.json'`
    - `ENOENT: no such file or directory, open '.cov-unit/jsdom-10/.tmp/coverage-0.json'`
  - this is currently a harness/temp-file issue, not a unit-test failure

### 02:31 BST

- Remaining closure items:
  - align `README.md` and `docs/ux-interactions.md` with runtime capability discovery and visible disabled unsupported actions
  - re-probe `u64` and `c64u`, then perform the smallest honest live validation pass for discovery and action execution
  - either complete the coverage gate or record the blocker precisely if the harness issue persists

### 02:57 BST

- Updated user-facing docs:
  - `README.md`
  - `docs/ux-interactions.md`
- Doc wording now reflects that:
  - Telnet support is discovered from the connected device and firmware at runtime
  - unsupported Telnet actions stay visible but disabled with explanation instead of disappearing
- Screenshot refresh was not performed:
  - visible Home semantics changed, but no screenshot corpus update was run in this turn
  - the existing task log now records that explicitly instead of implying refreshed screenshots

### 03:00 BST

- Re-probed both live devices over REST:
  - `http://u64/v1/info` -> `Ultimate 64 Elite`, firmware `3.14e`
  - `http://c64u/v1/info` -> `C64 Ultimate`, firmware `1.1.0`

### 03:18 BST

- Added the backlog extension requested during execution:
  - mirrored extracted artifacts under `docs/c64/devices/u64e/**` must use `u64e-*` basenames instead of `c64u-*`
  - extraction tools must infer the mirrored filename prefix automatically from the probed device family
- Updated the extractor toolchain:
  - `scripts/dump_c64u_config.py` now normalizes mirrored output basenames under `docs/c64/devices/<family>/<firmware>/...` so they always match the resolved device family
  - `scripts/dump_c64_telnet_screens.py` now reuses that normalization for mirrored Telnet YAML output
- Retroactively renamed the existing mirrored U64E artifacts:
  - `docs/c64/devices/u64e/3.12a/u64e-config.yaml`
  - `docs/c64/devices/u64e/3.14a/u64e-config.yaml`
  - `docs/c64/devices/u64e/3.14d/u64e-config.yaml`
  - `docs/c64/devices/u64e/3.14e/u64e-config.yaml`
  - `docs/c64/devices/u64e/3.14e/u64e-telnet.yaml`
- Updated task docs so file references now point at the `u64e-*` mirrored filenames.
- Validation:
  - `python3 -m unittest scripts/test_dump_c64u_config.py` -> passed
  - `python3 -m unittest scripts/test_dump_c64_telnet_screens.py` -> passed

### 03:34 BST

- Hardened live runtime menu handling after app-side probing exposed two device-specific redraw behaviors:
  - U64 can transiently return blank or otherwise non-actionable frames while moving within a menu
  - C64U `F1` action discovery exposes a level-0 filesystem menu plus a deeper level-1 action-category menu, so the deepest actionable visible menu must be treated as the root action menu
- Updated:
  - `src/lib/telnet/telnetCapabilityDiscovery.ts`
  - `src/lib/telnet/telnetMenuNavigator.ts`
- Locked in the behavior with targeted regressions:
  - `tests/unit/telnet/telnetCapabilityDiscovery.test.ts`
  - `tests/unit/telnet/telnetMenuNavigator.test.ts`
- Validation:
  - `npm run test -- --run tests/unit/telnet/telnetCapabilityDiscovery.test.ts` -> passed
  - `npm run test -- --run tests/unit/telnet/telnetMenuNavigator.test.ts` -> passed

### 03:48 BST

- Fixed the repository coverage harness failure in `scripts/run-unit-coverage.mjs` by keeping each shard's `.tmp` directory alive while Vitest writes raw coverage JSON.
- Added a regression test in `tests/unit/scripts/runUnitCoverage.test.ts` for the keepalive wrapper logic.
- Validation:
  - `npm run test -- --run tests/unit/scripts/runUnitCoverage.test.ts` -> passed
  - `npm run test:coverage` -> passed
  - Coverage summary:
    - statements `93.98%`
    - branches `92.01%`
    - functions `90.05%`
    - lines `93.98%`

### 03:58 BST

- Full repository validation after the coverage fix:
  - `npm run test` -> passed (`525` files, `6076` tests)
  - `npm run build` -> passed
  - `npm run lint` -> failed because `playwright/uiMocks.ts` is already modified in the worktree and currently fails the repository Prettier check
- Did not overwrite the unrelated `playwright/uiMocks.ts` user change just to force lint green.
- Remaining closure work is now limited to live device proof and final reporting unless the unrelated lint failure needs separate direction.

### 10:15 BST

- Added `docs/research/cross-device-telnet-support/HANDOVER_PROMPT.md`.
- The handover prompt captures:
  - the implemented cross-device Telnet state
  - the U64 `u64e-*` mirrored filename rule
  - the clipped standalone-submenu parser fix that restored live C64U discovery
  - the remaining live U64 blocker and exact next steps
  - the validation state that still needs final closure bookkeeping
- Built a small `vite-node` proof harness around the app-side Telnet session and capability discovery modules to avoid validating only through the Python scraper.
- Live U64 discovery findings from the app-side probe:
  - the initial `F5` open returns the expected boxed category menu
  - after `DOWN`, the device redraw can become a boxless category list that still reflects menu state but is not recognized by the current parser as a menu
  - after later transitions, the device can also emit transient blank frames before the next stable menu appears
- Practical impact:
  - the current runtime discovery path can desynchronize on live U64 because it assumes each intermediate frame remains parseable as a boxed menu
  - this is a real runtime hardening gap uncovered by device validation, not a unit-test failure

### 03:03 BST

- Re-ran `npm run test:coverage`.
- The coverage harness progressed much farther than the earlier run, but it still failed inside the repository temp-file handling rather than at a branch threshold.
- Latest concrete failure captured:
  - `ENOENT: no such file or directory, open '/home/chris/dev/c64/c64commander/.cov-unit/jsdom-17/.tmp/coverage-4.json'`
- The harness logged a retry for that shard, but the overall coverage run still did not produce a final merged threshold result before terminating.
- Current validation summary at close:
  - `python3 -m unittest scripts/test_dump_c64_telnet_screens.py` -> passed
  - targeted Telnet parser/discovery/UI tests -> passed
  - `npm run lint` -> passed
  - `npm run test` -> passed
  - `npm run build` -> passed
  - live REST identity probes for `u64` and `c64u` -> passed
  - app-side live U64 discovery probe -> exposed transient-frame discovery/parser gap
  - `npm run test:coverage` -> blocked by repository coverage harness ENOENT before threshold confirmation

### 03:11 BST

- Added a new in-scope backlog item from the user:
  - mirrored extracted config/Telnet artifacts under `docs/c64/devices/u64e/**` must be renamed from `c64u-*` to `u64e-*`
  - the extraction tools must derive that prefix automatically from the detected device family so future U64E runs land on the correct filenames without manual intervention
- Verified current affected mirrored files:
  - `docs/c64/devices/u64e/3.12a/u64e-config.yaml`
  - `docs/c64/devices/u64e/3.14a/u64e-config.yaml`
  - `docs/c64/devices/u64e/3.14d/u64e-config.yaml`
  - `docs/c64/devices/u64e/3.14e/u64e-config.yaml`
  - `docs/c64/devices/u64e/3.14e/u64e-telnet.yaml`

### 03:17 BST

- Updated the extraction helpers so device-mirrored filenames under `docs/c64/devices/<family>/...` now use a family-matching prefix instead of always preserving `c64u-*`.
- Retroactively renamed the existing mirrored U64E artifacts to:
  - `docs/c64/devices/u64e/3.12a/u64e-config.yaml`
  - `docs/c64/devices/u64e/3.14a/u64e-config.yaml`
  - `docs/c64/devices/u64e/3.14d/u64e-config.yaml`
  - `docs/c64/devices/u64e/3.14e/u64e-config.yaml`
  - `docs/c64/devices/u64e/3.14e/u64e-telnet.yaml`
- Left the generic top-level outputs under `docs/c64/` unchanged:
  - `docs/c64/c64u-config.yaml`
  - `docs/c64/c64u-telnet.yaml`
