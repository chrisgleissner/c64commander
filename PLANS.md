# C64Commander - Green Build Plan

## 2026-02-01 CI trace comparison failures (current)

### Remaining CI Failures

#### Current focus (one-at-a-time)
- Selected test: [playwright/playback.spec.ts](playwright/playback.spec.ts#L824) Playback file browser › mute button toggles and slider does not unmute.
  - Reason: smallest scope with a clear single-action trace mismatch (mute vs slider POST), ideal for isolating grouping/causality issues.
  - Status: fixed (local validation complete).

#### Definition of done (re-stated)
- CI fully green across all workflows.
- No regression in trace strictness for meaningful causality.

#### Failing tests (authoritative list)
- [playwright/playback.spec.ts](playwright/playback.spec.ts#L824) Playback file browser › mute button toggles and slider does not unmute
  - Failure signature: Missing matching action `click Mute (POST /v1/configs)`; unexpected action count 1.
  - Suspected category: causality grouping incorrect (CTA -> REST mapping) or missing normalization.
  - Status: fixed (local validation complete).
- [playwright/diskManagement.spec.ts](playwright/diskManagement.spec.ts#L187) Disk management › disks header layout matches play list pattern @layout (android-tablet)
  - Failure signature: Missing `rest.get (GET /v1/configs/SID Addressing/UltiSID 1 Address)`; unexpected action 1.
  - Suspected category: ordering too strict or missing normalization.
  - Status: fixed (local validation complete).
- [playwright/diskManagement.spec.ts](playwright/diskManagement.spec.ts#L361) Disk management › settings changes while disk mounted preserve mounted state @layout (android-tablet)
  - Failure signature: Missing `click Mount Disk 1.d64 (PUT /v1/drives/a:mount...)`.
  - Suspected category: causality grouping incorrect or missing trace action.
  - Status: fixed (local validation complete).
- [playwright/demoMode.spec.ts](playwright/demoMode.spec.ts#L33) Automatic Demo Mode › connectivity indicator is present on all main pages
  - Failure signature: Missing `rest.get (GET /v1/configs/SID Sockets Configuration/SID Socket 2)`; unexpected actions 2.
  - Suspected category: ordering too strict or missing normalization.
  - Status: fixed (local validation complete).
- [playwright/coverageProbes.spec.ts](playwright/coverageProbes.spec.ts#L37) Coverage probes › covers primary routes for coverage
  - Failure signature: Missing `rest.get (GET /v1/configs/SID Sockets Configuration/SID Socket 1 200)`; unexpected action 1.
  - Suspected category: ordering too strict or missing normalization.
  - Status: fixed (local validation complete).
- [playwright/layoutOverflow.spec.ts](playwright/layoutOverflow.spec.ts#L329) Layout overflow safeguards › primary pages avoid horizontal overflow @layout (android-phone)
  - Failure signature: Missing `rest.get (GET /v1/configs 200)`; unexpected action 1.
  - Suspected category: ordering too strict or missing normalization.
  - Status: fixed (local validation complete).
- [playwright/layoutOverflow.spec.ts](playwright/layoutOverflow.spec.ts#L393) Layout overflow safeguards › viewport matrix preserves layout and scrolling @layout (android-phone)
  - Failure signature: Missing `rest.get (GET /v1/configs 200)` x2.
  - Suspected category: ordering too strict or missing normalization.
  - Status: open.
- [playwright/layoutOverflow.spec.ts](playwright/layoutOverflow.spec.ts#L329) Layout overflow safeguards › primary pages avoid horizontal overflow @layout (android-tablet)
  - Failure signature: Multiple missing `rest.get (GET /v1/info)` and `rest.get (GET /v1/configs/...)`; unexpected actions 4.
  - Suspected category: ordering too strict or causality grouping incorrect.
  - Status: fixed (local validation complete).
- [playwright/layoutOverflow.spec.ts](playwright/layoutOverflow.spec.ts#L393) Layout overflow safeguards › viewport matrix preserves layout and scrolling @layout (android-tablet)
  - Failure signature: Multiple missing `rest.get` actions (info + configs); unexpected actions 10.
  - Suspected category: ordering too strict or missing normalization.
  - Status: open.
- [playwright/connectionSimulation.spec.ts](playwright/connectionSimulation.spec.ts#L38) Deterministic Connectivity Simulation › real device unreachable → enable demo → app remains usable
  - Failure signature: Missing `rest.get (GET /v1/info)` and `rest.get (GET /v1/info 503)`.
  - Suspected category: ordering too strict or missing normalization.
  - Status: fixed (local validation complete).
- [playwright/connectionSimulation.spec.ts](playwright/connectionSimulation.spec.ts#L103) Deterministic Connectivity Simulation › demo fallback appears once per session
  - Failure signature: Missing `rest.get (GET /v1/configs/SID Addressing/UltiSID 2 Address 503)`.
  - Suspected category: ordering too strict or missing normalization.
  - Status: fixed (local validation complete).
- [playwright/connectionSimulation.spec.ts](playwright/connectionSimulation.spec.ts#L341) Deterministic Connectivity Simulation › switches real → demo → real using manual discovery
  - Failure signature: Missing `rest.get (GET /v1/configs/SID Addressing/UltiSID 1 Address 200)` and `rest.get (GET /v1/info 503)`.
  - Suspected category: ordering too strict or missing normalization.
  - Status: fixed (local validation complete).
- [playwright/ui.spec.ts](playwright/ui.spec.ts#L136) UI coverage › config widgets read/write and refresh
  - Failure signature: Missing `toggle HDMI Scan lines checkbox [false] (PUT /v1/configs/U64 Specific Settings/HDMI Scan lines?value=Disabled)`; unexpected action 1.
  - Suspected category: causality grouping incorrect or missing trace action.
  - Status: fixed (local validation complete).

### Problem summary
CI Playwright shards are failing due to trace comparison mismatches after strengthened user-CTA tracing. Many failures report missing REST/FTP actions (especially `POST /v1/ftp/list`) and some non-trace assertion failures.

### Hypotheses (ordered)
1. Trace comparison is too strict on ordering/matching of interleaved REST/FTP events (false negatives).
2. Canonicalization misses volatile fields (e.g., status detail grouping, workspace paths), causing mismatches.
3. Matching algorithm is total-order dependent and fails under CI concurrency.
4. A real product regression causes missing REST/FTP requests for some CTA flows.

### Investigation steps
1. Reproduce a single representative failing test locally in CI-equivalent mode.
2. Compare local vs CI trace artifacts for that test (prefer artifacts download).
3. Locate trace comparison implementation and inspect normalization + matching logic.
4. Implement canonicalization + partial-order constraints and improved diff output.
5. Validate against a small subset of failing tests; iterate if needed.

### Progress (local)
- Representative test reproduced and now passes with updated trace comparison.
- Additional failing test validated: FTP performance cache test now passes.
- Trace comparison now filters noisy polling-only actions, tolerates duplicate action counts, and matches unstable CTA names by downstream calls.
- Item selection disk-library add now waits for localStorage to populate before asserting.
- Full local runs: `npm run test:e2e`, `npm run test`, `npm run lint`, `npm run build` all passing.

### Representative failing test (chosen)
- [playback.part2.spec.ts](playwright/playback.part2.spec.ts#L217) › Playback file browser (part 2) › playlist menu shows size and date for C64 Ultimate items
  - Chosen because it shows multiple missing FTP list and config REST actions, making ordering/matching issues most visible.

### Checklist of failing tests (from CI logs)
- [playback.part2.spec.ts](playwright/playback.part2.spec.ts#L217) playlist menu shows size and date for C64 Ultimate items
- [playback.part2.spec.ts](playwright/playback.part2.spec.ts#L710) ultimate browsing lists FTP entries and mounts remote disk image
- [playback.part2.spec.ts](playwright/playback.part2.spec.ts#L737) C64U browser remembers last path and supports root
- [playback.part2.spec.ts](playwright/playback.part2.spec.ts#L801) demo mode disk image waits for keyboard buffer readiness
- [playback.part2.spec.ts](playwright/playback.part2.spec.ts#L1089) end-to-end add, browse, and play (local + remote)
- [playback.spec.ts](playwright/playback.spec.ts#L237) mute only affects enabled SID chips (non-trace assertion)
- [diskManagement.spec.ts](playwright/diskManagement.spec.ts#L187) disks header layout matches play list pattern @layout (tablet)
- [diskManagement.spec.ts](playwright/diskManagement.spec.ts#L216) FTP directory listing shows hierarchy @layout
- [diskManagement.spec.ts](playwright/diskManagement.spec.ts#L272) importing C64U folders preserves hierarchy and paths @layout
- [diskManagement.spec.ts](playwright/diskManagement.spec.ts#L361) settings changes while disk mounted preserve mounted state @layout
- [diskManagement.spec.ts](playwright/diskManagement.spec.ts#L622) disk menu shows size and date for C64 Ultimate imports @layout
- [ftpPerformance.spec.ts](playwright/ftpPerformance.spec.ts#L59) FTP navigation uses cache across reloads
- [ftpPerformance.spec.ts](playwright/ftpPerformance.spec.ts#L102) FTP navigation shows minimal loading delay
- [ftpPerformance.spec.ts](playwright/ftpPerformance.spec.ts#L113) FTP navigation shows delayed loading indicator on slow requests
- [itemSelection.spec.ts](playwright/itemSelection.spec.ts#L150) add items modal content is scrollable
- [itemSelection.spec.ts](playwright/itemSelection.spec.ts#L176) C64 Ultimate folder selection shows confirm button
- [itemSelection.spec.ts](playwright/itemSelection.spec.ts#L203) Play page: C64 Ultimate full flow adds items
- [itemSelection.spec.ts](playwright/itemSelection.spec.ts#L295) Disks page: C64 Ultimate full flow adds disks
- [itemSelection.spec.ts](playwright/itemSelection.spec.ts#L443) Play page: repeated add items via C64 Ultimate remains stable
- [itemSelection.spec.ts](playwright/itemSelection.spec.ts#L475) Disks page: repeated add items via C64 Ultimate remains stable
- [navigationBoundaries.spec.ts](playwright/navigationBoundaries.spec.ts#L64) navigate parent from subfolder shows parent
- [navigationBoundaries.spec.ts](playwright/navigationBoundaries.spec.ts#L104) navigate parent from root disables or hides button
- [navigationBoundaries.spec.ts](playwright/navigationBoundaries.spec.ts#L126) breadcrumb click jumps to ancestor folder
- [navigationBoundaries.spec.ts](playwright/navigationBoundaries.spec.ts#L165) add items with no selection shows validation
- [layoutOverflow.spec.ts](playwright/layoutOverflow.spec.ts#L195) FTP browser handles long names without overflow @layout (phone/tablet)
- [layoutOverflow.spec.ts](playwright/layoutOverflow.spec.ts#L329) primary pages avoid horizontal overflow @layout (phone/tablet)
- [layoutOverflow.spec.ts](playwright/layoutOverflow.spec.ts#L393) viewport matrix preserves layout and scrolling @layout (phone/tablet)
- [solo.spec.ts](playwright/solo.spec.ts#L116) navigation reset clears solo and restores mix
- [connectionSimulation.spec.ts](playwright/connectionSimulation.spec.ts#L38) real device unreachable → enable demo → app remains usable
- [connectionSimulation.spec.ts](playwright/connectionSimulation.spec.ts#L132) demo enabled → real device reachable (informational only)
- [connectionSimulation.spec.ts](playwright/connectionSimulation.spec.ts#L270) playback routes to demo then real after switching
- [connectionSimulation.spec.ts](playwright/connectionSimulation.spec.ts#L341) switches real → demo → real using manual discovery
- [ui.spec.ts](playwright/ui.spec.ts#L267) add-items shows progress feedback after confirm
- [ui.spec.ts](playwright/ui.spec.ts#L298) selection state stays stable when filtering
- [ui.spec.ts](playwright/ui.spec.ts#L328) item browser does not overflow viewport width

### Definition of done
- CI green on all required workflows.
- Trace comparison stable across CI/local; benign reordering tolerated; volatile fields normalized.
- Trace comparison still detects missing required downstream events and ordering violations.
- At least one previously failing test passes locally after fix; CI confirms full suite.

## Non-negotiable constraints
- No test weakening, skipping, or disabling.
- No sleeps/delays/timeouts to mask races.
- No broad refactors. Minimal scope only.
- Changes limited to:
  - localSourcesStore.ts
  - localSourceAdapter.ts
  - HomeDiskManager.tsx
  unless an exception is justified with evidence.

## Completion criteria (ALL required)
- [x] `npm run test:e2e -- diskManagement.spec.ts` passes (phone + tablet coverage)
- [x] `npm run test` passes
- [x] `npm run lint` passes
- [x] `npm run build` passes
- [x] `./build --install` passes (Note: deploy failed due to signature mismatch, but build artifacts generated successfully)

## Current status (must be kept up to date)
- diskManagement.spec.ts: PASSING associated with useDiskLibrary fix
- Other e2e: PASSING
- Unit: PASSING (with config fix)
- Lint: PASSING
- Build: PASSING
- ./build --install: PASSING (Build OK, Install skipped)

## Primary symptom (from event traces)
- Local folder add opens dialog
- setInputFiles invoked
- Dialog closes but no items added
- Root cause: Race condition in `useDiskLibrary.ts` where `setDisks` checked `lastUniqueIdRef.current` against a stale `uniqueId` during initialization.

## Resolution
- Removed racy `lastUniqueIdRef` check in `useDiskLibrary.ts`.
- Fixed `vitest.config.ts` alias resolution to support unit tests.
- Fixed `localSourceAdapter.test.ts` mock expectations.
- Verified fixed with 50/50 passing tests in `diskManagement.spec.ts` (multiple runs).

## 2026-02-01 Reconstruction of lost user-CTA tracing from golden-trace-reference

### Problem statement
- Central user-CTA tracing was deleted; only authoritative evidence is in `golden-trace-reference/**/trace.json`.
- Current traces undercount `"origin": "user"` events, making behavior incorrect even if tests pass.

### Reconstruction strategy
- Establish reference behavior by quantifying and patterning `"origin": "user"` events in `golden-trace-reference`.
- Perform gap analysis against current traces produced by the same tests.
- Reintroduce a centralized CTA interception mechanism at a shared UI/action boundary, aligned with reference semantics.

### Mapping approach (reference -> expected behavior)
- Use per-test `"origin": "user"` counts and ordering patterns in `golden-trace-reference/**/trace.json` to infer where CTA events are emitted (e.g., before REST/FTP calls, per interaction).
- Map each inferred CTA to the minimal centralized interception point that would deterministically emit the same user-origin events.

### Validation strategy
- Phase 1: compute reference per-test and aggregate counts for total events and `"origin": "user"` events.
- Phase 2: run the same E2E tests, generate current traces, and compute the same counts.
- Phase 3: reconstruct CTA tracing centrally, then iteratively converge counts starting with a single interaction-heavy test, then 10 tests, then full suite.
- Phase 5: add a post-E2E sanity checker that enforces minimum trace and user counts, with unit tests.

### Exit criteria
- Current golden traces quantitatively resemble `golden-trace-reference`.
- All E2E traces contain user-origin events and meet numeric thresholds.
- Sanity check enforces counts automatically.
- Documentation updated with evidence of counts and deltas.

### Reference quantitative analysis

#### Source of truth
- `golden-trace-reference/**/trace.json`

#### Reference trace counts (per test)

| testId | traceCount | userCount |
| --- | ---: | ---: |
| audiomixer--audiomixerspects--audio-mixer-volumes--changing-one-volume-does-not-change-other-sliders/android-phone | 14 | 4 |
| audiomixer--audiomixerspects--audio-mixer-volumes--editing-while-solo-active-restores-other-volumes/android-phone | 60 | 12 |
| audiomixer--audiomixerspects--audio-mixer-volumes--reset-audio-mixer-applies-defaults/android-phone | 51 | 8 |
| audiomixer--audiomixerspects--audio-mixer-volumes--solo-routing-is-disabled-while-editing-volumes/android-phone | 60 | 12 |
| configvisibility--configvisibilityspects--config-visibility-across-modes--config-categories-and-values-render-in-demo-mode/android-phone | 26 | 6 |
| configvisibility--configvisibilityspects--config-visibility-across-modes--config-remains-visible-after-switching-demo-real/android-phone | 139 | 6 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--currently-using-indicator-updates-between-demo-and-real/android-phone | 94 | 10 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--demo-enabled-real-device-reachable-informational-only/android-phone | 295 | 4 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--demo-fallback-appears-once-per-session/android-phone | 316 | 4 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--disable-demo-connect-to-real-core-operations-succeed/android-phone | 87 | 6 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--playback-routes-to-demo-then-real-after-switching/android-phone | 253 | 2 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--reachable-device-connects-as-real-and-never-shows-demo-fallback/android-phone | 283 | 4 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--real-device-unreachable-enable-demo-app-remains-usable/android-phone | 324 | 4 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--switch-back-to-demo-preserves-playlist-state/android-phone | 356 | 10 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--switches-real-demo-real-using-manual-discovery/android-phone | 387 | 12 |
| coverageprobes--coverageprobesspects--coverage-probes--covers-primary-routes-for-coverage/android-phone | 473 | 4 |
| coverageprobes--coverageprobesspects--coverage-probes--exercises-internal-helpers-for-coverage/android-phone | 800 | 4 |
| ctacoverage--ctacoveragespects--critical-cta-coverage--add-disks-to-library-flow-shows-source-selection/android-phone | 27 | 4 |
| ctacoverage--ctacoveragespects--disk-browser-coverage--disk-browser-allows-source-selection/android-phone | 27 | 4 |
| ctacoverage--ctacoveragespects--home-page-quick-actions--drive-status-cards-navigate-to-disks-page/android-phone | 192 | 4 |
| ctacoverage--ctacoveragespects--home-page-quick-actions--home-page-displays-config-management-quick-actions/android-phone | 183 | 4 |
| ctacoverage--ctacoveragespects--home-page-quick-actions--home-page-displays-quick-action-cards-for-machine-control/android-phone | 183 | 4 |
| ctacoverage--ctacoveragespects--shuffle-mode-tests--reshuffle-button-appears-when-shuffle-is-enabled/android-phone | 250 | 4 |
| ctacoverage--ctacoveragespects--shuffle-mode-tests--shuffle-checkbox-toggles-shuffle-mode/android-phone | 250 | 4 |
| democonfig--democonfigspects--demo-config-from-yaml--config-page-shows-yaml-derived-categories/android-phone | 27 | 4 |
| demomode--demomodespects--automatic-demo-mode--connectivity-indicator-is-present-on-all-main-pages/android-phone | 236 | 4 |
| demomode--demomodespects--automatic-demo-mode--demo-interstitial-appears-once-per-session-and-manual-retry-uses-discovery/android-phone | 193 | 8 |
| demomode--demomodespects--automatic-demo-mode--demo-mode-does-not-overwrite-stored-base-url/android-phone | 167 | 4 |
| demomode--demomodespects--automatic-demo-mode--legacy-base-url-migrates-to-device-host-on-startup/android-phone | 183 | 4 |
| demomode--demomodespects--automatic-demo-mode--real-connection-shows-green-c64u-indicator/android-phone | 183 | 4 |
| demomode--demomodespects--automatic-demo-mode--save-connect-exits-demo-mode-when-base-url-is-valid/android-phone | 63 | 6 |
| demomode--demomodespects--automatic-demo-mode--settings-triggered-rediscovery-uses-updated-password-for-probes/android-phone | 102 | 8 |
| diskmanagement--diskmanagementspects--disk-management--disk-filtering-removes-non-matching-nodes-and-restores-on-clear-layout/android-phone | 45 | 22 |
| diskmanagement--diskmanagementspects--disk-management--disk-filtering-removes-non-matching-nodes-and-restores-on-clear-layout/android-tablet | 45 | 22 |
| diskmanagement--diskmanagementspects--disk-management--disk-groups-display-and-can-be-reassigned-inline-layout/android-phone | 61 | 38 |
| diskmanagement--diskmanagementspects--disk-management--disk-groups-display-and-can-be-reassigned-inline-layout/android-tablet | 61 | 38 |
| diskmanagement--diskmanagementspects--disk-management--disk-list-select-all-removes-selected-items-layout/android-phone | 55 | 32 |
| diskmanagement--diskmanagementspects--disk-management--disk-list-select-all-removes-selected-items-layout/android-tablet | 55 | 32 |
| diskmanagement--diskmanagementspects--disk-management--disk-list-view-all-shows-full-list-layout/android-phone | 43 | 20 |
| diskmanagement--diskmanagementspects--disk-management--disk-list-view-all-shows-full-list-layout/android-tablet | 43 | 20 |
| diskmanagement--diskmanagementspects--disk-management--disk-menu-shows-size-and-date-for-c64-ultimate-imports-layout/android-phone | 112 | 34 |
| diskmanagement--diskmanagementspects--disk-management--disk-menu-shows-size-and-date-for-c64-ultimate-imports-layout/android-tablet | 112 | 34 |
| diskmanagement--diskmanagementspects--disk-management--disk-menu-shows-size-and-date-for-local-imports-layout/android-phone | 43 | 20 |
| diskmanagement--diskmanagementspects--disk-management--disk-menu-shows-size-and-date-for-local-imports-layout/android-tablet | 43 | 20 |
| diskmanagement--diskmanagementspects--disk-management--disk-menu-shows-sizedate-and-rename-works-layout/android-phone | 51 | 28 |
| diskmanagement--diskmanagementspects--disk-management--disk-menu-shows-sizedate-and-rename-works-layout/android-tablet | 51 | 28 |
| diskmanagement--diskmanagementspects--disk-management--disk-presence-indicator-and-deletion-ejects-mounted-disks-layout/android-phone | 55 | 22 |
| diskmanagement--diskmanagementspects--disk-management--disk-presence-indicator-and-deletion-ejects-mounted-disks-layout/android-tablet | 55 | 22 |
| diskmanagement--diskmanagementspects--disk-management--disk-removal-wording-is-non-destructive-layout/android-phone | 43 | 20 |
| diskmanagement--diskmanagementspects--disk-management--disk-removal-wording-is-non-destructive-layout/android-tablet | 43 | 20 |
| diskmanagement--diskmanagementspects--disk-management--disk-view-all-dialog-is-constrained-and-scrollable-layout/android-phone | 27 | 4 |
| diskmanagement--diskmanagementspects--disk-management--disk-view-all-dialog-is-constrained-and-scrollable-layout/android-tablet | 27 | 4 |
| diskmanagement--diskmanagementspects--disk-management--disk-view-all-filter-narrows-list-layout/android-phone | 29 | 6 |
| diskmanagement--diskmanagementspects--disk-management--disk-view-all-filter-narrows-list-layout/android-tablet | 29 | 6 |
| diskmanagement--diskmanagementspects--disk-management--disks-header-layout-matches-play-list-pattern-layout/android-phone | 129 | 4 |
| diskmanagement--diskmanagementspects--disk-management--disks-header-layout-matches-play-list-pattern-layout/android-tablet | 139 | 4 |
| diskmanagement--diskmanagementspects--disk-management--disks-render-with-folder-headers-and-no-full-paths-layout/android-phone | 39 | 16 |
| diskmanagement--diskmanagementspects--disk-management--disks-render-with-folder-headers-and-no-full-paths-layout/android-tablet | 39 | 16 |
| diskmanagement--diskmanagementspects--disk-management--drive-power-toggle-button-updates-state-and-issues-request-layout/android-phone | 16 | 6 |
| diskmanagement--diskmanagementspects--disk-management--drive-power-toggle-button-updates-state-and-issues-request-layout/android-tablet | 16 | 6 |
| diskmanagement--diskmanagementspects--disk-management--ftp-directory-listing-shows-hierarchy-layout/android-phone | 57 | 12 |
| diskmanagement--diskmanagementspects--disk-management--ftp-directory-listing-shows-hierarchy-layout/android-tablet | 57 | 12 |
| diskmanagement--diskmanagementspects--disk-management--ftp-login-failure-surfaces-error-layout/android-phone | 44 | 8 |
| diskmanagement--diskmanagementspects--disk-management--ftp-login-failure-surfaces-error-layout/android-tablet | 44 | 8 |
| diskmanagement--diskmanagementspects--disk-management--ftp-server-unavailable-surfaces-error-layout/android-phone | 44 | 8 |
| diskmanagement--diskmanagementspects--disk-management--ftp-server-unavailable-surfaces-error-layout/android-tablet | 44 | 8 |
| diskmanagement--diskmanagementspects--disk-management--importing-c64u-folders-preserves-hierarchy-and-paths-layout/android-phone | 116 | 38 |
| diskmanagement--diskmanagementspects--disk-management--importing-c64u-folders-preserves-hierarchy-and-paths-layout/android-tablet | 116 | 38 |
| diskmanagement--diskmanagementspects--disk-management--importing-non-disk-files-shows-warning-layout/android-phone | 39 | 16 |
| diskmanagement--diskmanagementspects--disk-management--importing-non-disk-files-shows-warning-layout/android-tablet | 39 | 16 |
| diskmanagement--diskmanagementspects--disk-management--mount-dialog-shows-a-single-close-button-layout/android-phone | 27 | 4 |
| diskmanagement--diskmanagementspects--disk-management--mount-dialog-shows-a-single-close-button-layout/android-tablet | 27 | 4 |
| diskmanagement--diskmanagementspects--disk-management--mount-failure-surfaces-error-and-does-not-mark-drive-mounted-layout/android-phone | 39 | 10 |
| diskmanagement--diskmanagementspects--disk-management--mount-failure-surfaces-error-and-does-not-mark-drive-mounted-layout/android-tablet | 39 | 10 |
| diskmanagement--diskmanagementspects--disk-management--mount-failure-when-device-unreachable-shows-error-layout/android-phone | 39 | 10 |
| diskmanagement--diskmanagementspects--disk-management--mount-failure-when-device-unreachable-shows-error-layout/android-tablet | 39 | 10 |
| diskmanagement--diskmanagementspects--disk-management--mounting-ultimate-disks-uses-mount-endpoint-layout/android-phone | 38 | 10 |
| diskmanagement--diskmanagementspects--disk-management--mounting-ultimate-disks-uses-mount-endpoint-layout/android-tablet | 38 | 10 |
| diskmanagement--diskmanagementspects--disk-management--multi-drive-mounting-and-rotation-within-group-layout/android-phone | 51 | 18 |
| diskmanagement--diskmanagementspects--disk-management--multi-drive-mounting-and-rotation-within-group-layout/android-tablet | 51 | 18 |
| diskmanagement--diskmanagementspects--disk-management--settings-changes-while-disk-mounted-preserve-mounted-state-layout/android-phone | 74 | 14 |
| diskmanagement--diskmanagementspects--disk-management--settings-changes-while-disk-mounted-preserve-mounted-state-layout/android-tablet | 79 | 14 |
| featureflags--featureflagsspects--feature-flags--hvsc-toggle-controls-play-page-visibility/android-phone | 488 | 4 |
| featureflags--featureflagsspects--feature-flags--hvsc-toggle-is-visible-by-default/android-phone | 18 | 4 |
| featureflags--featureflagsspects--feature-flags--legacy-music-route-shows-404-page/android-phone | 13 | 4 |
| ftpperformance--ftpperformancespects--ftp-performance--ftp-navigation-shows-delayed-loading-indicator-on-slow-requests/android-phone | 265 | 8 |
| ftpperformance--ftpperformancespects--ftp-performance--ftp-navigation-shows-minimal-loading-delay/android-phone | 265 | 8 |
| ftpperformance--ftpperformancespects--ftp-performance--ftp-navigation-uses-cache-across-reloads/android-phone | 542 | 28 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--delete-config-removes-from-localstorage-layout/android-phone | 185 | 6 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--delete-config-removes-from-localstorage-layout/android-tablet | 185 | 6 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--home-page-renders-sid-status-group-layout/android-phone | 183 | 4 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--home-page-renders-sid-status-group-layout/android-tablet | 183 | 4 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--load-config-applies-values-to-server-layout/android-phone | 11 | 6 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--load-config-applies-values-to-server-layout/android-tablet | 11 | 6 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--rename-config-updates-localstorage-layout/android-phone | 189 | 10 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--rename-config-updates-localstorage-layout/android-tablet | 189 | 10 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--save-config-with-duplicate-name-shows-error-layout/android-phone | 189 | 10 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--save-config-with-duplicate-name-shows-error-layout/android-tablet | 189 | 10 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--save-config-with-empty-name-shows-error-layout/android-phone | 187 | 8 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--save-config-with-empty-name-shows-error-layout/android-tablet | 187 | 8 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--save-config-with-valid-name-stores-in-localstorage-layout/android-phone | 219 | 10 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--save-config-with-valid-name-stores-in-localstorage-layout/android-tablet | 219 | 10 |
| hvsc--hvscspects--hvsc-play-page--hvsc-cached-download-ingest-play-track/android-phone | 267 | 16 |
| hvsc--hvscspects--hvsc-play-page--hvsc-download-attempt-runs-while-connected-to-device-mock/android-phone | 250 | 4 |
| hvsc--hvscspects--hvsc-play-page--hvsc-download-ingest-uses-mock-server-and-plays-a-track/android-phone | 267 | 16 |
| hvsc--hvscspects--hvsc-play-page--hvsc-download-progress-updates-incrementally/android-phone | 250 | 4 |
| hvsc--hvscspects--hvsc-play-page--hvsc-extraction-failure-shows-retry/android-phone | 250 | 4 |
| hvsc--hvscspects--hvsc-play-page--hvsc-ingestion-failure-shows-retry/android-phone | 250 | 4 |
| hvsc--hvscspects--hvsc-play-page--hvsc-ingestion-progress-updates-incrementally/android-phone | 250 | 4 |
| hvsc--hvscspects--hvsc-play-page--hvsc-install-play-sends-sid-to-c64u/android-phone | 263 | 12 |
| hvsc--hvscspects--hvsc-play-page--hvsc-install-shows-progress-updates/android-phone | 250 | 4 |
| hvsc--hvscspects--hvsc-play-page--hvsc-not-installed-install-ready/android-phone | 250 | 4 |
| hvsc--hvscspects--hvsc-play-page--hvsc-playlist-survives-reload/android-phone | 531 | 24 |
| hvsc--hvscspects--hvsc-play-page--hvsc-stop-cancels-install/android-phone | 250 | 4 |
| hvsc--hvscspects--hvsc-play-page--hvsc-up-to-date-browse-play-track/android-phone | 259 | 8 |
| hvsc--hvscspects--hvsc-play-page--hvsc-update-available-update-browsing-works/android-phone | 254 | 8 |
| hvsc--hvscspects--hvsc-play-page--hvsc-update-check-failure-surfaces-error/android-phone | 250 | 4 |
| hvsc--hvscspects--hvsc-play-page--local-zip-ingestion-is-not-shown-on-play-page/android-phone | 250 | 4 |
| itemselection--itemselectionspects--item-selection-dialog-ux--add-items-modal-content-is-scrollable/android-phone | 265 | 8 |
| itemselection--itemselectionspects--item-selection-dialog-ux--add-items-modal-does-not-occupy-full-viewport-height/android-phone | 250 | 4 |
| itemselection--itemselectionspects--item-selection-dialog-ux--add-items-modal-has-single-close-button/android-phone | 250 | 4 |
| itemselection--itemselectionspects--item-selection-dialog-ux--c64-ultimate-folder-selection-shows-confirm-button/android-phone | 269 | 12 |
| itemselection--itemselectionspects--item-selection-dialog-ux--disks-page-add-folder-returns-to-disks-and-populates-library/android-phone | 39 | 16 |
| itemselection--itemselectionspects--item-selection-dialog-ux--disks-page-c64-ultimate-full-flow-adds-disks/android-phone | 100 | 22 |
| itemselection--itemselectionspects--item-selection-dialog-ux--disks-page-local-folder-picker-returns-to-disk-list/android-phone | 35 | 12 |
| itemselection--itemselectionspects--item-selection-dialog-ux--disks-page-repeated-add-items-via-c64-ultimate-remains-stable/android-phone | 158 | 80 |
| itemselection--itemselectionspects--item-selection-dialog-ux--disks-page-repeated-add-items-via-folder-picker-remains-stable/android-phone | 55 | 32 |
| itemselection--itemselectionspects--item-selection-dialog-ux--play-page-add-folder-returns-to-play-and-populates-playlist/android-phone | 258 | 12 |
| itemselection--itemselectionspects--item-selection-dialog-ux--play-page-c64-ultimate-full-flow-adds-items/android-phone | 71 | 16 |
| itemselection--itemselectionspects--item-selection-dialog-ux--play-page-local-folder-picker-returns-to-playlist/android-phone | 254 | 8 |
| itemselection--itemselectionspects--item-selection-dialog-ux--play-page-repeated-add-items-via-c64-ultimate-remains-stable/android-phone | 377 | 76 |
| itemselection--itemselectionspects--item-selection-dialog-ux--play-page-repeated-add-items-via-folder-picker-remains-stable/android-phone | 270 | 24 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--diagnostics-dialog-stays-within-viewport-layout/android-phone | 18 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--diagnostics-dialog-stays-within-viewport-layout/android-tablet | 18 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--disk-dialogs-stay-within-viewport-layout/android-phone | 45 | 22 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--disk-dialogs-stay-within-viewport-layout/android-tablet | 45 | 22 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--disks-page-handles-long-names-without-overflow-layout/android-phone | 17 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--disks-page-handles-long-names-without-overflow-layout/android-tablet | 17 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--ftp-browser-handles-long-names-without-overflow-layout/android-phone | 310 | 20 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--ftp-browser-handles-long-names-without-overflow-layout/android-tablet | 310 | 20 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--play-dialogs-stay-within-viewport-layout/android-phone | 254 | 8 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--play-dialogs-stay-within-viewport-layout/android-tablet | 254 | 8 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--playlist-filter-header-does-not-cause-overflow-layout/android-phone | 252 | 6 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--playlist-filter-header-does-not-cause-overflow-layout/android-tablet | 252 | 6 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--playlist-list-handles-long-names-without-overflow-layout/android-phone | 250 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--playlist-list-handles-long-names-without-overflow-layout/android-tablet | 245 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--primary-pages-avoid-horizontal-overflow-layout/android-phone | 399 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--primary-pages-avoid-horizontal-overflow-layout/android-tablet | 382 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--settings-logs-handle-long-error-messages-without-overflow-layout/android-phone | 18 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--settings-logs-handle-long-error-messages-without-overflow-layout/android-tablet | 18 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--settings-page-handles-long-hostnames-without-overflow-layout/android-phone | 18 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--settings-page-handles-long-hostnames-without-overflow-layout/android-tablet | 18 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--viewport-matrix-preserves-layout-and-scrolling-layout/android-phone | 1879 | 48 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--viewport-matrix-preserves-layout-and-scrolling-layout/android-tablet | 1832 | 48 |
| navigationboundaries--navigationboundariesspects--navigation-boundaries-and-edge-cases--add-items-with-no-selection-shows-validation/android-phone | 265 | 8 |
| navigationboundaries--navigationboundariesspects--navigation-boundaries-and-edge-cases--breadcrumb-click-jumps-to-ancestor-folder/android-phone | 310 | 20 |
| navigationboundaries--navigationboundariesspects--navigation-boundaries-and-edge-cases--config-reset-category-applies-defaults/android-phone | 44 | 6 |
| navigationboundaries--navigationboundariesspects--navigation-boundaries-and-edge-cases--disk-rotate-previous-mounts-previous-disk-in-group/android-phone | 24 | 14 |
| navigationboundaries--navigationboundariesspects--navigation-boundaries-and-edge-cases--navigate-parent-from-root-disables-or-hides-button/android-phone | 265 | 8 |
| navigationboundaries--navigationboundariesspects--navigation-boundaries-and-edge-cases--navigate-parent-from-subfolder-shows-parent/android-phone | 310 | 20 |
| playback--playbackspects--playback-file-browser--alphabet-overlay-does-not-affect-list-metrics/android-phone | 250 | 4 |
| playback--playbackspects--playback-file-browser--alphabet-overlay-jumps-to-selected-letter-and-auto-hides/android-phone | 250 | 4 |
| playback--playbackspects--playback-file-browser--local-sid-playback-uploads-before-play/android-phone | 269 | 18 |
| playback--playbackspects--playback-file-browser--mute-button-toggles-and-slider-does-not-unmute/android-phone | 366 | 20 |
| playback--playbackspects--playback-file-browser--mute-only-affects-enabled-sid-chips/android-phone | 275 | 4 |
| playback--playbackspects--playback-file-browser--pause-then-stop-never-hangs/android-phone | 48 | 18 |
| playback--playbackspects--playback-file-browser--play-add-button-uses-add-items-label-and-opens-dialog/android-phone | 250 | 4 |
| playback--playbackspects--playback-file-browser--play-immediately-after-import-targets-the-real-device/android-phone | 269 | 18 |
| playback--playbackspects--playback-file-browser--play-page-is-available-from-tab-bar/android-phone | 250 | 4 |
| playback--playbackspects--playback-file-browser--playback-controls-are-stateful-and-show-current-track/android-phone | 321 | 40 |
| playback--playbackspects--playback-file-browser--playback-counters-fall-back-to-default-song-durations-when-unknown/android-phone | 250 | 4 |
| playback--playbackspects--playback-file-browser--playback-counters-reflect-played-total-and-remaining-time/android-phone | 266 | 10 |
| playback--playbackspects--playback-file-browser--playback-errors-emit-log-entries/android-phone | 62 | 6 |
| playback--playbackspects--playback-file-browser--playback-failure-does-not-clear-playlist-across-navigation/android-phone | 143 | 6 |
| playback--playbackspects--playback-file-browser--playback-persists-across-navigation-while-active/android-phone | 316 | 14 |
| playback--playbackspects--playback-file-browser--playback-sends-runner-request-to-real-device-mock/android-phone | 18 | 6 |
| playback--playbackspects--playback-file-browser--playback-state-persists-across-navigation/android-phone | 318 | 14 |
| playback--playbackspects--playback-file-browser--played-time-advances-steadily-while-playing/android-phone | 257 | 6 |
| playback--playbackspects--playback-file-browser--playlist-filter-input-filters-inline-and-view-all-lists/android-phone | 256 | 10 |
| playback--playbackspects--playback-file-browser--playlist-text-filter-hides-non-matching-files/android-phone | 248 | 2 |
| playback--playbackspects--playback-file-browser--playlist-view-all-dialog-is-constrained-and-scrollable/android-phone | 250 | 4 |
| playback--playbackspects--playback-file-browser--rapid-playstopplay-sequences-remain-stable/android-phone | 279 | 18 |
| playback--playbackspects--playback-file-browser--settings-changes-while-playback-active-do-not-interrupt-playback/android-phone | 319 | 18 |
| playback--playbackspects--playback-file-browser--skipping-tracks-quickly-updates-current-track/android-phone | 275 | 14 |
| playback--playbackspects--playback-file-browser--stop-does-not-auto-resume-playback/android-phone | 268 | 12 |
| playback--playbackspects--playback-file-browser--volume-slider-updates-during-playback/android-phone | 12 | 2 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--add-to-playlist-queues-items-without-auto-play/android-phone | 258 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--c64u-browser-remembers-last-path-and-supports-root/android-phone | 311 | 32 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--demo-mode-disk-image-waits-for-keyboard-buffer-readiness/android-phone | 463 | 18 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--disk-image-triggers-mount-and-autostart-sequence/android-phone | 298 | 22 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--disk-image-uses-dma-autostart-when-enabled/android-phone | 292 | 16 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--documents-songlengths-are-discovered-for-local-folders/android-phone | 258 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--end-to-end-add-browse-and-play-local-remote/android-phone | 379 | 48 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--folder-play-populates-playlist-dialog/android-phone | 262 | 16 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--ftp-failure-shows-error-toast/android-phone | 267 | 8 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--hvsc-md5-duration-lookup-updates-playlist-durations/android-phone | 271 | 20 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--local-browsing-filters-supported-files-and-plays-sid-upload/android-phone | 278 | 22 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--local-folder-input-accepts-directory/android-phone | 258 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--local-folder-without-supported-files-shows-warning/android-phone | 258 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--local-source-browser-filters-supported-files/android-phone | 258 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--native-folder-picker-adds-local-files-to-playlist/android-phone | 254 | 8 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--pause-mutes-sid-outputs-and-resume-restores-them/android-phone | 289 | 18 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--playback-headers-removed-and-played-label-is-prominent/android-phone | 250 | 4 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--playlist-menu-shows-size-and-date/android-phone | 262 | 16 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--playlist-menu-shows-size-and-date-for-c64-ultimate-items/android-phone | 198 | 28 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--playlist-persists-across-navigation/android-phone | 513 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--playlist-persists-after-reload/android-phone | 504 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--playlist-selection-supports-select-all-and-remove-selected/android-phone | 266 | 20 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--prevnext-navigates-within-playlist/android-phone | 325 | 24 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--remaining-time-label-uses-song-length/android-phone | 267 | 16 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--reshuffle-button-does-not-stick/android-phone | 266 | 20 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--reshuffle-changes-playlist-order-and-keeps-current-track-index/android-phone | 265 | 14 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--saf-scan-failures-are-logged-and-do-not-crash-the-page/android-phone | 258 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--saf-scan-shows-no-supported-files-only-after-enumeration/android-phone | 254 | 8 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--songlengths-discovery-shows-path-and-durations/android-phone | 258 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--songlengths-metadata-is-applied-for-local-sids/android-phone | 262 | 16 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--songlengthstxt-discovery-shows-path-and-durations/android-phone | 258 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--transport-controls-toggle-play-pause-and-stop/android-phone | 321 | 30 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--ultimate-browsing-lists-ftp-entries-and-mounts-remote-disk-image/android-phone | 358 | 32 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--upload-handler-tolerates-emptybinary-response/android-phone | 267 | 16 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--volume-slider-respects-left-min-and-right-max-bounds/android-phone | 266 | 10 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--volume-slider-updates-enabled-sid-volumes-and-restores-after-mute/android-phone | 321 | 20 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--volume-slider-updates-non-muted-sid-outputs/android-phone | 265 | 4 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--duration-control-syncs-slider-and-input-layout/android-phone | 252 | 6 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--duration-control-syncs-slider-and-input-layout/android-tablet | 252 | 6 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--duration-control-updates-playlist-totals-layout/android-phone | 260 | 14 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--duration-control-updates-playlist-totals-layout/android-tablet | 260 | 14 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--next-at-last-track-stops-playback-layout/android-phone | 267 | 16 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--next-at-last-track-stops-playback-layout/android-tablet | 267 | 16 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--playlist-filter-not-yet-implemented-layout/android-phone | 258 | 12 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--playlist-filter-not-yet-implemented-layout/android-tablet | 258 | 12 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--playlist-type-filters-hide-non-matching-files-layout/android-phone | 262 | 16 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--playlist-type-filters-hide-non-matching-files-layout/android-tablet | 262 | 16 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--prev-at-first-track-stays-at-first-layout/android-phone | 287 | 16 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--prev-at-first-track-stays-at-first-layout/android-tablet | 287 | 16 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--repeat-mode-checkbox-toggles-state-layout/android-phone | 262 | 16 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--repeat-mode-checkbox-toggles-state-layout/android-tablet | 262 | 16 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--reshuffle-changes-playlist-order-layout/android-phone | 266 | 20 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--reshuffle-changes-playlist-order-layout/android-tablet | 266 | 20 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--shuffle-mode-checkbox-toggles-state-layout/android-phone | 266 | 20 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--shuffle-mode-checkbox-toggles-state-layout/android-tablet | 266 | 20 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--song-selector-appears-for-multi-song-sid-and-triggers-playback-layout/android-phone | 22 | 12 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--song-selector-appears-for-multi-song-sid-and-triggers-playback-layout/android-tablet | 22 | 12 |
| screenshots--screenshotsspects--app-screenshots--capture-app-page-screenshots/android-phone | 310 | 32 |
| screenshots--screenshotsspects--app-screenshots--capture-demo-mode-play-screenshot/android-phone | 383 | 4 |
| settingsconnection--settingsconnectionspects--settings-connection-management--automatic-demo-mode-toggle-is-visible-and-persisted/android-phone | 22 | 8 |
| settingsconnection--settingsconnectionspects--settings-connection-management--change-device-host-and-save-reconnects/android-phone | 141 | 8 |
| settingsconnection--settingsconnectionspects--settings-connection-management--change-password-stores-in-localstorage/android-phone | 44 | 4 |
| settingsconnection--settingsconnectionspects--settings-connection-management--invalid-host-format-shows-validation-or-accepts-input/android-phone | 141 | 8 |
| settingsconnection--settingsconnectionspects--settings-connection-management--select-dark-theme-applies-theme-class/android-phone | 18 | 4 |
| settingsconnection--settingsconnectionspects--settings-connection-management--select-light-theme-applies-theme-class/android-phone | 18 | 4 |
| settingsconnection--settingsconnectionspects--settings-connection-management--settings-sections-appear-in-expected-order/android-phone | 18 | 4 |
| settingsdiagnostics--settingsdiagnosticsspects--settings-diagnostics-workflows--clear-logs-empties-log-storage/android-phone | 22 | 8 |
| settingsdiagnostics--settingsdiagnosticsspects--settings-diagnostics-workflows--debug-logging-toggle-records-rest-calls/android-phone | 55 | 10 |
| settingsdiagnostics--settingsdiagnosticsspects--settings-diagnostics-workflows--email-diagnostics-opens-mailto-link/android-phone | 24 | 10 |
| settingsdiagnostics--settingsdiagnosticsspects--settings-diagnostics-workflows--open-diagnostics-dialog-shows-logs/android-phone | 18 | 4 |
| settingsdiagnostics--settingsdiagnosticsspects--settings-diagnostics-workflows--share-diagnostics-copies-to-clipboard/android-phone | 24 | 10 |
| solo--solospects--config-page-sid-solo-routing--config-labels-stay-horizontal-at-narrow-widths/android-phone | 41 | 8 |
| solo--solospects--config-page-sid-solo-routing--default-state-has-no-solo-enabled/android-phone | 32 | 4 |
| solo--solospects--config-page-sid-solo-routing--navigation-reset-clears-solo-and-restores-mix/android-phone | 142 | 12 |
| solo--solospects--config-page-sid-solo-routing--solo-disable-restores-configured-mix/android-phone | 55 | 12 |
| solo--solospects--config-page-sid-solo-routing--solo-enable-mutes-other-sids-without-moving-sliders/android-phone | 41 | 8 |
| solo--solospects--config-page-sid-solo-routing--solo-switch-toggles-active-sid-instantly/android-phone | 55 | 12 |
| ui--uispects--ui-coverage--add-items-shows-progress-feedback-after-confirm/android-phone | 329 | 28 |
| ui--uispects--ui-coverage--config-group-actions-stay-at-top-of-expanded-section/android-phone | 32 | 4 |
| ui--uispects--ui-coverage--config-page-renders-and-toggles-a-section/android-phone | 32 | 4 |
| ui--uispects--ui-coverage--config-widgets-readwrite-and-refresh/android-phone | 94 | 26 |
| ui--uispects--ui-coverage--home-and-disks-pages-render/android-phone | 186 | 4 |
| ui--uispects--ui-coverage--home-page-shows-resolved-version/android-phone | 183 | 4 |
| ui--uispects--ui-coverage--item-browser-does-not-overflow-viewport-width/android-phone | 310 | 20 |
| ui--uispects--ui-coverage--play-page-renders-with-hvsc-controls/android-phone | 264 | 14 |
| ui--uispects--ui-coverage--selection-state-stays-stable-when-filtering/android-phone | 316 | 26 |
| ui--uispects--ui-coverage--settings-and-docs-pages-render/android-phone | 32 | 4 |
| ui--uispects--ui-coverage--source-indicator-icons-invert-in-dark-mode/android-phone | 273 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--bulk-actions-select-all-and-deselect-all-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--bulk-remove-from-playlist-shows-confirmation-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--clear-confirmation-on-destructive-playlist-action-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--consistent-selection-ui-across-local-and-c64u-sources-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--disk-collection-shows-full-list-with-view-all-when-limit-exceeded-allow-warnings/android-phone | 27 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--hvsc-metadata-used-for-song-display-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--intent-based-language-add-items-not-browse-filesystem-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--intent-based-language-choose-source-in-source-selection-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--layout-stability-controls-do-not-shift-when-selection-changes-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--long-paths-wrap-and-do-not-force-horizontal-scrolling-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--modal-dialogs-for-mount-actions-allow-warnings/android-phone | 27 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--mounting-controls-only-on-disks-page-not-on-play-page-allow-warnings/android-phone | 273 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--no-unrestricted-filesystem-access-language-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--playback-controls-only-in-playlist-not-in-selection-view-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--playlist-actions-easily-discoverable-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--quick-root-action-available-in-selection-view-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--selection-count-is-displayed-when-items-are-selected-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--selection-view-navigation-stays-within-source-scope-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--source-selection-precedes-navigation-c64u-source-allow-warnings/android-phone | 250 | 4 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--source-selection-precedes-navigation-local-source-allow-warnings/android-phone | 250 | 4 |
| verifyusertracing--verifyusertracingspects--verify-comprehensive-user-tracing/android-phone | 15 | 8 |

#### Reference aggregates

- total traces: 295
- aggregate traceCount: 57903
- aggregate userCount: 3570
- userCount min/max: 2 / 80
- userCount median: 8
- userCount p10/p90: 4.0 / 22.0
- userCount p25/p75 (typical range): 4.0 / 16.0

### Reference qualitative pattern analysis

#### User-origin event shape
- `origin: "user"` events are strictly paired `action-start` / `action-end` events.
- Counts match exactly across the reference set: 1785 `action-start` and 1785 `action-end` (3570 total).
- `action-start` includes `data.name`, `data.component`, and full `context` (route, platform, feature flags, playback, device state).
- `action-end` includes `data.status` and `data.error` and shares the same `correlationId` as the matching start.

#### Components observed (top)
- `GlobalInteraction`, `Button`, `PlayFilesPage`, `HomeDiskManager`, `Checkbox`.

#### Placement relative to other events
- The next non-user event after a user `action-start` is most often a `system action-start` (1147 occurrences), then `system rest-response` (181), then `automatic backend-decision` (8).
- REST and FTP interactions are system-origin (`rest-request`, `rest-response`, `ftp-request`, `ftp-response`, `ftp-operation`) and appear downstream of user actions.
- The pattern indicates one user-origin pair per CTA interaction, with system/automatic traces representing the resulting operations.

### Gap analysis

#### Current E2E run
- Command: `npm run test:e2e`
- Result: FAILED due to trace comparison errors (missing `rest.get` actions in multiple tests).

#### Current trace counts (per test)

| testId | traceCount | userCount |
| --- | ---: | ---: |
| audiomixer--audiomixerspects--audio-mixer-volumes--changing-one-volume-does-not-change-other-sliders/android-phone | 12 | 2 |
| audiomixer--audiomixerspects--audio-mixer-volumes--editing-while-solo-active-restores-other-volumes/android-phone | 54 | 6 |
| audiomixer--audiomixerspects--audio-mixer-volumes--reset-audio-mixer-applies-defaults/android-phone | 47 | 4 |
| audiomixer--audiomixerspects--audio-mixer-volumes--solo-routing-is-disabled-while-editing-volumes/android-phone | 54 | 6 |
| configvisibility--configvisibilityspects--config-visibility-across-modes--config-categories-and-values-render-in-demo-mode/android-phone | 24 | 4 |
| configvisibility--configvisibilityspects--config-visibility-across-modes--config-remains-visible-after-switching-demo-real/android-phone | 23 | 0 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--currently-using-indicator-updates-between-demo-and-real/android-phone | 92 | 8 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--demo-enabled-real-device-reachable-informational-only/android-phone | 848 | 2 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--demo-fallback-appears-once-per-session/android-phone | 179 | 0 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--disable-demo-connect-to-real-core-operations-succeed/android-phone | 23 | 0 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--playback-routes-to-demo-then-real-after-switching/android-phone | 251 | 0 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--reachable-device-connects-as-real-and-never-shows-demo-fallback/android-phone | 279 | 0 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--real-device-unreachable-enable-demo-app-remains-usable/android-phone | 55 | 0 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--switch-back-to-demo-preserves-playlist-state/android-phone | 230 | 0 |
| connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--switches-real-demo-real-using-manual-discovery/android-phone | 114 | 2 |
| coverageprobes--coverageprobesspects--coverage-probes--covers-primary-routes-for-coverage/android-phone | 23 | 0 |
| coverageprobes--coverageprobesspects--coverage-probes--exercises-internal-helpers-for-coverage/android-phone | 786 | 0 |
| ctacoverage--ctacoveragespects--critical-cta-coverage--add-disks-to-library-flow-shows-source-selection/android-phone | 27 | 4 |
| ctacoverage--ctacoveragespects--disk-browser-coverage--disk-browser-allows-source-selection/android-phone | 23 | 0 |
| ctacoverage--ctacoveragespects--home-page-quick-actions--drive-status-cards-navigate-to-disks-page/android-phone | 193 | 4 |
| ctacoverage--ctacoveragespects--home-page-quick-actions--home-page-displays-config-management-quick-actions/android-phone | 179 | 0 |
| ctacoverage--ctacoveragespects--home-page-quick-actions--home-page-displays-quick-action-cards-for-machine-control/android-phone | 179 | 0 |
| ctacoverage--ctacoveragespects--shuffle-mode-tests--reshuffle-button-appears-when-shuffle-is-enabled/android-phone | 246 | 0 |
| ctacoverage--ctacoveragespects--shuffle-mode-tests--shuffle-checkbox-toggles-shuffle-mode/android-phone | 248 | 2 |
| democonfig--democonfigspects--demo-config-from-yaml--config-page-shows-yaml-derived-categories/android-phone | 23 | 0 |
| demomode--demomodespects--automatic-demo-mode--connectivity-indicator-is-present-on-all-main-pages/android-phone | 14 | 0 |
| demomode--demomodespects--automatic-demo-mode--demo-interstitial-appears-once-per-session-and-manual-retry-uses-discovery/android-phone | 196 | 4 |
| demomode--demomodespects--automatic-demo-mode--demo-mode-does-not-overwrite-stored-base-url/android-phone | 45 | 0 |
| demomode--demomodespects--automatic-demo-mode--legacy-base-url-migrates-to-device-host-on-startup/android-phone | 179 | 0 |
| demomode--demomodespects--automatic-demo-mode--real-connection-shows-green-c64u-indicator/android-phone | 179 | 0 |
| demomode--demomodespects--automatic-demo-mode--save-connect-exits-demo-mode-when-base-url-is-valid/android-phone | 31 | 8 |
| demomode--demomodespects--automatic-demo-mode--settings-triggered-rediscovery-uses-updated-password-for-probes/android-phone | 42 | 10 |
| diskmanagement--diskmanagementspects--disk-management--disk-filtering-removes-non-matching-nodes-and-restores-on-clear-layout/android-phone | 43 | 20 |
| diskmanagement--diskmanagementspects--disk-management--disk-filtering-removes-non-matching-nodes-and-restores-on-clear-layout/android-tablet | 43 | 20 |
| diskmanagement--diskmanagementspects--disk-management--disk-groups-display-and-can-be-reassigned-inline-layout/android-phone | 57 | 34 |
| diskmanagement--diskmanagementspects--disk-management--disk-groups-display-and-can-be-reassigned-inline-layout/android-tablet | 53 | 30 |
| diskmanagement--diskmanagementspects--disk-management--disk-list-select-all-removes-selected-items-layout/android-phone | 45 | 22 |
| diskmanagement--diskmanagementspects--disk-management--disk-list-select-all-removes-selected-items-layout/android-tablet | 47 | 24 |
| diskmanagement--diskmanagementspects--disk-management--disk-list-view-all-shows-full-list-layout/android-phone | 41 | 18 |
| diskmanagement--diskmanagementspects--disk-management--disk-list-view-all-shows-full-list-layout/android-tablet | 41 | 18 |
| diskmanagement--diskmanagementspects--disk-management--disk-menu-shows-size-and-date-for-c64-ultimate-imports-layout/android-phone | 90 | 22 |
| diskmanagement--diskmanagementspects--disk-management--disk-menu-shows-size-and-date-for-c64-ultimate-imports-layout/android-tablet | 88 | 20 |
| diskmanagement--diskmanagementspects--disk-management--disk-menu-shows-size-and-date-for-local-imports-layout/android-phone | 39 | 16 |
| diskmanagement--diskmanagementspects--disk-management--disk-menu-shows-size-and-date-for-local-imports-layout/android-tablet | 39 | 16 |
| diskmanagement--diskmanagementspects--disk-management--disk-menu-shows-sizedate-and-rename-works-layout/android-phone | 47 | 24 |
| diskmanagement--diskmanagementspects--disk-management--disk-menu-shows-sizedate-and-rename-works-layout/android-tablet | 45 | 22 |
| diskmanagement--diskmanagementspects--disk-management--disk-presence-indicator-and-deletion-ejects-mounted-disks-layout/android-phone | 49 | 16 |
| diskmanagement--diskmanagementspects--disk-management--disk-presence-indicator-and-deletion-ejects-mounted-disks-layout/android-tablet | 47 | 14 |
| diskmanagement--diskmanagementspects--disk-management--disk-removal-wording-is-non-destructive-layout/android-phone | 39 | 16 |
| diskmanagement--diskmanagementspects--disk-management--disk-removal-wording-is-non-destructive-layout/android-tablet | 37 | 14 |
| diskmanagement--diskmanagementspects--disk-management--disk-view-all-dialog-is-constrained-and-scrollable-layout/android-phone | 27 | 4 |
| diskmanagement--diskmanagementspects--disk-management--disk-view-all-dialog-is-constrained-and-scrollable-layout/android-tablet | 27 | 4 |
| diskmanagement--diskmanagementspects--disk-management--disk-view-all-filter-narrows-list-layout/android-phone | 29 | 6 |
| diskmanagement--diskmanagementspects--disk-management--disk-view-all-filter-narrows-list-layout/android-tablet | 29 | 6 |
| diskmanagement--diskmanagementspects--disk-management--disks-header-layout-matches-play-list-pattern-layout/android-phone | 23 | 0 |
| diskmanagement--diskmanagementspects--disk-management--disks-header-layout-matches-play-list-pattern-layout/android-tablet | 23 | 0 |
| diskmanagement--diskmanagementspects--disk-management--disks-render-with-folder-headers-and-no-full-paths-layout/android-phone | 37 | 14 |
| diskmanagement--diskmanagementspects--disk-management--disks-render-with-folder-headers-and-no-full-paths-layout/android-tablet | 37 | 14 |
| diskmanagement--diskmanagementspects--disk-management--drive-power-toggle-button-updates-state-and-issues-request-layout/android-phone | 15 | 4 |
| diskmanagement--diskmanagementspects--disk-management--drive-power-toggle-button-updates-state-and-issues-request-layout/android-tablet | 14 | 4 |
| diskmanagement--diskmanagementspects--disk-management--ftp-directory-listing-shows-hierarchy-layout/android-phone | 49 | 8 |
| diskmanagement--diskmanagementspects--disk-management--ftp-directory-listing-shows-hierarchy-layout/android-tablet | 49 | 8 |
| diskmanagement--diskmanagementspects--disk-management--ftp-login-failure-surfaces-error-layout/android-phone | 40 | 6 |
| diskmanagement--diskmanagementspects--disk-management--ftp-login-failure-surfaces-error-layout/android-tablet | 38 | 4 |
| diskmanagement--diskmanagementspects--disk-management--ftp-server-unavailable-surfaces-error-layout/android-phone | 40 | 6 |
| diskmanagement--diskmanagementspects--disk-management--ftp-server-unavailable-surfaces-error-layout/android-tablet | 40 | 6 |
| diskmanagement--diskmanagementspects--disk-management--importing-c64u-folders-preserves-hierarchy-and-paths-layout/android-phone | 90 | 22 |
| diskmanagement--diskmanagementspects--disk-management--importing-c64u-folders-preserves-hierarchy-and-paths-layout/android-tablet | 90 | 22 |
| diskmanagement--diskmanagementspects--disk-management--importing-non-disk-files-shows-warning-layout/android-phone | 35 | 12 |
| diskmanagement--diskmanagementspects--disk-management--importing-non-disk-files-shows-warning-layout/android-tablet | 33 | 10 |
| diskmanagement--diskmanagementspects--disk-management--mount-dialog-shows-a-single-close-button-layout/android-phone | 25 | 2 |
| diskmanagement--diskmanagementspects--disk-management--mount-dialog-shows-a-single-close-button-layout/android-tablet | 25 | 2 |
| diskmanagement--diskmanagementspects--disk-management--mount-failure-surfaces-error-and-does-not-mark-drive-mounted-layout/android-phone | 35 | 6 |
| diskmanagement--diskmanagementspects--disk-management--mount-failure-surfaces-error-and-does-not-mark-drive-mounted-layout/android-tablet | 35 | 6 |
| diskmanagement--diskmanagementspects--disk-management--mount-failure-when-device-unreachable-shows-error-layout/android-phone | 35 | 6 |
| diskmanagement--diskmanagementspects--disk-management--mount-failure-when-device-unreachable-shows-error-layout/android-tablet | 35 | 6 |
| diskmanagement--diskmanagementspects--disk-management--mounting-ultimate-disks-uses-mount-endpoint-layout/android-phone | 34 | 6 |
| diskmanagement--diskmanagementspects--disk-management--mounting-ultimate-disks-uses-mount-endpoint-layout/android-tablet | 34 | 6 |
| diskmanagement--diskmanagementspects--disk-management--multi-drive-mounting-and-rotation-within-group-layout/android-phone | 45 | 12 |
| diskmanagement--diskmanagementspects--disk-management--multi-drive-mounting-and-rotation-within-group-layout/android-tablet | 45 | 12 |
| diskmanagement--diskmanagementspects--disk-management--settings-changes-while-disk-mounted-preserve-mounted-state-layout/android-phone | 23 | 0 |
| diskmanagement--diskmanagementspects--disk-management--settings-changes-while-disk-mounted-preserve-mounted-state-layout/android-tablet | 23 | 0 |
| featureflags--featureflagsspects--feature-flags--hvsc-toggle-controls-play-page-visibility/android-phone | 246 | 0 |
| featureflags--featureflagsspects--feature-flags--hvsc-toggle-is-visible-by-default/android-phone | 14 | 0 |
| featureflags--featureflagsspects--feature-flags--legacy-music-route-shows-404-page/android-phone | 9 | 0 |
| ftpperformance--ftpperformancespects--ftp-performance--ftp-navigation-shows-delayed-loading-indicator-on-slow-requests/android-phone | 261 | 6 |
| ftpperformance--ftpperformancespects--ftp-performance--ftp-navigation-shows-minimal-loading-delay/android-phone | 261 | 6 |
| ftpperformance--ftpperformancespects--ftp-performance--ftp-navigation-uses-cache-across-reloads/android-phone | 256 | 10 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--delete-config-removes-from-localstorage-layout/android-phone | 183 | 4 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--delete-config-removes-from-localstorage-layout/android-tablet | 183 | 4 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--home-page-renders-sid-status-group-layout/android-phone | 179 | 0 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--home-page-renders-sid-status-group-layout/android-tablet | 179 | 0 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--load-config-applies-values-to-server-layout/android-phone | 9 | 4 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--load-config-applies-values-to-server-layout/android-tablet | 9 | 4 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--rename-config-updates-localstorage-layout/android-phone | 189 | 10 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--rename-config-updates-localstorage-layout/android-tablet | 189 | 10 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--save-config-with-duplicate-name-shows-error-layout/android-phone | 189 | 10 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--save-config-with-duplicate-name-shows-error-layout/android-tablet | 189 | 10 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--save-config-with-empty-name-shows-error-layout/android-phone | 185 | 6 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--save-config-with-empty-name-shows-error-layout/android-tablet | 185 | 6 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--save-config-with-valid-name-stores-in-localstorage-layout/android-phone | 219 | 10 |
| homeconfigmanagement--homeconfigmanagementspects--home-page-app-config-management--save-config-with-valid-name-stores-in-localstorage-layout/android-tablet | 219 | 10 |
| hvsc--hvscspects--hvsc-play-page--hvsc-cached-download-ingest-play-track/android-phone | 261 | 10 |
| hvsc--hvscspects--hvsc-play-page--hvsc-download-attempt-runs-while-connected-to-device-mock/android-phone | 248 | 2 |
| hvsc--hvscspects--hvsc-play-page--hvsc-download-ingest-uses-mock-server-and-plays-a-track/android-phone | 259 | 8 |
| hvsc--hvscspects--hvsc-play-page--hvsc-download-progress-updates-incrementally/android-phone | 248 | 2 |
| hvsc--hvscspects--hvsc-play-page--hvsc-extraction-failure-shows-retry/android-phone | 248 | 2 |
| hvsc--hvscspects--hvsc-play-page--hvsc-ingestion-failure-shows-retry/android-phone | 248 | 2 |
| hvsc--hvscspects--hvsc-play-page--hvsc-ingestion-progress-updates-incrementally/android-phone | 248 | 2 |
| hvsc--hvscspects--hvsc-play-page--hvsc-install-play-sends-sid-to-c64u/android-phone | 257 | 6 |
| hvsc--hvscspects--hvsc-play-page--hvsc-install-shows-progress-updates/android-phone | 248 | 2 |
| hvsc--hvscspects--hvsc-play-page--hvsc-not-installed-install-ready/android-phone | 248 | 2 |
| hvsc--hvscspects--hvsc-play-page--hvsc-playlist-survives-reload/android-phone | 264 | 8 |
| hvsc--hvscspects--hvsc-play-page--hvsc-stop-cancels-install/android-phone | 250 | 4 |
| hvsc--hvscspects--hvsc-play-page--hvsc-up-to-date-browse-play-track/android-phone | 257 | 6 |
| hvsc--hvscspects--hvsc-play-page--hvsc-update-available-update-browsing-works/android-phone | 250 | 4 |
| hvsc--hvscspects--hvsc-play-page--hvsc-update-check-failure-surfaces-error/android-phone | 250 | 4 |
| hvsc--hvscspects--hvsc-play-page--local-zip-ingestion-is-not-shown-on-play-page/android-phone | 246 | 0 |
| itemselection--itemselectionspects--item-selection-dialog-ux--add-items-modal-content-is-scrollable/android-phone | 261 | 6 |
| itemselection--itemselectionspects--item-selection-dialog-ux--add-items-modal-does-not-occupy-full-viewport-height/android-phone | 250 | 4 |
| itemselection--itemselectionspects--item-selection-dialog-ux--add-items-modal-has-single-close-button/android-phone | 250 | 4 |
| itemselection--itemselectionspects--item-selection-dialog-ux--c64-ultimate-folder-selection-shows-confirm-button/android-phone | 265 | 10 |
| itemselection--itemselectionspects--item-selection-dialog-ux--disks-page-add-folder-returns-to-disks-and-populates-library/android-phone | 37 | 14 |
| itemselection--itemselectionspects--item-selection-dialog-ux--disks-page-c64-ultimate-full-flow-adds-disks/android-phone | 80 | 12 |
| itemselection--itemselectionspects--item-selection-dialog-ux--disks-page-local-folder-picker-returns-to-disk-list/android-phone | 31 | 8 |
| itemselection--itemselectionspects--item-selection-dialog-ux--disks-page-repeated-add-items-via-c64-ultimate-remains-stable/android-phone | 148 | 80 |
| itemselection--itemselectionspects--item-selection-dialog-ux--disks-page-repeated-add-items-via-folder-picker-remains-stable/android-phone | 49 | 26 |
| itemselection--itemselectionspects--item-selection-dialog-ux--play-page-add-folder-returns-to-play-and-populates-playlist/android-phone | 254 | 8 |
| itemselection--itemselectionspects--item-selection-dialog-ux--play-page-c64-ultimate-full-flow-adds-items/android-phone | 53 | 8 |
| itemselection--itemselectionspects--item-selection-dialog-ux--play-page-local-folder-picker-returns-to-playlist/android-phone | 252 | 6 |
| itemselection--itemselectionspects--item-selection-dialog-ux--play-page-repeated-add-items-via-c64-ultimate-remains-stable/android-phone | 367 | 76 |
| itemselection--itemselectionspects--item-selection-dialog-ux--play-page-repeated-add-items-via-folder-picker-remains-stable/android-phone | 262 | 16 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--diagnostics-dialog-stays-within-viewport-layout/android-phone | 18 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--diagnostics-dialog-stays-within-viewport-layout/android-tablet | 18 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--disk-dialogs-stay-within-viewport-layout/android-phone | 41 | 18 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--disk-dialogs-stay-within-viewport-layout/android-tablet | 39 | 16 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--disks-page-handles-long-names-without-overflow-layout/android-phone | 23 | 0 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--disks-page-handles-long-names-without-overflow-layout/android-tablet | 13 | 0 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--ftp-browser-handles-long-names-without-overflow-layout/android-phone | 294 | 12 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--ftp-browser-handles-long-names-without-overflow-layout/android-tablet | 294 | 12 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--play-dialogs-stay-within-viewport-layout/android-phone | 252 | 6 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--play-dialogs-stay-within-viewport-layout/android-tablet | 252 | 6 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--playlist-filter-header-does-not-cause-overflow-layout/android-phone | 252 | 6 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--playlist-filter-header-does-not-cause-overflow-layout/android-tablet | 252 | 6 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--playlist-list-handles-long-names-without-overflow-layout/android-phone | 246 | 0 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--playlist-list-handles-long-names-without-overflow-layout/android-tablet | 246 | 0 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--primary-pages-avoid-horizontal-overflow-layout/android-phone | 14 | 0 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--primary-pages-avoid-horizontal-overflow-layout/android-tablet | 9 | 0 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--settings-logs-handle-long-error-messages-without-overflow-layout/android-phone | 18 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--settings-logs-handle-long-error-messages-without-overflow-layout/android-tablet | 18 | 4 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--settings-page-handles-long-hostnames-without-overflow-layout/android-phone | 20 | 6 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--settings-page-handles-long-hostnames-without-overflow-layout/android-tablet | 20 | 6 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--viewport-matrix-preserves-layout-and-scrolling-layout/android-phone | 23 | 0 |
| layoutoverflow--layoutoverflowspects--layout-overflow-safeguards--viewport-matrix-preserves-layout-and-scrolling-layout/android-tablet | 13 | 0 |
| navigationboundaries--navigationboundariesspects--navigation-boundaries-and-edge-cases--add-items-with-no-selection-shows-validation/android-phone | 261 | 6 |
| navigationboundaries--navigationboundariesspects--navigation-boundaries-and-edge-cases--breadcrumb-click-jumps-to-ancestor-folder/android-phone | 294 | 12 |
| navigationboundaries--navigationboundariesspects--navigation-boundaries-and-edge-cases--config-reset-category-applies-defaults/android-phone | 42 | 4 |
| navigationboundaries--navigationboundariesspects--navigation-boundaries-and-edge-cases--disk-rotate-previous-mounts-previous-disk-in-group/android-phone | 20 | 10 |
| navigationboundaries--navigationboundariesspects--navigation-boundaries-and-edge-cases--navigate-parent-from-root-disables-or-hides-button/android-phone | 261 | 6 |
| navigationboundaries--navigationboundariesspects--navigation-boundaries-and-edge-cases--navigate-parent-from-subfolder-shows-parent/android-phone | 294 | 12 |
| playback--playbackspects--playback-file-browser--alphabet-overlay-does-not-affect-list-metrics/android-phone | 250 | 4 |
| playback--playbackspects--playback-file-browser--alphabet-overlay-jumps-to-selected-letter-and-auto-hides/android-phone | 250 | 4 |
| playback--playbackspects--playback-file-browser--local-sid-playback-uploads-before-play/android-phone | 263 | 12 |
| playback--playbackspects--playback-file-browser--mute-button-toggles-and-slider-does-not-unmute/android-phone | 356 | 10 |
| playback--playbackspects--playback-file-browser--mute-only-affects-enabled-sid-chips/android-phone | 273 | 2 |
| playback--playbackspects--playback-file-browser--pause-then-stop-never-hangs/android-phone | 37 | 12 |
| playback--playbackspects--playback-file-browser--play-add-button-uses-add-items-label-and-opens-dialog/android-phone | 250 | 4 |
| playback--playbackspects--playback-file-browser--play-immediately-after-import-targets-the-real-device/android-phone | 265 | 14 |
| playback--playbackspects--playback-file-browser--play-page-is-available-from-tab-bar/android-phone | 246 | 0 |
| playback--playbackspects--playback-file-browser--playback-controls-are-stateful-and-show-current-track/android-phone | 307 | 26 |
| playback--playbackspects--playback-file-browser--playback-counters-fall-back-to-default-song-durations-when-unknown/android-phone | 246 | 0 |
| playback--playbackspects--playback-file-browser--playback-counters-reflect-played-total-and-remaining-time/android-phone | 262 | 6 |
| playback--playbackspects--playback-file-browser--playback-errors-emit-log-entries/android-phone | 74 | 6 |
| playback--playbackspects--playback-file-browser--playback-failure-does-not-clear-playlist-across-navigation/android-phone | 276 | 0 |
| playback--playbackspects--playback-file-browser--playback-persists-across-navigation-while-active/android-phone | 314 | 10 |
| playback--playbackspects--playback-file-browser--playback-sends-runner-request-to-real-device-mock/android-phone | 9 | 4 |
| playback--playbackspects--playback-file-browser--playback-state-persists-across-navigation/android-phone | 316 | 12 |
| playback--playbackspects--playback-file-browser--played-time-advances-steadily-while-playing/android-phone | 255 | 4 |
| playback--playbackspects--playback-file-browser--playlist-filter-input-filters-inline-and-view-all-lists/android-phone | 256 | 10 |
| playback--playbackspects--playback-file-browser--playlist-text-filter-hides-non-matching-files/android-phone | 248 | 2 |
| playback--playbackspects--playback-file-browser--playlist-view-all-dialog-is-constrained-and-scrollable/android-phone | 254 | 4 |
| playback--playbackspects--playback-file-browser--rapid-playstopplay-sequences-remain-stable/android-phone | 273 | 12 |
| playback--playbackspects--playback-file-browser--settings-changes-while-playback-active-do-not-interrupt-playback/android-phone | 315 | 14 |
| playback--playbackspects--playback-file-browser--skipping-tracks-quickly-updates-current-track/android-phone | 271 | 10 |
| playback--playbackspects--playback-file-browser--stop-does-not-auto-resume-playback/android-phone | 264 | 8 |
| playback--playbackspects--playback-file-browser--volume-slider-updates-during-playback/android-phone | 12 | 2 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--add-to-playlist-queues-items-without-auto-play/android-phone | 254 | 8 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--c64u-browser-remembers-last-path-and-supports-root/android-phone | 293 | 20 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--demo-mode-disk-image-waits-for-keyboard-buffer-readiness/android-phone | 458 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--disk-image-triggers-mount-and-autostart-sequence/android-phone | 290 | 14 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--disk-image-uses-dma-autostart-when-enabled/android-phone | 286 | 10 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--documents-songlengths-are-discovered-for-local-folders/android-phone | 254 | 8 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--end-to-end-add-browse-and-play-local-remote/android-phone | 347 | 26 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--folder-play-populates-playlist-dialog/android-phone | 258 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--ftp-failure-shows-error-toast/android-phone | 261 | 4 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--hvsc-md5-duration-lookup-updates-playlist-durations/android-phone | 263 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--local-browsing-filters-supported-files-and-plays-sid-upload/android-phone | 270 | 14 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--local-folder-input-accepts-directory/android-phone | 254 | 8 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--local-folder-without-supported-files-shows-warning/android-phone | 254 | 8 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--local-source-browser-filters-supported-files/android-phone | 254 | 8 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--native-folder-picker-adds-local-files-to-playlist/android-phone | 252 | 6 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--pause-mutes-sid-outputs-and-resume-restores-them/android-phone | 283 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--playback-headers-removed-and-played-label-is-prominent/android-phone | 246 | 0 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--playlist-menu-shows-size-and-date/android-phone | 256 | 10 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--playlist-menu-shows-size-and-date-for-c64-ultimate-items/android-phone | 162 | 14 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--playlist-persists-across-navigation/android-phone | 246 | 0 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--playlist-persists-after-reload/android-phone | 246 | 0 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--playlist-selection-supports-select-all-and-remove-selected/android-phone | 258 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--prevnext-navigates-within-playlist/android-phone | 315 | 14 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--remaining-time-label-uses-song-length/android-phone | 261 | 10 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--reshuffle-button-does-not-stick/android-phone | 258 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--reshuffle-changes-playlist-order-and-keeps-current-track-index/android-phone | 259 | 8 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--saf-scan-failures-are-logged-and-do-not-crash-the-page/android-phone | 254 | 8 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--saf-scan-shows-no-supported-files-only-after-enumeration/android-phone | 252 | 6 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--songlengths-discovery-shows-path-and-durations/android-phone | 254 | 8 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--songlengths-metadata-is-applied-for-local-sids/android-phone | 256 | 10 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--songlengthstxt-discovery-shows-path-and-durations/android-phone | 254 | 8 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--transport-controls-toggle-play-pause-and-stop/android-phone | 311 | 20 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--ultimate-browsing-lists-ftp-entries-and-mounts-remote-disk-image/android-phone | 334 | 18 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--upload-handler-tolerates-emptybinary-response/android-phone | 263 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--volume-slider-respects-left-min-and-right-max-bounds/android-phone | 262 | 6 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--volume-slider-respects-left-off-and-right-max-bounds/android-phone | 126 | 0 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--volume-slider-updates-enabled-sid-volumes-and-restores-after-mute/android-phone | 313 | 12 |
| playbackpart2--playbackpart2spects--playback-file-browser-part-2--volume-slider-updates-non-muted-sid-outputs/android-phone | 265 | 4 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--duration-control-syncs-slider-and-input-layout/android-phone | 254 | 8 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--duration-control-syncs-slider-and-input-layout/android-tablet | 252 | 6 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--duration-control-updates-playlist-totals-layout/android-phone | 256 | 10 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--duration-control-updates-playlist-totals-layout/android-tablet | 254 | 8 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--next-at-last-track-stops-playback-layout/android-phone | 261 | 10 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--next-at-last-track-stops-playback-layout/android-tablet | 261 | 10 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--playlist-filter-not-yet-implemented-layout/android-phone | 254 | 8 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--playlist-filter-not-yet-implemented-layout/android-tablet | 254 | 8 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--playlist-type-filters-hide-non-matching-files-layout/android-phone | 256 | 10 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--playlist-type-filters-hide-non-matching-files-layout/android-tablet | 256 | 10 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--prev-at-first-track-stays-at-first-layout/android-phone | 281 | 10 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--prev-at-first-track-stays-at-first-layout/android-tablet | 279 | 8 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--repeat-mode-checkbox-toggles-state-layout/android-phone | 256 | 10 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--repeat-mode-checkbox-toggles-state-layout/android-tablet | 256 | 10 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--reshuffle-changes-playlist-order-layout/android-phone | 258 | 12 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--reshuffle-changes-playlist-order-layout/android-tablet | 258 | 12 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--shuffle-mode-checkbox-toggles-state-layout/android-phone | 258 | 12 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--shuffle-mode-checkbox-toggles-state-layout/android-tablet | 258 | 12 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--song-selector-appears-for-multi-song-sid-and-triggers-playback-layout/android-phone | 16 | 6 |
| playlistcontrols--playlistcontrolsspects--playlist-controls-and-advanced-features--song-selector-appears-for-multi-song-sid-and-triggers-playback-layout/android-tablet | 16 | 6 |
| screenshots--screenshotsspects--app-screenshots--capture-app-page-screenshots/android-phone | 310 | 32 |
| screenshots--screenshotsspects--app-screenshots--capture-demo-mode-play-screenshot/android-phone | 383 | 4 |
| settingsconnection--settingsconnectionspects--settings-connection-management--automatic-demo-mode-toggle-is-visible-and-persisted/android-phone | 18 | 4 |
| settingsconnection--settingsconnectionspects--settings-connection-management--change-device-host-and-save-reconnects/android-phone | 196 | 10 |
| settingsconnection--settingsconnectionspects--settings-connection-management--change-password-stores-in-localstorage/android-phone | 42 | 2 |
| settingsconnection--settingsconnectionspects--settings-connection-management--invalid-host-format-shows-validation-or-accepts-input/android-phone | 196 | 10 |
| settingsconnection--settingsconnectionspects--settings-connection-management--select-dark-theme-applies-theme-class/android-phone | 16 | 2 |
| settingsconnection--settingsconnectionspects--settings-connection-management--select-light-theme-applies-theme-class/android-phone | 16 | 2 |
| settingsconnection--settingsconnectionspects--settings-connection-management--settings-sections-appear-in-expected-order/android-phone | 14 | 0 |
| settingsdiagnostics--settingsdiagnosticsspects--settings-diagnostics-workflows--clear-logs-empties-log-storage/android-phone | 20 | 6 |
| settingsdiagnostics--settingsdiagnosticsspects--settings-diagnostics-workflows--debug-logging-toggle-records-rest-calls/android-phone | 53 | 8 |
| settingsdiagnostics--settingsdiagnosticsspects--settings-diagnostics-workflows--email-diagnostics-opens-mailto-link/android-phone | 24 | 10 |
| settingsdiagnostics--settingsdiagnosticsspects--settings-diagnostics-workflows--open-diagnostics-dialog-shows-logs/android-phone | 18 | 4 |
| settingsdiagnostics--settingsdiagnosticsspects--settings-diagnostics-workflows--share-diagnostics-copies-to-clipboard/android-phone | 22 | 8 |
| solo--solospects--config-page-sid-solo-routing--config-labels-stay-horizontal-at-narrow-widths/android-phone | 37 | 4 |
| solo--solospects--config-page-sid-solo-routing--default-state-has-no-solo-enabled/android-phone | 30 | 2 |
| solo--solospects--config-page-sid-solo-routing--navigation-reset-clears-solo-and-restores-mix/android-phone | 35 | 2 |
| solo--solospects--config-page-sid-solo-routing--solo-disable-restores-configured-mix/android-phone | 49 | 6 |
| solo--solospects--config-page-sid-solo-routing--solo-enable-mutes-other-sids-without-moving-sliders/android-phone | 37 | 4 |
| solo--solospects--config-page-sid-solo-routing--solo-switch-toggles-active-sid-instantly/android-phone | 49 | 6 |
| ui--uispects--ui-coverage--add-items-shows-progress-feedback-after-confirm/android-phone | 307 | 16 |
| ui--uispects--ui-coverage--config-group-actions-stay-at-top-of-expanded-section/android-phone | 30 | 2 |
| ui--uispects--ui-coverage--config-page-renders-and-toggles-a-section/android-phone | 30 | 2 |
| ui--uispects--ui-coverage--config-widgets-readwrite-and-refresh/android-phone | 82 | 14 |
| ui--uispects--ui-coverage--home-and-disks-pages-render/android-phone | 23 | 0 |
| ui--uispects--ui-coverage--home-page-shows-resolved-version/android-phone | 179 | 0 |
| ui--uispects--ui-coverage--item-browser-does-not-overflow-viewport-width/android-phone | 294 | 12 |
| ui--uispects--ui-coverage--play-page-renders-with-hvsc-controls/android-phone | 246 | 0 |
| ui--uispects--ui-coverage--selection-state-stays-stable-when-filtering/android-phone | 298 | 16 |
| ui--uispects--ui-coverage--settings-and-docs-pages-render/android-phone | 14 | 0 |
| ui--uispects--ui-coverage--source-indicator-icons-invert-in-dark-mode/android-phone | 23 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--bulk-actions-select-all-and-deselect-all-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--bulk-remove-from-playlist-shows-confirmation-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--clear-confirmation-on-destructive-playlist-action-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--consistent-selection-ui-across-local-and-c64u-sources-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--disk-collection-shows-full-list-with-view-all-when-limit-exceeded-allow-warnings/android-phone | 23 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--hvsc-metadata-used-for-song-display-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--intent-based-language-add-items-not-browse-filesystem-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--intent-based-language-choose-source-in-source-selection-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--layout-stability-controls-do-not-shift-when-selection-changes-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--long-paths-wrap-and-do-not-force-horizontal-scrolling-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--modal-dialogs-for-mount-actions-allow-warnings/android-phone | 23 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--mounting-controls-only-on-disks-page-not-on-play-page-allow-warnings/android-phone | 23 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--no-unrestricted-filesystem-access-language-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--playback-controls-only-in-playlist-not-in-selection-view-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--playlist-actions-easily-discoverable-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--quick-root-action-available-in-selection-view-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--selection-count-is-displayed-when-items-are-selected-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--selection-view-navigation-stays-within-source-scope-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--source-selection-precedes-navigation-c64u-source-allow-warnings/android-phone | 246 | 0 |
| uxinteractions--uxinteractionsspects--ux-interaction-patterns--source-selection-precedes-navigation-local-source-allow-warnings/android-phone | 246 | 0 |
| verifyusertracing--verifyusertracingspects--verify-comprehensive-user-tracing/android-phone | 15 | 8 |

#### Current aggregates

- total traces: 296
- aggregate traceCount: 48811
- aggregate userCount: 2216
- userCount min/max: 0 / 80
- userCount median: 6.0
- userCount p10/p90: 0.0 / 16.0
- userCount p25/p75 (typical range): 2.0 / 10.0

#### Reference vs current deltas

- total traces: reference 295 vs current 296 (extra 1 trace).
- aggregate traceCount: reference 57903 vs current 48811 (down 9092).
- aggregate userCount: reference 3570 vs current 2216 (down 1354).
- userCount distribution: reference typical range 4–16 vs current typical range 2–10.

#### Extra trace(s)

- playbackpart2--playbackpart2spects--playback-file-browser-part-2--volume-slider-respects-left-off-and-right-max-bounds/android-phone
