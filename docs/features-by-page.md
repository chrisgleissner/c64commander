# C64 Commander Feature Surface

## 1. Scope

This document defines the implemented UI-driven feature surface of C64 Commander.

- Source of truth: current code in `src/pages/`, `src/components/`, `src/hooks/`, and `src/lib/`.
- Scope: user-facing routes, global page-affecting surfaces, and routed auxiliary pages.
- This complements:
  - `docs/architecture.md`: runtime layers, data flow, and storage model
  - `docs/ux-interactions.md`: interaction inventory and historical coverage notes
  - `docs/code-coverage.md`: test and coverage strategy

This document favors implemented behavior over intended behavior. Where the code does not confirm behavior, the status is marked `uncertain`.

## 2. Page Inventory

| Page                 | Component                | Route                            | Responsibility                                                                                                   |
| -------------------- | ------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Home                 | `HomePage`               | `/`                              | Operational dashboard for machine control, quick config, drives, printer, SID, streams, and app config snapshots |
| Play                 | `PlayFilesPage`          | `/play`                          | Build playlists from Local/C64U/HVSC, control playback, and manage HVSC lifecycle                                |
| Disks                | `DisksPage`              | `/disks`                         | Drive control, disk library management, and mount/eject workflows                                                |
| Config               | `ConfigBrowserPage`      | `/config`                        | Browse and edit full C64U configuration categories and items                                                     |
| Settings             | `SettingsPage`           | `/settings`                      | Connection, diagnostics, app behavior, HVSC flags, and device-safety tuning                                      |
| Open Source Licenses | `OpenSourceLicensesPage` | `/settings/open-source-licenses` | Render bundled third-party notices                                                                               |
| Docs                 | `DocsPage`               | `/docs`                          | Static in-app usage guidance and external reference links                                                        |
| Coverage Probe       | `CoverageProbePage`      | `/__coverage__`                  | Test-only probe route; available only when coverage probes are enabled                                           |
| Not Found            | `NotFound`               | `*`                              | Catch-all fallback for unknown routes                                                                            |
| Music Player         | `MusicPlayerPage`        | Unrouted                         | Legacy SID/HVSC player component; not mounted by `src/App.tsx`                                                   |

## 3. Page Feature Specifications

### Home

#### Page Overview

Operational dashboard. Combines machine actions, high-value config shortcuts, per-device drive/printer/SID/stream control, and app-stored config snapshots.

#### UI Feature Inventory

| Feature                      | UI Element                                                                                        | User Action                                                    | Behavior                                                                                                                                                                 | Internal Wiring                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| View system summary          | System info strip                                                                                 | Tap card                                                       | Expands/collapses app/device/build metadata                                                                                                                              | `SystemInfo` -> `useC64Connection` + `getBuildInfo`                                                                          |
| Run machine actions          | Quick action cards: Reset, Reboot, Pause/Resume, Menu, Save RAM, Load RAM, Power Cycle, Power Off | Tap                                                            | Sends REST-backed machine controls through the shared device-control layer, serializes busy state, and shows success/error toasts                                        | `MachineControls` -> `HomePage` -> `deviceControl` / `useC64MachineControl` / `useTelnetActions` -> `c64api` + Telnet        |
| Run overflow machine actions | Quick Actions overflow menu                                                                       | Tap                                                            | Exposes secondary actions including REST keep-RAM reboot and Telnet-only Save REU                                                                                        | `HomePage` -> `MachineControls` overflow -> `deviceControl` / `useTelnetActions`                                             |
| Save/load RAM image          | `Save RAM`, `Load RAM`, `Reboot`                                                                  | Tap                                                            | Uses folder/file picker, dumps or restores full RAM image, while the visible reboot action clears RAM before rebooting via the shared REST device-control orchestration  | `MachineControls` -> `deviceControl` / `ramOperations` / `ramDumpStorage` -> machine endpoints + memory REST endpoints       |
| Select RAM dump folder       | RAM Dump Folder card                                                                              | Tap `Change Folder`                                            | Persists target SAF folder for later RAM dumps                                                                                                                           | `HomePage` -> `useHomeActions.handleSelectRamDumpFolder` -> native folder picker + `ramDumpFolderStore`                      |
| Adjust quick config          | CPU/video/joystick/LED controls                                                                   | Change slider/select/checkbox                                  | Applies config change immediately and marks app config dirty                                                                                                             | `HomePage` -> shared config actions -> `c64api.setConfigValue` / batch update -> `/v1/configs/...`                           |
| Manage home drives           | Drive cards                                                                                       | Toggle, select bus/type, tap path, reset                       | Updates drive config; C64U physical drives can mount remote images; context-aware Telnet footer actions can reset or power on individual devices and refresh device data | `DriveManager` -> shared config actions / `getC64API().mountDrive` / `useTelnetActions` -> config + drive endpoints + Telnet |
| Manage printer               | Printer card                                                                                      | Toggle, change bus/config, reset                               | Updates printer emulation settings and surfaces Telnet shortcuts such as turn on, flush/eject, and reset when available                                                  | `PrinterManager` -> shared config actions / `useTelnetActions` -> `/v1/configs/...` + Telnet                                 |
| Manage SID mixer             | SID cards                                                                                         | Toggle enablement, move sliders, change UltiSID profile, reset | Updates SID socket/address/audio mixer items; reset sends silence sequence then restores                                                                                 | `AudioMixer` -> shared config actions / `silenceSidTargets` -> config endpoints + machine writes                             |
| Manage streams               | Stream rows                                                                                       | Start/Stop/Edit endpoint                                       | Starts or stops configured UDP streams; validates endpoint edits                                                                                                         | `StreamStatus` -> `useStreamData` -> stream config writes + `/v1/streams/*`                                                  |
| Manage device/app configs    | Config action cards                                                                               | Save/load/reset flash; save/load/revert/manage app configs     | Flash actions call device; app configs persist locally and can be renamed/deleted                                                                                        | `useC64MachineControl` + `useAppConfigState` -> flash endpoints + app config store                                           |

#### Internal Wiring

- Home-wide writes are funneled through shared config actions from `ConfigActionsContext`, then through `useC64Connection` queries/mutations and `c64api`.
- Home machine actions now centralize Menu, Reboot, Reboot (Keep RAM), and Power Cycle in `src/lib/deviceControl/deviceControl.ts`; concurrent actions are blocked by page task state plus the Telnet in-flight guard for remaining Telnet-only flows.
- Drive, printer, SID, and stream widgets mix optimistic UI, query invalidation, and explicit refetches; device state and UI can diverge briefly.
- App config snapshots are local-only. Device flash save/load/reset is separate from app snapshot save/load/manage.

#### Existing Test Coverage

| Feature                                                   | Test Type         | Test File                                                                               | Coverage |
| --------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------- | -------- |
| Machine controls, streams, drive/printer/SID interactions | Playwright        | `playwright/homeInteractivity.spec.ts`                                                  | Full     |
| App config save/load/manage                               | Playwright        | `playwright/homeConfigManagement.spec.ts`                                               | Full     |
| RAM dump folder and RAM actions                           | Playwright + Unit | `playwright/homeRamDumpFolder.spec.ts`, `tests/unit/pages/HomePage.ramActions.test.tsx` | Partial  |
| Basic home rendering                                      | Playwright + Unit | `playwright/ui.spec.ts`, `tests/unit/pages/HomePage.test.tsx`                           | Partial  |
| Connection/diagnostics header surfaces used on Home       | Playwright        | `playwright/homeDiagnosticsOverlay.spec.ts`, `playwright/demoMode.spec.ts`              | Partial  |

#### Observed Risk Areas

- Machine-task serialization is page-local; external device actions can still race UI assumptions.
- RAM save/load moves full-memory images through SAF/native bridges, and snapshot restore now overlays saved ranges onto a live RAM image before a single full-memory write.
- Home mixes many independent config categories; partial fetch or invalidation lag can leave cards temporarily stale.
- Drive path/status summaries rely on both config and drive-status queries.

#### Known or Suspected Bugs

- Button active-state regressions are historically significant; guarded by `registerGlobalButtonInteractionModel` and `playwright/buttonHighlightProof.spec.ts`.
- RAM restore hard-fails on wrong image size; permission loss on saved SAF folders produces operational failures until the folder is re-selected.
- Drive/path/status cards can briefly drift from device state until explicit refetch completes.

#### Testability Assessment

| Feature Class      | Features                                                                  |
| ------------------ | ------------------------------------------------------------------------- |
| Deterministic      | System info, app-config dialogs, most quick-config selectors              |
| Timing-sensitive   | Stream start/stop feedback, machine-task busy state, drive/status refresh |
| Hardware-dependent | Machine controls, RAM operations, drive/printer/SID/stream actions        |
| State-sensitive    | Flash save/load/reset, app-config revert/load, drive/path summaries       |

#### Required Tests

| Done | Feature          | UI Element                | Test Name                      | Test Steps                                       | Test Assertions                                                |
| ---- | ---------------- | ------------------------- | ------------------------------ | ------------------------------------------------ | -------------------------------------------------------------- |
| [ ]  | Machine controls | Quick action cards        | Home machine actions serialize | Open Home; tap Pause then Resume/Reset           | Busy state gates taps; correct toast/state refresh             |
| [ ]  | RAM ops          | RAM buttons + folder card | Home RAM dump and restore      | Set folder; save RAM; load valid dump            | Folder persists; save succeeds; restore triggers expected flow |
| [ ]  | Drive/SID/stream | Drive, SID, stream cards  | Home device widgets update     | Change drive/path, SID slider, stream start/stop | Writes persist; status refreshes; errors surface               |
| [ ]  | App configs      | Config action cards       | Home app-config lifecycle      | Save snapshot; modify config; load/revert/manage | Snapshot persists locally; dirty state changes correctly       |

### Play

#### Page Overview

Playlist and playback surface. Supports Local, C64U, and HVSC sources, mixed-source playlists, transport control, duration metadata, and HVSC install/ingest status.

#### UI Feature Inventory

| Feature                         | UI Element                     | User Action                                                                         | Behavior                                                                                                 | Internal Wiring                                                                                          |
| ------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Choose source                   | Add items dialog interstitial  | Tap `Local`, `C64U`, or `HVSC`                                                      | Opens source-scoped browser; local can invoke picker and optionally auto-confirm selected root           | `ItemSelectionDialog` -> source locations from local/FTP/HVSC adapters                                   |
| Browse source scope             | Source browser                 | Root, Up, Refresh, filter, open folder, toggle item checkbox                        | Lists source entries and collects selected files/folders within source root                              | `useSourceNavigator` -> source adapter `listEntries` / `listFilesRecursive`                              |
| Import to playlist              | Add to playlist + scan overlay | Confirm selection                                                                   | Recursively enumerates files, builds playlist items, discovers songlengths files, updates playlist state | `createAddFileSelectionsHandler` -> local/HVSC runtime file builders -> playlist state                   |
| Control playback                | Transport buttons              | Play/Stop, Pause/Resume, Prev/Next                                                  | Starts runner, pauses machine, resumes, advances playlist, or stops playback                             | `usePlaybackController` -> `playbackRouter.executePlayPlan` -> REST runner endpoints and drive endpoints |
| Track progress and auto-advance | Progress bar and counters      | Observe during playback                                                             | Updates elapsed/remaining/playlist totals and advances when due time is reached                          | `PlaybackClock` + auto-advance guard + `syncPlaybackTimeline` + background execution plugin              |
| Control volume and mute         | Volume slider + mute button    | Drag or tap                                                                         | Updates enabled SID volume items; mute/unmute preserves prior values                                     | `useVolumeOverride` -> config batch writes to Audio Mixer                                                |
| Set default duration            | Duration slider/input          | Adjust                                                                              | Changes fallback duration used for songs lacking metadata                                                | `PlayFilesPage` local state -> passed into `usePlaybackController`                                       |
| Apply songlengths metadata      | Songlengths card               | Pick/change file                                                                    | Stores songlengths file, parses entries, and applies durations to matching playlist items                | `useSonglengths` -> local file/native picker -> songlength parsing                                       |
| Select SID subsong              | Subsong dialog                 | Open and pick subsong                                                               | Rebuilds request with selected `songNr` and restarts current item                                        | `PlaybackSettingsPanel` -> `handleSongSelection` -> replay through controller                            |
| Manage playlist                 | Playlist list                  | Filter by type, select all/deselect all, remove selected, clear, view all, play row | Renders grouped list with source icons and details-only item menu; no per-row edit actions               | `PlaylistPanel` + `SelectableActionList` + `usePlaylistListItems`                                        |
| Persist playlist/session        | Page lifecycle                 | Navigate/reload/background                                                          | Restores playlist and active session from repository/local/session storage                               | `usePlaybackPersistence` -> playlist repository + storage                                                |
| Manage HVSC lifecycle           | HVSC card                      | Download, Ingest, Stop, Reset status                                                | Downloads archive, extracts/indexes, surfaces progress, cancellation, and summary state                  | `useHvscLibrary` -> HVSC service/native bridge                                                           |

#### Internal Wiring

- Source import is shared across Local/C64U/HVSC via `ItemSelectionDialog` and source adapters; only the data source changes.
- Playback uses `buildPlayPlan`/`executePlayPlan`:
  - SID/MOD/PRG/CRT -> runner REST endpoints
  - disk images -> drive mount endpoints plus autostart injection or DMA first-PRG load
- Ultimate SID duration propagation is best-effort: FTP fetch + SSL upload when duration exists, otherwise direct `/v1/runners:sidplay`.
- Playback completion is duration-driven, not device-state-driven. Lock/background recovery depends on JS reconciliation plus `BackgroundExecution.setDueAtMs()` on native.
- Playlist persistence is split: item list in repository/local storage, current playback session in session storage.

#### Existing Test Coverage

| Feature                                        | Test Type                   | Test File                                                                                                                                                                                                                        | Coverage |
| ---------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Source selection, browsing, import             | Playwright + Unit           | `playwright/playback.spec.ts`, `playwright/playback.part2.spec.ts`, `playwright/itemSelection.spec.ts`, `tests/unit/components/ItemSelectionDialog.test.tsx`                                                                     | Full     |
| Transport, progress, auto-advance, persistence | Playwright + Unit + Maestro | `playwright/playback.spec.ts`, `tests/unit/playFiles/usePlaybackController.test.tsx`, `tests/unit/playFiles/usePlaybackPersistence.test.tsx`, `.maestro/edge-auto-advance-lock.yaml`, `.maestro/smoke-background-execution.yaml` | Full     |
| Volume and mute                                | Playwright + Unit + Maestro | `playwright/playback.spec.ts`, `playwright/playback.part2.spec.ts`, `tests/unit/playFiles/volumeMuteRace.test.ts`, `.maestro/edge-volume-mute-race.yaml`                                                                         | Full     |
| Playlist filtering, selection, view-all        | Playwright + Unit           | `playwright/playback.spec.ts`, `playwright/playlistControls.spec.ts`, `tests/unit/components/SelectableActionList.test.tsx`                                                                                                      | Full     |
| HVSC download/ingest/browse/failure handling   | Playwright + Unit + Maestro | `playwright/hvsc.spec.ts`, `tests/unit/playFiles/useHvscLibrary.test.tsx`, `tests/unit/hvsc/*.test.ts`, `.maestro/smoke-hvsc.yaml`, `.maestro/edge-hvsc-ingest-lifecycle.yaml`                                                   | Full     |

#### Observed Risk Areas

- Auto-advance depends on local timing and resume reconciliation; there is no authoritative runner-finished endpoint in the current REST surface.
- Mixed-source playlists can lose local file access when SAF permissions or runtime file handles expire.
- Pause/resume mutates both machine state and audio-mixer state, creating multi-request race windows.
- Volume preview writes are intentionally coalesced and rate-limited by the persisted preview interval setting to avoid request storms during fast drags.
- Disk playback mixes mount/reset/autostart behavior into playlist transitions.
- HVSC actions are long-running and stateful across app sessions.

#### Known or Suspected Bugs

- Automatic next-track behavior remains a regression hotspot; guard logic, single-flight play starts, and lock-screen watchdogs exist specifically to prevent cascades and double-skips.
- Background playback under screen lock is OEM/power-policy sensitive; mitigated by `BackgroundExecution` but not fully device-deterministic.
- Volume control and mute/unmute are regression-prone; dedicated race tests exist for slider/mute ordering and pause/resume restoration.
- HVSC download, 7z extraction, ingestion, and low-RAM failure paths are first-class failure modes with explicit test flows.
- Historical button-highlight regressions also affect playback transport and reshuffle controls.

#### Testability Assessment

| Feature Class      | Features                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| Deterministic      | Playlist filtering, view-all rendering, source chooser, songlength parsing                               |
| Timing-sensitive   | Play/stop/pause, auto-advance, lock-screen recovery, reshuffle                                           |
| Hardware-dependent | Real playback, FTP-backed C64U browsing, HVSC install/ingest on native, background execution             |
| State-sensitive    | Mixed-source playlist restore, local permission reuse, volume/mute snapshots, repeat/shuffle transitions |

#### Required Tests

| Done | Feature        | UI Element               | Test Name                       | Test Steps                                      | Test Assertions                                             |
| ---- | -------------- | ------------------------ | ------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| [ ]  | Source import  | Source chooser + browser | Play imports source items       | Open chooser; browse Local/C64U/HVSC; add items | Correct items added with source metadata                    |
| [ ]  | Transport      | Playback controls        | Play transport and auto-advance | Start item; pause/resume; wait due time         | Runner starts/stops; clock updates; next item advances once |
| [ ]  | Volume/mute    | Slider + mute button     | Play volume state restore       | Change volume; mute/unmute; pause/resume        | Prior levels restore; no race-induced drift                 |
| [ ]  | HVSC lifecycle | HVSC card                | Play HVSC install lifecycle     | Download; ingest; cancel/reset as allowed       | Progress/status updates; failure and reset paths surface    |

### Disks

#### Page Overview

Drive-management and disk-library surface. Supports physical drives A/B, Soft IEC, disk imports from Local/C64U, grouping, rotation, mount/eject, and library cleanup.

#### UI Feature Inventory

| Feature               | UI Element                         | User Action                           | Behavior                                                                                                  | Internal Wiring                                                                 |
| --------------------- | ---------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Inspect drive state   | Drive cards                        | View card/status                      | Shows enabled state, bus/type, mounted image/path, and formatted DOS status                               | `HomeDiskManager` -> `useC64Drives` + `useC64ConfigItems`                       |
| Mount/eject disk      | Drive header action, mount dialogs | Tap mount/eject, choose drive         | Mounts selected disk or clears drive                                                                      | `HomeDiskManager` -> `mountDiskToDrive` / `c64api.unmountDrive`                 |
| Power or reset drives | Drive buttons                      | Toggle power, tap reset               | Sends drive power/reset request and refreshes drive query                                                 | `HomeDiskManager` -> `c64api.driveOn/driveOff/resetDrive`                       |
| Update drive config   | Bus/type/default-path selectors    | Change value                          | Persists drive config and invalidates config/drive queries                                                | `HomeDiskManager` -> `c64api.setConfigValue`                                    |
| Add disks to library  | Add disks dialog                   | Choose Local or C64U, browse, confirm | Recursively scans selected folders/files and stores normalized `DiskEntry` records                        | `ItemSelectionDialog` -> local/FTP source adapters -> `useDiskLibrary.addDisks` |
| Filter/manage library | List, filter, select all, view all | Filter text, bulk select/remove       | Uses persisted disk library with query-backed tree/list rendering                                         | `useDiskLibrary` + `SelectableActionList`                                       |
| Edit disk metadata    | Item menu + dialogs                | Set group, rename, remove             | Updates local disk entry metadata or deletes entry; mounted disks are ejected before delete when possible | `useDiskLibrary.updateDiskGroup/updateDiskName/removeDisk`                      |
| Rotate grouped disks  | Prev/Next drive buttons            | Tap rotate                            | Mounts previous or next disk within same group                                                            | `HomeDiskManager.handleRotate` -> `handleMountDisk`                             |
| Manage Soft IEC path  | Soft IEC directory picker          | Select C64U directory                 | Updates `Default Path`; only C64U source is accepted                                                      | `HomeDiskManager` -> `handleSoftIecDirectorySelect` -> `c64api.setConfigValue`  |

#### Internal Wiring

- Disk library is local app state persisted per device id through `diskStore`; runtime `File` handles are transient.
- Mount behavior is source-dependent:
  - C64U disk -> `/v1/drives/{drive}:mount?image=...`
  - Local disk -> read blob via SAF/runtime file -> upload mount endpoint
- Drive-card state merges device query results, optimistic overrides, and disk-library metadata.
- Soft IEC is configured through config items, not through the same mount endpoints as physical drives.

#### Existing Test Coverage

| Feature                                        | Test Type  | Test File                                                                                                          | Coverage |
| ---------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| Mount/eject, rotate, grouping, library actions | Playwright | `playwright/diskManagement.spec.ts`, `playwright/navigationBoundaries.spec.ts`                                     | Full     |
| Disk import/browse failure handling            | Playwright | `playwright/diskManagement.spec.ts`                                                                                | Full     |
| Disk mount service and library persistence     | Unit       | `tests/unit/diskMount.test.ts`, `tests/unit/hooks/useDiskLibrary.test.ts`, `tests/unit/disks/diskGrouping.test.ts` | Full     |
| Disk-page render/layout                        | Playwright | `playwright/ui.spec.ts`                                                                                            | Partial  |
| Maestro/mobile disk coverage                   | Maestro    | `Status: uncertain`                                                                                                | None     |

#### Observed Risk Areas

- UI uses optimistic mounted-drive overrides; failed or delayed refetch can temporarily misstate mounted state.
- Local-disk mounting depends on SAF/runtime file availability after import.
- Multi-disk rotation depends on consistent group metadata and current mounted-disk resolution.
- Soft IEC combines config writes and drive refreshes; error handling differs from physical-drive mount flows.

#### Known or Suspected Bugs

- Disk mount synchronization can drift when optimistic mounted state and drive query state disagree.
- Removing a mounted disk is best-effort: the delete flow first ejects mounted drives, then drops the library row.
- FTP listing failures and login failures are explicit failure modes and remain operational hotspots for C64U imports.

#### Testability Assessment

| Feature Class      | Features                                                               |
| ------------------ | ---------------------------------------------------------------------- |
| Deterministic      | Library filtering, rename/group dialogs, bulk selection                |
| Timing-sensitive   | Mount/eject feedback, drive reset/power refresh, grouped rotation      |
| Hardware-dependent | Real drive mount/eject, C64U browse, Soft IEC path selection           |
| State-sensitive    | Mounted-state resolution, group rotation order, local permission reuse |

#### Required Tests

| Done | Feature        | UI Element                  | Test Name                         | Test Steps                                | Test Assertions                                     |
| ---- | -------------- | --------------------------- | --------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| [ ]  | Disk import    | Add disks dialog            | Disks import to library           | Add Local/C64U disks; confirm selection   | Entries persist with expected names/groups          |
| [ ]  | Mount/eject    | Drive cards + mount actions | Disks mount and eject             | Mount disk to drive; eject it             | Mounted state/path update; eject clears state       |
| [ ]  | Group rotation | Prev/Next buttons           | Disks rotate grouped media        | Create group; mount one; rotate next/prev | Correct sibling mounts in stable order              |
| [ ]  | Mounted delete | Item menu + remove          | Disks delete mounted entry safely | Remove mounted disk entry                 | UI attempts eject first; row removed or error shown |

### Config

#### Page Overview

Full configuration browser. Exposes all categories returned by the device and applies edits immediately.

#### UI Feature Inventory

| Feature                       | UI Element                       | User Action             | Behavior                                                           | Internal Wiring                                                  |
| ----------------------------- | -------------------------------- | ----------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Search categories             | Search input                     | Type                    | Filters category names client-side                                 | `ConfigBrowserPage` local state over `useC64Categories`          |
| Open category                 | Category accordion header        | Tap                     | Lazily fetches category payload and renders rows                   | `CategorySection` -> `useC64Category`                            |
| Edit config item              | `ConfigItemRow` controls         | Change value            | Immediately writes updated value to device                         | `useC64SetConfig` -> `c64api.setConfigValue`                     |
| Refresh category              | `Refresh` button                 | Tap                     | Re-fetches current category                                        | `CategorySection` -> `refetch()`                                 |
| Reset audio mixer             | `Reset` in Audio Mixer category  | Tap                     | Writes reset values for mixer rows                                 | `CategorySection.resetAudioMixer` -> batch config update         |
| Solo SID output               | `Solo` switch per SID volume row | Toggle                  | Temporarily mutes other SID outputs and restores prior state later | `soloReducer` + `buildSoloRoutingUpdates` -> batch config update |
| Sync clock                    | `Sync clock` in Clock Settings   | Tap                     | Writes current clock-related values to device                      | `CategorySection.handleSyncClock`                                |
| Respect DHCP read-only fields | Ethernet/WiFi rows               | View while DHCP enabled | Static IP/netmask/gateway/DNS rows become read-only                | `CategorySection` local row-state logic                          |

#### Internal Wiring

- Category list is fetched once through `useC64Categories`; individual categories are fetched only when opened.
- Standard edits use `useC64SetConfig`; audio-mixer multi-row changes use `useC64UpdateConfigBatch`.
- Audio-mixer solo stores a session snapshot in `sessionStorage` and attempts restoration on unmount/re-entry.
- Config changes mark app-config dirty state through `updateHasChanges(runtimeBaseUrl, true)`.

#### Existing Test Coverage

| Feature                                      | Test Type         | Test File                                                              | Coverage |
| -------------------------------------------- | ----------------- | ---------------------------------------------------------------------- | -------- |
| Category rendering and config widget editing | Playwright + Unit | `playwright/ui.spec.ts`, `tests/unit/pages/ConfigBrowserPage.test.tsx` | Full     |
| Editing regressions                          | Playwright        | `playwright/configEditingBehavior.spec.ts`                             | Full     |
| Audio mixer solo                             | Playwright + Unit | `playwright/solo.spec.ts`, `tests/unit/audioMixerSolo.test.ts`         | Full     |
| Clock/audio mixer group actions              | Playwright        | `playwright/ui.spec.ts`, `playwright/navigationBoundaries.spec.ts`     | Partial  |

#### Observed Risk Areas

- Each edit writes immediately; there is no page-level transaction or batch save for general config edits.
- Category contents are device-driven and heterogeneous, so row widget behavior depends on device payload shape.
- Audio-mixer solo performs multiple writes and state restoration across navigation.

#### Known or Suspected Bugs

- No confirmed active defect from code inspection.
- Historical documentation terminology about generic “reset category” is broader than the current implementation; current UI exposes category-level actions only for Audio Mixer and Clock Settings.

#### Testability Assessment

| Feature Class      | Features                                                   |
| ------------------ | ---------------------------------------------------------- |
| Deterministic      | Category search, category open/close, DHCP read-only rules |
| Timing-sensitive   | Audio-mixer solo restore, refresh-after-write behavior     |
| Hardware-dependent | All actual config writes and clock sync                    |
| State-sensitive    | Dirty-state marking, audio-mixer solo snapshot/restore     |

#### Required Tests

| Done | Feature             | UI Element                | Test Name                  | Test Steps                                | Test Assertions                                      |
| ---- | ------------------- | ------------------------- | -------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| [ ]  | Category browse     | Search + accordion        | Config search and open     | Search category; open matching section    | Filter is client-side; opened rows render correctly  |
| [ ]  | Config write        | Config row control        | Config immediate write     | Change select/slider/checkbox/text value  | Device write fires once; UI reflects persisted value |
| [ ]  | Audio mixer actions | Solo switch + Reset       | Config audio mixer actions | Solo one SID; unsolo; reset mixer         | Other channels mute/restore; reset applies defaults  |
| [ ]  | Clock/DHCP rules    | Clock sync + network rows | Config special-case rules  | Tap clock sync; inspect DHCP-enabled rows | Sync writes occur; static IP rows remain read-only   |

### Settings

#### Page Overview

App-level control plane. Configures connection, diagnostics, UI theme, preference persistence, feature flags, and device-safety behavior.

#### UI Feature Inventory

| Feature                                  | UI Element                                         | User Action                      | Behavior                                                                                                                                | Internal Wiring                                                                                        |
| ---------------------------------------- | -------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Switch theme                             | Appearance card                                    | Tap Light/Dark/System            | Updates theme immediately                                                                                                               | `SettingsPage` -> `ThemeProvider.setTheme`                                                             |
| Save connection                          | Host/password inputs + `Save & Connect`            | Edit and tap                     | Persists host/password, updates API runtime config, runs discovery, shows result toast                                                  | `useC64Connection.updateConfig` -> secure storage/runtime config -> `discoverConnection("settings")`   |
| Retry discovery                          | Refresh button                                     | Tap                              | Re-runs device discovery without changing stored config                                                                                 | `discoverConnection("manual")`                                                                         |
| Toggle automatic demo mode               | Checkboxes in Connection and Config cards          | Toggle                           | Persists whether demo mode is offered automatically when probes fail                                                                    | `saveAutomaticDemoModeEnabled`                                                                         |
| Open diagnostics                         | `Diagnostics` button or app-bar activity indicator | Tap                              | Opens diagnostics dialog on requested tab                                                                                               | diagnostics overlay store + dialog state                                                               |
| Filter/share/clear diagnostics           | Diagnostics dialog                                 | Type, share, clear               | Filters logs/traces/actions/errors, exports a timestamped per-tab ZIP or Share All bundle, or clears local stores                       | `getLogs/getTraceEvents` + `shareDiagnosticsZip/shareAllDiagnosticsZip` + `clearLogs/clearTraceEvents` |
| Enable debug logging and SAF diagnostics | Diagnostics section                                | Toggle or tap tools              | Persists debug logging; on Android can enumerate persisted SAF URIs                                                                     | app settings + native folder picker diagnostics                                                        |
| Transfer settings                        | Export/Import buttons                              | Tap or choose file               | Exports or imports non-sensitive settings JSON                                                                                          | `settingsTransfer.exportSettingsJson/importSettingsJson`                                               |
| Tune play/disk prefs                     | List preview limit, disk autostart mode            | Edit/select                      | Persists list preview limit and disk DMA vs KERNAL autostart preference                                                                 | `useListPreviewLimit` + `saveDiskAutostartMode`                                                        |
| Toggle HVSC feature flag                 | HVSC checkbox                                      | Toggle                           | Shows or hides HVSC controls on Play page                                                                                               | feature-flag storage + context                                                                         |
| Override HVSC base URL                   | Developer-only input                               | Edit                             | Persists alternate HVSC mirror base URL                                                                                                 | `setHvscBaseUrlOverride`                                                                               |
| Tune device safety                       | Safety mode select + advanced fields               | Change mode or numeric overrides | Persists FTP pacing/cache/backoff/circuit-breaker limits; REST mutation scheduling stays internal; relaxed mode requires confirm dialog | `deviceSafetySettings` store                                                                           |
| Enable developer mode                    | About card                                         | Tap 7 times in 3s                | Enables developer-only controls                                                                                                         | `developerModeStore`                                                                                   |
| Open licenses                            | About card button                                  | Tap                              | Navigates to bundled notices route                                                                                                      | `navigate("/settings/open-source-licenses")`                                                           |

#### Internal Wiring

- Connection settings update both persistent config and in-memory API runtime config; discovery is then delegated to `connectionManager`.
- Diagnostics dialog is local-app data only: logs, traces, and action summaries come from structured logging and tracing stores.
- Most settings are local persistence only (`localStorage`, `sessionStorage`, secure storage); they do not touch the C64U until another page uses them.
- Device safety settings directly affect request throttling, FTP concurrency, cooldown, and retry behavior used across REST/FTP flows.
- The `Automatic Demo Mode` control is intentionally duplicated in two sections and writes the same persisted setting.

#### Existing Test Coverage

| Feature                                         | Test Type            | Test File                                                                                                                                                                          | Coverage |
| ----------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Connection save/theme/mock/demo behavior        | Playwright + Unit    | `playwright/settingsConnection.spec.ts`, `playwright/demoMode.spec.ts`, `tests/unit/pages/SettingsPage.test.tsx`                                                                   | Full     |
| Diagnostics dialog/share/clear                  | Playwright + Maestro | `playwright/settingsDiagnostics.spec.ts`, `playwright/homeDiagnosticsOverlay.spec.ts`, `.maestro/ios-diagnostics-export.yaml`                                                      | Full     |
| HVSC feature flag                               | Playwright + Unit    | `playwright/featureFlags.spec.ts`, `tests/unit/config/featureFlags.test.ts`                                                                                                        | Full     |
| Settings transfer and safety/config persistence | Unit + Maestro       | `tests/unit/config/settingsTransfer.test.ts`, `tests/unit/config/deviceSafetySettings.test.ts`, `.maestro/ios-config-persistence.yaml`, `.maestro/ios-secure-storage-persist.yaml` | Partial  |

#### Observed Risk Areas

- Connection save success depends on follow-up discovery, not just persistence.
- Diagnostics export depends on platform share/filesystem capabilities.
- Device-safety overrides can materially change request behavior across the whole app.
- Duplicate Automatic Demo Mode controls can create UX confusion even though they share storage.

#### Known or Suspected Bugs

- No confirmed active defect from code inspection.
- Relaxed safety mode is intentionally high-risk and guarded by confirmation; misuse can destabilize hardware interactions.
- HVSC base URL override is invisible until developer mode is enabled; this is an implementation constraint, not a runtime defect.

#### Testability Assessment

| Feature Class      | Features                                                                  |
| ------------------ | ------------------------------------------------------------------------- |
| Deterministic      | Theme switch, most local preference edits, About/developer tap            |
| Timing-sensitive   | Save & Connect, diagnostics activity badges, settings import side effects |
| Hardware-dependent | Discovery/probe outcomes, SAF diagnostics on Android                      |
| State-sensitive    | Demo mode, feature flags, device-safety overrides, imported settings      |

#### Required Tests

| Done | Feature           | UI Element                     | Test Name                      | Test Steps                                           | Test Assertions                                             |
| ---- | ----------------- | ------------------------------ | ------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------- |
| [ ]  | Connection save   | Host/password + Save & Connect | Settings save and discover     | Edit creds; save/connect; retry discovery            | Config persists; runtime target updates; result toast shown |
| [ ]  | Diagnostics       | Diagnostics dialog             | Settings diagnostics lifecycle | Open dialog; filter; export/share; clear             | Filter works; export triggers; stores clear                 |
| [ ]  | Local persistence | Transfer + flags + theme       | Settings persistence controls  | Toggle theme/HVSC/demo; export/import settings       | Values persist; imports apply expected fields               |
| [ ]  | Safety mode       | Safety controls                | Settings relaxed mode confirm  | Choose Relaxed; confirm/cancel; edit advanced fields | Confirm gate appears; values persist only after accept      |

### Docs

#### Page Overview

Static usage guide implemented as hardcoded accordion sections plus external reference links.

#### UI Feature Inventory

| Feature                 | UI Element          | User Action        | Behavior                                                    | Internal Wiring                             |
| ----------------------- | ------------------- | ------------------ | ----------------------------------------------------------- | ------------------------------------------- |
| Read in-app guides      | Accordion cards     | Tap section header | Expands/collapses static copy for setup and workflow topics | `DocsPage` local `isOpen` state per section |
| Open external resources | External links card | Tap link           | Opens external documentation in new tab/window              | plain anchor tags                           |

#### Internal Wiring

- Content is static JSX in `DocsPage`; it is not generated from live feature state.
- External links are direct `target="_blank"` anchors.

#### Existing Test Coverage

| Feature                            | Test Type  | Test File                          | Coverage |
| ---------------------------------- | ---------- | ---------------------------------- | -------- |
| Page render and basic availability | Playwright | `playwright/ui.spec.ts`            | Partial  |
| Route accessibility                | Playwright | `playwright/accessibility.spec.ts` | Partial  |

#### Observed Risk Areas

- Docs can drift from implemented behavior because the page is static.
- External links are outside app control.

#### Known or Suspected Bugs

- Documentation drift is a standing risk; this page is not implementation-bound.

#### Testability Assessment

| Feature Class      | Features                                      |
| ------------------ | --------------------------------------------- |
| Deterministic      | Accordion expansion, static content rendering |
| Timing-sensitive   | None significant                              |
| Hardware-dependent | None                                          |
| State-sensitive    | None significant                              |

#### Required Tests

| Done | Feature       | UI Element          | Test Name               | Test Steps              | Test Assertions                                |
| ---- | ------------- | ------------------- | ----------------------- | ----------------------- | ---------------------------------------------- |
| [ ]  | Static guides | Accordion cards     | Docs accordion behavior | Open/close each section | Copy renders; toggle state behaves predictably |
| [ ]  | External refs | External links card | Docs external links     | Tap each external link  | Correct target URLs/open behavior              |

### Open Source Licenses

#### Page Overview

Bundled notices viewer for `THIRD_PARTY_NOTICES.md`.

#### UI Feature Inventory

| Feature              | UI Element                   | User Action | Behavior                                                                     | Internal Wiring                                                                        |
| -------------------- | ---------------------------- | ----------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Load bundled notices | Full-screen licenses overlay | Open route  | Fetches bundled markdown and parses headings, lists, and markdown-table rows | `OpenSourceLicensesPage` -> `fetch(BASE_URL + THIRD_PARTY_NOTICES.md)` -> local parser |
| Close licenses view  | Close button                 | Tap         | Returns to Settings                                                          | `navigate("/settings")`                                                                |

#### Internal Wiring

- Fetch is client-side and uncached (`cache: "no-store"`).
- Parser is custom; it supports headings, paragraphs, lists, and simple markdown tables.

#### Existing Test Coverage

| Feature            | Test Type  | Test File           | Coverage |
| ------------------ | ---------- | ------------------- | -------- |
| Route availability | Playwright | `Status: uncertain` | None     |

#### Observed Risk Areas

- Fetch or parse failures surface a plain error message rather than a structured fallback UI.
- Large notice files rely on custom markdown parsing rather than a mature renderer.

#### Known or Suspected Bugs

- Status: uncertain.

#### Testability Assessment

| Feature Class      | Features                     |
| ------------------ | ---------------------------- |
| Deterministic      | Overlay render, close action |
| Timing-sensitive   | Initial fetch                |
| Hardware-dependent | None                         |
| State-sensitive    | None significant             |

#### Required Tests

| Done | Feature       | UI Element       | Test Name                          | Test Steps               | Test Assertions                                |
| ---- | ------------- | ---------------- | ---------------------------------- | ------------------------ | ---------------------------------------------- |
| [ ]  | Notice render | Licenses overlay | Licenses page loads notices        | Open route from Settings | Markdown content renders headings/lists/tables |
| [ ]  | Close flow    | Close button     | Licenses close returns to Settings | Tap Close                | Navigates back to Settings route               |

### Coverage Probe

#### Page Overview

Test-only route. Not part of production user workflows.

#### UI Feature Inventory

| Feature             | UI Element      | User Action | Behavior                                                                           | Internal Wiring                                   |
| ------------------- | --------------- | ----------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| Run internal probes | Probe page body | Open route  | Exercises API, playback, HVSC, feature-flag, and sid-player internals for coverage | `CoverageProbePage` -> direct service invocations |

#### Internal Wiring

- Route is only mounted when coverage probes are enabled.
- Uses direct service calls; it is not representative of normal user interaction flow.

#### Existing Test Coverage

| Feature     | Test Type  | Test File                           | Coverage |
| ----------- | ---------- | ----------------------------------- | -------- |
| Probe route | Playwright | `playwright/coverageProbes.spec.ts` | Full     |

#### Observed Risk Areas

- Not a product feature.

#### Known or Suspected Bugs

- Status: uncertain for production relevance.

#### Testability Assessment

| Feature Class      | Features                                 |
| ------------------ | ---------------------------------------- |
| Deterministic      | Probe execution                          |
| Timing-sensitive   | None significant                         |
| Hardware-dependent | Optional, depending on probe environment |
| State-sensitive    | Low                                      |

#### Required Tests

| Done | Feature     | UI Element      | Test Name                     | Test Steps                          | Test Assertions                               |
| ---- | ----------- | --------------- | ----------------------------- | ----------------------------------- | --------------------------------------------- |
| [ ]  | Probe route | Probe page body | Coverage probe route executes | Enable probes; open `/__coverage__` | Probe calls run without blocking route render |

### Not Found

#### Page Overview

Fallback route for unknown paths.

#### UI Feature Inventory

| Feature           | UI Element | User Action               | Behavior                                                                   | Internal Wiring            |
| ----------------- | ---------- | ------------------------- | -------------------------------------------------------------------------- | -------------------------- |
| Show 404 fallback | 404 page   | Navigate to unknown route | Shows not-found copy and home link; logs console error with attempted path | `NotFound` + `useLocation` |

#### Internal Wiring

- No app-state dependencies.

#### Existing Test Coverage

| Feature               | Test Type  | Test File                         | Coverage |
| --------------------- | ---------- | --------------------------------- | -------- |
| Legacy route fallback | Playwright | `playwright/featureFlags.spec.ts` | Partial  |

#### Observed Risk Areas

- None significant.

#### Known or Suspected Bugs

- None identified.

#### Testability Assessment

| Feature Class      | Features    |
| ------------------ | ----------- |
| Deterministic      | Entire page |
| Timing-sensitive   | None        |
| Hardware-dependent | None        |
| State-sensitive    | None        |

#### Required Tests

| Done | Feature      | UI Element                 | Test Name              | Test Steps                         | Test Assertions                       |
| ---- | ------------ | -------------------------- | ---------------------- | ---------------------------------- | ------------------------------------- |
| [ ]  | 404 fallback | Not-found page + home link | Unknown route fallback | Navigate to unknown path; tap Home | 404 copy renders; link returns to `/` |

### Music Player

#### Page Overview

Legacy SID/HVSC player component.

Status: uncertain for active product relevance; `MusicPlayerPage.tsx` exists but is not routed by `src/App.tsx`.

#### UI Feature Inventory

| Feature                      | UI Element                  | User Action         | Behavior                                                                                      | Internal Wiring                                                         |
| ---------------------------- | --------------------------- | ------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Legacy SID/HVSC/local player | Tabs and transport controls | `Status: uncertain` | Component includes standalone SID queue, HVSC install/browse, and local folder browsing logic | `MusicPlayerPage` -> `useSidPlayer` + legacy HVSC/local source services |

#### Internal Wiring

- Separate from the routed Play page.
- Uses older SID-player-specific flows, not the current playlist/playback architecture.

#### Existing Test Coverage

| Feature             | Test Type  | Test File                        | Coverage |
| ------------------- | ---------- | -------------------------------- | -------- |
| Legacy player route | Playwright | `playwright/musicPlayer.spec.ts` | Partial  |

#### Observed Risk Areas

- Architectural drift versus the routed Play page.

#### Known or Suspected Bugs

- Status: uncertain because the page is currently unrouted.

#### Testability Assessment

| Feature Class      | Features                          |
| ------------------ | --------------------------------- |
| Deterministic      | None confirmed                    |
| Timing-sensitive   | Playback/HVSC flows if re-enabled |
| Hardware-dependent | Playback and HVSC                 |
| State-sensitive    | High if re-routed                 |

#### Required Tests

| Done | Feature       | UI Element             | Test Name                     | Test Steps                           | Test Assertions                                         |
| ---- | ------------- | ---------------------- | ----------------------------- | ------------------------------------ | ------------------------------------------------------- |
| [ ]  | Route absence | App routing            | Music Player remains unrouted | Start app; inspect registered routes | No navigation path exposes `MusicPlayerPage`            |
| [ ]  | Legacy smoke  | Legacy tabs + controls | Music Player standalone smoke | Mount component in isolated harness  | Status: uncertain; legacy controls render without crash |

## 4. Cross-Page Behavior

| Behavior                                       | Pages                                               | Implementation                                                                                                                         | Primary Risk                                                                            |
| ---------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Connection lifecycle                           | All routed pages                                    | Global `ConnectionController` initializes discovery, reacts to saved settings, and schedules background rediscovery while demo/offline | State drift between persisted settings, runtime API target, and visible indicator state |
| Global app bar diagnostics/connection surfaces | All routed pages except overlay-style licenses page | `AppBar` hosts `DiagnosticsActivityIndicator` and `ConnectivityIndicator`; both can open diagnostics flows globally                    | Cross-page state confusion when diagnostics overlay is already active                   |
| Playlist lifecycle                             | Play, Settings                                      | Playlist/session persist across navigation; Settings can alter preview limits, HVSC flag, and disk autostart mode used by Play         | Mixed-source permission loss and stale playback session restore                         |
| Disk mounting vs playback                      | Play, Disks, Home                                   | Play can mount disk images as playback targets; Disks/Home can mount/eject/manage drives directly                                      | Drive state drift and autostart timing                                                  |
| Configuration application                      | Home, Config, Settings                              | Home and Config both write config immediately; Home app-config snapshots persist locally; Settings changes app-wide local behavior     | Dirty-state ambiguity between device config, flash, and app snapshots                   |
| Connection troubleshooting                     | Settings, Home app bar, Docs                        | Settings saves connection; app bar exposes retry/diagnostics; Docs explains workflow                                                   | Static docs can diverge from actual settings flow                                       |
| HVSC lifecycle                                 | Play, Settings                                      | Settings toggles HVSC availability and mirror override; Play performs download/ingest/browse                                           | Long-running install state and mirror/config mistakes                                   |

## 5. Interaction With The C64 Ultimate

| Area                 | Mechanism                                                                                                                                                                 | Implemented Operations                                                                    | Inconsistency Windows                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Device discovery     | REST probe to `/v1/info` plus connection manager state                                                                                                                    | startup/manual/settings/background discovery                                              | Probe result can lag stored host/password changes                             |
| Config               | REST `/v1/configs`, `/v1/configs/{category}`, `/v1/configs/{category}/{item}`, `/v1/configs:save_to_flash`, `/v1/configs:load_from_flash`, `/v1/configs:reset_to_default` | fetch categories/items, set values, save/load/reset flash                                 | UI writes are immediate; flash persistence is separate                        |
| Machine control      | REST `/v1/machine:*`                                                                                                                                                      | reset, reboot, pause, resume, power off, menu button, memory read/write                   | Machine state is inferred; no full machine-state subscription                 |
| Drives               | REST `/v1/drives`, `/v1/drives/{drive}:mount`, `:remove`, `:reset`, `:on`, `:off`                                                                                         | mount/eject/reset/power and drive inspection                                              | Mounted-state optimistic overrides can diverge until refetch                  |
| Playback runners     | REST `/v1/runners:*`                                                                                                                                                      | SID, MOD, PRG, CRT start operations                                                       | No authoritative completion endpoint for auto-advance                         |
| Streams              | REST `/v1/streams/{stream}:start`, `:stop`                                                                                                                                | start/stop configured UDP stream targets                                                  | Stream status is request/result based, not device-pushed                      |
| FTP                  | FTP bridge/client                                                                                                                                                         | C64U file browsing, recursive listing, remote SID blob fetch for MD5/duration propagation | Network latency, auth failures, and stale directory listings                  |
| Local/native bridges | SAF/folder picker/background execution/secure storage                                                                                                                     | local file import, persistent folder access, screen-lock watchdog, password storage       | Permission revocation, native bridge availability, platform-specific behavior |

Synchronization notes:

- Drive/path/playback state is partially inferred from prior successful operations and refetches.
- Demo mode is a first-class runtime state; some UI surfaces intentionally continue to operate against mock services.
- Local playlist items persist longer than local file permissions; the UI can restore an unavailable item record.

## 6. Test Infrastructure Mapping

| Feature Area                                 | Unit        | Playwright | Maestro | MCP-Based Agentic Fit                                                                   |
| -------------------------------------------- | ----------- | ---------- | ------- | --------------------------------------------------------------------------------------- |
| Home controls and config snapshots           | Strong      | Strong     | Partial | Good for real-hardware validation of machine/reset/stream/device effects                |
| Play import and playlist management          | Strong      | Strong     | Strong  | Very strong; combines UI, files, and observable audio/video outcomes                    |
| Playback timing and lock/background behavior | Strong      | Strong     | Strong  | Best validated with DroidMind + C64 Scope on real devices                               |
| Disk library and drive mount sync            | Strong      | Strong     | Weak    | Good for DroidMind + C64 Bridge when UI mount fails or needs recovery                   |
| Config editing and audio-mixer solo          | Strong      | Strong     | Weak    | Good for deterministic UI/state exploration; hardware needed for real effect validation |
| Settings, diagnostics, and persistence       | Strong      | Strong     | Strong  | Good for cross-session/stateful exploration                                             |
| HVSC lifecycle                               | Very strong | Strong     | Strong  | Best candidate for long-running agentic hardware workflows                              |

Notes:

- Unit tests cover service logic, persistence, parsing, and many page hooks.
- Playwright is the main authoritative UI regression layer for routed page behavior.
- Maestro covers native/mobile-specific paths: picker behavior, playback basics, diagnostics export, lock/background flows, and HVSC smoke.
- Contract tests validate REST/FTP assumptions but are not page-centric.

Features especially suitable for LLM-driven exploratory testing:

- Playback auto-advance under lock/background
- Mixed-source playlist restore after permission churn
- Disk mount/eject synchronization across Home, Disks, and Play
- HVSC install/ingest/update/cancel/retry on constrained devices
- Connection churn between real device, offline, and demo mode

## 7. High-Risk Behavior Map

| Priority | Feature                              | Why Risk Is High                                                                                                 | Evidence in Code/Test Surface                                                                                            |
| -------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1        | Background playback and auto-advance | Completion is duration-driven and reconciled across timers, visibility events, and native watchdog callbacks     | `usePlaybackController`, `usePlaybackPersistence`, `playwright/playback.spec.ts`, `.maestro/edge-auto-advance-lock.yaml` |
| 2        | Playlist transitions                 | Mixed-source items, disk reboots, single-flight play starts, and repeat/shuffle state interact                   | `playbackRouter`, `usePlaybackController`, `playwright/playback.spec.ts`                                                 |
| 3        | Volume handling and mute/unmute      | Multiple config writes, pause-mute snapshots, and slider/mute race conditions                                    | `useVolumeOverride`, `usePlaybackController`, `tests/unit/playFiles/volumeMuteRace.test.ts`                              |
| 4        | Device connection lifecycle          | Stored host/password, runtime target, discovery scheduling, demo mode, and indicator UI all interact             | `connectionManager`, `ConnectionController`, `demoMode.spec.ts`                                                          |
| 5        | HVSC ingestion                       | Long-running download/extract/index phases, native bridge availability, 7z extraction, and low-memory conditions | `useHvscLibrary`, `hvsc/*.test.ts`, `playwright/hvsc.spec.ts`, `.maestro/smoke-hvsc-lowram.yaml`                         |
| 6        | Disk mount synchronization           | Mount/eject state spans library state, optimistic overrides, drive queries, and playback side effects            | `HomeDiskManager`, `diskMount.ts`, `playwright/diskManagement.spec.ts`                                                   |

## 8. LLM Exploration Guidance

| Need                        | Guidance                                                                                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-only validation          | Use routed pages, tab bar, dialogs, list filtering, diagnostics dialog, and static Docs/Open Source Licenses pages                                                                                                               |
| Requires hardware           | Machine controls, real playback, disk mount/eject, stream start/stop, config writes with observable device effect, and non-demo connection flows                                                                                 |
| Requires DroidMind          | Lock/unlock, backgrounding, picker interactions, repeated taps, scrolls, and device-level state setup on Android                                                                                                                 |
| Requires C64 Bridge         | Direct device recovery, alternate mount/play operations when the UI path is blocked, and validation of device-side state independent of UI                                                                                       |
| Best use of C64 Scope       | Playback start/stop verification, auto-advance confirmation, stream output checks, and visual confirmation that mounted/autostarted content reached the device                                                                   |
| Good first exploration path | `Settings -> save/connect`, `Play -> import local/C64U item -> play -> lock/unlock`, `Disks -> mount/eject/rotate`, `Play -> HVSC lifecycle`, `Home -> machine/stream/SID controls`                                              |
| Caution points              | Prefer real-device mode over demo when validating hardware outcomes; treat Local-source persistence as revocable; treat auto-advance and HVSC flows as timing-sensitive; mark unrouted `MusicPlayerPage` behavior as `uncertain` |
