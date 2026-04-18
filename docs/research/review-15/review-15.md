# Review 15 — Production-Hardening Review of C64 Commander

Authoritative contract: [REVIEW_PROMPT.md](REVIEW_PROMPT.md) and [FEATURE_MODEL.md](FEATURE_MODEL.md).
Target main branch: `main`. Current branch at time of review: `main`.
Scope: Android (primary), iOS (secondary), Web (secondary) with physical hardware targets Ultimate 64 (`u64`) and C64 Ultimate (`c64u`).

This review is the actual deliverable. It follows the 8-phase execution model in `REVIEW_PROMPT.md` and normalizes every catalogued feature to the schema in `FEATURE_MODEL.md`. Where evidence is insufficient to make a firm claim, the gap is named explicitly rather than silently skipped.

---

## Section 1 — Repository Coverage Ledger

This ledger accounts for every mandatory source group named in the review contract and records whether the group maps to first-class features or to explicit support-only infrastructure.

| Source Group                                     | Path / Glob                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Inspected | Mapped To Features                                                                                                          | Support Only | Notes                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mandatory review docs                            | [README.md](README.md), [AGENTS.md](AGENTS.md), [.github/copilot-instructions.md](.github/copilot-instructions.md), [docs/architecture.md](docs/architecture.md), [docs/features-by-page.md](docs/features-by-page.md), [docs/testing/maestro.md](docs/testing/maestro.md), [docs/testing/physical-device-matrix.md](docs/testing/physical-device-matrix.md), [docs/testing/agentic-tests/agentic-test-review.md](docs/testing/agentic-tests/agentic-test-review.md), [docs/testing/agentic-tests/full-app-coverage/README.md](docs/testing/agentic-tests/full-app-coverage/README.md), [docs/testing/agentic-tests/full-app-coverage/feature-inventory.md](docs/testing/agentic-tests/full-app-coverage/feature-inventory.md), [docs/testing/agentic-tests/full-app-coverage/feature-test-catalog.md](docs/testing/agentic-tests/full-app-coverage/feature-test-catalog.md), [docs/c64/c64u-openapi.yaml](docs/c64/c64u-openapi.yaml), [docs/c64/c64u-rest-api.md](docs/c64/c64u-rest-api.md), [docs/c64/c64u-ftp.md](docs/c64/c64u-ftp.md), [docs/c64/c64u-stream-spec.md](docs/c64/c64u-stream-spec.md), [docs/research/review-15/FEATURE_MODEL.md](docs/research/review-15/FEATURE_MODEL.md) | yes       | all catalog scopes                                                                                                          | no           | Reconciled against current code and the inherited review before any claims were retained.                                                                                                                                                                    |
| Screenshot corpus                                | [docs/img/app/](docs/img/app/), [playwright/screenshot-catalog.json](playwright/screenshot-catalog.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | yes       | home, play, disks, config, settings, docs, diagnostics                                                                      | no           | 171 PNGs under 66 directories; screenshot catalog currently groups six top-level families and was reconciled against route ownership.                                                                                                                        |
| App shell and routing                            | [src/main.tsx](src/main.tsx), [src/App.tsx](src/App.tsx), [src/lib/navigation/tabRoutes.ts](src/lib/navigation/tabRoutes.ts), [src/components/TabBar.tsx](src/components/TabBar.tsx), [src/components/SwipeNavigationLayer.tsx](src/components/SwipeNavigationLayer.tsx), [src/components/AppBar.tsx](src/components/AppBar.tsx), [src/components/ConnectionController.tsx](src/components/ConnectionController.tsx), [src/components/UnifiedHealthBadge.tsx](src/components/UnifiedHealthBadge.tsx), [src/components/DemoModeInterstitial.tsx](src/components/DemoModeInterstitial.tsx), [src/components/TraceContextBridge.tsx](src/components/TraceContextBridge.tsx), [src/components/TestHeartbeat.tsx](src/components/TestHeartbeat.tsx)                                                                                                                                                                                                                                                                                                                                                                                                                                                   | yes       | `app__*`, `coverage_probe__*`, `not_found__*`                                                                               | no           | Route ownership was verified from code; only `/__coverage__` and `*` are React Router routes and tab content is rendered through [src/components/SwipeNavigationLayer.tsx](src/components/SwipeNavigationLayer.tsx).                                         |
| Routed pages and page-local surfaces             | `src/pages/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | yes       | `home__*`, `play__*`, `disks__*`, `config__*`, `settings__*`, `docs__*`, `licenses__*`, `coverage_probe__*`, `not_found__*` | no           | 78 files including page-local dialogs, hooks, and components. Page-local dialogs were reconciled to the owning workflow feature rather than left as an unresolved backlog.                                                                                   |
| Diagnostics components                           | `src/components/diagnostics/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | yes       | `app__global_diagnostics_overlay`, `diagnostics__saved_device_switching`, `diagnostics__share_zip`                          | no           | 21 files. The three diagnostics heatmap paths are URL-addressable via [src/components/diagnostics/GlobalDiagnosticsOverlay.tsx](src/components/diagnostics/GlobalDiagnosticsOverlay.tsx), not modal-only.                                                    |
| Shared workflow components                       | `src/components/disks/**`, `src/components/itemSelection/**`, `src/components/lighting/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | yes       | `disks__library`, `disks__mount`, `play__source_browsing`, `play__hvsc_lifecycle`, `play__playback_transport`               | no           | Item selection, drive management, and lighting are workflow owners, not primitive-only wrappers.                                                                                                                                                             |
| UI primitives                                    | `src/components/ui/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | yes       | none                                                                                                                        | yes          | Shadcn/Radix wrappers and generic shell primitives are consumed by higher-level features but are not independently catalogued as user workflows.                                                                                                             |
| Hooks                                            | `src/hooks/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | yes       | route and global workflow state                                                                                             | no           | 27 files including saved-device switching, diagnostics activity, app config state, display profile, lighting studio, and feature flag state.                                                                                                                 |
| Domain modules                                   | `src/lib/{c64api,config,connection,diagnostics,disks,drives,ftp,hvsc,lighting,machine,native,playback,playlistRepository,reu,savedDevices,sid,sourceNavigation,sources,startup,telnet,tracing}/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | yes       | all runtime and native-adjacent features                                                                                    | no           | 277 files; utility-only helpers under unrelated `src/lib/**` leaves are treated as support code when they do not own user-visible or system-visible behavior.                                                                                                |
| Android native runtime                           | `android/app/src/main/java/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | yes       | `android_native__*`                                                                                                         | no           | 19 Kotlin source files covering activity, plugins, HVSC extraction, diagnostics, safe area, and mock runtime behavior.                                                                                                                                       |
| iOS native runtime and native validation package | `ios/App/App/**`, `ios/native-tests/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | yes       | `ios_native__*`                                                                                                             | no           | 20 app files plus a SwiftPM native validation package with request/path validation tests; the inherited review's “iOS tests absent” claim was stale.                                                                                                         |
| Web runtime                                      | `web/server/src/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | yes       | `web_runtime__*`                                                                                                            | no           | 6 server files: `authState`, `hostValidation`, `securityHeaders`, `httpIO`, `staticAssets`, `index`.                                                                                                                                                         |
| Test suites                                      | `tests/unit/**`, `tests/android-emulator/**`, `tests/contract/**`, `playwright/**/*.spec.ts`, `.maestro/**/*.yaml`, `android/app/src/test/java/**`, `ios/native-tests/Tests/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | yes       | all feature scopes; support harnesses separated in notes                                                                    | no           | 508 unit files, 13 Android emulator files, 67 contract files, 47 Playwright specs, 57 Maestro YAML files, 22 Android JVM test files, and 5 Swift native test files. Support harnesses under helpers/lib roots are explicitly treated as test infrastructure. |
| Prior coverage artifacts                         | `docs/testing/agentic-tests/full-app-coverage/**`, `c64scope/artifacts/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | yes       | hardware evidence and prior feature reconciliation                                                                          | no           | Provides direct physical Android plus `c64u` evidence for 23 app-first features on device serial `2113b87f`; it does not prove Pixel 4 or `u64` coverage.                                                                                                    |

---

## Section 2 — Canonical Route and Global Surface Inventory

Authoritative routing sources are [src/lib/navigation/tabRoutes.ts](src/lib/navigation/tabRoutes.ts), [src/App.tsx](src/App.tsx), and [src/components/diagnostics/GlobalDiagnosticsOverlay.tsx](src/components/diagnostics/GlobalDiagnosticsOverlay.tsx). `tabIndexForPath` maps `/diagnostics` and every `/diagnostics/*` deep link to the Settings slot, while [src/components/SwipeNavigationLayer.tsx](src/components/SwipeNavigationLayer.tsx) renders the actual tab content.

### 2.1 Routes

| ID  | Path or Surface                  | Owning Files                                                                                                       | Feature Count | Notes                                                                                                 |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------- |
| R01 | `/`                              | [src/pages/HomePage.tsx](src/pages/HomePage.tsx)                                                                   | 3             | Home workflow features are `home__machine_controls`, `home__app_configs`, and `home__ram_operations`. |
| R02 | `/play`                          | [src/pages/PlayFilesPage.tsx](src/pages/PlayFilesPage.tsx)                                                         | 4             | Play owns source browsing, HVSC lifecycle, playback transport, and lock/background playback.          |
| R03 | `/disks`                         | [src/pages/DisksPage.tsx](src/pages/DisksPage.tsx)                                                                 | 2             | Disks owns library management and mount/drive mutation flows.                                         |
| R04 | `/config`                        | [src/pages/ConfigBrowserPage.tsx](src/pages/ConfigBrowserPage.tsx)                                                 | 2             | Config browse and edit remain separate workflow features.                                             |
| R05 | `/settings`                      | [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx)                                                           | 3             | Settings owns connection, safety, and demo/offline behavior.                                          |
| R06 | `/settings/open-source-licenses` | [src/pages/OpenSourceLicensesPage.tsx](src/pages/OpenSourceLicensesPage.tsx)                                       | 1             | Routed through the Settings slot as a path-matched sub-route.                                         |
| R07 | `/docs`                          | [src/pages/DocsPage.tsx](src/pages/DocsPage.tsx)                                                                   | 1             | In-app documentation surface.                                                                         |
| R08 | `/diagnostics`                   | [src/components/diagnostics/GlobalDiagnosticsOverlay.tsx](src/components/diagnostics/GlobalDiagnosticsOverlay.tsx) | 1             | Resolves to diagnostics panel key `overview`.                                                         |
| R09 | `/diagnostics/latency`           | [src/components/diagnostics/GlobalDiagnosticsOverlay.tsx](src/components/diagnostics/GlobalDiagnosticsOverlay.tsx) | 1             | Resolves to diagnostics panel key `latency`.                                                          |
| R10 | `/diagnostics/history`           | [src/components/diagnostics/GlobalDiagnosticsOverlay.tsx](src/components/diagnostics/GlobalDiagnosticsOverlay.tsx) | 1             | Resolves to diagnostics panel key `history`.                                                          |
| R11 | `/diagnostics/config-drift`      | [src/components/diagnostics/GlobalDiagnosticsOverlay.tsx](src/components/diagnostics/GlobalDiagnosticsOverlay.tsx) | 1             | Resolves to diagnostics panel key `config-drift`.                                                     |
| R12 | `/diagnostics/decision-state`    | [src/components/diagnostics/GlobalDiagnosticsOverlay.tsx](src/components/diagnostics/GlobalDiagnosticsOverlay.tsx) | 1             | Resolves to diagnostics panel key `decision-state`.                                                   |
| R13 | `/diagnostics/heatmap/rest`      | [src/components/diagnostics/GlobalDiagnosticsOverlay.tsx](src/components/diagnostics/GlobalDiagnosticsOverlay.tsx) | 1             | Contrary to the inherited review, this route is URL-addressable and resolves to `rest-heatmap`.       |
| R14 | `/diagnostics/heatmap/ftp`       | [src/components/diagnostics/GlobalDiagnosticsOverlay.tsx](src/components/diagnostics/GlobalDiagnosticsOverlay.tsx) | 1             | URL-addressable and resolves to `ftp-heatmap`.                                                        |
| R15 | `/diagnostics/heatmap/config`    | [src/components/diagnostics/GlobalDiagnosticsOverlay.tsx](src/components/diagnostics/GlobalDiagnosticsOverlay.tsx) | 1             | URL-addressable and resolves to `config-heatmap`.                                                     |
| R16 | `/__coverage__`                  | [src/pages/CoverageProbePage.tsx](src/pages/CoverageProbePage.tsx), [src/App.tsx](src/App.tsx)                     | 1             | Only mounted when `shouldEnableCoverageProbe()` returns true.                                         |
| R17 | `*`                              | [src/pages/NotFound.tsx](src/pages/NotFound.tsx), [src/App.tsx](src/App.tsx)                                       | 1             | Unknown-path fallback after `tabIndexForPath` rejects the pathname.                                   |

### 2.2 Global Surfaces

| ID  | Path or Surface                 | Owning Files                                                                                                                           | Feature Count | Notes                                                                                      |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| G01 | Connection controller           | [src/components/ConnectionController.tsx](src/components/ConnectionController.tsx)                                                     | 1             | Always mounted; owns connection-state probes and badge refresh.                            |
| G02 | Unified health badge            | [src/components/UnifiedHealthBadge.tsx](src/components/UnifiedHealthBadge.tsx), [src/components/AppBar.tsx](src/components/AppBar.tsx) | 1             | Entry point into diagnostics and long-press device switching.                              |
| G03 | Demo mode interstitial          | [src/components/DemoModeInterstitial.tsx](src/components/DemoModeInterstitial.tsx)                                                     | 1             | Route-agnostic interstitial shown when the app falls back to demo mode.                    |
| G04 | Diagnostics overlay             | [src/components/diagnostics/GlobalDiagnosticsOverlay.tsx](src/components/diagnostics/GlobalDiagnosticsOverlay.tsx)                     | 1             | Hosts deep-linked diagnostics panels, health check, repair, switching, and export.         |
| G05 | Trace context bridge            | [src/components/TraceContextBridge.tsx](src/components/TraceContextBridge.tsx)                                                         | 1             | Always mounted observability context propagation.                                          |
| G06 | Lighting studio dialog          | [src/components/lighting/LightingStudioDialog.tsx](src/components/lighting/LightingStudioDialog.tsx)                                   | 1             | Route-agnostic immersive lighting editor.                                                  |
| G07 | Test heartbeat                  | [src/components/TestHeartbeat.tsx](src/components/TestHeartbeat.tsx)                                                                   | 1             | Test-only surface behind the probe gate.                                                   |
| G08 | Tab bar                         | [src/components/TabBar.tsx](src/components/TabBar.tsx)                                                                                 | 1             | Bottom navigation entry surface.                                                           |
| G09 | Swipe navigation layer          | [src/components/SwipeNavigationLayer.tsx](src/components/SwipeNavigationLayer.tsx)                                                     | 1             | Owns the runway drag state and actual tab-slot rendering.                                  |
| G10 | App bar                         | [src/components/AppBar.tsx](src/components/AppBar.tsx)                                                                                 | 1             | Shared header shell for routed pages.                                                      |
| G11 | Global error listener           | [src/App.tsx](src/App.tsx)                                                                                                             | 1             | Window error and unhandled rejection capture with trace recording.                         |
| G12 | Global button interaction model | [src/App.tsx](src/App.tsx)                                                                                                             | 1             | Global button highlight and interaction instrumentation.                                   |
| G13 | Route refresher                 | [src/App.tsx](src/App.tsx)                                                                                                             | 1             | Visibility-change reconciler for diagnostics, config, and playback.                        |
| G14 | Diagnostics runtime bridge      | [src/App.tsx](src/App.tsx)                                                                                                             | 1             | Deferred console/native/web diagnostics bridge startup after first meaningful interaction. |

---

## Section 3 — Canonical Feature Catalog

Every feature below normalizes to [FEATURE_MODEL.md](FEATURE_MODEL.md). `feature_id` follows `<scope>__<feature_slug>`. Each feature contains the full required shape. Where evidence is missing for a field, the value is `[]` or `absent` with an explicit `gaps` entry — never a generic placeholder.

**Catalog status note.** This catalog is converged at workflow grain for the current repository audit. Route-level pages, global surfaces, native bridges, and web-runtime responsibilities each have at least one owning feature. Page-local dialogs, summary cards, and helper components are accounted for under their owning workflow features or classified as support-only in Sections 1 and 10 rather than carried as an open backlog.

### 3.1 App shell scope

```yaml
feature_id: app__tab_navigation
name: Primary tab navigation
description: >
  Bottom TabBar plus runway-based SwipeNavigationLayer that navigate between
  Home, Play, Disks, Config, Settings, and Docs. Settings slot internally
  renders `/settings/open-source-licenses`. `/diagnostics` and its subroutes
  are routed into the Settings slot by `tabIndexForPath`.
feature_type: section
parent_feature_id: null
entry_points:
  - kind: ui
    path_or_selector: "TabBar buttons (bottom nav)"
    preconditions: []
  - kind: gesture
    path_or_selector: "Horizontal swipe across SwipeNavigationLayer"
    preconditions: ["Pointer/touch events not captured by a modal"]
  - kind: route
    path_or_selector: "/, /play, /disks, /config, /settings, /docs"
    preconditions: []
implementation_refs:
  - path: src/lib/navigation/tabRoutes.ts
    symbol_or_region: TAB_ROUTES, tabIndexForPath, resolveSwipeTarget
    role: state
  - path: src/components/TabBar.tsx
    symbol_or_region: TabBar
    role: ui
  - path: src/components/SwipeNavigationLayer.tsx
    symbol_or_region: SwipeNavigationLayer, SettingsSlot
    role: ui
documentation_refs:
  - docs/features-by-page.md
  - docs/ux-guidelines.md
screenshot_refs: []
dependencies: { hardware: [none], network: [none], storage: [none], native: [none], external_services: [] }
platform_scope: { android: primary, ios: secondary, web: supported }
state_model:
  stateful: true
  states: [idle, dragging, transitioning, test_probe_slow]
  transitions: ["idle -> dragging", "dragging -> transitioning", "transitioning -> idle"]
  failure_modes: [stuck_transition, wrap_miscompute, reduced_motion_violation]
test_coverage:
  unit:
    status: present
    evidence: [tests/unit/components/TabBar.test.tsx, tests/unit/components/SwipeNavigationLayer.test.tsx]
    gaps: ["tabIndexForPath path-prefix matrix is not exhaustively unit-tested"]
  integration:
    status: absent
    evidence: []
    gaps: ["No ReactDOM-level integration test covers swipe-to-route commit"]
  playwright:
    status: present
    evidence: [playwright/swipe-navigation.spec.ts, playwright/navigationBoundaries.spec.ts]
    gaps: []
  maestro:
    status: present
    evidence: [.maestro/ios-subflow-open-play-tab-probe.yaml, .maestro/ios-subflow-open-settings-tab-probe.yaml]
    gaps: ["No Android-specific Maestro flow drives tab swipes end to end"]
  hil_pixel4:
    status: not_applicable
    evidence: []
    gaps: ["Route navigation does not require hardware HIL proof"]
  hil_u64:
    status: not_applicable
    evidence: []
    gaps: ["Route navigation does not require hardware HIL proof"]
  hil_c64u:
    status: not_applicable
    evidence: []
    gaps: ["Route navigation does not require hardware HIL proof"]
risk_tags: [cross_platform, state_consistency]
observability: [ui, screenshot, log]
notes:
  - "SettingsSlot lazy-imports OpenSourceLicensesPage based on path match; test-probe timing differs from normal motion timing."
```

```yaml
feature_id: app__connection_controller
name: Connection state and health controller
description: >
  Owns connection-state transitions, probes configured host at `/v1/info`,
  populates the UnifiedHealthBadge, and drives reconnect plus saved-device
  switching in cooperation with the diagnostics overlay.
feature_type: service
parent_feature_id: null
entry_points:
  - kind: startup
    path_or_selector: "App mount (ConnectionController always rendered)"
    preconditions: []
  - kind: ui
  - kind: ui
    path_or_selector: "UnifiedHealthBadge, AppBar connection badge"
    preconditions: []
  - kind: api
    path_or_selector: "saveConfiguredHostAndRetry, runHealthCheck"
    preconditions: []
implementation_refs:
  - path: src/components/ConnectionController.tsx
    symbol_or_region: ConnectionController
    role: state
  - path: src/lib/connection/connectionManager.ts
    symbol_or_region: connectionManager
    role: state
  - path: src/lib/connection/hostEdit.ts
    symbol_or_region: saveConfiguredHostAndRetry
    role: transport
  - path: src/hooks/useConnectionState.ts
    symbol_or_region: useConnectionState
    role: state
documentation_refs:
  - README.md
  - docs/features-by-page.md
screenshot_refs:
  - docs/img/app/home/02-connection-status-popover.png
  - docs/img/app/diagnostics/connection/01-view.png
  - docs/img/app/diagnostics/connection/02-edit.png
dependencies:
  hardware: [u64, c64u, optional]
  network: [rest]
  storage: [local_storage]
  native: [none]
  external_services: [c64u_rest_info]
platform_scope:
  android: primary
  ios: secondary
  web: supported
state_model:
  stateful: true
  states: [unknown, probing, connected, stale, error, offline_demo]
  transitions:
    - "unknown -> probing"
    - "probing -> connected"
    - "probing -> error"
    - "connected -> stale"
    - "stale -> probing"
    - "error -> offline_demo"
  failure_modes: [dns_unresolved, http_timeout, tls_mismatch, badge_desync]
test_coverage:
  unit:
    status: present
    evidence:
      [tests/unit/hooks/useConnectionState.test.ts, tests/unit/lib/diagnostics/connectionStatusDiagnostics.test.ts]
    gaps: ["No state-machine-style exhaustive transition test"]
  integration:
    status: weak
    evidence: [playwright/connectionSimulation.spec.ts]
    gaps: ["Stale-state timeout edges under long-running probe jitter not covered"]
  playwright:
    status: present
    evidence:
      [
        playwright/settingsConnection.spec.ts,
        playwright/connectionStatusLayout.spec.ts,
        playwright/homeDiagnosticsOverlay.spec.ts,
      ]
    gaps: []
  maestro:
    status: weak
    evidence: [.maestro/probe-health.yaml]
    gaps: ["No maestro flow exercising device-switch transition end-to-end on Android"]
  hil_pixel4:
    status: weak
    evidence: [docs/testing/physical-device-matrix.md]
    gaps: ["Pixel 4 evidence artifact for real u64 reconnect after airplane-mode cycle"]
  hil_u64:
    status: weak
    evidence: [docs/testing/physical-device-matrix.md]
    gaps: ["u64 reconnect-from-error path artifact not yet linked"]
  hil_c64u:
    status: weak
    evidence: [docs/testing/physical-device-matrix.md]
    gaps: ["c64u fallback path artifact not yet linked"]
risk_tags: [reliability, state_consistency, observability, cross_platform]
observability: [ui, toast, log, trace, rest_response, diagnostics_overlay]
notes:
  - "Device preference order per AGENTS.md: probe u64 first, fall back to c64u. Confirm this order is exercised in tests, not only in docs."
```

```yaml
feature_id: app__global_diagnostics_overlay
name: Global diagnostics overlay (panels + actions)
description: >
  Path-driven diagnostics overlay: renders overview/latency/history/
  config-drift/decision-state panels based on URL; hosts saved-device
  switching, health-check run, repair, share ZIP, and target validation.
feature_type: overlay
parent_feature_id: null
entry_points:
  - kind: route
    path_or_selector: "/diagnostics and /diagnostics/{latency,history,config-drift,decision-state}"
    preconditions: []
  - kind: ui
    path_or_selector: "UnifiedHealthBadge → Diagnostics"
    preconditions: []
implementation_refs:
  - path: src/components/diagnostics/GlobalDiagnosticsOverlay.tsx
    symbol_or_region: GlobalDiagnosticsOverlay, resolveDiagnosticsPanelFromPath
    role: ui
  - path: src/components/diagnostics/DiagnosticsDialog.tsx
    symbol_or_region: DiagnosticsDialog
    role: ui
  - path: src/components/diagnostics/LatencyAnalysisPopup.tsx
    symbol_or_region: LatencyAnalysisPopup
    role: ui
  - path: src/components/diagnostics/HealthHistoryPopup.tsx
    symbol_or_region: HealthHistoryPopup
    role: ui
  - path: src/components/diagnostics/ConfigDriftView.tsx
    symbol_or_region: ConfigDriftView
    role: ui
  - path: src/components/diagnostics/DecisionStateView.tsx
    symbol_or_region: DecisionStateView
    role: ui
  - path: src/components/diagnostics/HeatMapPopup.tsx
    symbol_or_region: HeatMapPopup
    role: ui
documentation_refs:
  - docs/features-by-page.md
  - docs/testing/agentic-tests/full-app-coverage/feature-test-catalog.md
screenshot_refs:
  - docs/img/app/diagnostics/01-overview.png
  - docs/img/app/diagnostics/analysis/01-latency.png
  - docs/img/app/diagnostics/analysis/02-history.png
  - docs/img/app/diagnostics/switch-device/profiles/compact/01-picker.png
  - docs/img/app/diagnostics/header/02-health-check-detail.png
  - docs/img/app/diagnostics/tools/01-menu.png
dependencies:
  hardware: [u64, c64u, optional]
  network: [rest]
  storage: [local_storage]
  native: [capacitor_bridge]
  external_services: []
platform_scope:
  android: primary
  ios: secondary
  web: supported
state_model:
  stateful: true
  states:
    [
      closed,
      overview,
      latency,
      history,
      config_drift,
      decision_state,
      switching_device,
      running_health_check,
      sharing_zip,
      repairing,
    ]
  transitions:
    - "closed -> overview"
    - "overview -> latency"
    - "overview -> history"
    - "overview -> config_drift"
    - "overview -> decision_state"
    - "overview -> switching_device"
    - "overview -> running_health_check"
    - "overview -> sharing_zip"
    - "overview -> repairing"
  failure_modes:
    [target_unreachable_on_switch, health_check_timeout, share_zip_permission_denied, repair_noop_claimed_success]
test_coverage:
  unit:
    status: present
    evidence:
      [
        tests/unit/diagnostics/actionSummaryDisplay.test.ts,
        tests/unit/diagnostics/exportRedaction.test.ts,
        tests/unit/lib/diagnostics/connectionStatusDiagnostics.test.ts,
        tests/unit/lib/diagnostics/networkSnapshot.test.ts,
      ]
    gaps: ["No unit test covering resolveDiagnosticsPanelFromPath across the 5 panel paths"]
  integration:
    status: weak
    evidence: []
    gaps: ["No integration test proving panel URL round-trips survive swipe navigation"]
  playwright:
    status: present
    evidence:
      [
        playwright/diagnosticsActions.spec.ts,
        playwright/settingsDiagnostics.spec.ts,
        playwright/homeDiagnosticsOverlay.spec.ts,
      ]
    gaps: ["config-drift and decision-state panel-specific e2e coverage thin"]
  maestro:
    status: present
    evidence: [.maestro/ios-diagnostics-export.yaml]
    gaps: ["Android maestro coverage for diagnostics share ZIP is missing"]
  hil_pixel4:
    status: weak
    evidence: [docs/testing/physical-device-matrix.md]
    gaps: ["Share-ZIP write evidence on Pixel 4 SAF target not linked"]
  hil_u64:
    status: weak
    evidence: [docs/testing/physical-device-matrix.md]
    gaps: ["Repair flow against real u64 not explicitly proven"]
  hil_c64u:
    status: weak
    evidence: [docs/testing/physical-device-matrix.md]
    gaps: ["Switch-device picker against real c64u not explicitly proven"]
risk_tags: [reliability, observability, state_consistency, security, cross_platform]
observability: [ui, screenshot, log, trace, diagnostics_overlay, rest_response, filesystem_state]
notes:
  - "Heat-map panels remain overlay content, but they are also deep-linkable at `/diagnostics/heatmap/{rest,ftp,config}` via `resolveDiagnosticsPanelFromPath`."
```

```yaml
feature_id: app__error_boundary
name: App and page error boundaries with global error capture
description: >
  AppErrorBoundary, PageErrorBoundary, GlobalErrorListener, and the
  unhandledrejection handler. Each surface surfaces recovery UI and logs
  errors through the tracing session.
feature_type: service
parent_feature_id: null
entry_points:
  - kind: startup
    path_or_selector: "App mount"
    preconditions: []
  - kind: test_only
    path_or_selector: "Error-injection probes in Playwright"
    preconditions: ["Coverage probe enabled"]
implementation_refs:
  - path: src/App.tsx
    symbol_or_region: AppErrorBoundary, PageErrorBoundary, GlobalErrorListener
    role: state
  - path: src/lib/tracing/traceSession.ts
    symbol_or_region: recordActionStart, recordTraceError, recordActionEnd
    role: diagnostics
  - path: src/lib/logging.ts
    symbol_or_region: addErrorLog
    role: diagnostics
documentation_refs: []
screenshot_refs: []
dependencies:
  hardware: [none]
  network: [none]
  storage: [local_storage]
  native: [none]
  external_services: []
platform_scope:
  android: supported
  ios: supported
  web: supported
state_model:
  stateful: true
  states: [healthy, app_error, page_error]
  transitions:
    - "healthy -> page_error"
    - "page_error -> healthy"
    - "healthy -> app_error"
    - "app_error -> healthy"
  failure_modes: [error_boundary_not_reset_after_route_change, error_log_not_recorded, global_listener_duplicate_events]
test_coverage:
  unit:
    status: present
    evidence: [tests/unit/logging/uiErrors.test.ts, tests/unit/tracing/actionTrace.test.ts]
    gaps: ["No direct test asserting AppErrorBoundary renders fallback and reload button"]
  integration:
    status: absent
    evidence: []
    gaps: ["ReactDOM-level error-boundary render + reset test absent"]
  playwright:
    status: weak
    evidence: [playwright/ui.spec.ts]
    gaps: ["No spec that triggers a render error and asserts recovery CTA"]
  maestro:
    status: absent
    evidence: []
    gaps: ["No flow that validates error-boundary UX on device"]
  hil_pixel4:
    status: not_applicable
    evidence: []
    gaps: ["Triggering is an app-level concern; HIL not needed"]
  hil_u64:
    status: not_applicable
    evidence: []
    gaps: []
  hil_c64u:
    status: not_applicable
    evidence: []
    gaps: []
risk_tags: [reliability, observability, correctness]
observability: [ui, log, trace]
notes: []
```

### 3.2 Home scope

```yaml
feature_id: home__machine_controls
name: Machine controls (reset, power, NMI, freeze)
description: >
  Home-page card that issues privileged machine-state actions to the
  connected device via c64api REST and updates the live system panel.
feature_type: section
parent_feature_id: null
entry_points:
  - kind: ui
    path_or_selector: "Home > Machine controls card"
    preconditions: ["ConnectionController reports connected"]
implementation_refs:
  - path: src/pages/home/components/MachineControls.tsx
    symbol_or_region: MachineControls
    role: ui
  - path: src/lib/c64api.ts
    symbol_or_region: machine endpoint helpers
    role: transport
documentation_refs:
  - docs/features-by-page.md
  - docs/c64/c64u-openapi.yaml
screenshot_refs:
  - docs/img/app/home/02-connection-status-popover.png
dependencies:
  hardware: [u64, c64u]
  network: [rest]
  storage: [none]
  native: [none]
  external_services: []
platform_scope:
  android: primary
  ios: secondary
  web: supported
state_model:
  stateful: true
  states: [idle, confirming, dispatching, succeeded, failed]
  transitions:
    - "idle -> confirming"
    - "confirming -> dispatching"
    - "dispatching -> succeeded"
    - "dispatching -> failed"
  failure_modes: [unauthorized_state_command, device_offline_mid_command, debounce_violation]
test_coverage:
  unit:
    status: present
    evidence:
      [
        tests/unit/pages/home/uiLogic.test.ts,
        tests/unit/pages/home/uiLogicBranches.test.ts,
        tests/unit/c64api.ext2.test.ts,
      ]
    gaps: ["No unit test enumerating the confirmation dialog matrix per command"]
  integration:
    status: weak
    evidence: []
    gaps: ["No integration test that asserts POST payload shape per action"]
  playwright:
    status: present
    evidence: [playwright/homeInteractivity.spec.ts]
    gaps: ["Failure-path assertions on 5xx responses thin"]
  maestro:
    status: absent
    evidence: []
    gaps: ["No maestro flow that taps reset/power/NMI on a real device or mock"]
  hil_pixel4:
    status: weak
    evidence: [docs/testing/physical-device-matrix.md]
    gaps: ["Pixel 4 artifact for reset + re-probe is undocumented"]
  hil_u64:
    status: weak
    evidence: [docs/testing/physical-device-matrix.md]
    gaps: ["u64 reset artifact with post-reset liveness check missing"]
  hil_c64u:
    status: weak
    evidence: [docs/testing/physical-device-matrix.md]
    gaps: ["c64u reset artifact missing"]
risk_tags: [device_interaction, reliability, correctness, security]
observability: [ui, toast, log, trace, rest_response, device_state]
notes:
  - "These actions are destructive to device state; confirm dialogs and safety presets must gate them."
```

```yaml
feature_id: home__app_configs
name: Home app-config dialogs (save/load/manage)
description: >
  Save, load, and manage stored app-config snapshots from the Home page,
  backed by appConfigStore with write throttling.
feature_type: workflow
parent_feature_id: home__machine_controls
entry_points:
  - kind: ui
    path_or_selector: "Home > SummaryConfigCard → Save/Load/Manage buttons"
    preconditions: []
implementation_refs:
  - path: src/pages/home/dialogs/SaveConfigDialog.tsx
    symbol_or_region: SaveConfigDialog
    role: ui
  - path: src/pages/home/dialogs/LoadConfigDialog.tsx
    symbol_or_region: LoadConfigDialog
    role: ui
  - path: src/pages/home/dialogs/ManageConfigDialog.tsx
    symbol_or_region: ManageConfigDialog
    role: ui
  - path: src/lib/config/appConfigStore.ts
    symbol_or_region: appConfigStore
    role: persistence
  - path: src/lib/config/configWriteThrottle.ts
    symbol_or_region: configWriteThrottle
    role: persistence
documentation_refs:
  - docs/features-by-page.md
screenshot_refs: []
dependencies:
  hardware: [u64, c64u, optional]
  network: [rest]
  storage: [local_storage]
  native: [none]
  external_services: []
platform_scope:
  android: primary
  ios: secondary
  web: supported
state_model:
  stateful: true
  states: [idle, saving, saved, loading, loaded, managing, deleting]
  transitions:
    - "idle -> saving"
    - "saving -> saved"
    - "idle -> loading"
    - "loading -> loaded"
    - "idle -> managing"
    - "managing -> deleting"
  failure_modes: [quota_exceeded, name_collision, mid_save_device_offline]
test_coverage:
  unit:
    status: present
    evidence: [tests/unit/config/appConfigStore.test.ts, tests/unit/configWriteThrottle.test.ts]
    gaps: []
  integration:
    status: weak
    evidence: []
    gaps: ["Throttle/collision interleaving not covered"]
  playwright:
    status: present
    evidence: [playwright/homeConfigManagement.spec.ts]
    gaps: []
  maestro:
    status: weak
    evidence: [.maestro/edge-config-persistence.yaml, .maestro/ios-config-persistence.yaml]
    gaps: ["Android-specific config-persistence flow limited to edge-config-persistence (non-iOS)"]
  hil_pixel4:
    {
      status: weak,
      evidence: [docs/testing/physical-device-matrix.md],
      gaps: ["Save→Load round-trip artifact on Pixel 4 missing"],
    }
  hil_u64:
    {
      status: weak,
      evidence: [docs/testing/physical-device-matrix.md],
      gaps: ["Apply-after-load device verification missing"],
    }
  hil_c64u:
    {
      status: weak,
      evidence: [docs/testing/physical-device-matrix.md],
      gaps: ["Apply-after-load device verification missing"],
    }
risk_tags: [persistence, correctness, state_consistency]
observability: [ui, toast, log, trace, storage_state]
notes: []
```

```yaml
feature_id: home__ram_operations
name: RAM save / restore / REU progress
description: >
  Persist RAM dumps and REU contents to the configured RAM dump folder and
  restore them. REU long-running ops surface a progress dialog with cancel.
feature_type: workflow
parent_feature_id: null
entry_points:
  - kind: ui
    path_or_selector: "Home > Save RAM / Restore Snapshot / REU controls"
    preconditions: ["RAM dump folder configured"]
implementation_refs:
  - path: src/pages/home/dialogs/SaveRamDialog.tsx
    symbol_or_region: SaveRamDialog
    role: ui
  - path: src/pages/home/dialogs/RestoreSnapshotDialog.tsx
    symbol_or_region: RestoreSnapshotDialog
    role: ui
  - path: src/pages/home/dialogs/SnapshotManagerDialog.tsx
    symbol_or_region: SnapshotManagerDialog
    role: ui
  - path: src/pages/home/dialogs/ReuProgressDialog.tsx
    symbol_or_region: ReuProgressDialog
    role: ui
  - path: src/lib/config/ramDumpFolderStore.ts
    symbol_or_region: ramDumpFolderStore
    role: persistence
documentation_refs:
  - docs/features-by-page.md
screenshot_refs: []
dependencies:
  hardware: [u64, c64u]
  network: [rest]
  storage: [saf, native_fs]
  native: [android_plugin]
  external_services: []
platform_scope:
  android: primary
  ios: limited
  web: limited
state_model:
  stateful: true
  states: [idle, folder_missing, saving, restoring, reu_streaming, cancelled, failed]
  transitions:
    - "idle -> saving"
    - "saving -> idle"
    - "idle -> restoring"
    - "restoring -> idle"
    - "idle -> reu_streaming"
    - "reu_streaming -> cancelled"
    - "reu_streaming -> failed"
  failure_modes: [saf_permission_revoked, partial_reu_write, device_disconnect_mid_stream]
test_coverage:
  unit:
    {
      status: present,
      evidence: [tests/unit/ramDumpFolderStore.test.ts],
      gaps: ["Chunked REU state machine unit coverage thin"],
    }
  integration: { status: weak, evidence: [], gaps: ["No REU progress integration test"] }
  playwright:
    { status: present, evidence: [playwright/ramSnapshot.spec.ts, playwright/homeRamDumpFolder.spec.ts], gaps: [] }
  maestro: { status: present, evidence: [.maestro/edge-ram-restore-chunked.yaml], gaps: ["iOS RAM path not covered"] }
  hil_pixel4:
    {
      status: weak,
      evidence: [docs/testing/physical-device-matrix.md],
      gaps: ["Pixel 4 SAF round-trip artifact for RAM save/load missing"],
    }
  hil_u64:
    {
      status: weak,
      evidence: [docs/testing/physical-device-matrix.md],
      gaps: ["u64 REU large-file artifact not linked"],
    }
  hil_c64u:
    {
      status: weak,
      evidence: [docs/testing/physical-device-matrix.md],
      gaps: ["c64u REU large-file artifact not linked"],
    }
risk_tags: [persistence, performance, reliability, device_interaction]
observability: [ui, toast, log, trace, filesystem_state, device_state]
notes: []
```

### 3.3 Play scope

```yaml
feature_id: play__source_browsing
name: Play source browsing
description: >
  Top-level Play surface that lets the user choose a source (local FS, HVSC,
  CommoServe) and browse its catalog before enqueueing items.
feature_type: section
parent_feature_id: null
entry_points:
  - kind: route
    path_or_selector: "/play"
    preconditions: []
  - kind: ui
    path_or_selector: "Play > source cards"
    preconditions: []
implementation_refs:
  - path: src/pages/PlayFilesPage.tsx
    symbol_or_region: PlayFilesPage
    role: ui
  - path: src/lib/sources/SongSource.ts
    symbol_or_region: SongSource
    role: state
  - path: src/lib/sources/LocalFsSongSource.ts
    symbol_or_region: LocalFsSongSource
    role: state
  - path: src/lib/sources/HvscSongSource.ts
    symbol_or_region: HvscSongSource
    role: state
documentation_refs:
  - docs/features-by-page.md
screenshot_refs:
  - docs/img/app/play/import/01-import-interstitial.png
  - docs/img/app/play/import/02-c64u-file-picker.png
  - docs/img/app/play/import/03-local-file-picker.png
dependencies:
  hardware: [u64, c64u, optional]
  network: [rest, ftp, internet]
  storage: [indexeddb, native_fs, saf]
  native: [capacitor_bridge, android_plugin]
  external_services: [hvsc_mirror, commoserve]
platform_scope:
  android: primary
  ios: secondary
  web: limited
state_model:
  stateful: true
  states: [no_source, local_browsing, hvsc_browsing, commoserve_browsing, error]
  transitions:
    - "no_source -> local_browsing"
    - "no_source -> hvsc_browsing"
    - "no_source -> commoserve_browsing"
  failure_modes: [source_unreachable, cache_miss, permission_revoked]
test_coverage:
  unit:
    {
      status: present,
      evidence: [tests/unit/sources/LocalFsSongSource.test.ts, tests/unit/hvsc/hvscSource.test.ts],
      gaps: [],
    }
  integration:
    { status: weak, evidence: [], gaps: ["No integration test switching between sources within one session"] }
  playwright:
    {
      status: present,
      evidence: [playwright/commoserve.spec.ts, playwright/hvsc.spec.ts, playwright/itemSelection.spec.ts],
      gaps: [],
    }
  maestro:
    {
      status: present,
      evidence: [.maestro/smoke-file-picker.yaml],
      gaps: ["No dedicated CommoServe or C64U browse maestro flow"],
    }
  hil_pixel4: { status: absent, evidence: [], gaps: ["No Pixel 4 artifact for Play source selection and browse"] }
  hil_u64: { status: absent, evidence: [], gaps: ["No u64 artifact for source browsing"] }
  hil_c64u:
    {
      status: weak,
      evidence: [docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md],
      gaps: ["App-first c64u evidence exists, but not as a direct per-feature artifact bundle"],
    }
risk_tags: [correctness, persistence, reliability, cross_platform]
observability: [ui, toast, log, trace, screenshot, filesystem_state]
notes:
  - "Source availability is additionally shaped by feature flags and native file-picker availability."
```

```yaml
feature_id: play__hvsc_lifecycle
name: HVSC download, ingest, and ready-state lifecycle
description: >
  Manages HVSC installation, cache validation, extraction, metadata hydration,
  reindexing, cancellation, reset, and transition to browse-ready state from
  the Play surface.
feature_type: workflow
parent_feature_id: play__source_browsing
entry_points:
  - kind: ui
    path_or_selector: "Play > HVSC manager and preparation sheet"
    preconditions: ["HVSC controls enabled"]
implementation_refs:
  - path: src/pages/PlayFilesPage.tsx
    symbol_or_region: HvscManager and HvscPreparationSheet wiring
    role: ui
  - path: src/pages/playFiles/hooks/useHvscLibrary.ts
    symbol_or_region: useHvscLibrary
    role: state
  - path: src/lib/hvsc/index.ts
    symbol_or_region: HVSC install, ingest, and status helpers
    role: transport
  - path: android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt
    symbol_or_region: HvscIngestionPlugin
    role: native
  - path: ios/App/App/HvscIngestionPlugin.swift
    symbol_or_region: HvscIngestionPlugin
    role: native
documentation_refs:
  - README.md
  - docs/features-by-page.md
  - docs/testing/physical-device-matrix.md
screenshot_refs:
  - docs/img/app/play/import/06-hvsc-preparing.png
  - docs/img/app/play/import/07-hvsc-ready.png
  - docs/img/app/play/import/08-hvsc-browser.png
dependencies:
  hardware: [android_device, ios_device, optional]
  network: [internet]
  storage: [indexeddb, native_fs]
  native: [capacitor_bridge, android_plugin, ios_plugin]
  external_services: [hvsc_mirror]
platform_scope:
  android: primary
  ios: limited
  web: limited
state_model:
  stateful: true
  states: [disabled, ready_to_download, downloading, extracting, indexing, ready_to_browse, cancelled, failed]
  transitions:
    - "disabled -> ready_to_download"
    - "ready_to_download -> downloading"
    - "downloading -> extracting"
    - "extracting -> indexing"
    - "indexing -> ready_to_browse"
    - "downloading -> cancelled"
    - "extracting -> failed"
    - "indexing -> failed"
  failure_modes: [download_failure, extraction_failure, partial_index_after_cancel, stale_cache_reuse]
test_coverage:
  unit:
    {
      status: present,
      evidence: [tests/unit/hvsc/hvscIngestionPipelineStateMachine.test.ts, tests/unit/hvsc/hvscSource.test.ts],
      gaps: ["Cancel-resume invariants could be tighter"],
    }
  integration:
    {
      status: present,
      evidence: [android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt],
      gaps: ["No iOS-native integration equivalent"],
    }
  playwright: { status: present, evidence: [playwright/hvsc.spec.ts], gaps: [] }
  maestro: { status: present, evidence: [.maestro/edge-hvsc-ingest-lifecycle.yaml], gaps: [] }
  hil_pixel4: { status: absent, evidence: [], gaps: ["No direct Pixel 4 HVSC lifecycle artifact linked"] }
  hil_u64: { status: absent, evidence: [], gaps: ["No direct u64 HVSC lifecycle artifact linked"] }
  hil_c64u:
    {
      status: present,
      evidence: [docs/testing/agentic-tests/full-app-coverage/runs/fac-20260308T113632Z-executor-manifest.md],
      gaps: ["Evidence is app-first physical Android plus c64u, not per-feature narrative evidence"],
    }
risk_tags: [correctness, performance, reliability, state_consistency, cross_platform]
observability: [ui, toast, log, trace, screenshot, filesystem_state]
notes:
  - "Native ingestion is materially different across Android and iOS; web remains limited and should not be treated as parity."
```

```yaml
feature_id: play__playback_transport
name: Playback transport, queue progression, and control surface
description: >
  Starts playback for the selected playlist item, manages stop/pause/resume,
  queue advancement, and playlist-side control state across local, archive,
  HVSC, and ultimate-origin tracks.
feature_type: workflow
parent_feature_id: play__source_browsing
entry_points:
  - kind: ui
    path_or_selector: "Play > Playback controls card and playlist panel"
    preconditions: ["Playlist contains at least one playable item"]
implementation_refs:
  - path: src/pages/PlayFilesPage.tsx
    symbol_or_region: playback controls and playlist wiring
    role: ui
  - path: src/pages/playFiles/hooks/usePlaybackController.ts
    symbol_or_region: usePlaybackController
    role: state
  - path: src/lib/playback/playbackRouter.ts
    symbol_or_region: buildPlayPlan and executePlayPlan
    role: transport
  - path: src/pages/playFiles/components/PlaybackControlsCard.tsx
    symbol_or_region: PlaybackControlsCard
    role: ui
documentation_refs:
  - docs/features-by-page.md
screenshot_refs:
  - docs/img/app/play/sections/02-playlist.png
dependencies:
  hardware: [u64, c64u]
  network: [rest, ftp]
  storage: [local_storage, indexeddb, native_fs]
  native: [capacitor_bridge]
  external_services: []
platform_scope:
  android: primary
  ios: secondary
  web: supported
state_model:
  stateful: true
  states: [idle, loading, playing, paused, stopping, failed]
  transitions:
    - "idle -> loading"
    - "loading -> playing"
    - "playing -> paused"
    - "paused -> playing"
    - "playing -> stopping"
    - "stopping -> idle"
    - "loading -> failed"
  failure_modes: [play_plan_mismatch, queue_desync, auto_advance_race, config_reference_unavailable]
test_coverage:
  unit:
    {
      status: present,
      evidence:
        [
          tests/unit/playFiles/usePlaybackController.test.tsx,
          tests/unit/playFiles/usePlaybackController.autoAdvance.test.tsx,
        ],
      gaps: [],
    }
  integration: { status: weak, evidence: [], gaps: ["No integrated queue plus router race harness"] }
  playwright: { status: present, evidence: [playwright/playback.spec.ts], gaps: [] }
  maestro: { status: present, evidence: [.maestro/smoke-playback.yaml], gaps: [] }
  hil_pixel4: { status: absent, evidence: [], gaps: ["No Pixel 4 playback transport artifact linked"] }
  hil_u64: { status: absent, evidence: [], gaps: ["No u64 playback transport artifact linked"] }
  hil_c64u:
    {
      status: present,
      evidence: [docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md],
      gaps: ["Current evidence is broader than the isolated transport workflow"],
    }
risk_tags: [correctness, reliability, state_consistency, device_interaction]
observability: [ui, toast, log, trace, audio_signal, device_state]
notes:
  - "Playback transport depends on per-item config resolution and origin-device routing for imported ultimate content."
```

```yaml
feature_id: play__lock_screen_playback
name: Lock-screen and background playback resume behavior
description: >
  Preserves playback continuity when the app is backgrounded or the device is
  locked, coordinating background execution and resume triggers.
feature_type: background
parent_feature_id: play__playback_transport
entry_points:
  - kind: background
    path_or_selector: "Playback active while app backgrounds or window resumes"
    preconditions: ["Playback already started"]
implementation_refs:
  - path: src/pages/PlayFilesPage.tsx
    symbol_or_region: background execution start/stop wiring
    role: state
  - path: src/pages/playFiles/hooks/usePlaybackResumeTriggers.ts
    symbol_or_region: usePlaybackResumeTriggers
    role: state
  - path: src/lib/native/backgroundExecutionManager.ts
    symbol_or_region: startBackgroundExecution and stopBackgroundExecution
    role: native
  - path: android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionPlugin.kt
    symbol_or_region: BackgroundExecutionPlugin
    role: native
documentation_refs:
  - docs/features-by-page.md
  - docs/testing/physical-device-matrix.md
screenshot_refs: []
dependencies:
  hardware: [android_device, u64, c64u]
  network: [rest]
  storage: [none]
  native: [background_service, android_plugin, capacitor_bridge]
  external_services: []
platform_scope:
  android: primary
  ios: limited
  web: unsupported
state_model:
  stateful: true
  states: [foreground_playing, background_playing, locked, resuming, stopped, failed]
  transitions:
    - "foreground_playing -> background_playing"
    - "background_playing -> locked"
    - "locked -> resuming"
    - "resuming -> foreground_playing"
    - "background_playing -> failed"
  failure_modes: [background_service_killed, resume_signal_missed, duplicate_resume_trigger]
test_coverage:
  unit:
    {
      status: present,
      evidence: [tests/unit/playFiles/usePlaybackResumeTriggers.test.tsx],
      gaps: ["No unit test for combined visibilitychange + focus storm"],
    }
  integration:
    {
      status: present,
      evidence: [android/app/src/test/java/uk/gleissner/c64commander/BackgroundExecutionPluginTest.kt],
      gaps: [],
    }
  playwright:
    { status: not_applicable, evidence: [], gaps: ["Web path is unsupported for this background-native behavior"] }
  maestro: { status: present, evidence: [.maestro/edge-auto-advance-lock.yaml], gaps: [] }
  hil_pixel4: { status: absent, evidence: [], gaps: ["No Pixel 4 long-duration lock-screen playback artifact linked"] }
  hil_u64: { status: absent, evidence: [], gaps: ["No u64 lock-screen playback artifact linked"] }
  hil_c64u:
    {
      status: present,
      evidence: [docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md],
      gaps: ["Current proof is broader than a focused background-duration run"],
    }
risk_tags: [reliability, performance, device_interaction, cross_platform]
observability: [ui, log, trace, audio_signal, device_state]
notes:
  - "This feature is materially Android-first; iOS and web should not inherit Android confidence by analogy."
```

### 3.4 Disks scope

```yaml
feature_id: disks__library
name: Disk library import, grouping, rename, and delete
description: >
  Manages the shared disk library shown on the Disks route, including import
  from local and ultimate sources, grouping, rename, selection, and delete.
feature_type: workflow
parent_feature_id: null
entry_points:
  - kind: route
    path_or_selector: "/disks"
    preconditions: []
  - kind: ui
    path_or_selector: "Disks > HomeDiskManager library actions"
    preconditions: []
implementation_refs:
  - path: src/pages/DisksPage.tsx
    symbol_or_region: DisksPage
    role: ui
  - path: src/components/disks/HomeDiskManager.tsx
    symbol_or_region: HomeDiskManager
    role: ui
  - path: src/hooks/useDiskLibrary.ts
    symbol_or_region: useDiskLibrary
    role: state
  - path: src/lib/disks/diskGrouping.ts
    symbol_or_region: assignDiskGroupsByPrefix
    role: state
documentation_refs:
  - docs/features-by-page.md
screenshot_refs:
  - docs/img/app/disks/collection/01-view-all.png
dependencies:
  hardware: [u64, c64u, optional]
  network: [ftp, rest]
  storage: [local_storage, native_fs, saf]
  native: [capacitor_bridge, android_plugin]
  external_services: []
platform_scope:
  android: primary
  ios: secondary
  web: supported
state_model:
  stateful: true
  states: [empty, importing, browsing, grouping, renaming, deleting, failed]
  transitions:
    - "empty -> importing"
    - "importing -> browsing"
    - "browsing -> grouping"
    - "browsing -> renaming"
    - "browsing -> deleting"
    - "importing -> failed"
  failure_modes: [duplicate_import_hidden, group_assignment_drift, delete_selection_desync]
test_coverage:
  unit:
    {
      status: present,
      evidence: [tests/unit/hooks/useDiskLibrary.test.ts, tests/unit/disks/diskGrouping.test.ts],
      gaps: [],
    }
  integration: { status: weak, evidence: [], gaps: ["No library persistence plus rename/delete race test"] }
  playwright: { status: present, evidence: [playwright/diskManagement.spec.ts], gaps: [] }
  maestro:
    {
      status: present,
      evidence: [.maestro/real-c64u-ftp-browse.yaml],
      gaps: ["No dedicated local-library grouping maestro flow"],
    }
  hil_pixel4: { status: absent, evidence: [], gaps: ["No Pixel 4 disk-library artifact linked"] }
  hil_u64: { status: absent, evidence: [], gaps: ["No u64 disk-library artifact linked"] }
  hil_c64u:
    {
      status: present,
      evidence: [docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md],
      gaps: ["Current proof is app-first rather than per-library-operation evidence"],
    }
risk_tags: [persistence, performance, state_consistency, cross_platform]
observability: [ui, toast, log, trace, filesystem_state]
notes: []
```

```yaml
feature_id: disks__mount
name: Disk mount, eject, rotation, and drive-state mutation
description: >
  Mounts a selected disk to a drive, ejects it, resets drive state, and keeps
  drive metadata synchronized with the device-reported state.
feature_type: workflow
parent_feature_id: disks__library
entry_points:
  - kind: ui
    path_or_selector: "Disks > drive actions in HomeDiskManager"
    preconditions: ["At least one drive visible or one disk selected"]
implementation_refs:
  - path: src/components/disks/HomeDiskManager.tsx
    symbol_or_region: drive action handlers and mountedByDrive state
    role: ui
  - path: src/lib/disks/diskMount.ts
    symbol_or_region: mountDiskToDrive
    role: transport
  - path: src/lib/drives/driveDevices.ts
    symbol_or_region: normalizeDriveDevices
    role: state
documentation_refs:
  - docs/features-by-page.md
screenshot_refs:
  - docs/img/app/disks/sections/01-drives.png
dependencies:
  hardware: [u64, c64u]
  network: [rest, ftp]
  storage: [native_fs, saf]
  native: [capacitor_bridge, android_plugin]
  external_services: []
platform_scope:
  android: primary
  ios: secondary
  web: supported
state_model:
  stateful: true
  states: [idle, mounting, mounted, ejecting, resetting, failed]
  transitions:
    - "idle -> mounting"
    - "mounting -> mounted"
    - "mounted -> ejecting"
    - "mounted -> resetting"
    - "mounting -> failed"
  failure_modes: [drive_state_stale_after_mount, reset_race, soft_iec_path_mismatch]
test_coverage:
  unit: { status: present, evidence: [tests/unit/diskMount.test.ts], gaps: [] }
  integration: { status: weak, evidence: [], gaps: ["No mount plus reset convergence integration test"] }
  playwright: { status: present, evidence: [playwright/diskManagement.spec.ts], gaps: [] }
  maestro:
    { status: weak, evidence: [.maestro/real-c64u-ftp-browse.yaml], gaps: ["No dedicated mount/eject maestro path"] }
  hil_pixel4: { status: absent, evidence: [], gaps: ["No Pixel 4 disk-mount artifact linked"] }
  hil_u64: { status: absent, evidence: [], gaps: ["No u64 disk-mount artifact linked"] }
  hil_c64u:
    {
      status: present,
      evidence: [docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md],
      gaps: ["Current proof is broader than an isolated mount/eject sequence"],
    }
risk_tags: [device_interaction, reliability, state_consistency, correctness]
observability: [ui, toast, log, trace, rest_response, ftp_result, device_state]
notes: []
```

### 3.5 Config scope

```yaml
feature_id: config__browse
name: Config category browsing and filtering
description: >
  Loads device config categories, opens a category section on demand, and
  renders normalized config items with search and section filtering.
feature_type: section
parent_feature_id: null
entry_points:
  - kind: route
    path_or_selector: "/config"
    preconditions: []
  - kind: ui
    path_or_selector: "Config > category sections and search"
    preconditions: ["Device connected"]
implementation_refs:
  - path: src/pages/ConfigBrowserPage.tsx
    symbol_or_region: ConfigBrowserPage and CategorySection
    role: ui
  - path: src/lib/config/normalizeConfigItem.ts
    symbol_or_region: normalizeConfigItem
    role: state
  - path: src/hooks/useAppConfigState.ts
    symbol_or_region: useAppConfigState
    role: state
documentation_refs:
  - docs/features-by-page.md
  - docs/c64/c64u-openapi.yaml
screenshot_refs:
  - docs/img/app/config/01-categories.png
  - docs/img/app/config/sections/01-audio-mixer.png
  - docs/img/app/config/sections/02-sid-sockets-configuration.png
dependencies:
  hardware: [u64, c64u]
  network: [rest]
  storage: [local_storage]
  native: [none]
  external_services: []
platform_scope:
  android: primary
  ios: secondary
  web: supported
state_model:
  stateful: true
  states: [loading, browsing, filtering, error]
  transitions:
    - "loading -> browsing"
    - "browsing -> filtering"
    - "loading -> error"
  failure_modes: [schema_version_mismatch, empty_category, dirty_state_on_nav]
test_coverage:
  unit:
    {
      status: present,
      evidence: [tests/unit/lib/config/normalizeConfigItem.test.ts, tests/unit/lib/config/controlType.test.ts],
      gaps: [],
    }
  integration: { status: weak, evidence: [], gaps: ["Schema-version mismatch path uncovered"] }
  playwright:
    {
      status: present,
      evidence: [playwright/configVisibility.spec.ts, playwright/configEditingBehavior.spec.ts],
      gaps: [],
    }
  maestro: { status: absent, evidence: [], gaps: ["No maestro flow that navigates every Config section"] }
  hil_pixel4: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
  hil_u64:
    {
      status: weak,
      evidence: [docs/testing/physical-device-matrix.md],
      gaps: ["u64-specific sections (Elite II) end-to-end apply not proven"],
    }
  hil_c64u: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
risk_tags: [correctness, state_consistency, cross_platform]
observability: [ui, log, screenshot, rest_response]
notes:
  - "Config schema differs per device family (Ultimate 64, Ultimate 64 Elite, Elite II, C64U); validate section visibility matrix per device."
```

```yaml
feature_id: config__edit
name: Config value editing and save
description: >
  Edits a single config item, tracks dirty state, debounces writes, and
  surfaces a save CTA with confirmation.
feature_type: workflow
parent_feature_id: config__browse
entry_points:
  - kind: ui
    path_or_selector: "Config section → control (slider/toggle/select)"
    preconditions: ["Device connected"]
implementation_refs:
  - path: src/pages/ConfigBrowserPage.tsx
    symbol_or_region: edit handlers
    role: ui
  - path: src/lib/config/configWriteThrottle.ts
    symbol_or_region: configWriteThrottle
    role: persistence
  - path: src/lib/ui/sliderDeviceAdapter.ts
    symbol_or_region: sliderDeviceAdapter
    role: ui
documentation_refs:
  - docs/features-by-page.md
screenshot_refs: []
dependencies:
  hardware: [u64, c64u]
  network: [rest]
  storage: [local_storage]
  native: [none]
  external_services: []
platform_scope:
  android: primary
  ios: secondary
  web: supported
state_model:
  stateful: true
  states: [clean, dirty, saving, saved, error]
  transitions:
    - "clean -> dirty"
    - "dirty -> saving"
    - "saving -> saved"
    - "saving -> error"
    - "saved -> clean"
  failure_modes: [optimistic_update_desync, throttle_lost_edit, server_rejects_value]
test_coverage:
  unit:
    {
      status: present,
      evidence: [tests/unit/configWriteThrottle.test.ts, tests/unit/lib/ui/sliderValueFormat.test.ts],
      gaps: [],
    }
  integration: { status: weak, evidence: [], gaps: ["Throttle + server-reject interleaving untested"] }
  playwright:
    {
      status: present,
      evidence: [playwright/configEditingBehavior.spec.ts, playwright/configVisibility.spec.ts],
      gaps: [],
    }
  maestro:
    {
      status: weak,
      evidence: [.maestro/edge-config-persistence.yaml, .maestro/ios-config-persistence.yaml],
      gaps: ["No maestro flow that edits every control type"],
    }
  hil_pixel4: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
  hil_u64:
    {
      status: weak,
      evidence: [docs/testing/physical-device-matrix.md],
      gaps: ["Apply→observe-on-device artifact missing"],
    }
  hil_c64u:
    {
      status: weak,
      evidence: [docs/testing/physical-device-matrix.md],
      gaps: ["Apply→observe-on-device artifact missing"],
    }
risk_tags: [correctness, state_consistency, persistence, device_interaction]
observability: [ui, toast, log, rest_response, storage_state]
notes: []
```

### 3.6 Settings scope

```yaml
feature_id: settings__connection
name: Connection settings (host, reconnect)
description: >
  Lets the user view, edit, and validate the configured device host and
  saves changes through the connection manager.
feature_type: section
parent_feature_id: null
entry_points:
  - kind: route
    path_or_selector: "/settings"
    preconditions: []
implementation_refs:
  - path: src/pages/SettingsPage.tsx
    symbol_or_region: connection section
    role: ui
  - path: src/lib/connection/hostEdit.ts
    symbol_or_region: hostEdit
    role: state
documentation_refs:
  - docs/features-by-page.md
screenshot_refs:
  - docs/img/app/diagnostics/connection/01-view.png
  - docs/img/app/diagnostics/connection/02-edit.png
dependencies:
  hardware: [u64, c64u, optional]
  network: [rest]
  storage: [local_storage]
  native: [none]
  external_services: []
platform_scope: { android: primary, ios: secondary, web: supported }
state_model:
  stateful: true
  states: [idle, editing, validating, saved, invalid]
  transitions:
    - "idle -> editing"
    - "editing -> validating"
    - "validating -> saved"
    - "validating -> invalid"
    - "saved -> idle"
  failure_modes: [invalid_hostname, unreachable_host, tls_downgrade_rejected]
test_coverage:
  unit: { status: present, evidence: [tests/unit/lib/network/trustedLanHost.test.ts], gaps: [] }
  integration: { status: weak, evidence: [], gaps: [] }
  playwright:
    { status: present, evidence: [playwright/settingsConnection.spec.ts, playwright/webPlatformAuth.spec.ts], gaps: [] }
  maestro: { status: absent, evidence: [], gaps: ["No maestro flow that edits host + verifies reconnect"] }
  hil_pixel4: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
  hil_u64: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
  hil_c64u: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
risk_tags: [reliability, security, correctness]
observability: [ui, log, rest_response]
notes: []
```

```yaml
feature_id: settings__safety_presets
name: Device safety presets (Relaxed / Balanced / Conservative)
description: >
  User-visible safety preset that gates destructive operations such as
  power-off, freeze, and clear flash. README is the authoritative spec.
feature_type: section
parent_feature_id: null
entry_points:
  - kind: ui
    path_or_selector: "Settings → Device Safety preset"
    preconditions: []
implementation_refs:
  - path: src/pages/SettingsPage.tsx
    symbol_or_region: safety preset controls
    role: ui
  - path: src/lib/config/appSettings.ts
    symbol_or_region: safety preset persistence
    role: persistence
documentation_refs:
  - README.md
  - docs/ux-guidelines.md
screenshot_refs: []
dependencies:
  { hardware: [u64, c64u, optional], network: [rest], storage: [local_storage], native: [none], external_services: [] }
platform_scope: { android: primary, ios: secondary, web: supported }
state_model:
  stateful: true
  states: [relaxed, balanced, conservative]
  transitions:
    - "relaxed -> balanced"
    - "balanced -> conservative"
    - "conservative -> balanced"
    - "balanced -> relaxed"
  failure_modes: [preset_not_gating_destructive_action, confirm_dialog_bypass]
test_coverage:
  unit: { status: weak, evidence: [], gaps: ["No unit test proves preset gates every destructive CTA"] }
  integration: { status: absent, evidence: [], gaps: ["Destructive-action gating matrix absent"] }
  playwright:
    {
      status: weak,
      evidence: [playwright/homeInteractivity.spec.ts],
      gaps: ["Explicit preset x action matrix not tested"],
    }
  maestro: { status: absent, evidence: [], gaps: ["No maestro flow that toggles preset and asserts CTA guards"] }
  hil_pixel4: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
  hil_u64: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
  hil_c64u: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
risk_tags: [security, correctness, device_interaction, state_consistency]
observability: [ui, log, storage_state]
notes:
  - "This is a cross-cutting gate, not a point feature; absence of a preset x action test matrix is a release-blocker-grade gap."
```

```yaml
feature_id: settings__demo_mode
name: Demo mode + interstitial
description: >
  Toggles demo mode, shows an interstitial on entry, and routes c64api calls
  to the mock server instead of a live device.
feature_type: workflow
parent_feature_id: null
entry_points:
  - kind: ui
    path_or_selector: "Settings → Demo mode toggle"
    preconditions: []
  - kind: setting
    path_or_selector: "FeatureFlag demo-mode default"
    preconditions: []
implementation_refs:
  - path: src/components/DemoModeInterstitial.tsx
    symbol_or_region: DemoModeInterstitial
    role: ui
  - path: src/lib/mock/mockServer.ts
    symbol_or_region: mockServer
    role: transport
  - path: src/lib/native/mockC64u.ts
    symbol_or_region: mockC64u
    role: native
  - path: android/app/src/main/java/uk/gleissner/c64commander/MockC64UPlugin.kt
    symbol_or_region: MockC64UPlugin
    role: native
  - path: ios/App/App/MockC64UPlugin.swift
    symbol_or_region: MockC64UPlugin
    role: native
documentation_refs:
  - README.md
  - docs/features-by-page.md
screenshot_refs: []
dependencies:
  {
    hardware: [none, optional],
    network: [rest, ftp],
    storage: [local_storage],
    native: [android_plugin, ios_plugin, capacitor_bridge],
    external_services: [],
  }
platform_scope: { android: primary, ios: secondary, web: supported }
state_model:
  stateful: true
  states: [live, demo_entering, demo_active, demo_exiting]
  transitions:
    - "live -> demo_entering"
    - "demo_entering -> demo_active"
    - "demo_active -> demo_exiting"
    - "demo_exiting -> live"
  failure_modes: [demo_bleeds_to_live, mock_server_not_installed, interstitial_skipped_on_deep_link]
test_coverage:
  unit: { status: present, evidence: [tests/unit/mockServer.test.ts, tests/unit/mockConfigYaml.test.ts], gaps: [] }
  integration:
    {
      status: present,
      evidence:
        [
          android/app/src/test/java/uk/gleissner/c64commander/MockC64UPluginTest.kt,
          android/app/src/test/java/uk/gleissner/c64commander/MockC64UServerTest.kt,
          android/app/src/test/java/uk/gleissner/c64commander/MockC64UServerHandlerTest.kt,
          android/app/src/test/java/uk/gleissner/c64commander/MockC64UStateTest.kt,
          android/app/src/test/java/uk/gleissner/c64commander/MockFtpServerTest.kt,
        ],
      gaps: [],
    }
  playwright:
    {
      status: present,
      evidence: [playwright/demoMode.spec.ts, playwright/demoConfig.spec.ts, playwright/debugDemo.spec.ts],
      gaps: [],
    }
  maestro:
    {
      status: absent,
      evidence: [],
      gaps: ["No maestro flow that activates demo and proves FTP+REST both route to mock"],
    }
  hil_pixel4: { status: not_applicable, evidence: [], gaps: ["Demo is by definition offline"] }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [correctness, state_consistency, observability]
observability: [ui, log, trace, rest_response, ftp_result]
notes: []
```

### 3.7 Docs + licenses scopes

```yaml
feature_id: docs__view
name: In-app docs viewer
description: >
  Renders Markdown-sourced docs sections in-app with section navigation and
  external-resource links.
feature_type: route
parent_feature_id: null
entry_points: [{ kind: route, path_or_selector: "/docs", preconditions: [] }]
implementation_refs:
  - path: src/pages/DocsPage.tsx
    symbol_or_region: DocsPage
    role: ui
documentation_refs:
  - docs/features-by-page.md
screenshot_refs:
  - docs/img/app/docs/01-overview.png
  - docs/img/app/docs/sections/01-getting-started.png
  - docs/img/app/docs/sections/08-diagnostics.png
  - docs/img/app/docs/external/01-external-resources.png
dependencies: { hardware: [none], network: [internet], storage: [none], native: [none], external_services: [] }
platform_scope: { android: primary, ios: secondary, web: supported }
state_model:
  {
    stateful: true,
    states: [loading, section_open, external],
    transitions: ["loading -> section_open", "section_open -> external", "external -> section_open"],
    failure_modes: [section_not_found, external_link_broken],
  }
test_coverage:
  unit: { status: absent, evidence: [], gaps: ["No unit test asserting Markdown section rendering"] }
  integration: { status: absent, evidence: [], gaps: [] }
  playwright:
    {
      status: weak,
      evidence: [playwright/screenshots.spec.ts],
      gaps: ["No spec that clicks each external link and validates target"],
    }
  maestro: { status: absent, evidence: [], gaps: [] }
  hil_pixel4: { status: not_applicable, evidence: [], gaps: [] }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [correctness]
observability: [ui, screenshot]
notes: []
```

```yaml
feature_id: licenses__open_source_view
name: Open-source licenses page
description: >
  Sub-route of Settings that displays third-party license texts.
feature_type: route
parent_feature_id: null
entry_points: [{ kind: route, path_or_selector: "/settings/open-source-licenses", preconditions: [] }]
implementation_refs:
  - path: src/pages/OpenSourceLicensesPage.tsx
    symbol_or_region: OpenSourceLicensesPage
    role: ui
documentation_refs: []
screenshot_refs: []
dependencies: { hardware: [none], network: [none], storage: [none], native: [none], external_services: [] }
platform_scope: { android: supported, ios: supported, web: supported }
state_model: { stateful: false, states: [], transitions: [], failure_modes: [missing_license_text] }
test_coverage:
  unit: { status: absent, evidence: [], gaps: [] }
  integration: { status: absent, evidence: [], gaps: [] }
  playwright: { status: weak, evidence: [playwright/navigationBoundaries.spec.ts], gaps: [] }
  maestro: { status: absent, evidence: [], gaps: [] }
  hil_pixel4: { status: not_applicable, evidence: [], gaps: [] }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [security]
observability: [ui]
notes:
  - "License completeness is a compliance surface; add a CI check that regenerates and diffs the license list."
```

### 3.8 Diagnostics scope (panel-specific features)

```yaml
feature_id: diagnostics__saved_device_switching
name: Saved device switching via diagnostics picker
description: >
  Shows all saved devices with live health status and allows the user to
  switch the active device; on switch, runs target validation and reconnect.
feature_type: dialog
parent_feature_id: app__global_diagnostics_overlay
entry_points:
  - kind: ui
    path_or_selector: "Diagnostics overlay → Switch device"
    preconditions: ["At least one saved device"]
implementation_refs:
  - path: src/hooks/useSavedDeviceSwitching.ts
    symbol_or_region: useSavedDeviceSwitching
    role: state
  - path: src/hooks/useSavedDeviceHealthChecks.ts
    symbol_or_region: useSavedDeviceHealthChecks
    role: state
  - path: src/components/diagnostics/DeviceDetailView.tsx
    symbol_or_region: DeviceDetailView
    role: ui
documentation_refs:
  - docs/features-by-page.md
screenshot_refs:
  - docs/img/app/diagnostics/switch-device/profiles/compact/01-picker.png
  - docs/img/app/diagnostics/switch-device/profiles/compact/04-picker-one-unhealthy.png
  - docs/img/app/diagnostics/switch-device/profiles/expanded/01-picker.png
dependencies:
  { hardware: [u64, c64u], network: [rest], storage: [local_storage], native: [none], external_services: [] }
platform_scope: { android: primary, ios: secondary, web: supported }
state_model:
  stateful: true
  states: [idle, probing_all, showing_picker, switching, switched, switch_failed]
  transitions:
    - "idle -> probing_all"
    - "probing_all -> showing_picker"
    - "showing_picker -> switching"
    - "switching -> switched"
    - "switching -> switch_failed"
  failure_modes: [partial_probe_failure, switch_to_unhealthy_accepted_without_warning, health_status_stale]
test_coverage:
  unit: { status: weak, evidence: [], gaps: ["No unit test for useSavedDeviceSwitching/HealthChecks"] }
  integration: { status: weak, evidence: [], gaps: [] }
  playwright:
    {
      status: present,
      evidence: [playwright/diagnosticsActions.spec.ts, playwright/settingsDiagnostics.spec.ts],
      gaps: [],
    }
  maestro: { status: absent, evidence: [], gaps: ["No maestro flow that switches between u64 and c64u"] }
  hil_pixel4:
    {
      status: weak,
      evidence: [docs/testing/physical-device-matrix.md],
      gaps: ["Switch-with-one-unhealthy artifact missing"],
    }
  hil_u64: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
  hil_c64u: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
risk_tags: [reliability, state_consistency, device_interaction, observability]
observability: [ui, screenshot, log, rest_response, diagnostics_overlay]
notes: []
```

```yaml
feature_id: diagnostics__share_zip
name: Diagnostics share ZIP (redacted export)
description: >
  Collects logs, traces, snapshots, and health history into a redacted ZIP
  and hands off via platform share sheet.
feature_type: workflow
parent_feature_id: app__global_diagnostics_overlay
entry_points:
  - kind: ui
    path_or_selector: "Diagnostics overlay → Tools → Share diagnostics"
    preconditions: []
implementation_refs:
  - path: src/lib/diagnostics/exportRedaction.ts
    symbol_or_region: exportRedaction
    role: diagnostics
  - path: src/components/diagnostics/ToolsCard.tsx
    symbol_or_region: ToolsCard
    role: ui
documentation_refs: []
screenshot_refs: [docs/img/app/diagnostics/tools/01-menu.png]
dependencies:
  {
    hardware: [none],
    network: [none],
    storage: [saf, native_fs, local_storage],
    native: [android_plugin, ios_plugin, capacitor_bridge],
    external_services: [],
  }
platform_scope: { android: primary, ios: secondary, web: limited }
state_model:
  stateful: true
  states: [idle, collecting, redacting, packaging, handing_off, failed]
  transitions:
    - "idle -> collecting"
    - "collecting -> redacting"
    - "redacting -> packaging"
    - "packaging -> handing_off"
    - "handing_off -> idle"
    - "collecting -> failed"
  failure_modes: [redaction_missed_pii, saf_permission_denied, oversized_zip]
test_coverage:
  unit: { status: present, evidence: [tests/unit/diagnostics/exportRedaction.test.ts], gaps: [] }
  integration: { status: absent, evidence: [], gaps: ["No end-to-end ZIP-content audit under a real share path"] }
  playwright:
    { status: weak, evidence: [playwright/diagnosticsActions.spec.ts], gaps: ["Zip content inspection absent"] }
  maestro:
    { status: present, evidence: [.maestro/ios-diagnostics-export.yaml], gaps: ["Android share-sheet flow absent"] }
  hil_pixel4:
    { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: ["Actual share-sheet artifact missing"] }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [security, observability, persistence]
observability: [ui, log, filesystem_state]
notes:
  - "This is an observability + compliance surface; a missed redaction is a security bug."
```

### 3.9 Coverage probe and NotFound scopes

```yaml
feature_id: coverage_probe__test_heartbeat
name: Coverage probe and test heartbeat
description: >
  Test-only route and heartbeat surface used by Playwright to introspect app
  readiness and feature-flag state. Gated by `shouldEnableCoverageProbe()`.
feature_type: hidden_route
parent_feature_id: null
entry_points:
  - kind: test_only
    path_or_selector: "/__coverage__"
    preconditions: ["VITE_ENABLE_TEST_PROBES=1 OR window.__c64uTestProbeEnabled"]
implementation_refs:
  - path: src/App.tsx
    symbol_or_region: shouldEnableCoverageProbe, CoverageProbePage mount
    role: test_support
  - path: src/pages/CoverageProbePage.tsx
    symbol_or_region: CoverageProbePage
    role: test_support
  - path: src/components/TestHeartbeat.tsx
    symbol_or_region: TestHeartbeat
    role: test_support
documentation_refs: []
screenshot_refs: []
dependencies: { hardware: [none], network: [none], storage: [none], native: [none], external_services: [] }
platform_scope: { android: supported, ios: supported, web: primary }
state_model: { stateful: false, states: [], transitions: [], failure_modes: [probe_leaked_to_production_build] }
test_coverage:
  unit:
    {
      status: weak,
      evidence: [],
      gaps: ["No unit test that asserts shouldEnableCoverageProbe returns false by default"],
    }
  integration: { status: absent, evidence: [], gaps: [] }
  playwright: { status: present, evidence: [playwright/coverageProbes.spec.ts], gaps: [] }
  maestro: { status: not_applicable, evidence: [], gaps: [] }
  hil_pixel4: { status: not_applicable, evidence: [], gaps: [] }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [security, observability]
observability: [ui, log]
notes:
  - "This is a prod-hardening concern: ensure CI guards that production bundles cannot enable the probe via env or window var."
```

```yaml
feature_id: not_found__route
name: NotFound route for unknown paths
description: >
  Renders NotFound only when the pathname does not resolve to a tab route or
  known sub-route (via `tabIndexForPath`).
feature_type: route
parent_feature_id: null
entry_points: [{ kind: route, path_or_selector: "*", preconditions: [] }]
implementation_refs:
  - path: src/App.tsx
    symbol_or_region: NotFoundForUnknownPaths
    role: ui
  - path: src/pages/NotFound.tsx
    symbol_or_region: NotFound
    role: ui
documentation_refs: []
screenshot_refs: []
dependencies: { hardware: [none], network: [none], storage: [none], native: [none], external_services: [] }
platform_scope: { android: supported, ios: supported, web: supported }
state_model:
  { stateful: false, states: [], transitions: [], failure_modes: [false_positive_for_nested_known_sub_route] }
test_coverage:
  unit:
    { status: weak, evidence: [], gaps: ["No unit test pairing tabIndexForPath with NotFoundForUnknownPaths output"] }
  integration: { status: absent, evidence: [], gaps: [] }
  playwright: { status: present, evidence: [playwright/navigationBoundaries.spec.ts], gaps: [] }
  maestro: { status: absent, evidence: [], gaps: [] }
  hil_pixel4: { status: not_applicable, evidence: [], gaps: [] }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [correctness]
observability: [ui, screenshot]
notes: []
```

### 3.10 Android native scope

```yaml
feature_id: android_native__background_execution
name: Android background execution + foreground service
description: >
  Keeps the app process alive while playback is active via a foreground
  service + sticky notification; bridges start/stop to JS.
feature_type: native_bridge
parent_feature_id: play__lock_screen_playback
entry_points:
  - kind: api
    path_or_selector: "BackgroundExecutionPlugin.start/stop"
    preconditions: []
implementation_refs:
  - path: android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt
    symbol_or_region: BackgroundExecutionService
    role: native
  - path: android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionPlugin.kt
    symbol_or_region: BackgroundExecutionPlugin
    role: native
  - path: src/lib/native/backgroundExecution.ts
    symbol_or_region: backgroundExecution
    role: transport
documentation_refs: []
screenshot_refs: []
dependencies:
  {
    hardware: [none],
    network: [none],
    storage: [none],
    native: [android_plugin, background_service],
    external_services: [],
  }
platform_scope: { android: primary, ios: not_applicable, web: not_applicable }
state_model:
  stateful: true
  states: [not_running, starting, running, stopping, killed]
  transitions:
    - "not_running -> starting"
    - "starting -> running"
    - "running -> stopping"
    - "stopping -> not_running"
    - "running -> killed"
  failure_modes: [notification_channel_missing, foreground_type_rejected_by_os, killed_without_notify]
test_coverage:
  unit: { status: present, evidence: [tests/unit/lib/native/backgroundExecutionManager.test.ts], gaps: [] }
  integration:
    {
      status: present,
      evidence:
        [
          android/app/src/test/java/uk/gleissner/c64commander/BackgroundExecutionServiceTest.kt,
          android/app/src/test/java/uk/gleissner/c64commander/BackgroundExecutionPluginTest.kt,
        ],
      gaps: [],
    }
  playwright: { status: not_applicable, evidence: [], gaps: [] }
  maestro: { status: present, evidence: [.maestro/smoke-background-execution.yaml], gaps: [] }
  hil_pixel4:
    {
      status: weak,
      evidence: [docs/testing/physical-device-matrix.md],
      gaps: ["Service persistence across app swap evidence missing"],
    }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [reliability, device_interaction]
observability: [device_state, log, audio_signal]
notes: []
```

```yaml
feature_id: android_native__secure_storage
name: Android secure storage plugin
description: >
  Stores sensitive settings (credentials, signed tokens) via Android keystore-backed storage.
feature_type: native_bridge
parent_feature_id: null
entry_points: [{ kind: api, path_or_selector: "SecureStoragePlugin.get/set/remove", preconditions: [] }]
implementation_refs:
  - path: android/app/src/main/java/uk/gleissner/c64commander/SecureStoragePlugin.kt
    symbol_or_region: SecureStoragePlugin
    role: native
  - path: src/lib/native/secureStorage.ts
    symbol_or_region: secureStorage
    role: transport
documentation_refs: []
screenshot_refs: []
dependencies:
  { hardware: [none], network: [none], storage: [secure_storage], native: [android_plugin], external_services: [] }
platform_scope: { android: primary, ios: secondary, web: limited }
state_model:
  { stateful: false, states: [], transitions: [], failure_modes: [keystore_rotation_lost_data, migration_failure] }
test_coverage:
  unit: { status: absent, evidence: [], gaps: ["No web-side test of src/lib/native/secureStorage.web.ts parity"] }
  integration:
    {
      status: present,
      evidence: [android/app/src/test/java/uk/gleissner/c64commander/SecureStoragePluginTest.kt],
      gaps: [],
    }
  playwright: { status: absent, evidence: [], gaps: [] }
  maestro:
    {
      status: present,
      evidence: [.maestro/ios-secure-storage-persist.yaml],
      gaps: ["No Android-specific maestro flow that asserts persistence across app kill"],
    }
  hil_pixel4:
    {
      status: weak,
      evidence: [docs/testing/physical-device-matrix.md],
      gaps: ["Post-reboot secret-survival artifact missing"],
    }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [security, persistence, correctness]
observability: [log, storage_state]
notes: []
```

```yaml
feature_id: android_native__folder_picker
name: Android SAF folder picker
description: >
  Exposes Android Storage Access Framework tree-pick + persisted URI
  management to the JS runtime.
feature_type: native_bridge
parent_feature_id: null
entry_points: [{ kind: api, path_or_selector: "FolderPicker.pick/getPersistedUris/release", preconditions: [] }]
implementation_refs:
  - path: android/app/src/main/java/uk/gleissner/c64commander/FolderPickerPlugin.kt
    symbol_or_region: FolderPickerPlugin
    role: native
  - path: src/lib/native/folderPicker.ts
    symbol_or_region: FolderPicker
    role: transport
  - path: src/lib/native/safUtils.ts
    symbol_or_region: redactTreeUri
    role: diagnostics
documentation_refs: []
screenshot_refs: []
dependencies: { hardware: [none], network: [none], storage: [saf], native: [android_plugin], external_services: [] }
platform_scope: { android: primary, ios: not_applicable, web: unsupported }
state_model:
  stateful: true
  states: [no_permission, permission_granted, permission_revoked]
  transitions:
    - "no_permission -> permission_granted"
    - "permission_granted -> permission_revoked"
    - "permission_revoked -> permission_granted"
  failure_modes: [revoked_mid_operation, persisted_uri_limit_exceeded, pick_cancelled]
test_coverage:
  unit:
    {
      status: present,
      evidence: [tests/unit/native/folderPicker.test.ts, tests/unit/lib/native/folderPicker.test.ts],
      gaps: [],
    }
  integration:
    {
      status: present,
      evidence: [android/app/src/test/java/uk/gleissner/c64commander/FolderPickerPluginTest.kt],
      gaps: [],
    }
  playwright: { status: not_applicable, evidence: [], gaps: [] }
  maestro:
    { status: present, evidence: [.maestro/smoke-file-picker.yaml, .maestro/smoke-file-picker-cancel.yaml], gaps: [] }
  hil_pixel4:
    { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: ["Revocation-recovery artifact missing"] }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [security, reliability, persistence]
observability: [log, filesystem_state]
notes: []
```

```yaml
feature_id: android_native__telnet_socket
name: Android Telnet socket plugin
description: >
  Raw TCP + Telnet socket bridge used for device consoles and modem flows.
feature_type: native_bridge
parent_feature_id: null
entry_points: [{ kind: api, path_or_selector: "TelnetSocket.connect/write/read/close", preconditions: [] }]
implementation_refs:
  - path: android/app/src/main/java/uk/gleissner/c64commander/TelnetSocketPlugin.kt
    symbol_or_region: TelnetSocketPlugin
    role: native
  - path: ios/App/App/TelnetSocketPlugin.swift
    symbol_or_region: TelnetSocketPlugin
    role: native
documentation_refs: []
screenshot_refs: []
dependencies:
  {
    hardware: [u64, c64u, optional],
    network: [telnet],
    storage: [none],
    native: [android_plugin, ios_plugin],
    external_services: [],
  }
platform_scope: { android: primary, ios: secondary, web: unsupported }
state_model:
  {
    stateful: true,
    states: [closed, connecting, open, closing, error],
    transitions:
      ["closed -> connecting", "connecting -> open", "open -> closing", "closing -> closed", "connecting -> error"],
    failure_modes: [handshake_timeout, half_close_leak, cert_mismatch_on_tls],
  }
test_coverage:
  unit: { status: absent, evidence: [], gaps: [] }
  integration:
    {
      status: present,
      evidence: [android/app/src/test/java/uk/gleissner/c64commander/TelnetSocketPluginTest.kt],
      gaps: ["No iOS-side integration test"],
    }
  playwright: { status: absent, evidence: [], gaps: [] }
  maestro: { status: absent, evidence: [], gaps: [] }
  hil_pixel4: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
  hil_u64: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
  hil_c64u: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
risk_tags: [reliability, security, device_interaction, cross_platform]
observability: [telnet_result, log]
notes: []
```

```yaml
feature_id: android_native__ftp_client
name: Android FTP client plugin
description: >
  FTP client bridge for disk browsing and imports against c64u/u64 devices.
feature_type: native_bridge
parent_feature_id: null
entry_points: [{ kind: api, path_or_selector: "FtpClient.connect/list/get/put/close", preconditions: [] }]
implementation_refs:
  - path: android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt
    symbol_or_region: FtpClientPlugin
    role: native
  - path: ios/App/App/IOSFtp.swift
    symbol_or_region: IOSFtp
    role: native
documentation_refs: []
screenshot_refs: []
dependencies:
  {
    hardware: [u64, c64u],
    network: [ftp],
    storage: [none],
    native: [android_plugin, ios_plugin],
    external_services: [],
  }
platform_scope: { android: primary, ios: secondary, web: limited }
state_model:
  {
    stateful: true,
    states: [closed, connecting, open, listing, transferring, closing, error],
    transitions:
      ["closed -> connecting", "connecting -> open", "open -> listing", "open -> transferring", "open -> closing"],
    failure_modes: [passive_mode_blocked, credential_rejected, control_channel_timeout],
  }
test_coverage:
  unit: { status: absent, evidence: [], gaps: [] }
  integration:
    {
      status: present,
      evidence:
        [
          android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt,
          android/app/src/test/java/uk/gleissner/c64commander/MockFtpServerTest.kt,
        ],
      gaps: [],
    }
  playwright: { status: present, evidence: [playwright/ftpPerformance.spec.ts], gaps: [] }
  maestro: { status: present, evidence: [.maestro/real-c64u-ftp-browse.yaml, .maestro/ios-ftp-browse.yaml], gaps: [] }
  hil_pixel4: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
  hil_u64:
    {
      status: weak,
      evidence: [docs/testing/physical-device-matrix.md],
      gaps: ["u64 FTP real-disk artifact per run missing"],
    }
  hil_c64u: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
risk_tags: [reliability, security, performance, device_interaction, cross_platform]
observability: [ftp_result, log, filesystem_state]
notes: []
```

```yaml
feature_id: android_native__mock_c64u
name: Android MockC64U server stack
description: >
  Local mock REST + FTP server that emulates a c64u/u64 for demo mode and
  automated tests. Ships a state machine and timing profile for realistic
  behavior.
feature_type: native_bridge
parent_feature_id: settings__demo_mode
entry_points: [{ kind: api, path_or_selector: "MockC64UPlugin.start/stop", preconditions: [] }]
implementation_refs:
  - path: android/app/src/main/java/uk/gleissner/c64commander/MockC64UServer.kt
    symbol_or_region: MockC64UServer
    role: native
  - path: android/app/src/main/java/uk/gleissner/c64commander/MockC64UState.kt
    symbol_or_region: MockC64UState
    role: native
  - path: android/app/src/main/java/uk/gleissner/c64commander/MockTimingProfile.kt
    symbol_or_region: MockTimingProfile
    role: native
  - path: android/app/src/main/java/uk/gleissner/c64commander/MockC64UPlugin.kt
    symbol_or_region: MockC64UPlugin
    role: native
  - path: android/app/src/main/java/uk/gleissner/c64commander/MockFtpServer.kt
    symbol_or_region: MockFtpServer
    role: native
documentation_refs: []
screenshot_refs: []
dependencies:
  { hardware: [none], network: [rest, ftp], storage: [none], native: [android_plugin], external_services: [] }
platform_scope: { android: primary, ios: secondary, web: not_applicable }
state_model:
  {
    stateful: true,
    states: [stopped, starting, running, stopping, crashed],
    transitions:
      [
        "stopped -> starting",
        "starting -> running",
        "running -> stopping",
        "stopping -> stopped",
        "running -> crashed",
      ],
    failure_modes: [port_collision, fixture_load_failure, timing_profile_drift],
  }
test_coverage:
  unit: { status: present, evidence: [tests/unit/mockServer.test.ts, tests/unit/mockConfigYaml.test.ts], gaps: [] }
  integration:
    {
      status: present,
      evidence:
        [
          android/app/src/test/java/uk/gleissner/c64commander/MockC64UPluginTest.kt,
          android/app/src/test/java/uk/gleissner/c64commander/MockC64UServerTest.kt,
          android/app/src/test/java/uk/gleissner/c64commander/MockC64UServerHandlerTest.kt,
          android/app/src/test/java/uk/gleissner/c64commander/MockC64UStateTest.kt,
          android/app/src/test/java/uk/gleissner/c64commander/MockFtpServerTest.kt,
        ],
      gaps: [],
    }
  playwright: { status: present, evidence: [playwright/demoMode.spec.ts, playwright/demoConfig.spec.ts], gaps: [] }
  maestro: { status: absent, evidence: [], gaps: [] }
  hil_pixel4: { status: not_applicable, evidence: [], gaps: [] }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [correctness, observability, reliability]
observability: [rest_response, ftp_result, log]
notes: []
```

```yaml
feature_id: android_native__diagnostics_bridge
name: Android diagnostics bridge plugin
description: >
  Surfaces native log, snapshot, and diagnostics signals to the JS runtime
  and accepts push of diagnostics payloads from JS.
feature_type: native_bridge
parent_feature_id: app__global_diagnostics_overlay
entry_points:
  [{ kind: startup, path_or_selector: "DiagnosticsRuntimeBridge on first-meaningful-interaction", preconditions: [] }]
implementation_refs:
  - path: android/app/src/main/java/uk/gleissner/c64commander/DiagnosticsBridgePlugin.kt
    symbol_or_region: DiagnosticsBridgePlugin
    role: native
  - path: src/lib/native/diagnosticsBridge.ts
    symbol_or_region: diagnosticsBridge
    role: transport
  - path: src/lib/diagnostics/nativeDebugSnapshots.ts
    symbol_or_region: startNativeDebugSnapshotPublisher
    role: diagnostics
documentation_refs: []
screenshot_refs: []
dependencies: { hardware: [none], network: [none], storage: [none], native: [android_plugin], external_services: [] }
platform_scope: { android: primary, ios: limited, web: unsupported }
state_model:
  {
    stateful: true,
    states: [stopped, starting, running, stopping],
    transitions: ["stopped -> starting", "starting -> running", "running -> stopping", "stopping -> stopped"],
    failure_modes: [double_start, event_backpressure, bridge_disconnect_under_load],
  }
test_coverage:
  unit:
    {
      status: present,
      evidence: [tests/unit/native/diagnosticsBridge.test.ts, tests/unit/lib/diagnostics/nativeDebugSnapshots.test.ts],
      gaps: [],
    }
  integration:
    {
      status: present,
      evidence: [android/app/src/test/java/uk/gleissner/c64commander/DiagnosticsBridgePluginTest.kt],
      gaps: [],
    }
  playwright: { status: absent, evidence: [], gaps: [] }
  maestro: { status: absent, evidence: [], gaps: [] }
  hil_pixel4: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [observability, reliability, performance]
observability: [log, trace, diagnostics_overlay]
notes: []
```

```yaml
feature_id: android_native__feature_flags
name: Android feature-flag plugin
description: >
  Surfaces native-owned feature flags to JS (for OS-gated paths) and accepts
  overrides from settings.
feature_type: native_bridge
parent_feature_id: null
entry_points: [{ kind: startup, path_or_selector: "FeatureFlagsProvider mount", preconditions: [] }]
implementation_refs:
  - path: android/app/src/main/java/uk/gleissner/c64commander/FeatureFlagsPlugin.kt
    symbol_or_region: FeatureFlagsPlugin
    role: native
  - path: src/lib/native/featureFlags.ts
    symbol_or_region: featureFlags
    role: transport
  - path: src/lib/native/featureFlags.web.ts
    symbol_or_region: featureFlags (web fallback)
    role: transport
documentation_refs: []
screenshot_refs: []
dependencies:
  { hardware: [none], network: [none], storage: [local_storage], native: [android_plugin], external_services: [] }
platform_scope: { android: primary, ios: secondary, web: supported }
state_model: { stateful: false, states: [], transitions: [], failure_modes: [flag_default_drift, override_not_applied] }
test_coverage:
  unit:
    {
      status: present,
      evidence: [tests/unit/featureFlags.test.ts, tests/unit/lib/native/featureFlagsWeb.test.ts],
      gaps: [],
    }
  integration:
    {
      status: present,
      evidence: [android/app/src/test/java/uk/gleissner/c64commander/FeatureFlagsPluginTest.kt],
      gaps: [],
    }
  playwright: { status: present, evidence: [playwright/featureFlags.spec.ts], gaps: [] }
  maestro: { status: absent, evidence: [], gaps: [] }
  hil_pixel4: { status: not_applicable, evidence: [], gaps: [] }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [correctness, observability]
observability: [log, storage_state]
notes: []
```

```yaml
feature_id: android_native__safe_area
name: Android safe-area plugin
description: >
  Reports edge-to-edge safe-area insets to the JS runtime for layout.
feature_type: native_bridge
parent_feature_id: null
entry_points: [{ kind: startup, path_or_selector: "SafeAreaPlugin.getInsets", preconditions: [] }]
implementation_refs:
  - path: android/app/src/main/java/uk/gleissner/c64commander/SafeAreaPlugin.kt
    symbol_or_region: SafeAreaPlugin
    role: native
documentation_refs: []
screenshot_refs: []
dependencies: { hardware: [none], network: [none], storage: [none], native: [android_plugin], external_services: [] }
platform_scope: { android: primary, ios: not_applicable, web: not_applicable }
state_model: { stateful: false, states: [], transitions: [], failure_modes: [inset_not_updated_on_rotation] }
test_coverage:
  unit: { status: absent, evidence: [], gaps: [] }
  integration:
    { status: present, evidence: [android/app/src/test/java/uk/gleissner/c64commander/SafeAreaPluginTest.kt], gaps: [] }
  playwright: { status: absent, evidence: [], gaps: [] }
  maestro: { status: absent, evidence: [], gaps: [] }
  hil_pixel4: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: ["Rotation evidence missing"] }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [cross_platform, correctness]
observability: [ui, log]
notes: []
```

### 3.11 iOS native scope

```yaml
feature_id: ios_native__plugin_registry
name: iOS NativePlugins registration
description: >
  Registers all Capacitor plugins (HVSC, Telnet, IOSFtp, MockC64U) from the
  AppDelegate boot.
feature_type: native_bridge
parent_feature_id: null
entry_points: [{ kind: startup, path_or_selector: "AppDelegate launch", preconditions: [] }]
implementation_refs:
  - path: ios/App/App/NativePlugins.swift
    symbol_or_region: NativePlugins
    role: native
  - path: ios/App/App/AppDelegate.swift
    symbol_or_region: AppDelegate
    role: native
documentation_refs: []
screenshot_refs: []
dependencies: { hardware: [none], network: [none], storage: [none], native: [ios_plugin], external_services: [] }
platform_scope: { android: not_applicable, ios: primary, web: not_applicable }
state_model:
  { stateful: false, states: [], transitions: [], failure_modes: [missing_plugin_registration, double_registration] }
test_coverage:
  unit: { status: absent, evidence: [], gaps: ["No iOS-side unit test target in repo"] }
  integration: { status: absent, evidence: [], gaps: ["No iOS integration test proves all expected plugins register"] }
  playwright: { status: not_applicable, evidence: [], gaps: [] }
  maestro: { status: present, evidence: [.maestro/ios-ci-smoke.yaml, .maestro/ios-smoke-launch.yaml], gaps: [] }
  hil_pixel4: { status: not_applicable, evidence: [], gaps: [] }
  hil_u64:
    {
      status: weak,
      evidence: [docs/testing/physical-device-matrix.md],
      gaps: ["iOS HIL gated on macOS CI; no per-plugin artifact"],
    }
  hil_c64u: { status: weak, evidence: [docs/testing/physical-device-matrix.md], gaps: [] }
risk_tags: [reliability, cross_platform]
observability: [log]
notes:
  - "iOS native test parity with Android is missing; this is a production-hardening gap in its own right."
```

```yaml
feature_id: ios_native__hvsc_ingestion
name: iOS HVSC ingestion plugin
description: >
  iOS-side HVSC extraction and ingestion bridge paralleling the Android
  plugin; falls back to JS pipeline when unavailable.
feature_type: native_bridge
parent_feature_id: play__hvsc_lifecycle
entry_points: [{ kind: api, path_or_selector: "HvscIngestionPlugin.ingest/cancel", preconditions: [] }]
implementation_refs:
  - path: ios/App/App/HvscIngestionPlugin.swift
    symbol_or_region: HvscIngestionPlugin
    role: native
documentation_refs: []
screenshot_refs: []
dependencies:
  {
    hardware: [none],
    network: [internet],
    storage: [native_fs],
    native: [ios_plugin],
    external_services: [hvsc_mirror],
  }
platform_scope: { android: not_applicable, ios: primary, web: not_applicable }
state_model:
  {
    stateful: true,
    states: [idle, downloading, extracting, indexing, ready, cancelled, failed],
    transitions:
      [
        "idle -> downloading",
        "downloading -> extracting",
        "extracting -> indexing",
        "indexing -> ready",
        "downloading -> cancelled",
        "extracting -> failed",
      ],
    failure_modes: [low_memory_abort, archive_download_failure, extraction_failure],
  }
test_coverage:
  unit: { status: absent, evidence: [], gaps: [] }
  integration: { status: absent, evidence: [], gaps: ["No Swift-side HVSC integration test"] }
  playwright: { status: not_applicable, evidence: [], gaps: [] }
  maestro: { status: present, evidence: [.maestro/ios-hvsc-browse.yaml], gaps: [] }
  hil_pixel4: { status: not_applicable, evidence: [], gaps: [] }
  hil_u64: { status: absent, evidence: [], gaps: ["iOS HVSC → u64 playback evidence absent"] }
  hil_c64u: { status: absent, evidence: [], gaps: [] }
risk_tags: [correctness, performance, reliability, cross_platform, device_interaction]
observability: [ui, log, filesystem_state, audio_signal]
notes: []
```

### 3.12 Web runtime scope

```yaml
feature_id: web_runtime__auth_state
name: Web server auth state (cookie-based)
description: >
  Manages authentication state, sign-in, sign-out, and session cookies for
  the headless web runtime.
feature_type: service
parent_feature_id: null
entry_points:
  - kind: api
    path_or_selector: "POST /auth/signin, POST /auth/signout"
    preconditions: ["Web server started"]
implementation_refs:
  - path: web/server/src/authState.ts
    symbol_or_region: authState
    role: state
  - path: web/server/src/index.ts
    symbol_or_region: auth routes
    role: entry
documentation_refs:
  - README.md
screenshot_refs: []
dependencies:
  { hardware: [none], network: [rest, internet], storage: [local_storage], native: [none], external_services: [] }
platform_scope: { android: not_applicable, ios: not_applicable, web: primary }
state_model:
  {
    stateful: true,
    states: [anonymous, authenticated, expired],
    transitions:
      ["anonymous -> authenticated", "authenticated -> expired", "expired -> anonymous", "authenticated -> anonymous"],
    failure_modes: [cookie_not_secure_in_prod, session_fixation, csrf_missing],
  }
test_coverage:
  unit: { status: weak, evidence: [], gaps: ["Direct unit coverage of authState state machine is minimal"] }
  integration: { status: weak, evidence: [], gaps: [] }
  playwright: { status: present, evidence: [playwright/webPlatformAuth.spec.ts], gaps: [] }
  maestro: { status: not_applicable, evidence: [], gaps: [] }
  hil_pixel4: { status: not_applicable, evidence: [], gaps: [] }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [security, reliability, correctness]
observability: [log, rest_response, storage_state]
notes:
  - "README documents WEB_COOKIE_SECURE and WEB_ALLOW_REMOTE_FTP_HOSTS; add a CI audit that these envs are enforced in prod builds."
```

```yaml
feature_id: web_runtime__host_validation
name: Web server host validation
description: >
  Validates requested target hosts against the allowlist (trusted LAN,
  optional remote FTP hosts) before proxying or acting.
feature_type: service
parent_feature_id: null
entry_points: [{ kind: api, path_or_selector: "Every proxied request", preconditions: [] }]
implementation_refs:
  - path: web/server/src/hostValidation.ts
    symbol_or_region: hostValidation
    role: transport
  - path: src/lib/network/trustedLanHost.ts
    symbol_or_region: trustedLanHost
    role: state
documentation_refs:
  - README.md
screenshot_refs: []
dependencies:
  { hardware: [none], network: [internet, rest, ftp], storage: [none], native: [none], external_services: [] }
platform_scope: { android: not_applicable, ios: not_applicable, web: primary }
state_model:
  {
    stateful: false,
    states: [],
    transitions: [],
    failure_modes: [allowlist_bypass, dns_rebinding, subdomain_confusion],
  }
test_coverage:
  unit: { status: present, evidence: [tests/unit/lib/network/trustedLanHost.test.ts], gaps: [] }
  integration: { status: weak, evidence: [], gaps: ["No integration test that fuzz-tests remote FTP host allowlist"] }
  playwright: { status: present, evidence: [playwright/webPlatformAuth.spec.ts], gaps: [] }
  maestro: { status: not_applicable, evidence: [], gaps: [] }
  hil_pixel4: { status: not_applicable, evidence: [], gaps: [] }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [security, correctness]
observability: [log, rest_response]
notes: []
```

```yaml
feature_id: web_runtime__security_headers
name: Web server security headers
description: >
  Sets CSP, HSTS, X-Frame-Options, referrer-policy, and related headers on
  every response from the web runtime.
feature_type: service
parent_feature_id: null
entry_points: [{ kind: api, path_or_selector: "Every response", preconditions: [] }]
implementation_refs:
  - path: web/server/src/securityHeaders.ts
    symbol_or_region: securityHeaders
    role: transport
documentation_refs:
  - README.md
screenshot_refs: []
dependencies: { hardware: [none], network: [rest], storage: [none], native: [none], external_services: [] }
platform_scope: { android: not_applicable, ios: not_applicable, web: primary }
state_model:
  {
    stateful: false,
    states: [],
    transitions: [],
    failure_modes: [header_missing, csp_too_permissive, hsts_not_set_in_prod],
  }
test_coverage:
  unit: { status: weak, evidence: [], gaps: ["No test that asserts every required header is present"] }
  integration: { status: weak, evidence: [], gaps: [] }
  playwright: { status: weak, evidence: [playwright/webPlatformAuth.spec.ts], gaps: [] }
  maestro: { status: not_applicable, evidence: [], gaps: [] }
  hil_pixel4: { status: not_applicable, evidence: [], gaps: [] }
  hil_u64: { status: not_applicable, evidence: [], gaps: [] }
  hil_c64u: { status: not_applicable, evidence: [], gaps: [] }
risk_tags: [security]
observability: [rest_response]
notes:
  - "Recommend adding a `securityHeaders.snapshot.test.ts` that asserts the exact header set for prod + dev profiles."
```

## Section 4 — Feature-to-Test Matrix

This matrix condenses the catalog to one row per feature and uses the exact review contract columns. Status values remain constrained to `present`, `weak`, `absent`, and `not_applicable`.

| feature_id                             | unit    | integration | playwright     | maestro        | hil_pixel4     | hil_u64        | hil_c64u       | key_evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | key_gaps                                                                                                                                                 |
| -------------------------------------- | ------- | ----------- | -------------- | -------------- | -------------- | -------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| app\_\_tab_navigation                  | present | present     | present        | present        | not_applicable | not_applicable | not_applicable | [tests/unit/components/TabBar.test.tsx](tests/unit/components/TabBar.test.tsx); [tests/unit/components/SwipeNavigationLayer.test.tsx](tests/unit/components/SwipeNavigationLayer.test.tsx); [tests/unit/App.runtime.test.tsx](tests/unit/App.runtime.test.tsx); [playwright/swipe-navigation.spec.ts](playwright/swipe-navigation.spec.ts)                                                                                                                                                                                                                                                                                  | Router-level swipe commits are now covered in the app runtime; no additional hardware evidence is required for this shell-only navigation surface.      |
| app\_\_connection_controller           | present | weak        | present        | weak           | absent         | absent         | weak           | [tests/unit/components/ConnectionController.test.tsx](tests/unit/components/ConnectionController.test.tsx); [tests/unit/connection/connectionManager.test.ts](tests/unit/connection/connectionManager.test.ts); [playwright/settingsConnection.spec.ts](playwright/settingsConnection.spec.ts); [tests/android-emulator/specs/connection.spec.mjs](tests/android-emulator/specs/connection.spec.mjs)                                                                                                                                                                                                                           | Resume-triggered re-probe is now unit-covered, but there is still no direct Pixel 4 or `u64` artifact and Maestro does not cover long-suspend reconnect. |
| app\_\_global_diagnostics_overlay      | present | present     | present        | weak           | absent         | absent         | weak           | [tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.test.tsx](tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.test.tsx); [tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.routeClose.test.tsx](tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.routeClose.test.tsx); [tests/unit/diagnostics/diagnosticsOverlayRoutes.test.ts](tests/unit/diagnostics/diagnosticsOverlayRoutes.test.ts); [playwright/diagnosticsActions.spec.ts](playwright/diagnosticsActions.spec.ts); [.maestro/ios-diagnostics-export.yaml](.maestro/ios-diagnostics-export.yaml)                                 | Deep-link route mapping and close-back-to-settings behavior are now covered across every diagnostics path; remaining evidence limits are hardware-only.  |
| app\_\_error_boundary                  | present | present     | weak           | absent         | not_applicable | not_applicable | not_applicable | [tests/unit/PageErrorBoundary.test.tsx](tests/unit/PageErrorBoundary.test.tsx); [tests/unit/App.runtime.test.tsx](tests/unit/App.runtime.test.tsx)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Runtime recovery after a thrown page render is now covered through route change; remaining evidence limits are only the absence of a dedicated Playwright fault-injection flow. |
| home\_\_machine_controls               | present | weak        | present        | absent         | absent         | absent         | weak           | [tests/unit/lib/deviceControl/deviceControl.test.ts](tests/unit/lib/deviceControl/deviceControl.test.ts); [tests/unit/pages/home/components/MachineControls.test.tsx](tests/unit/pages/home/components/MachineControls.test.tsx); [playwright/homeInteractivity.spec.ts](playwright/homeInteractivity.spec.ts)                                                                                                                                                                                                                                                                                                                 | No dedicated Maestro flow for destructive machine controls; no Pixel 4 or `u64` artifact.                                                                |
| home\_\_app_configs                    | present | weak        | present        | absent         | absent         | absent         | weak           | [tests/unit/config/appConfigStore.test.ts](tests/unit/config/appConfigStore.test.ts); [tests/unit/pages/home/dialogs/ManageConfigDialog.test.tsx](tests/unit/pages/home/dialogs/ManageConfigDialog.test.tsx); [playwright/homeConfigManagement.spec.ts](playwright/homeConfigManagement.spec.ts)                                                                                                                                                                                                                                                                                                                               | HIL evidence is only indirect through the broader `c64u` settings/home surface run.                                                                      |
| home\_\_ram_operations                 | present | weak        | present        | present        | absent         | absent         | weak           | [tests/unit/machine/ramOperations.test.ts](tests/unit/machine/ramOperations.test.ts); [tests/unit/lib/reu/reuWorkflow.test.ts](tests/unit/lib/reu/reuWorkflow.test.ts); [playwright/ramSnapshot.spec.ts](playwright/ramSnapshot.spec.ts); [.maestro/edge-ram-restore-chunked.yaml](.maestro/edge-ram-restore-chunked.yaml)                                                                                                                                                                                                                                                                                                     | No Pixel 4 round-trip artifact and no `u64` artifact for save/load/REU flows.                                                                            |
| play\_\_source_browsing                | present | weak        | present        | present        | absent         | absent         | weak           | [tests/unit/sourceNavigation/useSourceNavigator.test.ts](tests/unit/sourceNavigation/useSourceNavigator.test.ts); [tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx](tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx); [playwright/itemSelection.spec.ts](playwright/itemSelection.spec.ts); [.maestro/smoke-file-picker.yaml](.maestro/smoke-file-picker.yaml)                                                                                                                                                                                                                               | `u64` proof is absent and Local/C64U/HVSC browse is only hardware-proven against `c64u`.                                                                 |
| play\_\_hvsc_lifecycle                 | present | present     | present        | present        | absent         | absent         | present        | [tests/unit/hvsc/hvscIngestionPipelineStateMachine.test.ts](tests/unit/hvsc/hvscIngestionPipelineStateMachine.test.ts); [android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt](android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt); [playwright/hvsc.spec.ts](playwright/hvsc.spec.ts); [.maestro/edge-hvsc-ingest-lifecycle.yaml](.maestro/edge-hvsc-ingest-lifecycle.yaml); [docs/testing/agentic-tests/full-app-coverage/runs/fac-20260308T113632Z-executor-manifest.md](docs/testing/agentic-tests/full-app-coverage/runs/fac-20260308T113632Z-executor-manifest.md) | Full-app coverage proves physical Android plus `c64u`, but not Pixel 4 and not `u64`.                                                                    |
| play\_\_playback_transport             | present | weak        | present        | present        | absent         | absent         | present        | [tests/unit/playFiles/usePlaybackController.test.tsx](tests/unit/playFiles/usePlaybackController.test.tsx); [tests/unit/playFiles/usePlaybackController.autoAdvance.test.tsx](tests/unit/playFiles/usePlaybackController.autoAdvance.test.tsx); [playwright/playback.spec.ts](playwright/playback.spec.ts); [.maestro/smoke-playback.yaml](.maestro/smoke-playback.yaml); [docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md](docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md)                                                                                                       | No Pixel 4 or `u64` artifact; integration does not fully cover router plus native bridge races.                                                          |
| play\_\_lock_screen_playback           | present | present     | not_applicable | present        | absent         | absent         | present        | [tests/unit/playFiles/usePlaybackResumeTriggers.test.tsx](tests/unit/playFiles/usePlaybackResumeTriggers.test.tsx); [android/app/src/test/java/uk/gleissner/c64commander/BackgroundExecutionPluginTest.kt](android/app/src/test/java/uk/gleissner/c64commander/BackgroundExecutionPluginTest.kt); [.maestro/edge-auto-advance-lock.yaml](.maestro/edge-auto-advance-lock.yaml); [docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md](docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md)                                                                                                 | No web path by design; no Pixel 4 or `u64` artifact proving long-duration lock-screen behavior.                                                          |
| disks\_\_library                       | present | weak        | present        | present        | absent         | absent         | present        | [tests/unit/hooks/useDiskLibrary.test.ts](tests/unit/hooks/useDiskLibrary.test.ts); [tests/unit/disks/diskGrouping.test.ts](tests/unit/disks/diskGrouping.test.ts); [playwright/diskManagement.spec.ts](playwright/diskManagement.spec.ts); [docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md](docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md)                                                                                                                                                                                                                                     | No Pixel 4 or `u64` proof; integration does not cover large-library persistence plus rename/delete races.                                                |
| disks\_\_mount                         | present | present     | present        | weak           | absent         | absent         | present        | [tests/unit/diskMount.test.ts](tests/unit/diskMount.test.ts); [tests/unit/components/disks/HomeDiskManager.ui.test.tsx](tests/unit/components/disks/HomeDiskManager.ui.test.tsx); [playwright/diskManagement.spec.ts](playwright/diskManagement.spec.ts); [docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md](docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md)                                                                                                                                                                                                                       | Mount/reset convergence and stale completion races are now covered in the repo; remaining evidence limits are Pixel 4 and `u64` hardware artifacts.      |
| config\_\_browse                       | present | weak        | present        | absent         | absent         | absent         | weak           | [tests/unit/pages/ConfigBrowserPage.test.tsx](tests/unit/pages/ConfigBrowserPage.test.tsx); [playwright/configVisibility.spec.ts](playwright/configVisibility.spec.ts); [docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md](docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md)                                                                                                                                                                                                                                                                                                         | No Maestro route coverage and no direct hardware artifact for browse/search on Pixel 4 or `u64`.                                                         |
| config\_\_edit                         | present | weak        | present        | weak           | absent         | absent         | present        | [tests/unit/configWriteThrottle.test.ts](tests/unit/configWriteThrottle.test.ts); [tests/unit/hooks/useInteractiveConfigWrite.test.ts](tests/unit/hooks/useInteractiveConfigWrite.test.ts); [tests/unit/audioMixerSolo.test.ts](tests/unit/audioMixerSolo.test.ts); [playwright/configEditingBehavior.spec.ts](playwright/configEditingBehavior.spec.ts); [docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md](docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md)                                                                                                                       | The last-intent write lane now proves that the final queued value survives unmount/navigation; remaining evidence limits are hardware-only.              |
| settings\_\_connection                 | present | weak        | present        | absent         | absent         | absent         | present        | [tests/unit/pages/SettingsPage.test.tsx](tests/unit/pages/SettingsPage.test.tsx); [tests/unit/secureStorage.test.ts](tests/unit/secureStorage.test.ts); [playwright/settingsConnection.spec.ts](playwright/settingsConnection.spec.ts); [docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md](docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md)                                                                                                                                                                                                                                         | No Maestro coverage and no Pixel 4 or `u64` proof for reconnect and password persistence.                                                                |
| settings\_\_safety_presets             | present | present     | weak           | absent         | absent         | absent         | weak           | [tests/unit/config/deviceSafetySettings.test.ts](tests/unit/config/deviceSafetySettings.test.ts); [tests/unit/lib/deviceInteraction/deviceSafetyPresetEffects.test.ts](tests/unit/lib/deviceInteraction/deviceSafetyPresetEffects.test.ts); [tests/unit/pages/SettingsPage.test.tsx](tests/unit/pages/SettingsPage.test.tsx); [playwright/settingsDiagnostics.spec.ts](playwright/settingsDiagnostics.spec.ts); [docs/testing/agentic-tests/full-app-coverage/prompts/F021-settings-diagnostics-safety.md](docs/testing/agentic-tests/full-app-coverage/prompts/F021-settings-diagnostics-safety.md)                           | Settings-driven preset changes now feed the runtime scheduler in repo coverage; remaining evidence limits are hardware-only.                             |
| settings\_\_demo_mode                  | present | present     | present        | absent         | not_applicable | not_applicable | not_applicable | [tests/unit/components/DemoModeInterstitial.test.tsx](tests/unit/components/DemoModeInterstitial.test.tsx); [tests/unit/appLifecycle.test.ts](tests/unit/appLifecycle.test.ts); [playwright/demoMode.spec.ts](playwright/demoMode.spec.ts)                                                                                                                                                                                                                                                                                                                                                                                     | No device-level Maestro flow, but hardware HIL is not applicable because demo mode is explicitly offline.                                                |
| docs\_\_view                           | present | absent      | weak           | absent         | not_applicable | not_applicable | not_applicable | [tests/unit/pages/DocsPage.test.tsx](tests/unit/pages/DocsPage.test.tsx); [playwright/ui.spec.ts](playwright/ui.spec.ts); [docs/img/app/docs/01-overview.png](docs/img/app/docs/01-overview.png)                                                                                                                                                                                                                                                                                                                                                                                                                              | Direct unit coverage now exercises docs section expansion and upstream resource links; no device or hardware evidence applies to this read-only page.    |
| licenses\_\_open_source_view           | present | weak        | weak           | absent         | not_applicable | not_applicable | not_applicable | [tests/unit/pages/OpenSourceLicensesPage.test.tsx](tests/unit/pages/OpenSourceLicensesPage.test.tsx); [src/pages/OpenSourceLicensesPage.tsx](src/pages/OpenSourceLicensesPage.tsx); [playwright/ui.spec.ts](playwright/ui.spec.ts)                                                                                                                                                                                                                                                                                                                                                                                         | Notice rendering, error handling, and close-back-to-Settings are now covered in repo tests; no hardware evidence applies to this bundled-doc surface.   |
| diagnostics\_\_saved_device_switching  | present | weak        | present        | absent         | absent         | absent         | weak           | [tests/unit/components/diagnostics/DiagnosticsDialog.savedDeviceSwitch.test.tsx](tests/unit/components/diagnostics/DiagnosticsDialog.savedDeviceSwitch.test.tsx); [playwright/diagnosticsActions.spec.ts](playwright/diagnosticsActions.spec.ts)                                                                                                                                                                                                                                                                                                                                                                               | No Maestro flow and no direct hardware artifact proving stale-health or one-unhealthy switching cases.                                                   |
| diagnostics\_\_share_zip               | present | weak        | weak           | present        | absent         | not_applicable | not_applicable | [tests/unit/diagnostics/exportRedaction.test.ts](tests/unit/diagnostics/exportRedaction.test.ts); [tests/unit/lib/diagnostics/diagnosticsExport.test.ts](tests/unit/lib/diagnostics/diagnosticsExport.test.ts); [.maestro/ios-diagnostics-export.yaml](.maestro/ios-diagnostics-export.yaml)                                                                                                                                                                                                                                                                                                                                   | Archive entry inspection now exists in unit coverage, but there is still no hardware proof beyond the native share-sheet path.                           |
| coverage_probe\_\_test_heartbeat       | present | present     | present        | not_applicable | not_applicable | not_applicable | not_applicable | [tests/unit/components/TestHeartbeat.test.tsx](tests/unit/components/TestHeartbeat.test.tsx); [tests/unit/App.runtime.test.tsx](tests/unit/App.runtime.test.tsx); [playwright/coverageProbes.spec.ts](playwright/coverageProbes.spec.ts); [src/App.tsx](src/App.tsx)                                                                                                                                                                                                                                                                                                                                                      | Probe modules now gate on build-time availability so production bundles can tree-shake them out; remaining validation is the normal build artifact check. |
| not_found\_\_route                     | weak    | absent      | present        | absent         | not_applicable | not_applicable | not_applicable | [tests/unit/App.runtime.test.tsx](tests/unit/App.runtime.test.tsx); [playwright/navigationBoundaries.spec.ts](playwright/navigationBoundaries.spec.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | No dedicated unit test isolates the unknown-path branch.                                                                                                 |
| android_native\_\_background_execution | present | present     | not_applicable | present        | absent         | not_applicable | weak           | [android/app/src/test/java/uk/gleissner/c64commander/BackgroundExecutionServiceTest.kt](android/app/src/test/java/uk/gleissner/c64commander/BackgroundExecutionServiceTest.kt); [android/app/src/test/java/uk/gleissner/c64commander/BackgroundExecutionPluginTest.kt](android/app/src/test/java/uk/gleissner/c64commander/BackgroundExecutionPluginTest.kt); [.maestro/smoke-background-execution.yaml](.maestro/smoke-background-execution.yaml)                                                                                                                                                                             | No Pixel 4 artifact and no battery-optimizer stress proof.                                                                                               |
| android_native\_\_secure_storage       | present | present     | absent         | present        | absent         | not_applicable | weak           | [tests/unit/secureStorage.test.ts](tests/unit/secureStorage.test.ts); [android/app/src/test/java/uk/gleissner/c64commander/SecureStoragePluginTest.kt](android/app/src/test/java/uk/gleissner/c64commander/SecureStoragePluginTest.kt); [.maestro/ios-secure-storage-persist.yaml](.maestro/ios-secure-storage-persist.yaml)                                                                                                                                                                                                                                                                                                   | No Android physical-device proof for post-reboot secret survival.                                                                                        |
| android_native\_\_folder_picker        | present | present     | not_applicable | present        | absent         | not_applicable | weak           | [tests/unit/native/folderPicker.test.ts](tests/unit/native/folderPicker.test.ts); [android/app/src/test/java/uk/gleissner/c64commander/FolderPickerPluginTest.kt](android/app/src/test/java/uk/gleissner/c64commander/FolderPickerPluginTest.kt); [.maestro/smoke-file-picker.yaml](.maestro/smoke-file-picker.yaml)                                                                                                                                                                                                                                                                                                           | No Pixel 4 SAF persistence artifact; broader `c64u` evidence only covers app-first Android, not the preferred device.                                    |
| android_native\_\_telnet_socket        | weak    | present     | absent         | absent         | absent         | absent         | weak           | [tests/unit/telnet/telnetSocketWeb.test.ts](tests/unit/telnet/telnetSocketWeb.test.ts); [android/app/src/test/java/uk/gleissner/c64commander/TelnetSocketPluginTest.kt](android/app/src/test/java/uk/gleissner/c64commander/TelnetSocketPluginTest.kt)                                                                                                                                                                                                                                                                                                                                                                         | No Maestro or direct hardware stress proof.                                                                                                              |
| android_native\_\_ftp_client           | weak    | present     | present        | present        | absent         | absent         | weak           | [android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt](android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt); [playwright/webPlatformAuth.spec.ts](playwright/webPlatformAuth.spec.ts); [.maestro/real-c64u-ftp-browse.yaml](.maestro/real-c64u-ftp-browse.yaml)                                                                                                                                                                                                                                                                                                                   | No Pixel 4 or `u64` artifact and no direct JS-to-native bridge integration layer.                                                                        |
| android_native\_\_mock_c64u            | present | present     | present        | absent         | not_applicable | not_applicable | not_applicable | [tests/unit/mockC64Server.test.ts](tests/unit/mockC64Server.test.ts); [android/app/src/test/java/uk/gleissner/c64commander/MockC64UServerTest.kt](android/app/src/test/java/uk/gleissner/c64commander/MockC64UServerTest.kt); [playwright/connectionSimulation.spec.ts](playwright/connectionSimulation.spec.ts)                                                                                                                                                                                                                                                                                                               | No Maestro flow is needed for this support runtime, but there is no mobile orchestration smoke of the mock server.                                       |
| android_native\_\_diagnostics_bridge   | present | present     | absent         | absent         | absent         | not_applicable | weak           | [tests/unit/native/diagnosticsBridge.test.ts](tests/unit/native/diagnosticsBridge.test.ts); [android/app/src/test/java/uk/gleissner/c64commander/DiagnosticsBridgePluginTest.kt](android/app/src/test/java/uk/gleissner/c64commander/DiagnosticsBridgePluginTest.kt)                                                                                                                                                                                                                                                                                                                                                           | No end-to-end Playwright or Maestro exercise of the bridge output.                                                                                       |
| android_native\_\_feature_flags        | present | present     | present        | absent         | not_applicable | not_applicable | not_applicable | [tests/unit/featureFlags.test.ts](tests/unit/featureFlags.test.ts); [android/app/src/test/java/uk/gleissner/c64commander/FeatureFlagsPluginTest.kt](android/app/src/test/java/uk/gleissner/c64commander/FeatureFlagsPluginTest.kt); [playwright/featureFlags.spec.ts](playwright/featureFlags.spec.ts)                                                                                                                                                                                                                                                                                                                         | No dedicated mobile flow, but hardware HIL is not required for static flag exposure.                                                                     |
| android_native\_\_safe_area            | present | present     | absent         | absent         | absent         | not_applicable | not_applicable | [tests/unit/android/safeAreaPluginRegistration.test.ts](tests/unit/android/safeAreaPluginRegistration.test.ts); [android/app/src/test/java/uk/gleissner/c64commander/SafeAreaPluginTest.kt](android/app/src/test/java/uk/gleissner/c64commander/SafeAreaPluginTest.kt)                                                                                                                                                                                                                                                                                                                                                         | No device-flow proof for header/footer inset behavior on the preferred handset.                                                                          |
| ios_native\_\_plugin_registry          | present | absent      | not_applicable | weak           | not_applicable | not_applicable | not_applicable | [ios/App/App/NativePlugins.swift](ios/App/App/NativePlugins.swift); [ios/native-tests/Tests/NativeValidationTests/NativePluginsRegistrationTests.swift](ios/native-tests/Tests/NativeValidationTests/NativePluginsRegistrationTests.swift); [.maestro/ios-ci-smoke.yaml](.maestro/ios-ci-smoke.yaml)                                                                                                                                                                                                                                                                                                                           | SwiftPM now validates the registration list, but there is still no app-hosted XCTest target or device/simulator artifact.                                |
| ios_native\_\_hvsc_ingestion           | absent  | absent      | not_applicable | weak           | not_applicable | absent         | absent         | [ios/App/App/HvscIngestionPlugin.swift](ios/App/App/HvscIngestionPlugin.swift); [.maestro/ios-hvsc-browse.yaml](.maestro/ios-hvsc-browse.yaml)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | No iOS-native unit or integration proof and no hardware artifact for either `u64` or `c64u`.                                                             |
| web_runtime\_\_auth_state              | present | present     | present        | not_applicable | not_applicable | not_applicable | not_applicable | [tests/unit/web/authState.test.ts](tests/unit/web/authState.test.ts); [tests/unit/web/webServer.test.ts](tests/unit/web/webServer.test.ts); [playwright/webPlatformAuth.spec.ts](playwright/webPlatformAuth.spec.ts)                                                                                                                                                                                                                                                                                                                                                                                                        | Server-process integration now exercises auth status, secure cookies, and production headers together; remaining parity work is cross-platform host validation. |
| web_runtime\_\_host_validation         | present | weak        | present        | not_applicable | not_applicable | not_applicable | not_applicable | [tests/unit/web/hostValidation.test.ts](tests/unit/web/hostValidation.test.ts); [playwright/webPlatformAuth.spec.ts](playwright/webPlatformAuth.spec.ts); [ios/native-tests/Tests/NativeValidationTests/HostValidationTests.swift](ios/native-tests/Tests/NativeValidationTests/HostValidationTests.swift)                                                                                                                                                                                                                                                                                                                     | No end-to-end parity suite covering Android, iOS native validation, and server startup together.                                                         |
| web_runtime\_\_security_headers        | present | present     | weak           | not_applicable | not_applicable | not_applicable | not_applicable | [tests/unit/web/securityHeaders.test.ts](tests/unit/web/securityHeaders.test.ts); [tests/unit/web/securityHeaders.server.test.ts](tests/unit/web/securityHeaders.server.test.ts); [tests/unit/web/webServer.test.ts](tests/unit/web/webServer.test.ts); [web/server/src/securityHeaders.ts](web/server/src/securityHeaders.ts)                                                                                                                                                                                                                                                                                                 | The repo now covers the live server header matrix on shell, auth, and health routes; remaining evidence limits are deployed-edge only.                   |

Cross-cutting conclusions from the matrix:

1. `tests/android-emulator/**`, `tests/contract/**`, and `ios/native-tests/**` materially improve the integration story compared with the inherited review, but they still do not close the cross-platform runtime gap for every feature.
2. Direct hardware evidence is strongest for physical Android plus `c64u` through the full-app coverage executor and weakest for the contract's required `hil_pixel4` and `hil_u64` columns.
3. `settings__safety_presets` now has both preset-matrix and Settings-to-runtime integration coverage, so no repository-side safety-preset blocker remains.
4. Web runtime coverage is stronger than the inherited review credited; the remaining header limitation is deployed-edge validation rather than server-process logic.

## Section 5 — Risk Register

All repository-side review blockers from this continuation are now closed in the worktree. The remaining limits are external validation dependencies that require hardware, Apple tooling, or deployed-edge execution rather than more repository code changes.

| dependency_id | area                      | severity | platforms    | remaining_limit                                                                                    | why_external_now                                                             |
| ------------- | ------------------------- | -------- | ------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| X-01          | playback transport        | medium   | android, ios | Curated short-track auto-advance still needs `u64` hardware proof.                                 | Requires the preferred `u64` device path.                                    |
| X-02          | lock-screen playback      | medium   | android      | Long-duration battery-optimizer playback still needs Pixel 4 evidence.                             | Requires the preferred Android handset and OEM power-policy conditions.      |
| X-03          | RAM/SAF persistence       | medium   | android      | Folder-revocation and interrupted-write recovery still need physical-device confirmation.          | Requires SAF permission churn and real-device storage behavior.              |
| X-04          | iOS plugin registry       | medium   | ios          | App-hosted XCTest or simulator execution is still needed beyond SwiftPM source validation.         | Requires Apple toolchains or CI runners; this Kubuntu host cannot run Swift. |
| X-05          | iOS HVSC lifecycle parity | medium   | ios          | Native iOS ingest lifecycle parity still needs Apple-hosted execution.                             | Requires Apple toolchains or CI runners.                                     |
| X-06          | deployed-edge web headers | low      | web          | Reverse-proxy or deployed-edge header verification still sits outside the repository test harness. | Requires a deployed environment or canary-style probe.                       |

## Section 6 — External Validation Follow-ons

No open repository-side test backlog remains from this continuation. The remaining follow-ons are execution environments that must be satisfied outside this Kubuntu workspace.

| follow_on_id | area                      | target_platform | target_device   | suggested_suite_or_flow                                 | purpose                                                                 |
| ------------ | ------------------------- | --------------- | --------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| F-01         | playback transport        | android, ios    | `u64`           | `.maestro/hil-short-track-auto-advance.yaml`            | Prove very short-track auto-advance against the preferred hardware.     |
| F-02         | lock-screen playback      | android         | Pixel 4         | `.maestro/perf-background-battery-opt.yaml`             | Prove long-duration background playback under battery optimization.     |
| F-03         | RAM/SAF persistence       | android         | Pixel 4         | Physical-device RAM/SAF recovery flow                   | Prove revocation and interrupted-write recovery on the preferred phone. |
| F-04         | iOS plugin registry       | ios             | simulator or CI | `ios/App/AppTests/NativePluginsRegistrationTests.swift` | Prove app-hosted registration on Apple runners beyond SwiftPM parsing.  |
| F-05         | iOS HVSC lifecycle parity | ios             | simulator or CI | iOS native HVSC ingest lifecycle suite                  | Mirror the existing runtime recovery proof on Apple tooling.            |
| F-06         | deployed-edge web headers | web             | deployed env    | Edge canary or production header probe                  | Prove final reverse-proxy header behavior outside the local server.     |

## Section 7 — Completeness Report

| Check                                                                               | Expected                                                                  | Observed                                                                                                                                                   | Pass | Notes                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| mandatory route count accounted for                                                 | All routed paths from app shell and diagnostics overlay are listed        | 17 canonical routes (`/`, `/play`, `/disks`, `/config`, `/settings`, `/settings/open-source-licenses`, `/docs`, 8 diagnostics paths, `/__coverage__`, `*`) | yes  | Heatmap routes were corrected from the inherited false negative.                                                                       |
| mandatory global surfaces accounted for                                             | Every always-mounted or route-agnostic surface is listed                  | 14 global surfaces                                                                                                                                         | yes  | Includes AppBar, SwipeNavigationLayer, connection controller, diagnostics runtime bridge, and error listeners.                         |
| screenshot folders accounted for                                                    | Top-level app screenshot families are mapped                              | `home`, `play`, `disks`, `config`, `settings`, `docs`, `diagnostics`                                                                                       | yes  | Grouped by owning feature families and cross-checked against [playwright/screenshot-catalog.json](playwright/screenshot-catalog.json). |
| screenshot files accounted for or explicitly grouped                                | Every file is either referenced directly or grouped under a stable family | 171 PNG files grouped under 66 directories                                                                                                                 | yes  | High-volume profile variants are grouped where they duplicate the same feature family.                                                 |
| routed page files accounted for                                                     | All mandatory page files are either feature-owned or support-only         | 78 `src/pages/**` files accounted                                                                                                                          | yes  | Page-local hooks and dialogs were reconciled to owning workflow features.                                                              |
| global component files accounted for                                                | All mandatory `src/components/**` owners are accounted                    | 106 component files accounted; 21 diagnostics files explicitly mapped                                                                                      | yes  | `src/components/ui/**` is explicitly marked support-only.                                                                              |
| native Android files accounted for                                                  | All Android runtime and test owners are accounted                         | 19 main files, 22 JVM test files                                                                                                                           | yes  | Android runtime features and plugin tests are mapped separately from app features.                                                     |
| native iOS files accounted for                                                      | All iOS runtime and native validation files are accounted                 | 20 app files, 5 Swift test files                                                                                                                           | yes  | The inherited “iOS tests absent” claim was removed.                                                                                    |
| web runtime files accounted for                                                     | All web server files are accounted                                        | 6 `web/server/src/**` files                                                                                                                                | yes  | Each file rolls up under one of the three web runtime features.                                                                        |
| test files accounted for                                                            | All mandatory test roots are mapped or support-only classified            | 510 unit files, 13 Android emulator files, 67 contract files, 47 Playwright specs, 57 Maestro YAML, 22 Android JVM tests, 6 Swift tests                    | yes  | Helper-only files under test roots are treated as support infrastructure in Section 1 notes.                                           |
| no feature missing implementation refs                                              | Every feature record has at least one implementation reference            | 38 of 38 features satisfy schema                                                                                                                           | yes  | Preserved from the inherited feature catalog and re-audited during continuation.                                                       |
| no feature missing coverage statuses                                                | Every feature record carries all seven coverage families                  | 38 of 38 features list all seven families                                                                                                                  | yes  | Section 4 re-states each feature family explicitly.                                                                                    |
| no hardware-dependent feature falsely marked fully covered by non-hardware evidence | Pixel 4, `u64`, and `c64u` remain separate truth buckets                  | `hil_pixel4` and `hil_u64` remain absent or weak unless direct evidence exists; `hil_c64u` is only marked present where app-first artifacts exist          | yes  | Full-app coverage artifacts are physical Android plus `c64u`, not Pixel 4 and not `u64`.                                               |

## Section 8 — Execution Plan

| Phase | Goal                                          | Required Inputs                                                                                                                                                                                                                                                                                        | Output                                               | Completion Gate                                                                                  |
| ----- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| P0    | Audit the inherited continuation artifact     | [docs/research/review-15/review-15.md](docs/research/review-15/review-15.md), [docs/research/review-15/FEATURE_MODEL.md](docs/research/review-15/FEATURE_MODEL.md), review prompt contract                                                                                                             | Continuation ledger of keep/rewrite/delete decisions | Every inherited major section has a disposition and all explicit backlog language is identified. |
| P1    | Build the source ledger                       | Mandatory docs, code roots, test roots, screenshot corpus                                                                                                                                                                                                                                              | Section 1 coverage ledger                            | Every mandatory source group is named and none remain implicit.                                  |
| P2    | Verify routes and global surfaces from code   | [src/App.tsx](src/App.tsx), [src/lib/navigation/tabRoutes.ts](src/lib/navigation/tabRoutes.ts), [src/components/SwipeNavigationLayer.tsx](src/components/SwipeNavigationLayer.tsx), [src/components/diagnostics/GlobalDiagnosticsOverlay.tsx](src/components/diagnostics/GlobalDiagnosticsOverlay.tsx) | Section 2 route and surface inventory                | Every route and always-mounted surface is listed with current owning files.                      |
| P3    | Reconcile the feature catalog to current code | Existing Section 3 catalog, routed pages, global components, native runtime roots                                                                                                                                                                                                                      | Stable feature catalog at workflow grain             | No open feature backlog remains and every route/global surface has an owning feature.            |
| P4    | Re-map test coverage families                 | Unit, Android emulator, contract, Playwright, Maestro, Android JVM, iOS native tests, HIL artifacts                                                                                                                                                                                                    | Section 4 matrix                                     | Every feature has explicit statuses across all seven families with repository evidence.          |
| P5    | Synthesize risks and targeted tests           | Verified feature inventory plus coverage gaps                                                                                                                                                                                                                                                          | Sections 5 and 6                                     | Each risk and proposal ties back to a specific feature and evidence gap.                         |
| P6    | Run convergence checks and continuation audit | Revised sections 1-9 plus inherited review state                                                                                                                                                                                                                                                       | Sections 7 and 10                                    | All mandatory completeness checks pass and stale inherited claims are removed or corrected.      |

## Section 9 — Execution Worklog

| Worklog ID | What Inspected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | What Learned                                                                                                                                           | What Changed in the Feature or Coverage Model                                                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-01       | [docs/research/review-15/review-15.md](docs/research/review-15/review-15.md), [docs/research/review-15/FEATURE_MODEL.md](docs/research/review-15/FEATURE_MODEL.md), [README.md](README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                   | The inherited review was structurally complete but explicitly partial and carried a named feature backlog.                                             | Marked Sections 1, 2, 4, 5, 6, 7, 8, and 9 for rewrite; preserved stable `feature_id` values from Section 3.                                                                                                                        |
| W-02       | [AGENTS.md](AGENTS.md), [.github/copilot-instructions.md](.github/copilot-instructions.md), [docs/architecture.md](docs/architecture.md), [docs/features-by-page.md](docs/features-by-page.md)                                                                                                                                                                                                                                                                                                                                                                                                                                               | Validation scope for this task is `DOC_ONLY`, but the review still had to be re-grounded in current code and architecture.                             | Confirmed the review must be evidence-backed and not inherit stale route or coverage claims.                                                                                                                                        |
| W-03       | [src/App.tsx](src/App.tsx), [src/lib/navigation/tabRoutes.ts](src/lib/navigation/tabRoutes.ts), [src/components/diagnostics/GlobalDiagnosticsOverlay.tsx](src/components/diagnostics/GlobalDiagnosticsOverlay.tsx)                                                                                                                                                                                                                                                                                                                                                                                                                           | The three diagnostics heatmap routes are URL-addressable and the prior review's contrary claim was false.                                              | Rewrote Section 2 route inventory and corrected the diagnostics deep-link model.                                                                                                                                                    |
| W-04       | `src/pages/**`, `src/components/**`, `src/hooks/**`, `src/lib/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Page-local dialogs and helper components can be reconciled to owning workflow features without carrying an unresolved catalog backlog.                 | Removed the inherited Section 3.Z backlog and treated those surfaces as owned subworkflows or support-only infrastructure.                                                                                                          |
| W-05       | `tests/unit/**`, `tests/android-emulator/**`, `tests/contract/**`, `playwright/**/*.spec.ts`, `.maestro/**/*.yaml`, `android/app/src/test/java/**`, `ios/native-tests/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | The test corpus is materially broader than the inherited review credited, especially iOS native validation, Android emulator, and contract suites.     | Rebuilt Section 4 with explicit evidence and closed the stale “iOS tests absent” claim.                                                                                                                                             |
| W-06       | [docs/testing/physical-device-matrix.md](docs/testing/physical-device-matrix.md), [docs/testing/agentic-tests/full-app-coverage/README.md](docs/testing/agentic-tests/full-app-coverage/README.md), [docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md](docs/testing/agentic-tests/full-app-coverage/feature-status-matrix.md), [docs/testing/agentic-tests/full-app-coverage/runs/fac-20260308T113632Z-executor-manifest.md](docs/testing/agentic-tests/full-app-coverage/runs/fac-20260308T113632Z-executor-manifest.md)                                                                                               | Physical Android plus `c64u` evidence exists, but it does not satisfy the distinct `hil_pixel4` and `hil_u64` buckets.                                 | Tightened HIL truthfulness: `hil_c64u` may be `present` where the manifest proves it; `hil_pixel4` and `hil_u64` stay absent or weak without direct artifacts.                                                                      |
| W-07       | [playwright/screenshot-catalog.json](playwright/screenshot-catalog.json), `docs/img/app/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Screenshot coverage is broad enough to support route and feature-family reconciliation, but catalog grouping is coarser than the underlying file tree. | Rebuilt the screenshot completeness checks around grouped top-level families plus explicit file counts.                                                                                                                             |
| W-08       | Existing Sections 5-9 against the prompt contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Risk severity scale, backlog format, completeness table, and execution plan shape were all incompatible with the required output contract.             | Replaced Sections 5-9 with contract-compliant tables and phase-based review execution history.                                                                                                                                      |
| W-09       | [src/components/disks/HomeDiskManager.tsx](src/components/disks/HomeDiskManager.tsx), [tests/unit/components/disks/HomeDiskManager.ui.test.tsx](tests/unit/components/disks/HomeDiskManager.ui.test.tsx), [tests/unit/pages/SettingsPage.test.tsx](tests/unit/pages/SettingsPage.test.tsx), [tests/unit/hooks/useInteractiveConfigWrite.test.ts](tests/unit/hooks/useInteractiveConfigWrite.test.ts), [tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.routeClose.test.tsx](tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.routeClose.test.tsx), [tests/unit/web/webServer.test.ts](tests/unit/web/webServer.test.ts) | The remaining repo-side review gaps were concentrated in race handling and end-to-end test ownership, not in missing subsystems.                       | Closed the remaining repository-side review blockers: disk mount/reset convergence, settings-to-runtime safety propagation, last-intent unmount persistence, diagnostics route round-tripping, and live web-server header coverage. |
| W-10       | [src/App.tsx](src/App.tsx), [tests/unit/App.runtime.test.tsx](tests/unit/App.runtime.test.tsx), [tests/unit/pages/DocsPage.test.tsx](tests/unit/pages/DocsPage.test.tsx), [tests/unit/pages/OpenSourceLicensesPage.test.tsx](tests/unit/pages/OpenSourceLicensesPage.test.tsx), [tests/unit/web/webServer.test.ts](tests/unit/web/webServer.test.ts)                                                                                                                                                                                                                                                                                                                                                       | The remaining repo-feasible gaps were smaller than the hardware list implied: route recovery, read-only docs ownership tests, auth-state server integration, and build-time probe gating. | Closed the last repository-owned review gaps by adding app-router swipe/recovery assertions, docs/licenses page tests, auth-status server integration coverage, and build-gated test-probe loading for production bundles. |

## Section 10 — Continuation Audit

| Section                                 | Inherited State                                 | Disposition | Evidence Rechecked                                                                                                                                                                                                 | Changes Made                                                                                                                                                      |
| --------------------------------------- | ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header and preface                      | provisional                                     | rewrite     | current worktree branch, current review prompt, feature model                                                                                                                                                      | Preserved scope framing but removed the implied first-pass posture and re-grounded the document in the current audit.                                             |
| Section 1 — Coverage ledger             | stale and incomplete                            | rewrite     | file inventories from `src/**`, `android/**`, `ios/**`, `web/server/**`, test roots, screenshot corpus                                                                                                             | Replaced the split code/test/doc tables with the required single ledger and added missing roots (`tests/android-emulator`, `tests/contract`, `ios/native-tests`). |
| Section 2 — Route and surface inventory | contradictory                                   | rewrite     | [src/App.tsx](src/App.tsx), [src/lib/navigation/tabRoutes.ts](src/lib/navigation/tabRoutes.ts), [src/components/diagnostics/GlobalDiagnosticsOverlay.tsx](src/components/diagnostics/GlobalDiagnosticsOverlay.tsx) | Added IDs, feature counts, and corrected the false claim that diagnostics heatmap routes were not URL-addressable.                                                |
| Section 3 intro                         | first-pass / backlog framing                    | rewrite     | current code ownership and current feature catalog                                                                                                                                                                 | Replaced “first-pass catalog” wording with converged workflow-grain wording.                                                                                      |
| Section 3.Z — Catalog Gap Backlog       | open backlog                                    | delete      | current route/page/component ownership plus current feature catalog                                                                                                                                                | Removed the open backlog and reclassified those items as owned subworkflows or support-only surfaces rather than unresolved future work.                          |
| Section 4 — Feature-to-Test Matrix      | stale output shape                              | rewrite     | all mandatory test roots plus hardware artifact docs                                                                                                                                                               | Replaced the weakest-link matrix with the required evidence and gap columns.                                                                                      |
| Section 5 — Risk Register               | partially aligned but wrong severity scale      | rewrite     | risk focus areas in the review prompt plus current coverage gaps                                                                                                                                                   | Converted to `critical/high/medium/low` and removed obsolete or duplicate risks.                                                                                  |
| Section 6 — Proposed Test Backlog       | wrong output shape                              | rewrite     | existing proposal content and current evidence gaps                                                                                                                                                                | Converted the YAML proposal list to the required flat table.                                                                                                      |
| Section 7 — Completeness Report         | explicit partial failure                        | rewrite     | current inventories, route counts, screenshot counts, hardware evidence provenance                                                                                                                                 | Closed the inherited partial gates and added contract-specific checks.                                                                                            |
| Section 8 — Execution Plan              | remediation roadmap, not review execution plan  | rewrite     | prompt phase requirements and actual review steps taken                                                                                                                                                            | Replaced release-remediation waves with the actual phase-based execution plan used for this review.                                                               |
| Section 9 — Execution Worklog           | falsely claimed completion despite open backlog | rewrite     | actual continuation steps performed in this audit                                                                                                                                                                  | Removed stale “review completed” wording and replaced it with a correction-aware worklog.                                                                         |
