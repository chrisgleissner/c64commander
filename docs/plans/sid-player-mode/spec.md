# SID Player: specification

Status: draft for implementation. Spec IDs (`SPM-…`) are stable. Commits, tests and PR descriptions cite them.
Baseline: integration branch at `6d8463b85`. Line counts quoted below were measured there.

## 1. Summary

SID Player is a mode of the app for people who own no C64 Ultimate-family device and want to listen to C64
music on their phone. In SID Player the app shows only what works without a device: on-device SID playback,
playlists, local files, HVSC browsing and download, CommoServe, SID Radio, search, a subset of Settings, a
subset of the in-app guide, and the tour. Everything that needs a machine is hidden, not greyed out: the Disks
and Config tabs, Home's machine sections, Live View, Remote Input, Game Mode, the device switcher, device
health probing, connection errors and "device unreachable" notices. The app sends no request to any device
while SID Player is active.

SID Player is a sibling of Demo Mode. Both are device-less states and they are mutually exclusive. Demo Mode
simulates a machine so the whole app can be explored. SID Player removes the machine from the app.

The design adds no second UI. It is a visibility and gating layer over the existing pages, routes, settings,
playback and source code:

- One persisted store holds the mode (`src/lib/appMode/appModeStore.ts`).
- One declarative map says which surface is shown in which mode (`src/lib/appMode/surfaces.ts`).
- Existing choke points consult that map: the tab list, `CollapsibleSection`, the feature-flag resolver, the
  search requirement resolver, tour steps, guide chapters, the Quick menu, and the connection manager's
  discovery entry point.
- SID Player rides on the existing "no device" plumbing. The connection state is `OFFLINE_NO_DEMO`, so
  `isDeviceOutOfReach()`, `preRouteEngine({ noDeviceConnected })`, `playbackVolumeBinding` and
  `remoteTuneHandover` already route playback to the phone. No parallel "no device" flag is introduced.

The start-up mode (`default`, `demo` or `sid-player`) is a build-time variant field, independent of the
edition. SID Player works, and can be switched at runtime, in both existing editions: the broad edition and
the compact keypad edition. A new variant builds a further APK named "SID Player" that starts in SID Player.
The variant value is only the initial value: an explicit choice made by the user persists and wins.

Measured fact (product owner): only a small percentage of the SID songs in HVSC require the KERNAL or the BASIC ROM; most tunes play without any ROM. Guide, manual and in-app help text say "a small percentage" and give no figure.

## 2. Glossary

| Term | Meaning |
| --- | --- |
| Device | A C64 Ultimate-family machine the app controls over the network (integrated computer or cartridge). |
| Full App | The app with every surface the build and feature flags allow. The counterpart of SID Player. |
| Demo Mode | Existing feature. The app runs against a simulated device served on loopback (`DEMO_ACTIVE`). |
| SID Player | The mode specified here. The app runs with no device and hides device surfaces. |
| App mode | Runtime value `full` or `sid-player`. Drives surface visibility. |
| Start-up mode | `default`, `demo` or `sid-player`. Decides what the app does at launch. Variant default plus a persisted user override. |
| Surface | A tab, route, page section, settings section, Quick menu entry, search entry, tour step, guide chapter, feature-flag row, toast class or background service. |
| Surface map | The declarative table in `src/lib/appMode/surfaces.ts` that classifies every surface. |
| Device traffic | Any REST, FTP, Telnet, stream-control or discovery packet addressed to a device. |
| Compact keypad phone | A small-screen phone driven by a D-pad, soft keys and a numeric keypad, with touch absent or secondary. |
| Variant | A build edition declared in `variants/variants.yaml`, compiled by `scripts/generate-variant.mjs`. |

## 3. Naming and wording

| Item | Text |
| --- | --- |
| Mode name (product feature name, capitalized like Live View) | SID Player |
| Counterpart | Full App |
| Sibling | Demo Mode (existing name, unchanged) |
| Enter | Use SID Player |
| Leave | Leave SID Player |
| Settings section title / id | App mode / `app-mode` |
| Settings choices | Full App · Demo Mode · SID Player |
| Health badge label in SID Player | SID Player |
| Second APK display name | SID Player |

Confirmation copy (sentence case, American English):

- Enter, title "Use SID Player?", body: "SID Player keeps what works without a C64 Ultimate: playback on this
  phone, playlists, HVSC, SID Radio and search. Machine controls, disks, config and Live View are put away.
  Your playlists, settings and saved devices are kept. You can leave SID Player at any time from Settings or
  the menu." Buttons: "Use SID Player" (primary), "Cancel".
- Leave, title "Leave SID Player?", body: "Full App looks for your C64 Ultimate and shows its controls
  again. Nothing you saved is changed." Buttons: "Full App" (primary), "Demo Mode", "Cancel".
- Compact profile body (two lines maximum, see `DemoModeInterstitial` sizing note): Enter "Only music on this
  phone. Machine controls are hidden. You can switch back." Leave "Show the C64 Ultimate controls again?"

## 4. Current state (findings that shape the design)

1. `TAB_ROUTES` (`src/lib/navigation/tabRoutes.ts`) is a const of six routes. Page identity everywhere is an
   index into it: `SwipeNavigationLayer`, `PageSlotBody.SLOT_COMPONENTS`, `swipeNavigationModel`, cached pages,
   page positions, `createTabJumpShortcut`, `useFocusNavigation` digit shortcuts, `KeypadQuickMenu`.
2. Home, Settings and the in-app guide all build their sections from `CollapsibleSection` with a `scope`
   (`home`, `settings`, `docs`) and an `id`. Every Home device section is one of these: `quick-actions`
   (`MachineControls`), `live-view`, `cpu-ram`, `ports`, `video`, `audio`, `user-interface`, `lighting`,
   `drives`, `printers`, `streams`, `config-actions`.
3. Home already has an offline arrangement (`useOfflineArrangement`, `src/lib/home/offlineArrangement.ts`):
   promoted listen tiles (SID Radio, Last, Recent, Live View greyed), `ConnectC64Card`, device sections
   force-closed. It is the natural SID Player Home.
4. `OFFLINE_NO_DEMO` already means "play on the phone": `isDeviceOutOfReach()`
   (`src/pages/playFiles/playableWithoutDevice.ts`), `preRouteEngine` `noDeviceConnected`, the
   `noMachineForRoms` branch in `usePlaybackController` (no ROM fetch), and `deviceStateStore` maps it to
   `ERROR`, which blocks background-intent requests in `deviceInteractionManager.shouldBlockForState`.
   React Query device hooks are gated on `connectionActive` and are idle in that state.
5. `runDiscoverConnection` in `src/lib/connection/connectionManager.ts` is the single entry for startup,
   manual, settings, background, switch and resume discovery. `transitionToOfflineNoDemo` already cancels
   discovery, stops the demo server, dismisses the Demo offer and clears the Demo pin.
6. `c64api.ts` already blocks requests in fuzz and smoke modes inside the request loop, and
   `isCriticalRestError` treats those blocks as non-critical. That is the precedent for a traffic backstop.
7. Feature flags (`src/lib/config/feature-flags.yaml`) are compiled at build time and overridden per variant;
   runtime overrides load asynchronously from a native plugin (`isLoaded`). The app mode must be known
   synchronously before first render and before startup discovery, so it cannot be a feature flag.
8. Search entries carry `requires` (`device`, `capability`, `flag`, …) resolved in
   `src/lib/search/requirements.ts`. Tour steps carry `requiresDevice` (`src/lib/tour/steps.ts`). Guide
   chapters are built by `buildGuideChapters(context)` from `GuideContext` (`src/lib/docs/guide/chapters.ts`).
9. The health badge owns the device switcher and the saved-device health checks
   (`UnifiedHealthBadge` → `useSavedDeviceHealthChecks`). `deriveConnectivityState` in
   `src/lib/diagnostics/healthModel.ts` already has a `"Demo"` label.
10. ROMs today (details in §5.16):
    - Only KERNAL and BASIC are known (`C64RomKind`, 8192 bytes each). `validateRomImage`
      (`src/lib/roms/c64SystemRoms.ts`) checks size, non-uniform content, at least 64 distinct byte values,
      the KERNAL reset vector (at least `$E000`) and the BASIC `CBMBASIC` signature. `KNOWN_FINGERPRINTS`
      names 901227-03 and 901226-01 by FNV-1a fingerprint; any other image that passes is accepted as an
      "unrecognised variant".
    - The only writer is `fetchSystemRomsFromDevice` (`romFetchService.ts`), called by `ensureSystemRoms`
      (automatic, once per session) and by the developer-only `LocalEngineRomsRow` ("Read from C64").
    - `romStore.ts` keeps base64 images in `localStorage` key `c64commander.localEngine.systemRoms.v1`.
      `settingsTransfer.ts` does not export it.
    - `LocalSidEngine` reads the store on every open (`loadStoredRoms()`), so a change applies from the next
      tune. It sends the images only when both are present. The character ROM argument of `setSystemROMs` is
      always `null`.
    - Without images the WASM renderer synthesizes a minimal KERNAL. A tune whose RSID v2+ header declares
      BASIC (`detectRomRequired`) is refused with `romRequired: true` unless a BASIC image is supplied.
    - `usePlaybackController` pre-routes a header-declared tune to the C64 when the set is incomplete
      (`romFallbackDecision`), which ends in "Device not connected" when there is no device.
    - The `romRequired` result of `getLocalSidPlayback().play()` is ignored. A tune refused at open therefore
      plays silence until its songlength runs out.
    - The rendered-tune cache key carries a `/noroms` suffix (`renderedTuneCache.ts`).
    - The keypad phone class this app targets may have no system document picker. `canPickDocuments()`
      (`src/lib/native/folderPicker.ts`) reports that, and Add items then hides local sources.
11. File-size ceilings leave little room in the files this work touches (lines now / ceiling + 25 allowance):
    `connectionManager.ts` 1521 / 1522, `c64api.ts` 3489 / 3493, `usePlaybackController.ts` 2460 / 2463,
    `DiagnosticsDialog.tsx` 2013 / 2016, `SettingsPage.tsx` 3477 / 3498, `HomePage.tsx` 2199 / 2222,
    `PlayFilesPage.tsx` 3171 / 3190. `appSettings.ts` is 997 lines against the 1000-line hard limit and is
    not grandfathered. `UnifiedHealthBadge.tsx` is 962.
12. `variants/variants.yaml` `runtime.*` fields are validated in `scripts/generate-variant.mjs`, baked into
    `src/generated/variant.ts`, checked by `npm run variant:check` and `tests/unit/scripts/generateVariant.test.ts`.
    `repo.publish_defaults.ci` builds a variant on every CI run; `repo.publish_defaults.release` attaches it to
    a release. `.github/workflows/manual.yaml` lists variants literally. `scripts/build-manuals.mjs` selects
    the manual's scope with predicates keyed on variant id.
13. `docs/ux-guidelines.md` "Overlay and Badge Visibility Contract" requires the health badge on every page
    with zero exceptions.

## 5. Specification

Format of each feature: Requirement · Rationale · Files · Choke point · Acceptance · Tests · Verification ·
Status · Evidence.

### 5.1 Architecture

#### SPM-ARCH-01 One source of truth for the mode

- Requirement: The app MUST hold the start-up mode and the app mode in one module,
  `src/lib/appMode/appModeStore.ts`, exposing `loadStartupMode()`, `saveStartupModeByUser(mode)`,
  `getAppMode()`, `isSidPlayerActive()`, `subscribeAppMode(listener)` and the hook `useAppMode()`
  (`useSyncExternalStore`). The persisted user choice MUST live in `localStorage` key `c64u_startup_mode`.
  The store MUST be readable synchronously at module load, before first render. No other module may read
  `variant.runtime.startupMode` or the storage key.
- Rationale: Feature flags load asynchronously; a mode read late would flash device UI and start discovery.
- Files: new `src/lib/appMode/appModeStore.ts`. Not `appSettings.ts` (997 of 1000 lines).
- Choke point: this module.
- Acceptance: grep finds `variant.runtime.startupMode` and `c64u_startup_mode` only in this module and its test.
  Writes dispatch the existing `c64u-app-settings-updated` event so `useSettingsPageStaleness` rebuilds Settings.
- Tests: `tests/unit/lib/appMode/appModeStore.test.ts` — "returns the variant start-up mode when the user has
  not chosen", "a stored user choice wins over the variant start-up mode", "ignores an unknown stored value
  and logs a warning", "storage that throws falls back to the variant value and logs", "notifies subscribers
  once per change".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-ARCH-02 One declarative surface map

- Requirement: Every mode-dependent surface MUST be classified in `src/lib/appMode/surfaces.ts` as
  `always`, `needs-device` or `sid-player-only`, keyed by a typed `SurfaceId` (`route:/disks`,
  `home:live-view`, `settings:device-safety`, `quick-menu:machine-reset`, …). One predicate,
  `isSurfaceVisible(id, appMode)`, MUST be the only place that turns a classification into a decision.
  Derived rules MUST hold without listing each item: a search entry, tour step or feature flag that already
  declares a device requirement is `needs-device`.
- Rationale: The no-duplication rule. A future feature is hidden or shown predictably by declaring a device
  requirement once.
- Files: new `src/lib/appMode/surfaces.ts`.
- Choke point: `isSurfaceVisible`.
- Acceptance: No component compares the app mode itself; components ask `isSurfaceVisible` or a
  derived helper (`visibleTabIndexes`, `isSearchEntryShown`, `tourStepsFor`, `guideChaptersFor`).
- Tests: `tests/unit/lib/appMode/surfaces.test.ts` — "every needs-device surface is hidden in SID Player and
  shown in Full App", "always surfaces are shown in both modes", "sid-player-only surfaces are hidden in
  Full App".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-ARCH-03 An unclassified surface fails a test

- Requirement: A `CollapsibleSection` (`home`, `settings`, `docs` scopes), tab route, Quick menu entry or
  feature flag that is not in the surface map MUST fail a unit test. `SurfaceId` for tabs and flags MUST be
  derived from `TAB_ROUTES` and `FEATURE_FLAG_IDS` so TypeScript rejects a missing entry.
- Rationale: Predictable defaults for future work, enforced rather than documented.
- Files: `src/lib/appMode/surfaces.ts`; test only.
- Choke point: compile-time `Record` over the id unions plus a render scan.
- Acceptance: Adding a new Home section without a map entry turns the test red.
- Tests: `tests/unit/lib/appMode/surfaceCoverage.test.tsx` — "every Home, Settings and Docs section rendered in
  Full App has a surface classification", "every tab route and feature flag has a surface classification".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-ARCH-04 No duplicated screens or logic

- Requirement: SID Player MUST reuse the existing pages, tab bar, routes, Settings, Play page, sources,
  playback engine and dialogs. It MUST NOT add a second tab bar, a second Home page, a copy of any page or a
  parallel "no device" flag. Where a surface needs different words in SID Player, the existing component
  MUST select them (for example `ConnectC64Card`, `DemoModeInterstitial`), not a copy.
- Rationale: Product owner requirement; one code path to test and maintain.
- Files: all touched files.
- Choke point: review rule; `SPM-ARCH-02`.
- Acceptance: The diff adds no `*Page.tsx` and no component whose JSX mirrors an existing one. The places
  where a shared component is needed are listed in `SPM-ARCH-06`.
- Tests: review; `SPM-ARCH-03` keeps classification in one table.
- Verification: code review.
- Status: Not started. Evidence: —

#### SPM-ARCH-05 Make room before changing ceiling-bound files

- Requirement: Before behavior changes, these extractions MUST land as separate no-behavior-change commits,
  each lowering the file's `GRANDFATHERED` ceiling in `scripts/check-file-sizes.mjs`:
  1. Demo Mode session flags (`persistDemoModeSessionFlag`, the four `c64u_demo_*` session keys, their
     restore in `initializeConnectionManager`) from `connectionManager.ts` to
     `src/lib/connection/demoModeSession.ts`.
  2. The "Play and disk" section from `SettingsPage.tsx` to `src/pages/settings/PlayAndDiskSettingsSection.tsx`.
  3. The connection actions block of `DiagnosticsDialog.tsx` (`diagnostics-connection-details-action`,
     `diagnostics-manage-devices-action`) to `src/components/diagnostics/DiagnosticsConnectionActions.tsx`.
- Rationale: `connectionManager.ts` has one line of headroom, `DiagnosticsDialog.tsx` three,
  `usePlaybackController.ts` three, `c64api.ts` four. The guards below cannot fit otherwise, and adding to
  `GRANDFATHERED` is not allowed.
- Files: as listed.
- Choke point: n/a.
- Acceptance: `npm run lint:file-sizes` passes with lowered ceilings; all existing tests pass unchanged.
- Tests: existing suites (`tests/unit/lib/connection/connectionManager*.test.ts`, Settings and Diagnostics
  component tests) pass with no edits other than imports.
- Verification: unit, `npm run lint`.
- Status: Not started. Evidence: —

#### SPM-ARCH-06 Shared device-less choices component

- Requirement: One component, `src/components/appMode/DeviceLessChoices.tsx`, MUST render the sibling
  choices (Full App, Demo Mode, SID Player, with the current one marked) and run the transitions in
  `SPM-SWT-02`. It MUST be used by the Settings `app-mode` section, the Leave confirmation, the Home
  `ConnectC64Card` in SID Player, `DiagnosticsConnectionActions` in SID Player and the first-run offer.
- Rationale: The same three choices appear in five places; one component prevents five copies drifting apart.
- Files: new component; consumers listed.
- Choke point: this component.
- Acceptance: No other file calls `saveStartupModeByUser` or `pinDemoModeByUserChoice` for a mode switch.
- Tests: `tests/unit/components/appMode/DeviceLessChoices.test.tsx` — "marks the current mode", "choosing
  SID Player asks for confirmation before switching", "choosing Demo Mode from SID Player leaves SID Player
  and pins Demo Mode", "every choice is reachable by the focus ring and is at least 44 px".
- Verification: unit, Playwright.
- Status: Not started. Evidence: —

### 5.2 Mode semantics and Demo Mode

#### SPM-MODE-01 SID Player settles the connection without a device

- Requirement: While `isSidPlayerActive()`, `runDiscoverConnection` MUST return before any probe, scan or
  saved-device sweep for every trigger. A non-background trigger MUST settle the state through the existing
  `transitionToOfflineNoDemo`; a background trigger MUST return without a transition.
- Rationale: One guard at the one discovery entry point covers startup, resume, settings, manual, switch,
  network-edge (`networkTransitions`) and background triggers.
- Files: `src/lib/connection/connectionManager.ts` (after `SPM-ARCH-05`).
- Choke point: `runDiscoverConnection`.
- Acceptance: In SID Player the connection state goes `UNKNOWN → OFFLINE_NO_DEMO` at startup and never
  enters `DISCOVERING`, `DEMO_ACTIVE` or `REAL_CONNECTED`.
- Tests: `tests/unit/lib/connection/connectionManager.sidPlayer.test.ts` — "startup in SID Player settles
  offline without probing", "each discovery trigger in SID Player sends no probe", "a background trigger in
  SID Player does not transition", "a returning network in SID Player starts no discovery".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-MODE-02 SID Player and Demo Mode are mutually exclusive

- Requirement: The app MUST NOT be in `DEMO_ACTIVE` while the app mode is `sid-player`. Entering SID Player
  from Demo Mode MUST stop the demo server and clear the Demo pin (through `transitionToOfflineNoDemo`).
  Entering Demo Mode from SID Player MUST first set the app mode to `full`, then call
  `pinDemoModeByUserChoice()`.
- Rationale: Both are device-less states; one simulates a machine, the other removes it.
- Files: `src/lib/appMode/appModeTransitions.ts` (new), `connectionManager.ts` guard.
- Choke point: `appModeTransitions` plus the `SPM-MODE-01` guard.
- Acceptance: No sequence of user actions produces `appMode === "sid-player"` with `DEMO_ACTIVE`.
- Tests: `tests/unit/lib/appMode/appModeTransitions.test.ts` — "entering SID Player from Demo Mode stops the
  demo server", "entering Demo Mode from SID Player switches to Full App first", "pinning Demo Mode is
  refused while SID Player is active".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-MODE-03 What Demo Mode shows that SID Player does not, and the reverse

- Requirement: The surface map MUST encode this table.

  | Surface | Demo Mode | SID Player |
  | --- | --- | --- |
  | Disks, Config tabs | shown (simulated device) | hidden |
  | Home machine sections, Live View, Remote Input, Game Mode | shown | hidden |
  | Health badge | "Demo" | "SID Player" |
  | Device switcher, saved-device health probes | shown | hidden, stopped |
  | Simulated HVSC release (480 tunes) | installed, removed on leaving | never installed |
  | "Play on" C64 / this device choice | shown | hidden (phone only) |
  | App mode section and Leave SID Player entries | Full App / Demo Mode / SID Player choices | same choices |
  | Home listen tiles, Play page, HVSC, SID Radio | shown | shown |

- Rationale: The coordinator's sibling requirement; makes the difference reviewable.
- Files: `src/lib/appMode/surfaces.ts`.
- Choke point: surface map.
- Acceptance: Each row is asserted by a test in `SPM-TST-02`.
- Tests: covered by `SPM-TST-02`.
- Verification: Playwright.
- Status: Not started. Evidence: —

#### SPM-MODE-04 Switching preserves data

- Requirement: Switching mode in either direction MUST NOT modify playlists, the HVSC library, liked tunes,
  recently played, app settings, feature-flag overrides, saved devices, the selected device or stored
  passwords. Feature flags hidden in SID Player MUST keep their stored override.
- Rationale: "No data loss, never forced."
- Files: `appModeTransitions.ts`; `featureFlags.ts` (`SPM-SET-03`).
- Choke point: transitions write only `c64u_startup_mode`.
- Acceptance: A storage snapshot before and after a round trip differs only in `c64u_startup_mode` and the
  existing Demo session keys.
- Tests: `tests/unit/lib/appMode/appModeTransitions.test.ts` — "a round trip through SID Player leaves every
  other stored key unchanged"; `playwright/sidPlayerMode.spec.ts` — "playlist and saved devices survive a
  round trip through SID Player".
- Verification: unit, Playwright, handset.
- Status: Not started. Evidence: —

### 5.3 Device traffic and background work

#### SPM-NET-01 No device traffic in SID Player

- Requirement: While SID Player is active the app MUST send no REST, FTP, Telnet, stream-control, mDNS or
  LAN-scan packet to any device. The only exception is the user-initiated, bounded ROM read of `SPM-ROM-18`. Internet traffic for HVSC, CommoServe and SID Radio data stays allowed.
- Rationale: No wasted requests, no error toasts, no battery cost.
- Files: covered by `SPM-MODE-01`, `SPM-NET-02`, `SPM-NET-03`.
- Choke point: discovery guard plus the traffic backstop.
- Acceptance: A Playwright session that starts in SID Player, plays a tune, opens every visible page, the
  Quick menu, search and Diagnostics, backgrounds and resumes, records zero requests at the mock device
  server and zero traffic-gate hits.
- Tests: `playwright/sidPlayerMode.spec.ts` — "SID Player sends no request to the device during a full
  session".
- Verification: Playwright; handset (CDP request log, see `SPM-TST-05`).
- Status: Not started. Evidence: —

#### SPM-NET-02 Background services stop

- Requirement: In SID Player the `ConnectionController` background rediscovery schedule MUST NOT arm, and
  `useSavedDeviceHealthChecks` MUST NOT run. Services that are already idle in `OFFLINE_NO_DEMO`
  (`LocalSidModelDriver`, `useDeviceVicPalette`, `AvMirrorGovernorDriver`, `ensureSystemRoms`, device query
  hooks) need no change and MUST stay idle.
- Rationale: Timers that only return early still wake the CPU.
- Files: `src/components/ConnectionController.tsx` (scheduling effect), `src/components/UnifiedHealthBadge.tsx`
  (`shouldRunSavedDeviceHealthChecks`).
- Choke point: those two gates.
- Acceptance: No background discovery timer exists in SID Player.
- Tests: `tests/unit/components/ConnectionController.sidPlayer.test.tsx` — "SID Player arms no background
  rediscovery timer"; `tests/unit/components/UnifiedHealthBadge.sidPlayer.test.tsx` — "SID Player runs no
  saved-device health check".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-NET-03 Traffic backstop

- Requirement: `src/lib/appMode/deviceTrafficGate.ts` MUST export `assertDeviceTrafficAllowed(channel, detail)`,
  which throws a typed `SidPlayerTrafficBlockedError` while SID Player is active and logs a `warn` entry with
  the stack and detail once per channel per session. It MUST be called at the request loop in `c64api.ts`
  (beside the fuzz-mode block), the FTP client entry, the Telnet client connect, and the
  `discoveryManager` scan entry. `isCriticalRestError` MUST treat the error as non-critical, and
  `reportUserError` MUST not toast it.
- Rationale: The gates above stop known sources; a backstop makes a leaked surface visible in logs and tests
  instead of on the network.
- Files: new gate module; `c64api.ts` (two lines), `src/lib/ftp/ftpClient.ts`, `src/lib/telnet/telnetClient.ts`,
  `src/lib/deviceDiscovery/discoveryManager.ts`, `src/lib/deviceInteraction/deviceInteractionManager.ts`.
- Choke point: `assertDeviceTrafficAllowed`.
- Acceptance: A forced request in SID Player throws, is logged once, and reaches no socket.
- Tests: `tests/unit/lib/appMode/deviceTrafficGate.test.ts` — "blocks each channel in SID Player and logs once",
  "allows every channel in Full App"; `tests/unit/c64api.sidPlayer.test.ts` — "a REST call in SID Player is
  refused before dispatch and is not a critical error".
- Verification: unit; zero hits asserted in `SPM-NET-01`.
- Status: Not started. Evidence: —

### 5.4 Navigation

#### SPM-NAV-01 Visible tabs

- Requirement: `TAB_ROUTES` MUST stay unchanged (page indices are identities). A new
  `visibleTabIndexes(appMode)` in `tabRoutes.ts` MUST return the indices whose `route:` surface is visible.
  In SID Player that is Home, Play, Settings, Docs. `TabBar` MUST render only those.
- Rationale: Index stability keeps `SwipeNavigationLayer`, cached pages and page positions untouched.
- Files: `src/lib/navigation/tabRoutes.ts`, `src/components/TabBar.tsx`.
- Choke point: `visibleTabIndexes`.
- Acceptance: In SID Player the tab bar shows four tabs, each at least 44x44 px, labels at the compact floor.
- Tests: `tests/unit/lib/navigation/tabRoutes.test.ts` — "SID Player shows Home, Play, Settings and Docs";
  `tests/unit/components/TabBar.test.tsx` — "renders only the visible tabs in SID Player".
- Verification: unit, Playwright.
- Status: Not started. Evidence: —

#### SPM-NAV-02 Swipe skips hidden pages

- Requirement: `resolveSwipeTarget`, `resolveAdjacentIndexes` and `resolveNavigationDirection` MUST step over
  hidden indices and wrap within the visible set. Their default argument MUST be all indices, so full-app
  behavior is unchanged.
- Files: `tabRoutes.ts`, `src/lib/navigation/swipeNavigationModel.ts`, `src/components/SwipeNavigationLayer.tsx`.
- Choke point: the three model functions.
- Acceptance: Swiping left from Play in SID Player opens Settings; right from Home opens Docs.
- Tests: `tests/unit/lib/navigation/swipeNavigationModel.test.ts` — "adjacent pages skip hidden tabs",
  "swipe wraps within the visible tabs"; existing cases unchanged.
- Verification: unit, Playwright.
- Status: Not started. Evidence: —

#### SPM-NAV-03 Keypad digit jumps follow visible tabs

- Requirement: Digits 1..n MUST open the n visible tabs in order; higher digits up to 6 MUST do nothing; 7
  MUST still open search. `createTabJumpShortcut` and the digit bound in `useFocusNavigation` MUST use the
  visible count.
- Files: `tabRoutes.ts`, `src/hooks/useFocusNavigation.tsx`, `src/components/search/SearchKeyListener.tsx`
  (comment and test only).
- Choke point: `createTabJumpShortcut`.
- Acceptance: In SID Player, 3 opens Settings, 5 is ignored, 7 opens search.
- Tests: `tests/unit/lib/navigation/tabJumpShortcut.test.ts` — "digit jumps map to visible tabs in SID
  Player", "digits past the visible tabs do nothing"; `SearchKeyListener.test.tsx` updated assertion.
- Verification: unit, Playwright keypad spec, handset.
- Status: Not started. Evidence: —

#### SPM-NAV-04 Hidden routes redirect to Home

- Requirement: Navigating to a hidden route (deep link, history Back, search target, toast action, restored
  location, `/diagnostics` sub-route of a hidden page) MUST replace the location with `/` and log one
  `info` entry naming the path. No error page, no toast.
- Files: `src/App.tsx` (a `HiddenRouteRedirect` beside `NotFoundForUnknownPaths`).
- Choke point: `HiddenRouteRedirect`.
- Acceptance: Opening `/config` in SID Player shows Home.
- Tests: `tests/unit/AppRoutes.sidPlayer.test.tsx` — "a hidden route in SID Player redirects to Home";
  `playwright/sidPlayerMode.spec.ts` — "deep link to Disks in SID Player lands on Home".
- Verification: unit, Playwright.
- Status: Not started. Evidence: —

### 5.5 Home

#### SPM-HOME-01 Home uses the offline arrangement

- Requirement: In SID Player `useOfflineArrangement` MUST return `true` immediately, without the settle delay.
- Files: `src/hooks/useOfflineArrangement.ts`.
- Choke point: `useOfflineArrangement`.
- Acceptance: Home shows the search field and listen tiles first on the first frame.
- Tests: `tests/unit/hooks/useOfflineArrangement.test.ts` — "SID Player arranges Home offline at once".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-HOME-02 Device sections are hidden, not closed

- Requirement: `CollapsibleSection` MUST render nothing when `isSurfaceVisible({scope, id})` is false. The
  check MUST sit in a wrapper so the section body's hooks never run. In SID Player this hides Home sections
  `quick-actions`, `live-view`, `cpu-ram`, `ports`, `video`, `audio`, `user-interface`, `lighting`,
  `drives`, `printers`, `streams`, `config-actions`, and the `home-offline-sections-note` paragraph.
  `DeviceStepsOffer` MUST not render. `SystemInfo` stays (`appVersionOnly`).
- Files: `src/components/CollapsibleSection.tsx`, `src/pages/HomePage.tsx` (note paragraph only),
  `src/components/tour/DeviceStepsOffer.tsx`.
- Choke point: `CollapsibleSection`.
- Acceptance: SID Player Home contains search, listen tiles, the SID Player card and the version line only.
- Tests: `tests/unit/components/CollapsibleSection.test.tsx` — "a section hidden by the app mode renders
  nothing and runs no body effect"; `tests/unit/pages/HomePage.sidPlayer.test.tsx` — "SID Player Home shows
  no device section".
- Verification: unit, Playwright, handset.
- Status: Not started. Evidence: —

#### SPM-HOME-03 Listen tiles drop device tiles

- Requirement: `useListenActions` MUST omit tiles whose search entry is not shown (`isSearchEntryShown`). In
  SID Player the Live View tile is removed rather than greyed.
- Files: `src/pages/home/components/useListenActions.ts`.
- Choke point: `isSearchEntryShown` (`SPM-SRCH-01`).
- Acceptance: SID Player Home shows SID Radio, Last and Recent tiles.
- Tests: `tests/unit/pages/home/useListenActions.test.ts` — "SID Player omits the Live View tile".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-HOME-04 The connect card becomes the SID Player card

- Requirement: In SID Player `ConnectC64Card` MUST say that SID Player is on and render `DeviceLessChoices`
  (Leave SID Player). Same `data-testid` root, new child test ids.
- Files: `src/pages/home/components/ConnectC64Card.tsx`.
- Choke point: `ConnectC64Card`.
- Acceptance: A keypad user can leave SID Player from Home.
- Tests: `tests/unit/pages/home/ConnectC64Card.test.tsx` — "SID Player shows the leave choice".
- Verification: unit, Playwright.
- Status: Not started. Evidence: —

### 5.6 Play page and playback

#### SPM-PLAY-01 Device sources and controls are hidden

- Requirement: In SID Player the Play page MUST NOT show the C64U source group in Add items, the "Play on"
  engine toggle (`PlaybackEngineToggle`), the per-item config sheet (`PlaybackConfigSheet`), the Remote
  Input button or the Game Mode button. Remote Input and Game Mode follow from `SPM-SET-03`.
- Files: `src/pages/PlayFilesPage.tsx` (source groups, engine toggle condition).
- Choke point: `isSurfaceVisible("play:c64u-source")`, `("play:engine-choice")`, `("play:item-config")`.
- Acceptance: Add items lists Local, HVSC and CommoServe only.
- Tests: `tests/unit/pages/PlayFilesPage.sidPlayer.test.tsx` — "SID Player offers no C64U source", "SID Player
  hides the play-on choice".
- Verification: unit, Playwright.
- Status: Not started. Evidence: —

#### SPM-PLAY-02 Add items accepts only what the phone can play

- Requirement: In SID Player `ItemSelectionDialog` MUST receive a `filterEntry` that keeps SID files and
  folders only.
- Files: `src/pages/PlayFilesPage.tsx` (one prop).
- Choke point: existing `filterEntry` prop.
- Acceptance: A folder of PRG and D64 files adds nothing.
- Tests: `tests/unit/pages/playFiles/sidPlayerAddFilter.test.ts` — "SID Player adds SID files only".
- Verification: unit, Playwright.
- Status: Not started. Evidence: —

#### SPM-PLAY-03 Existing non-SID rows stay, marked and skipped

- Requirement: Playlist rows that cannot play on the phone MUST stay in the playlist (no data loss), show
  "Needs a C64 Ultimate" as their subtitle, and be skipped by play and auto-advance through the existing
  `firstPlayableWithoutDevice`.
- Files: `src/pages/playFiles/playlistRowSubtitle.ts`, `playableWithoutDevice.ts` (no change expected).
- Choke point: `canPlayWithoutDevice`.
- Acceptance: Pressing play on a PRG row in SID Player plays the next SID and shows no error toast.
- Tests: `tests/unit/pages/playFiles/playlistRowSubtitle.test.ts` — "SID Player marks a program row as
  needing a C64 Ultimate"; `tests/unit/pages/playFiles/playableWithoutDevice.test.ts` — "SID Player skips
  a program row".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-PLAY-04 Tunes that need the C64 ROMs

- Requirement: A tune that cannot play because ROMs are missing MUST be skipped, never routed to an absent
  device and never left playing silence. The design is in `SPM-ROM-05` to `SPM-ROM-07`. This ID remains
  the umbrella that Play page commits cite.
- Tests: those of `SPM-ROM-05` to `SPM-ROM-07`.
- Verification: unit, Playwright, handset.
- Status: Not started. Evidence: —

#### SPM-PLAY-05 Supply ROM images from files

- Requirement: The user MUST be able to supply their own KERNAL and BASIC images from files in a few taps or
  key presses. The design is in `SPM-ROM-01` to `SPM-ROM-04` and `SPM-ROM-08` to `SPM-ROM-15`. This ID
  remains the umbrella.
- Tests: those of the referenced IDs.
- Verification: unit, Playwright with a fake picker, handset.
- Status: Not started. Evidence: —

#### SPM-PLAY-06 Engine notices fit SID Player

- Requirement: `preRouteEngine` MUST return no notice for `no-device-local-sid` in SID Player. The
  `rom-lite-engine` notice MUST use copy that does not mention a connected machine.
- Files: `playbackEngineRouting.ts`.
- Choke point: `preRouteEngine`.
- Tests: `tests/unit/lib/playback/playbackEngineRouting.test.ts` — "SID Player plays a SID here without a
  notice", "the lighter-emulation notice in SID Player names no connected machine".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-PLAY-07 SID Radio works in SID Player

- Requirement: SID Radio MUST start, steer and rank in SID Player once HVSC is installed. Before that, its tile
  and launcher MUST say a one-time download is needed (existing copy).
- Rationale: Verified by code reading: `src/lib/sidRadio/` imports no device API; Demo Mode already runs it
  offline against real sidcorr identities.
- Files: none expected.
- Tests: `playwright/sidPlayerMode.spec.ts` — "SID Radio plays a station in SID Player".
- Verification: Playwright, handset.
- Status: Not started. Evidence: —

### 5.7 Settings


#### SPM-PLAY-08 CommoServe stays and opens narrowed to SID files

- Requirement: CommoServe MUST stay available in Add items in SID Player. Its search MUST open with the type
  preset `sid` selected, and a result whose files include no SID file MUST NOT be offered for adding.
- Rationale: CommoServe does host SID music. Check made on 2026-10-22 with read-only requests to its public search
  service: the presets include the type `sid` and the category `music`, a search for `type:sid` returned SID
  entries, and an entry listing contained a `.sid` file next to a disk image. It also hosts disk images,
  cartridges, tapes, apps, games, demos and graphics, which SID Player cannot run.
- Files: `src/pages/playFiles/hooks/useArchiveClientSettings.ts`, the archive search view, the existing
  `filterEntry` of `SPM-PLAY-02` for entries.
- Choke point: the archive search's default preset values and the shared `filterEntry`.
- Acceptance: In SID Player the CommoServe search shows SID results only. In the Full App the search is
  unchanged. The CommoServe source is hidden when the feature flag `commoserve_enabled` is off, in both modes.
- Tests: `tests/unit/pages/playFiles/sidPlayerCommoServe.test.tsx` — "SID Player opens CommoServe narrowed to the
  sid type", "SID Player does not offer a result without a SID file", "the Full App keeps all types".
- Verification: unit, Playwright with the existing archive mock.
- Status: Not started. Evidence: —

#### SPM-SET-01 Section visibility

- Requirement: Settings sections MUST follow the surface map through `CollapsibleSection`:

  | Section id | SID Player |
  | --- | --- |
  | `appearance` | keep |
  | `app-mode` (new) | keep |
  | `connection` | hide |
  | `diagnostics` | keep |
  | `play-and-disk` | adapt (`SPM-SET-02`) |
  | `feature-group-stable`, `feature-group-experimental` | adapt (`SPM-SET-03`) |
  | `sid-radio` | keep; hide the play-on choice; the ROM row opens the ROM sheet (`SPM-ROM-09`) |
  | audio processing | keep |
  | `hvsc` | keep |
  | `online-archive` | keep |
  | `device-safety` | hide |
  | `notifications` | keep |
  | `about` | keep |

- Files: `src/lib/appMode/surfaces.ts`; `src/pages/settings/SidRadioSettingsSection.tsx`.
- Choke point: `CollapsibleSection`.
- Tests: `tests/unit/pages/SettingsPage.sidPlayer.test.tsx` — "SID Player shows only standalone sections".
- Verification: unit, Playwright.
- Status: Not started. Evidence: —

#### SPM-SET-02 Play and disk rows

- Requirement: In SID Player, `PlayAndDiskSettingsSection` MUST show only list preview limit and friendly SID
  names, under the title "Play". Disk autostart, search inside disks, launch safety, boot menu, stream ports
  and buffers, autofire, Game Mode and remote function keys MUST be hidden.
- Files: `src/pages/settings/PlayAndDiskSettingsSection.tsx` (from `SPM-ARCH-05`).
- Choke point: row-level `isSurfaceVisible` inside that one file.
- Tests: `tests/unit/pages/settings/PlayAndDiskSettingsSection.test.tsx` — "SID Player keeps list preview and
  friendly names only".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-SET-03 Feature flags that need a device

- Requirement: `feature-flags.yaml` MUST gain a required boolean `requires_device` per feature, validated by
  `scripts/compile-feature-flags.mjs`. `buildSnapshot` in `featureFlags.ts` MUST resolve a `requires_device`
  flag to `false` and `visible: false` while SID Player is active, without touching the stored override, and
  `FeatureFlagManager` MUST rebuild on app-mode change. `requires_device: true` for: `remote_input_enabled`, `ram_snapshots_enabled`, all `home_telnet_*`,
  `launch_safety_enabled`, `disk_explorer_enabled`, `in_image_search_enabled`, `live_view_enabled`,
  `av_sync_tests_enabled`, `audio_mirror_enabled`, `video_mirror_enabled`, `new_disk_enabled`,
  `lighting_studio_enabled`. False for `hvsc_enabled`, `commoserve_enabled`, `keypad_input_enabled`,
  `background_execution_enabled`, `app_styles_gallery_enabled`, `demo_mode_enabled`.
- Rationale: One change hides Remote Input, Game Mode, Live View, snapshots and Telnet actions in every
  consumer (Home, Play, Quick menu, keypad shortcuts, search `flag` requirements).
- Files: `src/lib/config/feature-flags.yaml`, `scripts/compile-feature-flags.mjs`,
  `src/lib/config/featureFlagsRegistry.generated.ts`, `src/lib/config/featureFlags.ts`.
- Choke point: `buildSnapshot`.
- Acceptance: `npm run feature-flags:check` fails for a feature without `requires_device`.
- Tests: `tests/unit/lib/config/featureFlags.sidPlayer.test.ts` — "SID Player resolves device flags off and
  keeps their stored override", "leaving SID Player restores the stored override";
  `tests/unit/scripts/compileFeatureFlags.test.ts` — "rejects a feature without requires_device".
- Verification: unit.
- Status: Not started. Evidence: —

### 5.8 Quick menu, search, tour, guide

#### SPM-QM-01 Quick menu entries

- Requirement: In SID Player the Quick menu MUST list only visible tabs, MUST hide machine pause, machine
  reset, Game Mode, switch device and stop Live View, and MUST show "Leave SID Player". In Full App it
  MUST show "Use SID Player" only while no device is connected (`OFFLINE_NO_DEMO` or `DEMO_ACTIVE`). The
  keypad shortcuts `machinePauseResume`, `machineReset`, `openDeviceSwitcher` in `App.tsx` MUST be
  `undefined` in SID Player.
- Files: `src/components/input/KeypadQuickMenu.tsx`, `src/App.tsx`.
- Choke point: `isSurfaceVisible("quick-menu:…")`.
- Tests: `tests/unit/components/input/KeypadQuickMenu.test.tsx` — "SID Player lists visible tabs and the leave
  entry", "Full App offers SID Player only without a connected device".
- Verification: unit, Playwright keypad, handset.
- Status: Not started. Evidence: —

#### SPM-SRCH-01 Search hides device entries

- Requirement: `isSearchEntryShown(entry, appMode)` MUST hide, in SID Player, every entry with a `device` or
  `capability` requirement, a `flag` requirement on a `requires_device` flag, or a target on a hidden route
  or section. Search results and promoted tiles MUST use it.
- Files: `src/lib/appMode/surfaces.ts`, `src/hooks/useSearchResults.ts`.
- Choke point: `isSearchEntryShown`.
- Tests: `tests/unit/lib/search/sidPlayerSearch.test.ts` — "SID Player hides device and capability entries",
  "SID Player hides entries targeting Config".
- Verification: unit, Playwright.
- Status: Not started. Evidence: —

#### SPM-TOUR-01 Tour steps

- Requirement: `tourStepsFor(appMode)` MUST drop steps with `requiresDevice` or a hidden anchor (`disks`) in
  SID Player. `TourContext` MUST carry the app mode so "Welcome", "Build a playlist" and "Keys work too" use
  SID Player wording ("1 to 4 open pages"). `TourDriver` MUST use the filtered list; `deviceStepsPending`
  MUST stay false in SID Player.
- Files: `src/lib/tour/steps.ts`, `src/components/tour/TourDriver.tsx`.
- Choke point: `tourStepsFor`.
- Tests: `tests/unit/lib/tour/steps.test.ts` — "SID Player tour has no device or Disks step", "SID Player
  key step names the visible tab count".
- Verification: unit, Playwright, handset.
- Status: Not started. Evidence: —

#### SPM-DOC-01 In-app guide chapters

- Requirement: `GuideContext` MUST carry the app mode. In SID Player `buildGuideChapters` MUST omit
  `machineChapters` and the `devices`, `connection-problems` and `status-badge` help chapters, and MUST add a
  "SID Player" chapter (how to leave, what is hidden, ROM limitation). Full App MUST include the same
  chapter.
- Files: `src/lib/docs/guide/chapters.ts`, `types.ts`, `helpChapters.ts`.
- Choke point: `buildGuideChapters`.
- Tests: `tests/unit/lib/docs/guide/chapters.test.ts` — "SID Player guide omits machine chapters", "both modes
  include the SID Player chapter".
- Verification: unit.
- Status: Not started. Evidence: —

### 5.9 Errors, toasts and diagnostics

#### SPM-ERR-01 No device errors in SID Player

- Requirement: In SID Player `reportUserError` MUST log connectivity-class failures and
  `SidPlayerTrafficBlockedError` without a toast, and MUST NOT show "C64 Ultimate not reachable".
- Files: `src/lib/uiErrors.ts`.
- Choke point: `reportUserError`.
- Tests: `tests/unit/lib/uiErrors.sidPlayer.test.ts` — "SID Player logs a connectivity failure without a
  toast".
- Verification: unit; Playwright asserts no toast (`SPM-NET-01` session).
- Status: Not started. Evidence: —

#### SPM-ERR-02 The badge says SID Player

- Requirement: `deriveConnectivityState` MUST return a new `"SID Player"` state for `OFFLINE_NO_DEMO` while SID
  Player is active. `UnifiedHealthBadge` MUST render it without a severity glyph, with no long-press switcher,
  and a tap MUST open Diagnostics as it does today.
- Files: `src/lib/diagnostics/healthModel.ts`, `UnifiedHealthBadge.tsx`.
- Choke point: `deriveConnectivityState`.
- Tests: `tests/unit/lib/diagnostics/healthModel.test.ts` — "SID Player maps offline to the SID Player state";
  `UnifiedHealthBadge.sidPlayer.test.tsx` — "the badge reads SID Player and opens no switcher".
- Verification: unit, Playwright.
- Status: Not started. Evidence: —

#### SPM-ERR-03 Diagnostics in SID Player

- Requirement: Diagnostics MUST stay reachable (logs, share, settings transfer). The header device line and
  connection actions MUST be replaced by `DeviceLessChoices` through `DiagnosticsConnectionActions`.
- Files: `src/components/diagnostics/DiagnosticsConnectionActions.tsx`.
- Choke point: that component.
- Tests: `tests/unit/components/diagnostics/DiagnosticsConnectionActions.test.tsx` — "SID Player shows mode
  choices instead of device actions".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-ERR-04 Interstitials never appear in SID Player

- Requirement: `DemoModeInterstitial`, `DeviceDiscoveryInterstitial` and `DeviceAuthChallengeDialog` MUST NOT
  open in SID Player. This follows from `SPM-MODE-01`; no component change is expected.
- Tests: `tests/unit/lib/connection/connectionManager.sidPlayer.test.ts` — "SID Player never raises the Demo
  Mode offer".
- Verification: unit.
- Status: Not started. Evidence: —

### 5.10 Switch UX

#### SPM-SWT-01 Entry points

- Requirement: SID Player MUST be reachable from: the Settings `app-mode` section (both modes), the Quick menu
  (`SPM-QM-01`), Home's connect card while offline in Full App, the first-run offer (`SPM-FRST-01`), and
  Diagnostics in SID Player. Leaving MUST be reachable from the Settings `app-mode` section, the Quick menu,
  the Home card and Diagnostics. Every entry MUST be operable with the focus ring alone, scroll into view
  when focused, be at least 44x44 CSS px, and use text at or above the 14/16 px floors.
- Files: `src/pages/settings/AppModeSettingsSection.tsx` (new, placed after Appearance), consumers in
  `SPM-ARCH-06`.
- Tests: `playwright/keypadOnlyNavigation.spec.ts` gains "SID Player can be entered and left by keypad only";
  `playwright/smallScreenErgonomics.spec.ts` gains the SID Player Settings and Home states.
- Verification: Playwright, handset.
- Status: Not started. Evidence: —

#### SPM-SWT-02 Transitions and confirmation

- Requirement: Entering SID Player MUST show the Enter confirmation, then persist `sid-player`, settle the
  connection (`SPM-MODE-01`) and navigate to Home if the current route becomes hidden. Leaving MUST show the
  Leave confirmation; "Full App" persists `default` and runs `discoverConnection("settings")`; "Demo Mode"
  persists `demo` and pins Demo Mode. Cancel changes nothing. Back and the left soft key MUST cancel.
- Files: `src/lib/appMode/appModeTransitions.ts`, `DeviceLessChoices.tsx`.
- Choke point: `appModeTransitions`.
- Tests: `tests/unit/lib/appMode/appModeTransitions.test.ts` — "leaving to Full App starts settings
  discovery", "cancel changes nothing"; `playwright/sidPlayerMode.spec.ts` — "enter and leave SID Player
  from Settings".
- Verification: unit, Playwright, handset.
- Status: Not started. Evidence: —

#### SPM-SWT-03 Copy follows the rules

- Requirement: All new text MUST be sentence case except the feature names SID Player and Demo Mode, MUST be
  American English, and MUST name no unannounced hardware.
- Tests: `tests/unit/lib/appMode/copy.test.ts` — "SID Player copy is sentence case and fits two compact lines".
- Verification: unit, review.
- Status: Not started. Evidence: —

### 5.11 First run

#### SPM-FRST-01 Offer SID Player when no device is found

- Requirement: In a variant whose start-up mode is `default`, when startup discovery ends without a device and
  no saved device has ever connected (`lastSuccessfulConnectionAt` absent on all), the existing
  `DemoModeInterstitial` MUST offer, in this order: "Use SID Player" (primary), "Continue in Demo Mode",
  "Retry connection". The host field and Save & retry MUST stay on non-compact profiles only. The copy MUST
  say the choice can be changed in Settings. Closing the dialog MUST keep today's decline semantics.
- Rationale: The person with no device should not be led into a simulated machine they do not own.
- Files: `src/components/DemoModeInterstitial.tsx`, `src/lib/connection/demoOfferMemory.ts` (first-run
  predicate).
- Choke point: `DemoModeInterstitial`.
- Tests: `tests/unit/components/DemoModeInterstitial.test.tsx` — "first run offers SID Player first", "a user
  whose device connected before is not offered SID Player first"; `playwright/sidPlayerMode.spec.ts` —
  "first run without a device offers SID Player".
- Verification: unit, Playwright, handset in flight mode.
- Status: Not started. Evidence: —

#### SPM-FRST-02 A SID Player start-up never asks

- Requirement: When the resolved start-up mode is `sid-player`, the app MUST start in SID Player with no
  discovery, no offer and no confirmation.
- Files: `src/components/ConnectionController.tsx` (startup effect calls `startForStartupMode()` from
  `appModeTransitions.ts`).
- Choke point: `startForStartupMode`.
- Tests: `tests/unit/lib/appMode/startForStartupMode.test.ts` — "sid-player start-up shows no offer and sends
  no probe".
- Verification: unit, Playwright, handset.
- Status: Not started. Evidence: —

#### SPM-FRST-03 A Demo start-up skips discovery

- Requirement: When the resolved start-up mode is `demo`, the app MUST pin Demo Mode at launch without
  discovery and without the offer.
- Files: `appModeTransitions.ts`.
- Choke point: `startForStartupMode`.
- Tests: `tests/unit/lib/appMode/startForStartupMode.test.ts` — "demo start-up pins Demo Mode without
  probing", "default start-up runs startup discovery".
- Verification: unit.
- Status: Not started. Evidence: —

### 5.12 Variant and build

#### SPM-VAR-01 Variant field `runtime.startup_mode`

- Requirement: `variants.yaml` MUST accept `runtime.startup_mode` with values `default`, `demo`,
  `sid-player`; absent means `default`. `generate-variant.mjs` MUST validate it like the other `runtime`
  enums and emit `runtime.startupMode`. Only `appModeStore.ts` reads it (`SPM-ARCH-01`). No `mode_locked`
  field is added: a locked mode contradicts "the user stays in control", and the generator's rejection of
  unknown fields lets one be added later without migration.
- Files: `scripts/generate-variant.mjs`, `src/generated/variant.json`, `src/generated/variant.ts`,
  web server copy, `docs/variants.md`.
- Tests: `tests/unit/scripts/generateVariant.test.ts` — "startup_mode defaults to default", "accepts each
  start-up mode", "rejects an unknown start-up mode".
- Verification: unit, `npm run variant:check`.
- Status: Not started. Evidence: —

#### SPM-VAR-02 Persisted user choice wins

- Requirement: The variant value applies only while `c64u_startup_mode` is absent. Any explicit choice
  (`SPM-SWT-02`, Settings `app-mode`) writes it. Accepting Demo Mode from the automatic offer remains
  session-only, as today, and writes nothing. The key MUST NOT be part of settings export or import
  (`settingsTransfer.ts` unchanged; no export version bump).
- Tests: `tests/unit/lib/appMode/appModeStore.test.ts` (`SPM-ARCH-01`); `tests/unit/lib/config/settingsTransfer.test.ts`
  — "export does not carry the start-up mode".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-VAR-03 The SID Player variant

- Requirement: `variants.yaml` MUST declare variant `sid-player`: `display_name: SID Player`,
  `app_id: sid-player`, `exported_file_basename: sid-player`, Android `application_id: uk.gleissner.sidplayer`
  and matching `custom_url_scheme`, description "Play Commodore 64 SID music on your phone.", its own asset
  sources under `variants/assets/sid-player/`, the same `runtime.endpoints` as the default variant,
  `runtime.startup_mode: sid-player`, `publish_to_google_play: false`, Android platform only.
- Files: `variants/variants.yaml`, `variants/assets/sid-player/{icon,logo,splash}.png`, generated PNGs from
  `node scripts/generate-variant.mjs`.
- Tests: `tests/unit/scripts/generateVariant.test.ts` — "the SID Player variant starts in SID Player and has
  its own application id".
- Verification: unit; CI packaging metadata check (`build-android-apks.mjs --verify-metadata`).
- Status: Not started. Evidence: —

#### SPM-VAR-04 CI builds it, release stays opt-in

- Requirement: `repo.publish_defaults.ci` MUST include `sid-player`; `repo.publish_defaults.release` MUST
  NOT. `.github/workflows/manual.yaml` MUST derive its variant loop from `variants.yaml` instead of a literal
  list.
- Files: `variants/variants.yaml`, `.github/workflows/manual.yaml`.
- Tests: `tests/unit/scripts/generateVariant.test.ts` — "SID Player is built in CI and not attached to
  releases".
- Verification: CI run of `Android | Packaging (sid-player)`.
- Status: Not started. Evidence: —

#### SPM-VAR-05 Manual scope follows the start-up mode

- Requirement: `scripts/build-manuals.mjs` MUST derive a SID Player manual scope from
  `variant.runtime.startupMode === "sid-player"`: music, SID Radio, HVSC, playlists, search, Settings subset,
  the SID Player chapter, and one closing chapter "Add a C64 Ultimate later" that explains Leave SID Player.
  `targetDeviceShortName` and `appDeviceName` MUST gain the scope rather than a new variant-id predicate.
- Files: `scripts/build-manuals.mjs`, `docs/manual/sid-player/…` (generated).
- Tests: `tests/unit/scripts/buildManuals.test.ts` — "the SID Player manual has no machine chapters",
  "the broad manual documents SID Player".
- Verification: unit, `npm run manuals:build`.
- Status: Not started. Evidence: —

#### SPM-VAR-06 Store listing metadata

- Requirement: Store listing text (short and full description, feature list) SHOULD live in
  `variants/assets/sid-player/store/` and be generic about phones.
- Status: Deferred until publishing is decided. Evidence: —

### 5.13 Documentation and inventory

#### SPM-DOC-02 CTA inventory and reference-docs lint

- Requirement: `docs/cta-inventory.md` MUST add the Settings `app-mode` section, `DeviceLessChoices` test ids,
  Quick menu entries, the SID Player Home card, and a §3 count row and §4 notes for SID Player per page.
  `npm run lint:reference-docs` MUST pass without baseline additions.
- Verification: lint, on-device scope enumeration (inventory §7).
- Status: Not started. Evidence: —

#### SPM-DOC-03 UX guideline amendment

- Requirement: `docs/ux-guidelines.md` "Health Badge" MUST state that in SID Player the badge reads
  "SID Player" and carries no connectivity severity, and keeps its position and visibility rules.
- Status: Not started. Evidence: —

#### SPM-DOC-04 Manual and screenshots

- Requirement: Both existing manuals MUST gain a SID Player chapter. Screenshots MUST be added for SID Player
  Home, Play, Settings `app-mode` and the first-run offer at the compact and medium profiles under
  `docs/img/app/sid-player/`. No other screenshot is refreshed.
- Status: Not started. Evidence: —

### 5.14 Testing

#### SPM-TST-01 Unit and contract

- Requirement: Every test named above MUST be red when its production change is reverted (revert-check per
  commit, per AGENTS.md).
- Status: Not started. Evidence: —

#### SPM-TST-02 Playwright SID Player suite

- Requirement: `playwright/sidPlayerMode.spec.ts` MUST start the app with `c64u_startup_mode=sid-player`
  (init script) against the mock device server and assert the `SPM-MODE-03` table, zero device requests,
  zero toasts, and keypad-only operation. The existing suites stay in Full App and are not edited
  beyond the additions named in `SPM-SWT-01`.
- Status: Not started. Evidence: —

#### SPM-TST-03 Variant start-up per APK

- Requirement: The CI packaging job MUST verify each APK's application id and display name. A launch smoke
  per variant (Maestro flow `.maestro/sid-player-launch.yaml` asserting the SID Player badge and four tabs)
  SHOULD run where the emulator job can take the variant matrix.
- Status: Not started (launch smoke may be Deferred). Evidence: —

#### SPM-TST-04 Coverage

- Requirement: Patch coverage MUST reach the 94% Codecov target; the merged gate stays at 93% lines and 85%
  branches.
- Status: Not started. Evidence: —

#### SPM-TST-05 Handset validation

- Requirement: On a compact keypad phone with the SID Player APK: keypad-only walk of all four tabs, enter and
  leave SID Player, play HVSC and SID Radio, background and resume, and a CDP request log showing no
  device-addressed request. On a standard phone with the default APK in flight mode: first-run offer and
  switch. No Ultimate is driven by these checks.
- Status: Not started. Evidence: —

### 5.15 Editions

The repository builds two editions today: the broad edition (default variant) and the compact keypad edition
(a variant for a compact keypad phone: 320x427 CSS px, physical keypad, focus-ring navigation, T9 on by
default). SID Player is a runtime mode of the shared code, so it exists in both editions. The start-up mode is
a field independent of the edition, so editions and start-up modes compose without one `variants.yaml` entry
per combination.

#### SPM-ED-01 SID Player in both editions

- Requirement: SID Player MUST be available and switchable at runtime in the broad edition and in the compact
  keypad edition, through the same entry points (`SPM-SWT-01`). No surface classification may depend on the
  variant id.
- Rationale: The mode is a property of the user's situation, not of the build.
- Files: `src/lib/appMode/surfaces.ts` (no variant import).
- Choke point: `isSurfaceVisible` takes the app mode only.
- Acceptance: grep finds no `variant.id` in `src/lib/appMode/`.
- Tests: `tests/unit/lib/appMode/surfaces.test.ts` — "surface visibility does not depend on the variant".
- Verification: unit; Playwright per edition (`SPM-ED-05`).
- Status: Not started. Evidence: —

#### SPM-ED-02 Edition, start-up mode and keypad UI compose independently

- Requirement: Three independent inputs decide the experience: the variant (identity, assets, keypad and
  display defaults such as `default_t9_input_enabled`, `default_display_profile`, `key_labels`), the start-up
  mode (`runtime.startup_mode`, `SPM-VAR-01`), and the user's persisted choice (`SPM-VAR-02`). `variants.yaml`
  MUST NOT gain an entry per combination. `generate-variant.mjs` MUST accept an `APP_STARTUP_MODE`
  environment override (validated like the YAML field), so any edition can be built with any start-up mode
  for testing or a downstream build without editing `variants.yaml`, in the same way `APP_KEY_LABELS_FILE`
  overrides key labels. A dedicated variant entry is needed only when the identity changes (application id,
  name, icon), as for `sid-player` (`SPM-VAR-03`).
- Files: `scripts/generate-variant.mjs`, `docs/variants.md`.
- Choke point: the generator's `runtime` normalization.
- Tests: `tests/unit/scripts/generateVariant.test.ts` — "APP_STARTUP_MODE overrides the start-up mode of the
  selected variant", "APP_STARTUP_MODE rejects an unknown mode", "the compact keypad edition keeps its keypad
  defaults when built with a SID Player start-up".
- Verification: unit, `npm run variant:check` (the override is never used for checked-in files).
- Status: Not started. Evidence: —

#### SPM-ED-03 Keypad operation of SID Player in the compact keypad edition

- Requirement: In the compact keypad edition SID Player MUST be fully operable from the keypad:
  1. Digits map to visible tabs: 1 Home, 2 Play, 3 Settings, 4 Docs; 5 and 6 do nothing; 7 opens search
     (`SPM-NAV-03`).
  2. The right soft key (Menu) opens the Quick menu, which lists the four tabs and "Leave SID Player"
     (`SPM-QM-01`).
  3. The left soft key (Back) cancels the Enter and Leave confirmations and the first-run offer; at a page
     root it keeps today's behavior (`navigateBackOrLeave`: history back, else send the app to the
     background). A hidden-route redirect uses `replace`, so Back never returns to a hidden page.
  4. Initial focus on SID Player Home is the search field; on Settings it is the first visible section. A
     hidden section is never a focus target because it does not render (`SPM-HOME-02`).
  5. The keypad guidance bar labels follow the focus ring and need no change; the Enter and Leave
     confirmations MUST expose their buttons to the ring so the bar names OK and Back correctly.
  6. The tour runs the SID Player step list (`SPM-TOUR-01`) and its key step reads "1 to 4 open pages".
  7. Every new control is at least 44x44 CSS px and every new text at least 14 px (16 px body) at the
     compact profile; nothing is shrunk to fit.
- Files: `tabRoutes.ts`, `useFocusNavigation.tsx`, `KeypadQuickMenu.tsx`, `DeviceLessChoices.tsx`,
  `src/lib/tour/steps.ts`.
- Choke point: the navigation, Quick menu and tour choke points in §7.
- Tests: `playwright/keypadOnlyNavigation.spec.ts` — "SID Player can be entered and left by keypad only",
  "SID Player digit keys open the four visible tabs"; `playwright/smallScreenErgonomics.spec.ts` — "SID
  Player screens meet the target and text floors at the compact profile"; `tests/unit/lib/navigation/navigateBack.test.ts`
  — "Back after a hidden-route redirect does not return to the hidden page".
- Verification: Playwright at the compact profile; handset (`SPM-TST-05`).
- Status: Not started. Evidence: —

#### SPM-ED-04 Manual text per edition

- Requirement: Each edition's manual MUST document SID Player through the existing naming helpers in
  `scripts/build-manuals.mjs` (`appDeviceName`, `targetDeviceShortName`) and the key-label fields, never
  literal device or phone names. The compact keypad edition's chapter MUST give the keypad route (Menu key,
  "Leave SID Player"; digits 1 to 4) using `key_labels`; the broad edition's chapter MUST give the touch route.
  A build whose start-up mode is `sid-player` uses the SID Player scope (`SPM-VAR-05`) on top of its edition.
- Files: `scripts/build-manuals.mjs`, generated `docs/manual/**`.
- Tests: `tests/unit/scripts/buildManuals.test.ts` — "each edition's manual has a SID Player chapter",
  "the compact keypad edition's SID Player chapter names keys through the key labels", "SID Player manual
  text uses the naming helpers only".
- Verification: unit, `npm run manuals:build`.
- Status: Not started. Evidence: —

#### SPM-ED-05 Tests per edition and profile

- Requirement: `playwright/sidPlayerMode.spec.ts` MUST run the SID Player assertions at the compact and medium
  display profiles (`playwright/displayProfileViewports.ts`), with keypad input enabled and with T9 on as the
  compact keypad edition defaults, as well as with the broad edition defaults. The CI packaging job MUST build
  both existing editions and `sid-player` and verify each APK's metadata (`SPM-TST-03`).
- Tests: `playwright/sidPlayerMode.spec.ts` parameterized over `{ profile: compact | medium } x { keypad
  defaults: compact keypad edition | broad edition }`.
- Verification: Playwright, CI.
- Status: Not started. Evidence: —

#### SPM-ED-06 CTA inventory per edition

- Requirement: `docs/cta-inventory.md` MUST record, for SID Player, the per-page counts in §3 and the scopes in
  §4 for Home, Play, Settings and Docs, the digit-to-tab mapping above, and the Quick menu entries, at the
  compact profile. The on-device enumeration in §7 MUST be rerun in SID Player on the compact keypad phone.
- Verification: handset enumeration; `npm run lint:reference-docs`.
- Status: Not started. Evidence: —

### 5.16 C64 ROMs: skipping and supplying them

Product decision: both a graceful skip for tunes that need ROMs, and an easy way for users to supply their
own ROM files. No ROM is bundled. No ROM is fetched from the network, except from the user's own connected
device as today. This section applies to SID Player and to Full App whenever no device can supply the ROMs
(`OFFLINE_NO_DEMO`, `DEMO_ACTIVE`).

#### SPM-ROM-01 Which ROMs, and which tunes need them

- Requirement: The app MUST store and use the KERNAL (8192 bytes) and BASIC (8192 bytes) images. The need
  matrix MUST be implemented as one pure function, `romNeedFor(sidBytes)` in
  `src/lib/playback/localSidWorkerCore.ts`, beside `detectRomRequired`:

  | Tune | Needs | Without them |
  | --- | --- | --- |
  | RSID v2+ with the BASIC flag (`detectRomRequired`) | KERNAL and BASIC | skipped (`SPM-ROM-05`) |
  | Every other PSID or RSID | nothing | plays on the synthesized minimal KERNAL; a real KERNAL improves fidelity for tunes that call KERNAL routines, which no header declares |

  The character ROM (4096 bytes) MUST NOT be stored or used. The engine passes `null` for it today, and no
  header declares a need for it. A supplied character ROM file is reported as not needed (`SPM-ROM-11`).
  Support for it is `SPM-ROM-16` (Deferred).
- Rationale: BASIC programs call KERNAL routines, so a BASIC image alone does not make a BASIC tune
  playable. "Needs ROM" can only be detected from the header; a late ROM call is caught by `SPM-ROM-06`.
- Files: `localSidWorkerCore.ts`.
- Choke point: `romNeedFor`.
- Tests: `tests/unit/playback/localSidWorkerCore.test.ts` — "a BASIC-declared RSID needs KERNAL and BASIC",
  "a PSID and an RSID without the BASIC flag need no ROM".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-ROM-02 Recognize a supplied file

- Requirement: `classifyRomFile(name, bytes)` in `c64SystemRoms.ts` MUST return zero or more validated
  `C64RomImage`s, or a short reason, using these structural rules:
  1. 8192 bytes: BASIC when the `CBMBASIC` signature is present, KERNAL when the reset vector check passes;
     the known fingerprint, when matched, names the revision.
  2. 8194 bytes whose first two bytes are a load address of `$A000` (BASIC) or `$E000` (KERNAL): strip the
     header, then apply rule 1.
  3. 16384 bytes: a combined image with BASIC in the first half and KERNAL in the second, validated half by
     half. One valid half is accepted alone.
  4. 4096 bytes: a character ROM, reported as not needed.
  5. Anything else, including a size above 16386 bytes, is not recognized and is not read past 16386 bytes.
  The file name is never used to decide the kind; it is only shown in feedback. A known-good fingerprint list
  MUST NOT gate acceptance. Other KERNAL revisions, regional and custom KERNALs are accepted as
  "unrecognised variant", with the note "may change how a few tunes sound". Images that fail
  `validateRomImage` are rejected with its reason.
- Rationale: Users hold ROM files in several common layouts. A hash allowlist would reject legitimate
  revisions, and structural checks already reject RAM dumps and wrong files.
- Files: `src/lib/roms/c64SystemRoms.ts`.
- Choke point: `classifyRomFile`.
- Tests: `tests/unit/lib/roms/classifyRomFile.test.ts` — "an 8 KiB image with the BASIC signature is BASIC",
  "an 8 KiB image with a KERNAL reset vector is KERNAL", "a load-address header is stripped", "a 16 KiB
  combined image yields BASIC and KERNAL", "a 4 KiB image is reported as a character ROM", "a uniform or RAM-like
  image is rejected with its reason", "an unknown revision is accepted as an unrecognised variant", "the file
  name does not decide the kind". Fixtures MUST be synthetic images that satisfy the structural rules; no ROM
  bytes are committed. The known-fingerprint path is tested by injecting a fingerprint table.
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-ROM-03 Storage, source and privacy

- Requirement: `StoredRom` MUST gain `source: "file" | "device"`. An entry without it reads as `device`, so
  the v1 key and existing stored images stay valid without migration. For a file, `capturedFrom` holds the
  file name. Images stay in app-private storage, survive restarts and app updates, and MUST NOT be part of
  settings export, diagnostics export or shared logs. Removing MUST be possible for one kind or for both.
  Every save and remove MUST dispatch `c64u-system-roms-changed`.
- Rationale: The images are copyrighted. They must not travel in a file a user shares.
- Files: `src/lib/roms/romStore.ts`.
- Choke point: `saveRom`, `clearStoredRoms`, new `removeStoredRom(kind)`.
- Tests: `tests/unit/lib/roms/romStore.test.ts` — "an entry without a source reads as from the device",
  "removing one kind keeps the other", "save and remove announce the change";
  `tests/unit/lib/config/settingsTransfer.test.ts` — "settings export carries no ROM image";
  `tests/unit/lib/diagnostics/diagnosticsExport.test.ts` — "a diagnostics report carries no ROM image".
- Verification: unit.
- Status: Not started. Evidence: —

#### SPM-ROM-04 Precedence between file and device ROMs

- Requirement: Each kind has one slot. An explicit user action replaces the slot: importing a file, or
  "Read from C64" in Settings, which asks for confirmation when the slot holds a file. The automatic device
  read (`ensureSystemRoms`) MUST fill only empty slots and MUST NEVER overwrite a `file` slot.
  `fetchSystemRomsFromDevice` MUST take a `fillEmptyOnly` option to enforce this.
- Rationale: The user's deliberate choice is never undone silently. A connected device still completes an
  incomplete set without asking.
- Files: `romFetchService.ts`, `ensureSystemRoms.ts`, `LocalEngineRomsRow.tsx`.
- Choke point: `fetchSystemRomsFromDevice`.
- Tests: `tests/unit/lib/roms/ensureSystemRoms.test.ts` — "the automatic read fills an empty slot and keeps a
  file slot", "an explicit read replaces a file slot after confirmation".
- Verification: unit; handset with a device in Full App (optional).
- Status: Not started. Evidence: —

#### SPM-ROM-05 Skip before opening when the header declares a need

- Requirement: When `romNeedFor` reports a need that the store cannot meet and no device can play the tune,
  the controller MUST NOT route it to the C64. Instead it MUST record a skip (`SPM-ROM-07`) and advance through
  the existing auto-advance path. "No device" means SID Player, `OFFLINE_NO_DEMO`, or the simulated device.
  `romFallbackDecision` MUST return a `skip` route for that case. With a real connected device the existing
  route to the C64 stays.
- Files: `src/lib/playback/playbackEngineRouting.ts`, `usePlaybackController.ts` (one call site).
- Choke point: `romFallbackDecision`.
- Tests: `tests/unit/lib/playback/playbackEngineRouting.test.ts` — "a BASIC tune without ROMs and without a
  device is skipped", "a BASIC tune without ROMs plays on a connected C64"; `tests/unit/pages/playFiles/
  usePlaybackController.romSkip.test.tsx` — "a skipped tune advances to the next playable tune at once".
- Verification: unit, Playwright, handset.
- Status: Not started. Evidence: —

#### SPM-ROM-06 Skip when the engine refuses at open

- Requirement: A `romRequired: true` result from `LocalSidPlaybackController.play()` MUST record a skip and
  advance immediately, in every mode. Today the result is ignored and the tune plays silence until its
  songlength runs out. This is a defect in both modes and ships with its own regression test.
- Files: `usePlaybackController.ts` (the `play` call site), `localSidPlaybackController.ts`.
- Choke point: the result of `play()`.
- Tests: `tests/unit/pages/playFiles/usePlaybackController.romSkip.test.tsx` — "a tune the engine refuses
  for missing ROMs advances instead of playing silence". Reverting the fix must make it fail.
- Verification: unit, handset.
- Status: Not started. Evidence: —

#### SPM-ROM-07 No stall and no error storm

- Requirement: Skips MUST be held in a session store, `src/lib/roms/romSkips.ts`, keyed by playlist item id
  and by SID MD5. `canPlayWithoutDevice` MUST treat a recorded item as unplayable, so auto-advance,
  `firstPlayableWithoutDevice`, next-tune prefetch and warm-up pass over it without opening it again. When a
  full pass over the playlist finds nothing playable, playback MUST stop with the notice of `SPM-ROM-08`
  rather than loop. SID Radio MUST draw the next station tune in the same way. Skips are logged at `info`
  with the item and the missing kinds; they are not errors. Rows of skipped items show the subtitle
  "Needs C64 ROMs".
- Files: new `romSkips.ts`, `playableWithoutDevice.ts`, `playlistRowSubtitle.ts`, the station queue provider.
- Choke point: `canPlayWithoutDevice`.
- Tests: `tests/unit/lib/roms/romSkips.test.ts` — "a recorded tune is not opened again this session";
  `tests/unit/pages/playFiles/playableWithoutDevice.test.ts` — "auto-advance passes over a tune that needs
  ROMs", "a playlist of only ROM-dependent tunes stops with one notice instead of looping".
- Verification: unit, Playwright.
- Status: Not started. Evidence: —

#### SPM-ROM-08 One calm notice with an Add ROMs action

- Requirement: The first skip in a session MUST show one toast: title "Skipped a tune", description "It needs
  the C64 ROMs. You can add your own copies.", action "Add ROMs". The action opens the ROM sheet
  (`SPM-ROM-09`). Further skips in the same session MUST NOT toast. The notice MAY appear once more after the
  ROM set changes and a skip happens again. On the keypad, the action MUST be reachable through the existing
  Quick menu entry for the newest notification action (`findNewestToastAction`). The toast MUST use the
  existing toast component and notification settings.
- Files: `src/lib/roms/romSkips.ts`, `src/lib/input/toastAction.ts` (no change expected).
- Choke point: `romSkips.noteSkip()`.
- Tests: `tests/unit/lib/roms/romSkips.test.ts` — "only the first skip in a session raises the notice", "the
  notice action opens the ROM sheet"; `playwright/sidPlayerRoms.spec.ts` — "Add ROMs from the notice is
  reachable from the keypad Quick menu".
- Verification: unit, Playwright, handset.
- Status: Not started. Evidence: —

#### SPM-ROM-09 The ROM sheet

- Requirement: One component, `src/components/roms/RomSheet.tsx` (an `AppSheet`), MUST show:
  - the current set ("KERNAL: 901227-03 from file kernal.bin", "BASIC: missing");
  - "Choose files" and "Choose a folder";
  - per-file results (`SPM-ROM-11`);
  - "Remove" for each kind.
  The copy MUST say: "Use your own copies of the C64 KERNAL and BASIC ROMs. This app does not include them
  and does not download them. Most tunes play without them." Every control MUST be focus-ring operable, at
  least 44x44 CSS px, with text at or above the floors. Back and the left soft key close the sheet. The
  developer-only `LocalEngineRomsRow` MUST become a summary row that opens this sheet. In Full App with a
  connected device the row also offers "Read from C64".
- Files: new `RomSheet.tsx`, `LocalEngineRomsRow.tsx`, `SidRadioSettingsSection.tsx` (no longer
  developer-only).
- Choke point: `RomSheet`.
- Tests: `tests/unit/components/roms/RomSheet.test.tsx` — "shows the current set and its sources", "removing
  one kind updates the set", "every control is reachable by the focus ring".
- Verification: unit, Playwright, handset.
- Status: Not started. Evidence: —

#### SPM-ROM-10 Picking files

- Requirement:
  - "Choose files" MUST allow choosing several files at once. On the web this is `<input type="file"
    multiple>`. Native gets a new `FolderPicker.pickFiles` (Android `ACTION_OPEN_DOCUMENT` with
    `EXTRA_ALLOW_MULTIPLE`; iOS document picker with multiple selection), read through the existing
    `readFile`.
  - "Choose a folder" MUST use `pickDirectory` and `readFileFromTree`, reading at most 64 files of at most
    16386 bytes each, without descending into subfolders.
  - Picking MUST go through the existing override hook (`__c64uFolderPickerOverride`) so Playwright can
    supply a fake picker.
  - Cancelling a picker MUST change nothing and show nothing.
- Files: `src/lib/native/folderPicker.ts`, `android/app/src/main/java/uk/gleissner/c64commander/FolderPickerPlugin.kt`,
  `ios/App/App/NativePlugins.swift`, new `src/lib/roms/importRomFiles.ts`.
- Choke point: `importRomFiles(sources)`.
- Tests: `tests/unit/lib/roms/importRomFiles.test.ts` — "three files add KERNAL and BASIC and decline the
  character ROM", "a folder is read one level deep with a size cap", "cancel changes nothing";
  Android JVM `FolderPickerPluginTest` — "pickFiles returns every selected document";
  `playwright/sidPlayerRoms.spec.ts` — "choose files through a fake picker".
- Verification: unit, Android JVM, Playwright, handset.
- Status: Not started. Evidence: —

#### SPM-ROM-11 Per-file feedback

- Requirement: Each picked file MUST produce one result line, announced through an `aria-live` region:
  - "KERNAL added (901227-03)"
  - "BASIC added (901226-01)"
  - "KERNAL replaced"
  - "KERNAL added (unrecognised variant; may change how a few tunes sound)"
  - "BASIC and KERNAL added from one file"
  - "Character ROM: not needed for music"
  - "File not recognised: <short reason>"
  A summary line follows: "Ready: KERNAL and BASIC" or "Still missing: BASIC". Results within one pick are
  applied together. When two files supply the same kind, the last valid one wins and the line says so.
- Files: `RomSheet.tsx`, `importRomFiles.ts`.
- Tests: `tests/unit/lib/roms/importRomFiles.test.ts` — "each file gets one result line", "a duplicate kind
  reports which file was kept".
- Verification: unit, Playwright.
- Status: Not started. Evidence: —

#### SPM-ROM-12 A device with no document picker

- Requirement: When `canPickDocuments()` reports no file support, the sheet MUST replace both pick buttons
  with the path of the app's import folder (the app-specific external files directory, subfolder `roms`) and a
  "Check the folder" button. A new native method lists and reads that folder under the same limits as
  `SPM-ROM-10`. If this folder cannot be reached from a computer on the compact keypad phone, the handset
  check MUST record that as a blocker.
- Rationale: The keypad phone class this app targets may have no system document picker, and local sources
  are already hidden there for that reason.
- Files: `FolderPickerPlugin.kt` (or a small `RomImportPlugin`), `folderPicker.ts`, `RomSheet.tsx`.
- Tests: `tests/unit/components/roms/RomSheet.test.tsx` — "without a document picker the sheet offers the import
  folder"; Android JVM — "the import folder lists only top-level files under the size cap".
- Verification: unit, Android JVM, handset (compact keypad phone).
- Status: Not started. Evidence: —

#### SPM-ROM-13 Entry points

- Requirement: The ROM sheet MUST open from:
  - the skip notice action (`SPM-ROM-08`);
  - the Settings ROM row (`SPM-ROM-09`), shown in SID Player and in Full App;
  - the SID Player card on Home (`SPM-HOME-04`), as "Add C64 ROMs (optional)" until the set is complete,
    which also covers the first launch of a SID Player start-up;
  - the "SID Player" chapter of the in-app guide, through a button.
  The search index MUST gain an entry "C64 ROMs" that targets the Settings row.
- Files: `ConnectC64Card.tsx`, `LocalEngineRomsRow.tsx`, `helpChapters.ts`, `search/` sources.
- Tests: `tests/unit/pages/home/ConnectC64Card.test.tsx` — "offers Add C64 ROMs until the set is complete";
  `tests/unit/lib/search/sidPlayerSearch.test.ts` — "searching ROMs finds the ROM row".
- Verification: unit, Playwright.
- Status: Not started. Evidence: —

#### SPM-ROM-14 After an import

- Requirement: On `c64u-system-roms-changed`:
  - `romSkips` MUST forget every skip whose missing kinds are now present. Their rows lose the subtitle and
    the tunes play when reached.
  - Nothing MUST start playing by itself, and a playback stopped by the loop guard stays stopped.
  - Playlists are unchanged, because skipping never removes an item.
  - SID Radio does not re-insert tunes it passed over.
  - The rendered-tune cache key MUST carry the fingerprints of the present images instead of `/noroms`, so a
    pre-render made with another set is never reused.
  - `LocalSidEngine` MUST send each present image rather than only a complete pair, and the BASIC check MUST
    require both images. The worker protocol `roms` field becomes `{ kernal?: ArrayBuffer; basic?: ArrayBuffer }`.
- Files: `romSkips.ts`, `renderedTuneCache.ts`, `localSidEngine.ts` (15 lines of headroom),
  `localSidWorkerProtocol.ts`, `sidRendererContract.ts`, `wasmRendererCore.ts`, `sidplayEzRendererCore.ts`.
- Choke point: the `c64u-system-roms-changed` event.
- Tests: `tests/unit/lib/roms/romSkips.test.ts` — "adding the missing ROMs clears their skips and starts
  nothing"; `tests/unit/lib/playback/renderedTuneCache.test.ts` — "a different ROM set gives a different
  key"; `tests/unit/playback/wasmRendererCore.test.ts` — "a BASIC tune with BASIC but no KERNAL is refused",
  "a KERNAL alone is passed to the engine".
- Verification: unit, handset (play a BASIC-declared tune after importing).
- Status: Not started. Evidence: —

#### SPM-ROM-15 Sources of ROM bytes

- Requirement: ROM bytes MUST enter the store only through `importRomFiles` (user files, archives and shared
  items) and `fetchSystemRomsFromDevice` (the user's own device, automatic in Full App or through
  `SPM-ROM-18`). The repository MUST contain no ROM image, and no
  code may download one.
- Tests: `tests/unit/lib/roms/romSources.test.ts` — "only the two import paths call saveRom" (a module-graph
  check over `src/`).
- Verification: unit, review.
- Status: Not started. Evidence: —

#### SPM-ROM-16 Character ROM support

- Requirement: Store a 4096-byte character ROM and pass it to `setSystemROMs`.
- Rationale for deferring: no header declares a need for it, and no measured tune has been shown to need it.
  Revisit when a tune is shown to need it.
- Status: Deferred. Evidence: —

#### SPM-ROM-17 Full App without a device

- Requirement: In Full App with no device (`OFFLINE_NO_DEMO`), and in Demo Mode, the skip, notice, sheet and
  import MUST behave as in SID Player. With a real device connected, the behavior is unchanged: header-declared
  tunes go to the C64 when the set is incomplete, and the automatic device read fills empty slots
  (`SPM-ROM-04`). The ROM row is visible in every mode.
- Tests: `tests/unit/lib/playback/playbackEngineRouting.test.ts` — "Demo Mode skips a BASIC tune without
  ROMs"; `playwright/sidPlayerRoms.spec.ts` — "Full App offline skips and imports like SID Player".
- Verification: unit, Playwright.
- Status: Not started. Evidence: —

#### SPM-ROM-18 Get ROMs from my Ultimate (one-shot exception to SPM-NET-01)

- Requirement: The ROM sheet MUST offer "Get ROMs from my Ultimate" in every mode. In SID Player it is the
  only path allowed to send device traffic, and only while the user's request is in progress:
  1. The user picks a saved device, types a hostname or IP address, or presses "Look on this network". That
     button runs one LAN scan inside the scope and lists what it found.
  2. The app identifies the host (`GET /v1/info`, accepting any Ultimate-family product, including the
     cartridge) and asks for its password if it answers 401/403.
  3. The app reads the two ROM areas with `readMemory` (`ROM_SOURCE_ADDRESS`, 8192 bytes each) and stores
     the valid images as `source: "device"` through `fetchSystemRomsFromDevice`. The explicit-action
     precedence of `SPM-ROM-04` applies.
  4. The app stops.
  - The traffic is made by a transient `C64API` instance for that host. It MUST NOT change the connection
    state, the selected device, the saved devices (unless the user is in Full App and chooses "Save this
    device"), health probing, discovery schedules or the stored device host.
  - `deviceTrafficGate.ts` MUST expose `withRomReadException(host, run)`. It opens a scope bound to that one
    host and closes it in `finally`, or after 60 seconds, whichever comes first. Inside the scope
    `assertDeviceTrafficAllowed` allows only `GET /v1/info`, the `readmem` requests for the two ROM ranges,
    and one discovery scan. It blocks everything else, including other hosts, FTP and Telnet.
  - Cancel aborts the in-flight request and closes the scope.
- Rationale: Users who own a device but use SID Player get accurate ROMs with no file handling. The bounded
  scope keeps the rule "no device traffic in SID Player" true outside an explicit request.
- Files: `deviceTrafficGate.ts`, `romFetchService.ts` (accept a `C64API` for any host), `RomSheet.tsx`,
  `discoveryManager.ts` (scan inside the scope only).
- Choke point: `withRomReadException`.
- Tests: `tests/unit/lib/appMode/deviceTrafficGate.test.ts` — "the ROM exception allows only info and the two
  ROM reads on its host", "the ROM exception blocks another host, FTP, Telnet and any other REST path",
  "the scope closes after success, failure, cancel and the time bound", "outside the scope SID Player blocks
  everything"; `tests/unit/lib/roms/getRomsFromDevice.test.ts` — "reading ROMs changes no connection state,
  saved device or schedule". `SPM-NET-01`'s zero-request session test stays unchanged; a second session
  asserts exactly the allowed requests.
- Verification: unit, Playwright (mock device), handset against `c64u` and `u2` (two REST reads each; no
  other traffic in the CDP log).
- Status: Not started. Evidence: —

#### SPM-ROM-19 Archives

- Requirement: "Choose files" and the share target (`SPM-ROM-20`) MUST accept `.zip` and `.7z` archives,
  through the existing archive support (`localArchiveIngestion.ts`). The app MUST extract only entries of at
  most 16386 bytes, at most 256 entries, and no nested archives. It classifies each entry with
  `classifyRomFile` and reports one summary line per archive ("From roms.zip: KERNAL and BASIC added,
  12 other files ignored"). Extracted bytes MUST NOT be written to disk.
- Rationale: Emulator ROM packs and personal backups are usually archives; this saves the user from
  unpacking on a phone.
- Legal posture: the user supplies their own archive; nothing changes compared to single files.
- Size: small (reuses archive code).
- Tests: `tests/unit/lib/roms/importRomFiles.test.ts` — "an archive yields its ROM entries and ignores the
  rest", "oversized and nested entries are not extracted".
- Verification: unit, Playwright with a fake picker.
- Status: Not started. Evidence: —

#### SPM-ROM-20 Open with and share to the app

- Requirement: On Android the app SHOULD register for `ACTION_SEND` and `ACTION_SEND_MULTIPLE` (any type) and
  for `ACTION_VIEW` of `application/zip` and `application/x-7z-compressed`. A received item MUST be offered
  to the ROM import only after the user confirms in the ROM sheet ("Add these as C64 ROMs?"). It MUST work
  in every mode and on a cold start. Non-ROM content gets "File not recognised" and nothing else happens.
  `ACTION_VIEW` for `application/octet-stream` MUST NOT be registered, so the app does not appear for every
  binary file.
- Rationale: On a phone without a system document picker, a file manager, mail or cloud app can still hand
  the file over. This makes it the better fallback than `SPM-ROM-12` where a file manager exists.
- Legal posture: unchanged.
- Size: medium (manifest, an intent handler in `MainActivity`, a small plugin event).
- Tests: Android JVM — "a shared document reaches the app as one import request", "a view intent for an
  archive on a cold start opens the ROM sheet"; unit — "a received item is imported only after confirmation".
- Verification: Android JVM, handset.
- Status: Not started (recommended for the second ROM phase). Evidence: —

#### SPM-ROM-21 Emulator ROM folders

- Requirement: No separate feature. A user-visible folder that holds an emulator's ROMs is picked with
  "Choose a folder" (`SPM-ROM-10`). Content is detected by `classifyRomFile` regardless of file names, so
  common emulator layouts work as they are.
- Rationale for cutting a dedicated feature: other apps' private data folders cannot be read through the
  storage-access framework, so a dedicated "find my emulator" feature could only offer what the folder picker
  already offers.
- Status: Not started (covered by `SPM-ROM-10`). Evidence: —

#### SPM-ROM-22 User-supplied URL, FTP or network share

- Decision:
  - A free-form URL download: cut. It would turn the app into a downloader in which pasting a third-party
    link is the easiest path, which conflicts with the rule against fetching ROMs from the internet and
    raises store-policy risk.
  - FTP or SMB to the user's own NAS or PC: deferred. The native FTP client exists, but no SMB client does.
    Demand is unproven next to files, archives, share and the device read.
  - Any Ultimate-family device reachable by hostname is covered by `SPM-ROM-18`.
- Status: Deferred (FTP or SMB); cut (URL). Evidence: —

#### SPM-ROM-23 Honest ROM-less behavior and a measured skip set

- Requirement: The docs and the guide MUST state what happens without ROMs, based on the code and a
  measurement, not on assumption:
  - The WASM renderer passes `null` images. libsidplayfp then installs a minimal KERNAL replacement that
    provides reset and the standard interrupt entry points, an empty BASIC area and an empty character area.
  - Every PSID and every RSID that relies only on those entry points plays.
  - An RSID that declares BASIC cannot play (`SPM-ROM-05`).
  - Other tunes that call further KERNAL routines may play wrongly or go quiet. The header does not reveal
    them, and a quiet tune is not detected as a ROM problem.
  A measurement MUST render the HVSC RSID set and a PSID sample with and without the user's own ROMs (held
  locally, never committed) on the WASM renderer and on the native libSidplayEZ backend. It classifies each
  tune as identical, different or silent, and records the counts and the method in
  `docs/plans/sid-player-mode/rom-less-measurement.md`. If the silent group can be identified by a cheap
  check, it SHOULD feed `romNeedFor`, so the skip set is as small as is truthful.
- Rationale: Users must not be told ROMs are needed when they are not, and the skip notice must not be the
  only signal when a tune fails quietly.
- Tests: the measurement is evidence; `romNeedFor` changes, if any, get unit tests with synthetic headers.
- Verification: offline render harness (development machine), handset spot check.
- Status: Not started. Evidence: —

#### SPM-ROM-24 Freely licensed replacement ROMs (open decision)

- Requirement: none until decided. Open questions:
  1. Licence: is an open-source C64 ROM replacement project's licence compatible with this app's
     GPL-3.0-or-later licence and with app store distribution? This needs a legal check of the actual licence
     text; nothing is assumed here.
  2. Compatibility: does it keep the interrupt entry points and their cycle timing, which tune timing depends
     on? This is measured with the `SPM-ROM-23` harness against real ROMs.
  3. Product: would a bundled replacement set be presented as "built-in", with real ROMs as an optional
     upgrade?
  Commodore ROMs MUST NOT be bundled under any outcome.
- Status: Deferred (open decision; legal check needed). Evidence: —

#### SPM-ROM-25 Export or back up the imported ROM set

- Decision: not recommended; deferred. The user already holds the original files and can import them on
  another device in the same way. An in-app export adds a redistribution path and no convenience. Android
  backup is disabled in the manifest (`allowBackup="false"`), so images do not leave the device through
  backups.
- Status: Deferred (not recommended). Evidence: —

#### SPM-ROM-26 Guide page: where to get ROMs

- Requirement: The in-app guide and both manuals MUST have a section "Where do I get the C64 ROMs?" that names
  only lawful sources in plain words: a dump from a C64 or Ultimate-family device the user owns ("Get ROMs
  from my Ultimate"), the ROM files of an emulator installation the user has, and ROM files included in a
  licensed product the user bought. It MUST say that most tunes play without ROMs, MUST NOT link to any site,
  and MUST NOT name hosts that distribute copies. Manual text goes through the naming helpers (`SPM-ED-04`).
- Files: `helpChapters.ts`, `scripts/build-manuals.mjs`.
- Tests: `tests/unit/lib/docs/guide/chapters.test.ts` — "the ROM help names no URL";
  `tests/unit/scripts/buildManuals.test.ts` — "the ROM section is present in every edition".
- Verification: unit, review.
- Status: Not started. Evidence: —

#### ROM sourcing options: recommendation

| Option | Legal posture | Keypad steps | Size | Recommendation | ID |
| --- | --- | --- | --- | --- | --- |
| Multi-file and folder picker with content detection | user's own files | Add ROMs → Choose files → select → OK | small | build now | SPM-ROM-10/11 |
| Archive (zip, 7z) | user's own archive | as above | small | build now | SPM-ROM-19 |
| One-shot read from the user's Ultimate | user's own hardware | Add ROMs → Get ROMs from my Ultimate → pick device → OK | small | build now | SPM-ROM-18 |
| Import folder when no picker exists | user's own files | copy files, then Check the folder | medium | build now (fallback) | SPM-ROM-12 |
| Open with / share to the app | user's own files | file manager → Share → this app → confirm | medium | second ROM phase | SPM-ROM-20 |
| Emulator folder | user's own install | Choose a folder | none | covered by the folder picker | SPM-ROM-21 |
| URL download | invites third-party links | — | small | cut | SPM-ROM-22 |
| FTP or SMB to the user's own share | user's own files | host, path, credentials | medium to large | defer | SPM-ROM-22 |
| Honest ROM-less statement and measured skip set | none | — | small (measurement) | build now | SPM-ROM-23 |
| Open replacement ROM set | licence to verify | none (built in) | small to medium | open decision | SPM-ROM-24 |
| Export or back up the set | redistribution path | — | small | defer, not recommended | SPM-ROM-25 |
| "Where to get ROMs" guide page | names lawful sources only | Docs → SID Player | small | build now | SPM-ROM-26 |

### 5.17 Full-screen player

A user setting that, in SID Player, shows the Play page without the app bar and the tab bar. It reuses the
page shell and the existing chrome components through one flag, so no second layout is added.

Current state that shapes it:
- `AppBar` is rendered by each page and measures its own height (`rememberSlotAppBarHeight`).
- `TabBar` already hides itself while an interstitial is active (`useInterstitialActive`, `translate-y-full`).
- The page runway height subtracts `--app-tab-bar-reserved-height`, defined in `src/index.css`.
- `KeypadGuidanceBar` reserves its own height through `--keypad-guidance-reserved-height`.
- Toasts sit at the bottom (`toast-viewport`, `max-h-[40dvh]`).
- System bars follow the persisted "Hide status bar" and "Hide navigation bar" settings through
  `applyFullScreenFromSettings` (`src/lib/native/fullScreen.ts`). Live View's immersive view lives inside the
  Remote Input sheet and does not hide app chrome, so there is no chrome-hiding code to reuse from it; the
  reusable parts are the system-bar helper and the sheet presentation.

#### SPM-FS-01 Setting and persistence

- Requirement: The setting "Full-screen player", default off, MUST be stored in `appModeStore.ts` under
  `c64u_sid_player_full_screen`. It uses the same storage helpers and announces changes on the shared
  `c64u-app-settings-updated` event.
  - It applies only while SID Player is active. In Full App and in Demo Mode it is ignored, and its value is
    kept.
  - It persists across restarts, and screen-off and resume restore the same view.
  - It is not part of settings export or import, consistent with the mode itself (`SPM-VAR-02`).
- Rationale: `appSettings.ts` is at 997 of 1000 lines. The SID Player store is the cohesive home for a
  SID Player preference.
- Files: `src/lib/appMode/appModeStore.ts`.
- Tests: `tests/unit/lib/appMode/appModeStore.test.ts` — "full screen defaults to off", "full screen persists
  across a reload", "full screen is ignored outside SID Player and keeps its value";
  `tests/unit/lib/config/settingsTransfer.test.ts` — "export does not carry the full-screen setting".
- Verification: unit. Phase 3b.
- Status: Not started. Evidence: —

#### SPM-FS-02 One chrome-visibility flag

- Requirement: `useAppChromeVisible()` in `src/lib/appMode/chromeVisibility.ts` MUST return false only when
  all of these hold: SID Player is active, the setting is on, the route is `/play`, and no tour is running. Its
  consumers MUST be:
  - `AppBar`, which renders the exit strip (`SPM-FS-03`) instead of the title, badge and menu row;
  - `TabBar`, which hides the way it does for an interstitial and is removed from the focus ring;
  - one `data-app-chrome="hidden"` attribute on `<html>`, set by `TabBar`, under which `src/index.css` sets
    `--app-tab-bar-reserved-height` to `0px`;
  - `SwipeNavigationLayer`, which disables swipe while the flag is false, so the page cannot be left by a
    gesture the user cannot see.
  `KeypadGuidanceBar` stays, because it tells keypad users how to leave (`SPM-FS-05`). No component may test
  the setting directly.
- Files: new `chromeVisibility.ts`, `src/components/AppBar.tsx`, `src/components/TabBar.tsx`, `src/index.css`,
  `src/components/SwipeNavigationLayer.tsx`.
- Choke point: `useAppChromeVisible`.
- Tests: `tests/unit/lib/appMode/chromeVisibility.test.ts` — "chrome hides only on Play in SID Player with the
  setting on", "a running tour shows chrome"; `tests/unit/components/TabBar.test.tsx` — "the tab bar leaves
  the ring and frees its height in full screen"; `tests/unit/components/SwipeNavigationLayer.test.tsx` —
  "swipe is off in full screen".
- Verification: unit, Playwright. Phase 3b.
- Status: Not started. Evidence: —

#### SPM-FS-03 The exit control

- Requirement: In full screen, `AppBar` MUST render a slim strip with one button, "Exit full screen" (icon and
  label), at least 44x44 CSS px, aligned to the end. The strip carries the top and side safe-area insets that
  the full app bar carried, and keeps the `rememberSlotAppBarHeight` measurement so the page lays out under
  it. The button MUST be the first item of the page's focus ring. Pressing it turns the setting off; the
  change is persistent, and nothing is hidden or deferred. The button MUST stay visible and hittable while
  toasts and the guidance bar show; toasts are at the bottom, the strip at the top.
- Files: `AppBar.tsx`.
- Tests: `tests/unit/components/AppBar.test.tsx` — "full screen shows only the exit control", "the exit
  control turns full screen off"; `playwright/sidPlayerFullScreen.spec.ts` — "the exit control is
  unobstructed while three error toasts show at the compact profile".
- Verification: unit, Playwright (compact and medium), handset. Phase 3b.
- Status: Not started. Evidence: —

#### SPM-FS-04 Back leaves full screen

- Requirement: On the Play page in full screen, Back (hardware, system gesture or the left soft key) MUST turn
  full screen off, whatever the history depth. The next Back behaves as today (`navigateBackOrLeave`). A Back
  consumed by an open dialog or sheet is not affected. The check MUST live in `navigateBackOrLeave` as one
  call to `consumeBackForFullScreen()`.
- Rationale: Back is the exit every phone user tries first. Making it the guaranteed exit means nobody is
  stuck without chrome.
- Files: `src/lib/navigation/navigateBack.ts`, `chromeVisibility.ts`.
- Tests: `tests/unit/lib/navigation/navigateBack.test.ts` — "Back on Play in full screen turns full screen off
  and does not leave the app", "Back with a sheet open closes the sheet first".
- Verification: unit, Playwright keypad, handset. Phase 3b.
- Status: Not started. Evidence: —

#### SPM-FS-05 Guidance for keypad users

- Requirement: In full screen at the Play page root, `resolveGuidanceLabels` MUST label the left soft key
  "Exit full screen". The right soft key keeps "Menu", which opens the Quick menu whose first entry is "Exit
  full screen" (`SPM-FS-06`).
- Files: `src/components/input/KeypadGuidanceBar.tsx` (the pure resolver's input).
- Tests: `tests/unit/components/input/resolveGuidanceLabels.test.ts` — "full screen names Back as the exit".
- Verification: unit, handset. Phase 3b.
- Status: Not started. Evidence: —

#### SPM-FS-06 Entry points and quick toggles

- Requirement: The setting MUST be reachable from:
  - a switch row "Full-screen player" in the Settings `app-mode` section, shown in SID Player only;
  - a "Full screen" button on the Play page, shown in SID Player while the setting is off, at least 44 px,
    in the playback card's control row;
  - a Quick menu entry, "Full screen" or "Exit full screen", in SID Player only; while full screen is active it
    is the first entry.
  All three call one function, `setSidPlayerFullScreen(on)`.
- Files: `src/pages/settings/AppModeSettingsSection.tsx`, `src/pages/PlayFilesPage.tsx` (one element),
  `KeypadQuickMenu.tsx`.
- Tests: `tests/unit/components/input/KeypadQuickMenu.test.tsx` — "full screen puts Exit full screen first";
  `tests/unit/pages/PlayFilesPage.sidPlayer.test.tsx` — "the Full screen button shows only in SID Player with the
  setting off".
- Verification: unit, Playwright. Phase 3b.
- Status: Not started. Evidence: —

#### SPM-FS-07 First use explains the exit

- Requirement: The first time the setting is turned on, a dialog MUST say "Full screen shows only the player.
  To show the tabs again, choose Exit full screen at the top or press Back." It has one button, "OK", and
  records `c64u_sid_player_full_screen_explained`. Back and the left soft key close it. Full screen is never on
  without this dialog having been shown once: the default is off and no start-up mode turns it on.
- Files: `chromeVisibility.ts`, a small dialog built on the existing `Dialog` primitives (`src/components/ui/dialog.tsx`).
- Tests: `tests/unit/lib/appMode/chromeVisibility.test.ts` — "the first activation shows the explanation once".
- Verification: unit, Playwright, handset. Phase 3b.
- Status: Not started. Evidence: —

#### SPM-FS-08 Navigation while full screen

- Requirement: Full screen is how the Play page looks; it does not change other pages.
  - Digit keys keep their meaning (`SPM-NAV-03`). A digit for another tab opens that page with chrome. The
    digit for Play on Play keeps today's page reset. A digit is never ignored.
  - Deep links and search targets elsewhere open their page with chrome.
  - Returning to Play shows full screen again while the setting is on.
  - A launch that restores `/play` opens in full screen.
- Tests: `tests/unit/lib/appMode/chromeVisibility.test.ts` — "another route shows chrome with the setting on";
  `playwright/sidPlayerFullScreen.spec.ts` — "digit 3 opens Settings with chrome and digit 2 returns to full
  screen".
- Verification: unit, Playwright keypad, handset. Phase 3b.
- Status: Not started. Evidence: —

#### SPM-FS-09 Sheets, dialogs and toasts

- Requirement: Every sheet and dialog opened from Play must work unchanged and return to full screen when
  closed: Add items, playlist, SID Radio launcher, liked tunes, tune details, HVSC, the ROM sheet. They are
  portals and do not depend on chrome. Toasts keep their viewport and notification settings. Toast actions stay
  reachable through the Quick menu. T9 entry in sheet fields is unaffected.
- Tests: `playwright/sidPlayerFullScreen.spec.ts` — "Add items opens and returns to full screen", "SID Radio
  launcher opens and returns to full screen".
- Verification: Playwright (compact and medium). Phase 3b.
- Status: Not started. Evidence: —

#### SPM-FS-10 System bars, safe area and orientation

- Requirement: Full screen MUST NOT change the system bars. They keep following "Hide status bar" and "Hide
  navigation bar" through `applyFullScreenFromSettings`. Safe-area insets come from the exit strip
  (`SPM-FS-03`). Landscape works with the side insets applied.
- Rationale for not hiding the system bars:
  - The status bar carries the clock and battery, which matter while listening, and the existing policy keeps
    it at every profile.
  - Hiding the navigation bar on a touch phone removes the system Back, which is an exit.
  - Users who want both bars hidden already have the two existing settings, which combine with this one.
- Tests: `tests/unit/lib/native/fullScreen.test.ts` — "the full-screen player does not change system bar
  visibility"; `playwright/sidPlayerFullScreen.spec.ts` — "landscape keeps the exit control inside the safe
  area".
- Verification: unit, Playwright, handset. Phase 3b.
- Status: Not started. Evidence: —

#### SPM-FS-11 Interaction with the tour, Demo Mode and Full App

- Requirement:
  - A running tour shows chrome (`SPM-FS-02`), because its steps point at the tab bar and the menu button.
  - Leaving SID Player shows chrome at once and keeps the setting.
  - Entering Demo Mode from SID Player does the same.
  - Returning to SID Player restores full screen if the setting is on.
- Tests: `tests/unit/lib/appMode/chromeVisibility.test.ts` — "leaving SID Player shows chrome and keeps the
  setting".
- Verification: unit. Phase 3b.
- Status: Not started. Evidence: —

#### SPM-FS-12 Documented badge exception and inventory

- Requirement: `docs/ux-guidelines.md` MUST list the full-screen player as a user-chosen exception to the
  health-badge rule. `docs/cta-inventory.md` MUST add the exit control, the Play page Full screen button, the
  Settings row and the Quick menu entry, and record the Play page scope in full screen at the compact profile.
  The manuals and the guide's SID Player chapter MUST explain how to leave full screen, with keys named through
  the key labels.
- Verification: `npm run lint:reference-docs`, review, `npm run manuals:build`. Phase 6.
- Status: Not started. Evidence: —

## 6. Inventory of surfaces and their fate in SID Player

| Area | Surface (file) | Fate | Mechanism |
| --- | --- | --- | --- |
| Tabs | Home `/` | keep (offline arrangement) | `SPM-HOME-01` |
| Tabs | Play `/play` | keep, adapted | `SPM-PLAY-01..03` |
| Tabs | Disks `/disks` (`DisksPage`, `HomeDiskManager`) | hide, redirect | `SPM-NAV-01/04` |
| Tabs | Config `/config` (`ConfigBrowserPage`) | hide, redirect | `SPM-NAV-01/04` |
| Tabs | Settings `/settings` | keep, adapted | `SPM-SET-01..03` |
| Tabs | Docs `/docs` | keep, adapted | `SPM-DOC-01` |
| Home | `HomeSearchField` | keep | — |
| Home | `DeviceStepsOffer` | hide | `SPM-HOME-02` |
| Home | `home-promoted-actions` tiles (SID Radio, Last, Recent) | keep | — |
| Home | Live View tile | hide | `SPM-HOME-03` |
| Home | `ConnectC64Card` | adapt to SID Player card | `SPM-HOME-04` |
| Home | sections `quick-actions`, `live-view`, `cpu-ram`, `ports`, `video`, `audio`, `user-interface`, `lighting`, `drives`, `printers`, `streams`, `config-actions` | hide | `SPM-HOME-02` |
| Home | `home-offline-sections-note` | hide | `SPM-HOME-02` |
| Home | `SystemInfo` (version only) | keep | — |
| Home dialogs | Save RAM, snapshots, config save/load/manage, clear flash, power off, REU | unreachable (sections hidden) | `SPM-HOME-02` |
| Play | Add items: Local, HVSC, CommoServe | keep, SID-only filter | `SPM-PLAY-02` |
| Play | Add items: C64U source | hide | `SPM-PLAY-01` |
| Play | `PlaybackEngineToggle` | hide | `SPM-PLAY-01` |
| Play | `VolumeControls` | keep (phone volume via `playbackVolumeBinding`) | — |
| Play | `PlaybackConfigSheet`, `PlaybackConfigOverrideEditor` | hide | `SPM-PLAY-01` |
| Play | Remote Input button, `RemoteInputSheet`, Game Mode button | hide | `SPM-SET-03` |
| Play | `SidRadioChip`, `SidRadioLauncherSheet`, `LikedTunesSheet`, `NowPlayingRanking` | keep | `SPM-PLAY-07` |
| Play | `HvscManager`, `HvscControls`, `HvscPreparationSheet`, `HvscSearchSheet` | keep | — |
| Play | `PlaybackSpectrumCard`, `SleepTimerControl`, `TuneDetails`, `TuneNotes` | keep | — |
| Play | Non-SID playlist rows | keep, marked, skipped | `SPM-PLAY-03` |
| Settings | see `SPM-SET-01` table | per table | `SPM-SET-01..03` |
| Settings | `LocalEngineRomsRow` | adapt: summary row opening the ROM sheet, in every mode | `SPM-ROM-09` |
| Play | ROM skip notice, "Needs C64 ROMs" row subtitle | new | `SPM-ROM-07/08` |
| Sheets | ROM sheet (files, folder, archive, Get ROMs from my Ultimate) | new | `SPM-ROM-09..12`, `SPM-ROM-18..19` |
| Settings | Demo Mode rows in `connection` | moved into `app-mode` choices in SID Player | `SPM-ARCH-06` |
| App bar | `UnifiedHealthBadge` | adapt: "SID Player", no switcher, no probes | `SPM-ERR-02`, `SPM-NET-02` |
| App bar | Quick menu button | keep | — |
| App bar | Whole bar on Play with the full-screen player on | replaced by the exit strip | `SPM-FS-02/03` |
| Tab bar | With the full-screen player on, on Play | hidden, out of the ring, height freed | `SPM-FS-02` |
| Guidance bar | With the full-screen player on | kept; Back labelled "Exit full screen" | `SPM-FS-05` |
| Play | "Full screen" button | new, SID Player only | `SPM-FS-06` |
| Settings | "Full-screen player" row in `app-mode` | new, SID Player only | `SPM-FS-06` |
| Quick menu | Full screen / Exit full screen | new, SID Player only | `SPM-FS-06` |
| Quick menu | search, notification action, section expand/collapse/descriptions, diagnostics | keep | — |
| Quick menu | tab jumps | visible tabs only | `SPM-QM-01` |
| Quick menu | machine pause, reset, Game Mode, switch device, stop Live View | hide | `SPM-QM-01` |
| Quick menu | function-key summary | keep only for non-device actions | `SPM-QM-01` |
| Quick menu | Use / Leave SID Player | new | `SPM-QM-01` |
| Keypad | digits 1..n, 7 search, F1/F3 transport | keep, remapped | `SPM-NAV-03` |
| Keypad | machine shortcuts, device switcher | off | `SPM-QM-01` |
| Overlays | Search overlay | keep, filtered | `SPM-SRCH-01` |
| Overlays | Tour | keep, filtered and reworded | `SPM-TOUR-01` |
| Overlays | Diagnostics | keep, device actions replaced | `SPM-ERR-03` |
| Overlays | Device switcher, Lighting Studio, Remote Input, Key explorer for machine | hide | `SPM-SET-03`, `SPM-ERR-02` |
| Overlays | Demo Mode offer, discovery picker, auth challenge | never opens | `SPM-ERR-04` |
| Toasts | offline notice, device-not-connected, connectivity errors | log only | `SPM-ERR-01` |
| Toasts | engine notices | adapted | `SPM-PLAY-04/06` |
| Docs | music chapters | keep | `SPM-DOC-01` |
| Docs | machine chapters, devices, connection problems, status badge | hide | `SPM-DOC-01` |
| Docs | keypad cheat sheet, diagnostics, getting started | keep | `SPM-DOC-01` |
| Background | discovery, rediscovery, network-edge discovery | off | `SPM-MODE-01`, `SPM-NET-02` |
| Background | saved-device health checks | off | `SPM-NET-02` |
| Background | device queries, SID model sync, VIC palette, A/V mirror governor, ROM fetch | idle by state | `SPM-NET-02` |
| Background | notification permission, media buttons, audio focus, background execution | keep | — |

## 7. Choke points

| Concern | Choke point | File |
| --- | --- | --- |
| Mode value | `appModeStore` | `src/lib/appMode/appModeStore.ts` |
| Classification | `isSurfaceVisible` | `src/lib/appMode/surfaces.ts` |
| Tabs, swipe, digits | `visibleTabIndexes` and model functions | `tabRoutes.ts`, `swipeNavigationModel.ts` |
| Hidden routes | `HiddenRouteRedirect` | `src/App.tsx` |
| Page sections (Home, Settings, Docs) | `CollapsibleSection` wrapper | `src/components/CollapsibleSection.tsx` |
| Feature-gated controls | `buildSnapshot` with `requires_device` | `src/lib/config/featureFlags.ts` |
| Search and promoted tiles | `isSearchEntryShown` | `surfaces.ts`, `useSearchResults.ts` |
| Tour | `tourStepsFor` | `src/lib/tour/steps.ts` |
| Guide | `buildGuideChapters` | `src/lib/docs/guide/chapters.ts` |
| Quick menu and keypad shortcuts | `isSurfaceVisible("quick-menu:…")` | `KeypadQuickMenu.tsx`, `App.tsx` |
| Discovery | `runDiscoverConnection` guard | `connectionManager.ts` |
| Start-up | `startForStartupMode` | `appModeTransitions.ts` |
| Device traffic backstop | `assertDeviceTrafficAllowed` | `deviceTrafficGate.ts` |
| Toast policy | `reportUserError` | `uiErrors.ts` |
| Health label | `deriveConnectivityState` | `healthModel.ts` |
| Mode switching UI | `DeviceLessChoices` | `src/components/appMode/DeviceLessChoices.tsx` |
| App chrome in the full-screen player | `useAppChromeVisible` | `src/lib/appMode/chromeVisibility.ts` |
| Back in the full-screen player | `consumeBackForFullScreen` | `src/lib/navigation/navigateBack.ts` |

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| File-size ceilings in `connectionManager.ts`, `c64api.ts`, `usePlaybackController.ts`, `DiagnosticsDialog.tsx`, `appSettings.ts` | `SPM-ARCH-05` extractions first; new logic in new modules; one-line call sites |
| Hooks-order bugs from early `return null` in `CollapsibleSection` | Wrapper component; test that a hidden body runs no effect |
| Index-based navigation assumptions | `TAB_ROUTES` unchanged; filtering only in the model functions with all-indices defaults |
| Tests that assume six tabs (18 specs reference Disks/Config tabs) | Default mode stays `full`; SID Player tests are additive |
| Effect loops from a new store feeding effect dependencies | `useSyncExternalStore` with a primitive snapshot |
| Settings export and import | Mode excluded; no export version bump |
| Two APKs keep separate data | Documented in the SID Player guide chapter: HVSC is downloaded per app |
| A tune refused for missing ROMs plays silence today | `SPM-ROM-06` fixes it in both modes, with a regression test |
| Skips that loop or flood notices | `SPM-ROM-07` session skip store and loop guard; `SPM-ROM-08` one notice per session |
| The compact keypad phone may have no document picker | `SPM-ROM-12` import folder, `SPM-ROM-20` share target; handset check records a blocker if neither works |
| The ROM-read exception widens into general device traffic | `SPM-ROM-18` scope bound to one host, three request kinds and 60 s; negative tests for every other channel |
| ROM bytes leaking through exports or the repository | `SPM-ROM-03` exclusions, `SPM-ROM-15` single-writer check, synthetic fixtures only |
| A user-supplied ROM variant changes tune timing | Accepted as "unrecognised variant" with a plain warning; `SPM-ROM-23` measures behavior |
| Licence of a replacement ROM set | `SPM-ROM-24` stays an open decision until a legal check |
| Worker protocol change overlaps the concurrent ROM-compatibility work | Land `SPM-ROM-14` after that work merges; `localSidEngine.ts` has 15 lines of headroom |
| Bundle budget (index at most 250 KB gzip) | Store and surface map are a few KB; `AppModeSettingsSection` and `DeviceLessChoices` load with their pages; measure with `npm run lint:bundle-budgets` |
| Health badge contract in UX guidelines | `SPM-DOC-03`, `SPM-FS-12` |
| A user stuck without chrome | Back always exits (`SPM-FS-04`), a permanent exit control (`SPM-FS-03`), a first-use explanation (`SPM-FS-07`), a running tour shows chrome, default off |
| Exit control hidden by toasts or insets | Strip at the top with safe-area insets, toasts at the bottom; Playwright hit-test with three error toasts |
| Hidden tab bar breaks layout measurements | Reserved height set to 0 through one root attribute; the guidance bar keeps its own reservation |
| CTA inventory and `lint:reference-docs` | `SPM-DOC-02` in the same commits as the controls |
| Generated variant files drift | Run `node scripts/generate-variant.mjs`; `npm run variant:check` |
| Manual workflow lists variants literally | `SPM-VAR-04` |

## 9. Phased plan

| Phase | Scope | IDs | Main tests | Verified on | Size (prod / test lines) |
| --- | --- | --- | --- | --- | --- |
| 0 | Headroom extractions, no behavior change | SPM-ARCH-05 | existing suites | unit | 0 net / 0 |
| 1 | Store, surface map, variant field, flag `requires_device`, discovery guard, traffic gate, health label | SPM-ARCH-01..03, SPM-VAR-01..02, SPM-SET-03, SPM-MODE-01..02, SPM-NET-02..03, SPM-ERR-02, SPM-FRST-02..03 | appModeStore, surfaces, connectionManager.sidPlayer, deviceTrafficGate, featureFlags.sidPlayer, generateVariant | unit | 450 / 700 |
| 2 | Navigation, Home, Settings, Quick menu, search, tour, guide gating | SPM-NAV-01..04, SPM-HOME-01..04, SPM-SET-01..02, SPM-QM-01, SPM-SRCH-01, SPM-TOUR-01, SPM-DOC-01, SPM-ERR-03..04 | tabRoutes, swipeNavigationModel, CollapsibleSection, HomePage.sidPlayer, KeypadQuickMenu, sidPlayerSearch, steps, chapters | unit, Playwright | 350 / 600 |
| 3 | Switch UX and first run | SPM-ARCH-06, SPM-SWT-01..03, SPM-FRST-01, SPM-MODE-04 | DeviceLessChoices, appModeTransitions, DemoModeInterstitial, keypadOnlyNavigation addition | unit, Playwright, handset | 300 / 400 |
| 3b | Full-screen player | SPM-FS-01..11 | appModeStore, chromeVisibility, AppBar, TabBar, navigateBack, resolveGuidanceLabels, KeypadQuickMenu, sidPlayerFullScreen.spec | unit, Playwright (compact and medium), handset | 220 / 350 |
| 4 | Playback and notice policy | SPM-PLAY-01..03, SPM-PLAY-06..07, SPM-ERR-01 | playbackEngineRouting, PlayFilesPage.sidPlayer, uiErrors.sidPlayer, playlistRowSubtitle | unit, Playwright, handset | 120 / 250 |
| 4a | ROM skip (both modes), measurement | SPM-PLAY-04, SPM-ROM-01, SPM-ROM-05..08, SPM-ROM-17, SPM-ROM-23 | localSidWorkerCore, playbackEngineRouting, usePlaybackController.romSkip, romSkips, playableWithoutDevice | unit, Playwright, handset | 180 / 300 |
| 4b | ROM supply: files, folder, archives, device read, sheet, entry points, guide | SPM-PLAY-05, SPM-ROM-02..04, SPM-ROM-09..15, SPM-ROM-18..19, SPM-ROM-26 | classifyRomFile, importRomFiles, romStore, RomSheet, deviceTrafficGate ROM exception, FolderPickerPluginTest, sidPlayerRoms.spec | unit, Android JVM, Playwright (fake picker), handset | 650 / 700 |
| 4c | Share target | SPM-ROM-20 | Android JVM intent tests | Android JVM, handset | 150 / 120 |
| 5 | SID Player variant, start-up override, CI, manuals per edition | SPM-VAR-03..05, SPM-ED-02, SPM-ED-04 | generateVariant, buildManuals | unit, CI | 180 + assets / 160 |
| 6 | Docs, inventory, screenshots, per-edition Playwright | SPM-FS-12, SPM-DOC-02..04, SPM-MODE-03, SPM-ED-01, SPM-ED-03, SPM-ED-05..06 | sidPlayerMode.spec, keypadOnlyNavigation, smallScreenErgonomics | Playwright, handset | docs + 150 test |
| 7 | Convergence | SPM-NET-01, SPM-TST-01..05 | full suites, coverage gate | Playwright, handset | — |

Playwright can prove visibility, routing, keypad operation, target and text sizes, zero requests at the mock
server and zero toasts. Only the handset can prove keypad behavior of the real key codes, focus scrolling on the
real panel, audio on the phone in SID Player, and absence of device traffic on a real network.

## 10. Traceability

| ID | Title | Status | Tests | Commit |
| --- | --- | --- | --- | --- |
| SPM-ARCH-01 | One source of truth for the mode | Not started | appModeStore.test.ts | — |
| SPM-ARCH-02 | One declarative surface map | Not started | surfaces.test.ts | — |
| SPM-ARCH-03 | An unclassified surface fails a test | Not started | surfaceCoverage.test.tsx | — |
| SPM-ARCH-04 | No duplicated screens or logic | Not started | review | — |
| SPM-ARCH-05 | Make room before changing ceiling-bound files | Not started | existing suites | — |
| SPM-ARCH-06 | Shared device-less choices component | Not started | DeviceLessChoices.test.tsx | — |
| SPM-MODE-01 | SID Player settles the connection without a device | Not started | connectionManager.sidPlayer.test.ts | — |
| SPM-MODE-02 | SID Player and Demo Mode are mutually exclusive | Not started | appModeTransitions.test.ts | — |
| SPM-MODE-03 | Demo Mode versus SID Player surfaces | Not started | sidPlayerMode.spec.ts | — |
| SPM-MODE-04 | Switching preserves data | Not started | appModeTransitions.test.ts, sidPlayerMode.spec.ts | — |
| SPM-NET-01 | No device traffic in SID Player | Not started | sidPlayerMode.spec.ts | — |
| SPM-NET-02 | Background services stop | Not started | ConnectionController.sidPlayer, UnifiedHealthBadge.sidPlayer | — |
| SPM-NET-03 | Traffic backstop | Not started | deviceTrafficGate.test.ts, c64api.sidPlayer.test.ts | — |
| SPM-NAV-01 | Visible tabs | Not started | tabRoutes.test.ts, TabBar.test.tsx | — |
| SPM-NAV-02 | Swipe skips hidden pages | Not started | swipeNavigationModel.test.ts | — |
| SPM-NAV-03 | Keypad digit jumps follow visible tabs | Not started | tabJumpShortcut.test.ts | — |
| SPM-NAV-04 | Hidden routes redirect to Home | Not started | AppRoutes.sidPlayer.test.tsx | — |
| SPM-HOME-01 | Home uses the offline arrangement | Not started | useOfflineArrangement.test.ts | — |
| SPM-HOME-02 | Device sections are hidden, not closed | Not started | CollapsibleSection.test.tsx, HomePage.sidPlayer.test.tsx | — |
| SPM-HOME-03 | Listen tiles drop device tiles | Not started | useListenActions.test.ts | — |
| SPM-HOME-04 | The connect card becomes the SID Player card | Not started | ConnectC64Card.test.tsx | — |
| SPM-PLAY-01 | Device sources and controls are hidden | Not started | PlayFilesPage.sidPlayer.test.tsx | — |
| SPM-PLAY-02 | Add items accepts only what the phone can play | Not started | sidPlayerAddFilter.test.ts | — |
| SPM-PLAY-03 | Existing non-SID rows stay, marked and skipped | Not started | playlistRowSubtitle.test.ts | — |
| SPM-PLAY-04 | Tunes that need the C64 ROMs (umbrella) | Not started | see SPM-ROM-05..07 | — |
| SPM-PLAY-05 | Supply ROM images from files (umbrella) | Not started | see SPM-ROM-01..04, 08..15 | — |
| SPM-PLAY-06 | Engine notices fit SID Player | Not started | playbackEngineRouting.test.ts | — |
| SPM-PLAY-07 | SID Radio works in SID Player | Not started | sidPlayerMode.spec.ts | — |
| SPM-PLAY-08 | CommoServe stays and opens narrowed to SID files | Not started | sidPlayerCommoServe.test.tsx | — |
| SPM-SET-01 | Section visibility | Not started | SettingsPage.sidPlayer.test.tsx | — |
| SPM-SET-02 | Play and disk rows | Not started | PlayAndDiskSettingsSection.test.tsx | — |
| SPM-SET-03 | Feature flags that need a device | Not started | featureFlags.sidPlayer.test.ts | — |
| SPM-QM-01 | Quick menu entries | Not started | KeypadQuickMenu.test.tsx | — |
| SPM-SRCH-01 | Search hides device entries | Not started | sidPlayerSearch.test.ts | — |
| SPM-TOUR-01 | Tour steps | Not started | steps.test.ts | — |
| SPM-DOC-01 | In-app guide chapters | Not started | chapters.test.ts | — |
| SPM-ERR-01 | No device errors in SID Player | Not started | uiErrors.sidPlayer.test.ts | — |
| SPM-ERR-02 | The badge says SID Player | Not started | healthModel.test.ts | — |
| SPM-ERR-03 | Diagnostics in SID Player | Not started | DiagnosticsConnectionActions.test.tsx | — |
| SPM-ERR-04 | Interstitials never appear in SID Player | Not started | connectionManager.sidPlayer.test.ts | — |
| SPM-SWT-01 | Entry points | Not started | keypadOnlyNavigation.spec.ts | — |
| SPM-SWT-02 | Transitions and confirmation | Not started | appModeTransitions.test.ts | — |
| SPM-SWT-03 | Copy follows the rules | Not started | copy.test.ts | — |
| SPM-FRST-01 | Offer SID Player when no device is found | Not started | DemoModeInterstitial.test.tsx | — |
| SPM-FRST-02 | A SID Player start-up never asks | Not started | startForStartupMode.test.ts | — |
| SPM-FRST-03 | A Demo start-up skips discovery | Not started | startForStartupMode.test.ts | — |
| SPM-VAR-01 | Variant field runtime.startup_mode | Not started | generateVariant.test.ts | — |
| SPM-VAR-02 | Persisted user choice wins | Not started | appModeStore.test.ts | — |
| SPM-VAR-03 | The SID Player variant | Not started | generateVariant.test.ts | — |
| SPM-VAR-04 | CI builds it, release stays opt-in | Not started | generateVariant.test.ts | — |
| SPM-VAR-05 | Manual scope follows the start-up mode | Not started | buildManuals.test.ts | — |
| SPM-VAR-06 | Store listing metadata | Deferred | — | — |
| SPM-DOC-02 | CTA inventory and reference-docs lint | Not started | lint:reference-docs | — |
| SPM-DOC-03 | UX guideline amendment | Not started | review | — |
| SPM-DOC-04 | Manual and screenshots | Not started | manuals:build | — |
| SPM-TST-01 | Unit and contract | Not started | revert-checks | — |
| SPM-TST-02 | Playwright SID Player suite | Not started | sidPlayerMode.spec.ts | — |
| SPM-TST-03 | Variant start-up per APK | Not started | packaging metadata, sid-player-launch.yaml | — |
| SPM-TST-04 | Coverage | Not started | coverage:gate | — |
| SPM-TST-05 | Handset validation | Not started | HIL | — |
| SPM-ED-01 | SID Player in both editions | Not started | surfaces.test.ts | — |
| SPM-ED-02 | Edition, start-up mode and keypad UI compose independently | Not started | generateVariant.test.ts | — |
| SPM-ED-03 | Keypad operation of SID Player in the compact keypad edition | Not started | keypadOnlyNavigation.spec.ts, smallScreenErgonomics.spec.ts, navigateBack.test.ts | — |
| SPM-ED-04 | Manual text per edition | Not started | buildManuals.test.ts | — |
| SPM-ED-05 | Tests per edition and profile | Not started | sidPlayerMode.spec.ts | — |
| SPM-ED-06 | CTA inventory per edition | Not started | lint:reference-docs, handset enumeration | — |
| SPM-ROM-01 | Which ROMs, and which tunes need them | Not started | localSidWorkerCore.test.ts | — |
| SPM-ROM-02 | Recognize a supplied file | Not started | classifyRomFile.test.ts | — |
| SPM-ROM-03 | Storage, source and privacy | Not started | romStore.test.ts, settingsTransfer.test.ts, diagnosticsExport.test.ts | — |
| SPM-ROM-04 | Precedence between file and device ROMs | Not started | ensureSystemRoms.test.ts | — |
| SPM-ROM-05 | Skip before opening when the header declares a need | Not started | playbackEngineRouting.test.ts, usePlaybackController.romSkip.test.tsx | — |
| SPM-ROM-06 | Skip when the engine refuses at open | Not started | usePlaybackController.romSkip.test.tsx | — |
| SPM-ROM-07 | No stall and no error storm | Not started | romSkips.test.ts, playableWithoutDevice.test.ts | — |
| SPM-ROM-08 | One calm notice with an Add ROMs action | Not started | romSkips.test.ts, sidPlayerRoms.spec.ts | — |
| SPM-ROM-09 | The ROM sheet | Not started | RomSheet.test.tsx | — |
| SPM-ROM-10 | Picking files | Not started | importRomFiles.test.ts, FolderPickerPluginTest, sidPlayerRoms.spec.ts | — |
| SPM-ROM-11 | Per-file feedback | Not started | importRomFiles.test.ts | — |
| SPM-ROM-12 | A device with no document picker | Not started | RomSheet.test.tsx, Android JVM | — |
| SPM-ROM-13 | Entry points | Not started | ConnectC64Card.test.tsx, sidPlayerSearch.test.ts | — |
| SPM-ROM-14 | After an import | Not started | romSkips.test.ts, renderedTuneCache.test.ts, wasmRendererCore.test.ts | — |
| SPM-ROM-15 | Sources of ROM bytes | Not started | romSources.test.ts | — |
| SPM-ROM-16 | Character ROM support | Deferred | — | — |
| SPM-ROM-17 | Full App without a device | Not started | playbackEngineRouting.test.ts, sidPlayerRoms.spec.ts | — |
| SPM-ROM-18 | Get ROMs from my Ultimate (one-shot exception) | Not started | deviceTrafficGate.test.ts, getRomsFromDevice.test.ts | — |
| SPM-ROM-19 | Archives | Not started | importRomFiles.test.ts | — |
| SPM-ROM-20 | Open with and share to the app | Not started | Android JVM intent tests | — |
| SPM-ROM-21 | Emulator ROM folders | Not started | covered by SPM-ROM-10 | — |
| SPM-ROM-22 | User-supplied URL, FTP or network share | Deferred | — | — |
| SPM-ROM-23 | Honest ROM-less behavior and a measured skip set | Not started | rom-less-measurement.md | — |
| SPM-ROM-24 | Freely licensed replacement ROMs (open decision) | Deferred | — | — |
| SPM-ROM-25 | Export or back up the imported ROM set | Deferred | — | — |
| SPM-ROM-26 | Guide page: where to get ROMs | Not started | chapters.test.ts, buildManuals.test.ts | — |
| SPM-FS-01 | Setting and persistence | Not started | appModeStore.test.ts, settingsTransfer.test.ts | — |
| SPM-FS-02 | One chrome-visibility flag | Not started | chromeVisibility.test.ts, TabBar.test.tsx, SwipeNavigationLayer.test.tsx | — |
| SPM-FS-03 | The exit control | Not started | AppBar.test.tsx, sidPlayerFullScreen.spec.ts | — |
| SPM-FS-04 | Back leaves full screen | Not started | navigateBack.test.ts | — |
| SPM-FS-05 | Guidance for keypad users | Not started | resolveGuidanceLabels.test.ts | — |
| SPM-FS-06 | Entry points and quick toggles | Not started | KeypadQuickMenu.test.tsx, PlayFilesPage.sidPlayer.test.tsx | — |
| SPM-FS-07 | First use explains the exit | Not started | chromeVisibility.test.ts | — |
| SPM-FS-08 | Navigation while full screen | Not started | chromeVisibility.test.ts, sidPlayerFullScreen.spec.ts | — |
| SPM-FS-09 | Sheets, dialogs and toasts | Not started | sidPlayerFullScreen.spec.ts | — |
| SPM-FS-10 | System bars, safe area and orientation | Not started | fullScreen.test.ts, sidPlayerFullScreen.spec.ts | — |
| SPM-FS-11 | Interaction with the tour, Demo Mode and Full App | Not started | chromeVisibility.test.ts | — |
| SPM-FS-12 | Documented badge exception and inventory | Not started | lint:reference-docs, review | — |
