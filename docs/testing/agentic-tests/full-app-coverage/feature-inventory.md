# Feature Inventory

Derived from:

- `README.md`
- `src/App.tsx`
- `src/components/TabBar.tsx`
- `src/pages/**`
- `src/components/disks/HomeDiskManager.tsx`
- `src/pages/playFiles/components/**`
- `src/pages/ConfigBrowserPage.tsx`
- `src/pages/SettingsPage.tsx`
- `doc/testing/agentic-tests/**`

| Feature ID | Feature Name | Screen / Flow Location | Why Key | User-Visible Outcome | Backend / Device Interaction | Observability Options | Current Testability Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F001 | App shell launch + foreground | `/` app start | Entry path for every journey | App launches and stays foreground | Android app lifecycle | app screenshot, app MP4, foreground check, session timeline | PASS (app-first evidence run available) |
| F002 | Tab navigation across routes | `TabBar` (`/`, `/play`, `/disks`, `/config`, `/settings`, `/docs`) | All major areas depend on deterministic navigation | Tab taps switch visible page context | Router state + view rendering | tab screenshots, route-specific UI assertions, diagnostics traces | PASS |
| F003 | Home machine controls | `HomePage` machine actions | Directly mutates C64 machine state | Reset/reboot/pause/menu/power actions execute correctly | REST machine-control endpoints | home UI state, REST state refs, diagnostics/action traces | PASS |
| F004 | Home quick config + LED/SID | `HomePage` quick-config + LED section | High-frequency controls for runtime behavior | Config controls change values and persist on device | REST config update/read | UI control states, config snapshots, action traces | PASS |
| F005 | Home RAM workflows | `HomePage` RAM dump/load/clear | Stateful and destructive recovery path | RAM saved/loaded/cleared with chosen folder | RAM + filesystem + reboot interaction | filesystem artifact, UI toasts, logs, C64 state ref | PASS |
| F006 | Home app config snapshots | `HomePage` save/load/manage dialogs | Key persistence feature for user presets | Save/load/rename/delete app config entries | local app storage persistence | dialog UI + stored entries + diagnostics | PASS |
| F007 | Disks library management | `DisksPage` + `HomeDiskManager` | Core media curation path | Add/group/rename/delete disk entries | local library + source browsing | disk list UI, item counts, persistent store evidence | PASS |
| F008 | Disk mount/eject | `DisksPage` drive rows and disk actions | Changes C64 drive state | Mounted image updates drive A/B status | REST drive mount APIs | drive UI state, `/v1/drives`, DOS status text | PASS |
| F009 | Drive + Soft IEC controls | `HomeDiskManager` drive config + soft IEC rows | Device behavior and compatibility | Bus/type/power/reset/default-path controls apply | Drive config + Soft IEC settings | UI selectors (`drive-*` test IDs), config snapshots, logs | PASS |
| F010 | Play source browsing | `PlayFilesPage` add-items source chooser | Required for building playlists from all sources | Local/C64U/HVSC source trees browse correctly | local FS + FTP + HVSC bridge | source list UI, selected item metadata, trace logs | PASS |
| F011 | Playlist lifecycle | `PlaylistPanel` + add-items flow | Primary user workflow in Play | Items can be added, selected, removed, cleared | playlist repository + local persistence | playlist UI (`playlist-list`, `playlist-item`), action traces | PASS |
| F012 | Playback transport | `PlaybackControlsCard` | Core playback correctness | play/pause/stop/next/prev works, queue advances | play router + C64 execution | transport UI + counters + C64 audio/video + logs | PASS |
| F013 | Queue and volume controls | `PlaybackControlsCard` + `VolumeControls` | Session quality and control confidence | shuffle/repeat/recurse/reshuffle/volume/mute behave as expected | queue logic + mixer updates | UI toggles + mixer config state + playback traces | PASS |
| F014 | Duration/songlength/subsong | `PlaybackSettingsPanel` | Needed for SID correctness | duration slider/input + songlength + subsong selector affect playback | songlength parser + subsong selection | settings panel UI, playback state deltas, traces | PASS |
| F015 | HVSC download/ingest lifecycle | `HvscControls` + settings HVSC toggle | Key feature family advertised in app | download/install/ingest/cancel/reset status transitions are correct | native HVSC service + cache/index | HVSC progress UI (`hvsc-*` test IDs), logs, filesystem cache | PASS |
| F016 | HVSC cache reuse | HVSC service + play browsing | Performance and offline reuse behavior | cached baseline/update archives are reused and browseable | cache status + ingest path | cache status API, filesystem markers, UI state | PASS |
| F017 | Lock-screen/background auto-advance | `PlayFilesPage` + background execution hooks | Long-running autonomy requirement | playback continues/advances while locked/backgrounded | Android background execution + due-at scheduling | app logs (`backgroundAutoSkipDue`), lock/unlock cycle evidence, A/V | PASS |
| F018 | Config browse/search/refresh | `ConfigBrowserPage` | Wide hardware config surface | categories searchable and expandable, values visible | REST configs APIs | category UI (`config-category-*`), config list snapshots | PASS |
| F019 | Config edits + mixer solo/reset | `ConfigBrowserPage` category actions | High-impact config mutation path | edits round-trip, mixer solo/reset and clock sync work | REST config write/read | row-level UI, value round-trip snapshots, traces | PASS |
| F020 | Settings connection + preferences | `SettingsPage` sections (Appearance/Connection/Play/HVSC) | Governs app behavior and device routing | host/password/theme/preferences toggles persist and apply | app settings storage + discovery manager | settings UI controls, connection snapshot, persisted values | PASS |
| F021 | Settings diagnostics + safety | `SettingsPage` diagnostics + device safety | Critical troubleshooting and resilience controls | diagnostics share/clear/import/export and safety tuning behave correctly | diagnostics store + filesystem/share + safety config | diagnostics dialog UI (`diagnostics-*`), exported artifacts, logs | PASS |
| F022 | Docs + licenses | `DocsPage` + `/settings/open-source-licenses` | User-facing guidance and compliance | docs sections expand and license markdown renders | static docs + bundled notices fetch | UI screenshots, no-error logs, license render check | PASS |
| F023 | Persistence + reconnect recovery | cross-route (Play/Disks/Settings lifecycle) | Reliability across restarts/lock/reconnect | app state survives restart/lock; reconnect behavior is deterministic | local stores + connection manager + runtime lifecycle | before/after state snapshots, lock/restart traces, logcat | PASS |

## Inventory Notes

- Features are treated as key when they are user-facing, mutate C64 state, influence persistence/recovery, or control major workflows.
- Read-only areas (Docs/Licenses) are included to avoid silent omission of user-visible routes.
- No feature is omitted due to runtime complexity; every feature now has explicit terminal classification and current matrix state `PASS:23`, `FAIL:0`, `BLOCKED:0`.
