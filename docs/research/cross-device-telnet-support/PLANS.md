# Plan

## Classification

- `DOC_PLUS_CODE`

## Objective

Capture live U64 3.14e Telnet/config evidence, produce a research-backed implementation prompt for cross-device Telnet support across C64U and U64-class devices, and harden the extraction tooling so device family and firmware version are derived from live `/v1/info` metadata instead of hard-coded output paths.

## Impact Map

- Documentation:
  - `docs/research/cross-device-telnet-support/PLANS.md`
  - `docs/research/cross-device-telnet-support/WORKLOG.md`
  - `docs/research/cross-device-telnet-support/prompt.md`
  - `docs/c64/devices/u64e/3.14e/c64u-config.yaml`
  - `docs/c64/devices/u64e/3.14e/c64u-telnet.yaml`
- Code and tooling:
  - `build`
  - `scripts/dump_c64u_config.py`
  - `scripts/dump_c64_telnet_screens.py`
  - `scripts/test_dump_c64u_config.py`
  - `scripts/test_dump_c64_telnet_screens.py`
- Read-only analysis targets:
  - `README.md`
  - `.github/copilot-instructions.md`
  - `docs/ux-guidelines.md`
  - `docs/c64/c64u-telnet.yaml`
  - `docs/c64/devices/c64u/1.1.0/c64u-telnet.yaml`
  - `src/lib/telnet/telnetTypes.ts`
  - `src/lib/telnet/telnetMenuNavigator.ts`
  - `src/lib/telnet/telnetScreenParser.ts`
  - `src/hooks/useTelnetActions.ts`
  - `src/pages/HomePage.tsx`
  - `src/pages/home/components/MachineControls.tsx`
  - `src/pages/home/components/DriveManager.tsx`
  - `src/pages/home/components/PrinterManager.tsx`

## Findings

- Live device probe confirmed:
  - `http://u64/v1/info` -> `Ultimate 64 Elite`, firmware `3.14e`
  - `http://c64u/v1/info` -> `C64 Ultimate`, firmware `1.1.0`
- Extraction-tool follow-up:
  - the initial scrape workflow mistakenly mirrored one config extract under `docs/c64/devices/c64u/3.14e/...`
  - the extraction toolchain now derives both `firmware_version` and `device_family` from live `/v1/info` metadata
  - default mirror paths now target `docs/c64/devices/{device_family}/{firmware_version}/...`
- Added live U64 config snapshot:
  - `docs/c64/devices/u64e/3.14e/c64u-config.yaml`
- Added live U64 Telnet snapshot:
  - `docs/c64/devices/u64e/3.14e/c64u-telnet.yaml`
- The current Telnet dump script captured U64 file-entry menus correctly, but did not fully expand U64 `F5` action submenus or the selected-directory `F5` menu.
- Direct live U64 Telnet probing confirmed:
  - top-level `F5` items are `Assembly 64`, `C64 Machine`, `Built-in Drive A`, `Built-in Drive B`, `Software IEC`, `Printer`, `Configuration`, `Streams`, `Developer`
  - `C64 Machine` includes `Reset C64`, `Reboot C64`, `Reboot (Clr Mem)`, `Power OFF`, `Save C64 Memory`, `Save REU Memory`, `Save MP3 Drv B`
  - `Power Cycle` is absent on U64 3.14e
  - Drive A/B, Software IEC, Printer, and Configuration submenus match the app's current Telnet action families
  - `Developer` includes `Clear Debug Log`, `Save Debug Log`, `Save EDID to file`, and `Debug Stream`
- Current app gaps:
  - `src/lib/telnet/telnetTypes.ts` hard-codes C64U-centric action paths such as `Power & Reset`
  - `src/hooks/useTelnetActions.ts` exposes only boolean availability, not per-action support
  - `MachineControls`, `DriveManager`, and `PrinterManager` hide unsupported Telnet controls instead of rendering visibly disabled controls
  - `src/lib/telnet/telnetScreenParser.ts` and the dump script both need better handling for overlapping nested menu boxes on U64

## Task Breakdown

- [x] Read repository guidance and classify the task correctly
- [x] Inspect existing Telnet docs, dump scripts, parser, and UI wiring
- [x] Probe `u64` and `c64u` over REST
- [x] Dump live U64 3.14e config snapshot
- [x] Dump live U64 3.14e Telnet snapshot
- [x] Probe live U64 Telnet submenus to confirm app-relevant capability differences
- [x] Harden the extract tools so firmware and device family come from live `/v1/info`
- [x] Produce folder-local plan and work log
- [x] Write the implementation prompt in `docs/research/cross-device-telnet-support/prompt.md`

## Validation

- Targeted tool validation:
  - `python3 -m unittest scripts/test_dump_c64u_config.py scripts/test_dump_c64_telnet_screens.py`
- Repository coverage run started because the follow-up introduced executable changes:
  - `npm run test:coverage`
- No screenshot refresh was needed because no visible UI changed

## Completion Tracking

- [x] Local planning docs exist for this research track
- [x] U64 3.14e config snapshot exists
- [x] U64 3.14e Telnet snapshot exists
- [x] Prompt captures verified U64 differences and current code gaps
- [x] Extractor defaults no longer assume `c64u`
