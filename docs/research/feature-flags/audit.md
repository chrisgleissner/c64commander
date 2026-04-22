# Feature Flag Audit

## Scope

This audit evaluates a minimal operational feature-flag set for C64 Commander.

- Primary map: `docs/features-by-page.md`
- Registry under governance: `src/lib/config/feature-flags.yaml`
- Audit standard: a flag is valid only when its OFF path leaves a usable app, isolates non-core or failure-prone behavior, provides real mitigation value, and has a safe degraded mode.

## Method

Priority order used for the audit:

1. Telnet-dependent logic, especially when chained with REST or FTP.
2. Background-execution and locked-screen playback behavior.
3. Known high-risk flows from the feature surface: playback transitions, volume/mute race handling, connection lifecycle, HVSC lifecycle, and disk mount synchronization.
4. Poorly tested or partially covered surfaces.
5. Non-MVP or diagnostics-only surfaces.

For each candidate below, conclusions are grounded in live code paths and verified test files, not only the feature-surface document.

## Candidate Ledger

### 1. Background playback execution

- Feature surface mapping: Play -> Track progress and auto-advance
- Code locations:
  - `src/pages/PlayFilesPage.tsx`
  - `src/lib/native/backgroundExecutionManager.ts`
  - `src/lib/native/backgroundExecution.ts`
- Classification:
  - background-execution
  - complex/brittle
- External dependencies:
  - native `BackgroundExecution` plugin
  - app lifecycle visibility changes
- Risk description:
  - Playback relies on JS duration timing, with Android background execution used only to preserve lock-screen auto-advance and due-time wakeups.
  - The current code already treats plugin failure as non-fatal and explicitly tells the user that foreground playback continues.
- Verified test coverage:
  - `tests/unit/playFiles/usePlaybackController.autoAdvance.test.tsx`
  - `tests/unit/playFiles/usePlaybackController.test.tsx`
  - `tests/unit/playFiles/usePlaybackPersistence.test.tsx`
  - `tests/unit/lib/native/backgroundExecution.web.test.ts`
  - `.maestro/edge-auto-advance-lock.yaml`
  - `.maestro/smoke-background-execution.yaml`
- Evaluation:
  - Core functionality: NO
  - App usable when disabled: YES, in foreground-only mode
  - Real mitigation value: YES, isolates OEM and native-plugin failures without disabling playback itself
  - Safe degraded mode: YES, foreground playback remains while background auto-advance may stop under lock
  - Realistic production disable case: YES
- Decision: ACCEPTED

### 2. HVSC lifecycle

- Feature surface mapping: Play -> Manage HVSC lifecycle; Source selection, browsing, import
- Code locations:
  - `src/pages/PlayFilesPage.tsx`
  - `src/pages/playFiles/hvscControlsVisibility.ts`
  - `src/pages/playFiles/components/HvscManager.tsx`
  - `src/pages/playFiles/hooks/useHvscLibrary.ts`
- Classification:
  - complex/brittle
  - non-core
- External dependencies:
  - native HVSC bridge and archive preparation flow
  - local indexing and metadata state
- Risk description:
  - HVSC is a long-running native archive lifecycle with download, ingest, preparation, retry, and reset paths.
  - The current `hvsc_enabled` flag is only partial: it hides the HVSC manager card but does not remove HVSC from Add Items source groups or prevent the preparation sheet from opening.
- Verified test coverage:
  - `playwright/hvsc.spec.ts`
  - `tests/unit/playFiles/useHvscLibrary.test.tsx`
  - `tests/unit/hvsc/*.test.ts`
  - `.maestro/smoke-hvsc.yaml`
  - `.maestro/edge-hvsc-ingest-lifecycle.yaml`
- Evaluation:
  - Core functionality: NO
  - App usable when disabled: YES, Local and C64U playback remain
  - Real mitigation value: YES, disables a long-running native/archive subsystem cleanly
  - Safe degraded mode: YES, remove HVSC source and lifecycle entrypoints entirely
  - Realistic production disable case: YES
- Decision: ACCEPTED by extending existing `hvsc_enabled` semantics instead of adding a new flag

### 3. Home Telnet machine controls

- Feature surface mapping: Home -> Run machine actions; Run overflow machine actions
- Code locations:
  - `src/pages/HomePage.tsx`
  - `src/hooks/useTelnetActions.ts`
  - `src/lib/deviceControl/deviceControl.ts`
- Classification:
  - Telnet-dependent
  - complex/brittle
- External dependencies:
  - Telnet session lifecycle
  - some REST fallback paths
- Risk description:
  - Telnet actions sit inside the core machine-control surface, alongside reboot, menu, power, and printer/drive actions.
  - Several flows share the same page-local busy-state and device-control assumptions.
- Verified test coverage:
  - `playwright/homeInteractivity.spec.ts`
  - `tests/unit/pages/HomePage.ramActions.test.tsx`
- Evaluation:
  - Core functionality: YES for the machine-control surface as exposed on Home
  - App usable when disabled: only partially; this would remove a meaningful portion of Home's core operational controls
  - Real mitigation value: not enough to justify a new permanent governance surface here
  - Safe degraded mode: not clearly bounded without fragmenting core machine control
  - Realistic production disable case: weak
- Decision: REJECTED

### 4. Telnet-backed config-file snapshot workflow

- Feature surface mapping: Home -> Manage device/app configs
- Code locations:
  - `src/pages/HomePage.tsx`
  - `src/lib/config/configTelnetWorkflow.ts`
  - `src/lib/config/configSnapshotStorage.ts`
- Classification:
  - Telnet-dependent
  - complex/brittle
  - poorly tested
- External dependencies:
  - FTP temp-file exchange
  - Telnet menu automation
  - native snapshot storage
- Risk description:
  - This workflow is brittle because it chains native storage, FTP temp files, and Telnet automation.
  - It is adjacent to simpler flash and app-local config actions that remain usable without it.
- Verified test coverage:
  - partial indirect Home coverage from `playwright/homeConfigManagement.spec.ts`
  - no dedicated feature-flag or isolated workflow regression found in the current targeted reads
- Evaluation:
  - Core functionality: NO
  - App usable when disabled: YES
  - Real mitigation value: POSSIBLE
  - Safe degraded mode: POSSIBLE
  - Realistic production disable case: POSSIBLE
- Decision: REJECTED for this pass
  - Reason: the workflow may justify a future flag, but the current code does not present a sufficiently isolated, already-cohesive feature boundary in the time-budgeted audit slice, and the task requires fewer, stronger flags over speculative additions.

### 5. REU snapshot workflow

- Feature surface mapping: Home -> Save/load RAM and REU images
- Code locations:
  - `src/pages/HomePage.tsx`
  - `src/lib/reu/reuTelnetWorkflow.ts`
- Classification:
  - Telnet-dependent
  - complex/brittle
  - non-core
- External dependencies:
  - FTP temp files
  - Telnet session automation
  - native storage
- Risk description:
  - REU save and restore is long-running and hardware-sensitive.
  - This workflow is already isolated by the existing `reu_snapshot_enabled` flag in Home and snapshot-manager composition.
- Verified test coverage:
  - `playwright/homeRamDumpFolder.spec.ts`
  - `tests/unit/pages/HomePage.ramActions.test.tsx`
- Evaluation:
  - Existing relevant flag already present: YES
  - New flag needed: NO
- Decision: REJECTED as a new candidate; keep existing `reu_snapshot_enabled`

### 6. Volume and mute race handling

- Feature surface mapping: Play -> Control volume and mute
- Code locations:
  - `src/pages/PlayFilesPage.tsx`
  - `src/pages/playFiles/hooks/usePlayFilesVolumeBindings.ts`
- Classification:
  - complex/brittle
- External dependencies:
  - audio-mixer config writes
- Risk description:
  - The logic is timing-sensitive and regression-prone, but it is part of normal playback control rather than an optional subsystem.
- Verified test coverage:
  - `playwright/playback.spec.ts`
  - `playwright/playback.part2.spec.ts`
  - `tests/unit/playFiles/volumeMuteRace.test.ts`
  - `.maestro/edge-volume-mute-race.yaml`
- Evaluation:
  - Core functionality: YES
  - App usable when disabled: NO in a meaningful playback sense
- Decision: REJECTED

### 7. Disk mount synchronization

- Feature surface mapping: Disks -> Mount/eject disk; Rotate grouped disks
- Code locations:
  - `src/components/disks/HomeDiskManager.tsx`
  - `src/lib/disks/diskMount.ts`
- Classification:
  - complex/brittle
  - state-sensitive
- External dependencies:
  - drive REST endpoints
  - local runtime files for uploads
- Risk description:
  - Mounted-drive state merges optimistic overrides with polled device state and library metadata.
  - This is a genuine risk area but is also the core purpose of the Disks page.
- Verified test coverage:
  - `playwright/diskManagement.spec.ts`
  - `tests/unit/diskMount.test.ts`
  - `tests/unit/hooks/useDiskLibrary.test.ts`
  - `tests/unit/disks/diskGrouping.test.ts`
- Evaluation:
  - Core functionality: YES
  - App usable when disabled: NO for the page's core responsibility
- Decision: REJECTED

### 8. Diagnostics overlay and runtime

- Feature surface mapping: Settings/Home diagnostics overlay surfaces; diagnostics deep links
- Code locations:
  - `src/App.tsx`
  - `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
  - `src/components/UnifiedHealthBadge.tsx`
  - `src/lib/diagnostics/**`
- Classification:
  - non-MVP
  - diagnostics-only
  - complex/brittle
- External dependencies:
  - logging bridge
  - route-to-overlay mapping
  - health checks and export tooling
- Risk description:
  - Diagnostics is broad, always mounted, and intertwined with badge affordances, deep links, and trace/export state.
  - It is non-core, but the current code suggests a larger integration surface than a minimal operational flag should take on in this pass.
- Verified test coverage:
  - `playwright/homeDiagnosticsOverlay.spec.ts`
  - `playwright/demoMode.spec.ts`
  - multiple diagnostics unit tests under `tests/unit/diagnostics/**`
- Evaluation:
  - Core functionality: NO
  - App usable when disabled: YES
  - Real mitigation value: YES
  - Safe degraded mode: not yet clean enough from the current mount/routing/readiness evidence
  - Realistic production disable case: YES
- Decision: REJECTED for this pass
  - Reason: viable in principle, but the current code shape would require a broader cross-cutting change than the minimal accepted set.

### 9. Saved-device quick switcher

- Feature surface mapping: header long-press switch device and diagnostics connection actions
- Code locations:
  - `src/components/UnifiedHealthBadge.tsx`
  - `src/components/diagnostics/ConnectionActionsRegion.tsx`
  - `src/pages/SettingsPage.tsx`
- Classification:
  - non-MVP
  - diagnostics-only
- Risk description:
  - This is a convenience flow, but saved-device management and switching also exist in Settings.
- Verified test coverage:
  - code-path verification only in the current audit slice; no dedicated coverage summary added here
- Evaluation:
  - Core functionality: NO
  - App usable when disabled: YES
  - Real mitigation value: weak compared with accepted candidates
- Decision: REJECTED

## Accepted Flag Definitions

### `hvsc_enabled`

- Status: existing flag, semantics must be tightened
- Default: `true`
- Scope:
  - HVSC source-group inclusion in Add Items
  - HVSC preparation sheet entrypoints
  - HVSC manager controls and reset/reindex/download/ingest actions
  - HVSC-specific browse handoff on Play
- ON behavior:
  - current HVSC lifecycle remains available
- OFF behavior:
  - remove HVSC source from Add Items
  - prevent HVSC preparation sheet from opening
  - hide HVSC manager section
  - leave Local and C64U playback intact
- Degraded behavior:
  - Play operates without HVSC as a source
- Failure modes mitigated:
  - native archive-preparation failures
  - long-running ingest/download issues
  - HVSC-specific support incidents

### `background_execution_enabled`

- Status: new
- Default: `true`
- Proposed authoring:
  - `visible_to_user: false`
  - `developer_only: true`
  - `group: experimental`
- Scope:
  - `src/pages/PlayFilesPage.tsx`
  - `src/lib/native/backgroundExecutionManager.ts`
  - any direct `BackgroundExecution.setDueAtMs` calls tied to playback session lifecycle
- ON behavior:
  - current native background execution start/stop and due-time scheduling remain active
- OFF behavior:
  - never start the background-execution plugin
  - never push due-time updates to the native background-execution bridge
  - keep foreground playback, pause/resume, and in-app auto-advance logic intact
- Degraded behavior:
  - foreground-only playback; lock-screen or suspended-app auto-advance may stop until the app resumes
- Failure modes mitigated:
  - OEM wake-lock/plugin instability
  - native background bridge failures
  - operational incidents where background playback support must be disabled without removing playback itself

## Minimal Set Conclusion

The audit found one new high-value operational flag and one existing flag whose semantics needed tightening.

- New flag to add: `background_execution_enabled`
- Existing flag to extend: `hvsc_enabled`

All other reviewed areas were rejected because they either govern core functionality, lack a sufficiently bounded OFF path, or would broaden the flag surface more than the operational value justifies.
