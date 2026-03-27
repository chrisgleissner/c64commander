# Agentic Feature Surface

## Purpose

This file is the repository-derived inventory for autonomous testing scope. It is the source of truth for what "full feature-surface" means in this repo.

Primary anchors:

- `src/App.tsx`
- `src/components/TabBar.tsx`
- `src/pages/**`
- `src/lib/connection/connectionManager.ts`

## Route Inventory

| Route | Page | Purpose | Notes |
| --- | --- | --- | --- |
| `/` | Home | Operational dashboard for machine control and high-value config | High mutation risk |
| `/play` | Play | Source browsing, playlist management, playback, HVSC | Highest async/background risk |
| `/disks` | Disks | Disk library, drive control, mount/eject, Soft IEC | Destructive and stateful |
| `/config` | Config | Full C64 Ultimate category browser and editor | Broad mutation surface |
| `/settings` | Settings | App settings, diagnostics, import/export, safety | Persistence-heavy |
| `/docs` | Docs | Built-in usage help | Read-only |
| `/settings/open-source-licenses` | Licenses | Rendered bundled third-party notices | Read-only |
| `/__coverage__` | Coverage probe | Test-only probe route behind `VITE_ENABLE_TEST_PROBES` | Not a product workflow |


## Home

Repo anchors:

- `src/pages/HomePage.tsx`
- `src/pages/home/components/**`
- `src/pages/home/hooks/useHomeActions.ts`

Feature areas:

- System info and connection summary.
- Machine control: reset, reboot, pause/resume, menu, power off.
- RAM workflows: save, load, reboot-and-clear, dump-folder selection.
- Quick config: CPU speed, turbo coupling, video mode, HDMI scan lines, joystick swap.
- LED and SID controls, including per-chip routing and silence/reset actions.
- Inline drive management and printer management.
- Stream status and stream endpoint control.
- App config snapshot save, load, rename, delete.

Risk profile:

- Hardware-coupled.
- Mixed destructive and guarded mutations.
- Several workflows need more than UI oracles.

## Play

Repo anchors:

- `src/pages/PlayFilesPage.tsx`
- `src/pages/playFiles/**`
- `src/lib/native/backgroundExecution.ts`
- `src/lib/native/backgroundExecutionManager.ts`

Feature areas:

- Source browsing across Local, C64U, and HVSC.
- Playlist build from files or folders, recursive import, add-more, filter, bulk remove.
- Transport control: play, stop, pause/resume, previous, next.
- Queue state: shuffle, repeat, reshuffle, current item, elapsed, remaining, totals.
- Volume and mute control against Audio Mixer state.
- Duration, subsong, multi-song SID, and songlength file support.
- Mixed-format playback across `sid`, `mod`, `prg`, `crt`, and disk-image flows.
- Playback persistence keyed by device.
- Android background execution and lock/auto-advance handling.
- HVSC lifecycle: download, install, ingest, cancel, reset, browse, play.

Risk profile:

- Highest async and long-running surface.
- Mixes app state, REST, FTP, filesystem, Android lifecycle, and A/V evidence.

## Disks

Repo anchors:

- `src/pages/DisksPage.tsx`
- `src/components/disks/HomeDiskManager.tsx`

Feature areas:

- Disk library import from Local and C64U.
- Library persistence, search, view-all, grouping, rename, delete, bulk delete.
- Mount/eject to Drive A and Drive B.
- Drive power, drive reset, bus ID, drive type, DOS status.
- Soft IEC enablement, bus ID, and default path.

Risk profile:

- Stateful and destructive.
- Requires drive-state and mounted-state oracles, not only UI confirmation.

## Config

Repo anchors:

- `src/pages/ConfigBrowserPage.tsx`
- `src/lib/config/**`

Feature areas:

- Category discovery and search across the full C64 Ultimate config tree.
- Per-item edits with immediate apply semantics.
- Audio Mixer special cases, including solo routing and reset-to-defaults.
- Clock synchronization.

Risk profile:

- Very broad surface.
- Many items need feature-specific expected behavior that is not yet fully documented.

## Settings

Repo anchors:

- `src/pages/SettingsPage.tsx`
- `src/lib/config/appSettings.ts`
- `src/lib/config/deviceSafetySettings.ts`
- `src/lib/diagnostics/**`

Feature areas:

- Connection host/password, manual reconnect, automatic demo mode.
- Appearance theme.
- Diagnostics dialog with Errors, Logs, Traces, and Actions tabs.
- Diagnostics clear and diagnostics ZIP export/share.
- Settings export/import.
- List preview limit, disk autostart mode, debug logging.
- HVSC enablement and developer base URL override.
- Device Safety presets and advanced throttling/backoff/circuit controls.
- Developer mode unlock, REST API docs link, licenses navigation.

Risk profile:

- Persistence-heavy.
- Some controls mutate global safety behavior for the whole app.
- Share/export flows are Android-runtime-sensitive.

## Docs And Licenses

Repo anchors:

- `src/pages/DocsPage.tsx`
- `src/pages/OpenSourceLicensesPage.tsx`

Feature areas:

- Expandable built-in help for setup and core pages.
- Bundled `THIRD_PARTY_NOTICES.md` rendering.

Risk profile:

- Read-only.
- Still part of user-visible coverage and should not be silently excluded.

## Cross-Cutting Runtime Surfaces

Repo anchors:

- `src/lib/connection/connectionManager.ts`
- `src/components/DemoModeInterstitial.tsx`
- `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
- `src/components/TestHeartbeat.tsx`

Feature areas:

- Startup discovery, manual discovery, settings-triggered discovery, background rediscovery.
- Real vs demo mode transitions and sticky real-device lock.
- Demo interstitial session behavior.
- Global diagnostics overlay and trace/log capture.
- Hidden test heartbeat and coverage-probe surfaces.

## Testing Implications

- Mixed-format playback is only the baseline physical proof, not the full autonomous scope.
- Many major features require non-A/V oracles from UI state, REST-visible state, FTP-visible state, filesystem artifacts, diagnostics, and logcat.
- The coverage probe route is useful for lab validation and probe health only. It must not replace product workflows in autonomous coverage claims.
