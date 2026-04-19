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
- Dumped live U64 config to `docs/c64/devices/u64e/3.14e/c64u-config.yaml`.

### Telnet scrape work

- Initial U64 Telnet scrape failed because the script only searched `/USB0/test-data` and `/USB1/test-data`.
- FTP inspection showed this U64 exposes test fixtures at `/USB2/test-data`.
- Re-ran the Telnet scrape successfully against `/USB2/test-data`.
- The scrape still left two important holes:
  - U64 initial `F5` action submenus were not expanded into the YAML
  - U64 selected-directory `F5` action menu was captured as empty
- Added `docs/c64/devices/u64e/3.14e/c64u-telnet.yaml` with the current script output so the gap is explicit and reproducible.

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
