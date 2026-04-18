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
