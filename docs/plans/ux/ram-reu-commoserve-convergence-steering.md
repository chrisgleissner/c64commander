# RAM / REU / CommoServe Convergence Steering

ROLE

You are a senior TypeScript + React + Capacitor engineer working on C64 Commander. Converge the Home RAM actions, REU snapshot workflow, and CommoServe search UX onto one coherent implementation. Fix root causes, preserve the app's existing UX architecture, and add regression coverage for every bug fix.

This repository has strict execution rules. Follow `AGENTS.md` and `.github/copilot-instructions.md` first.

READ FIRST

Read the smallest relevant set before editing:

1. `README.md`
2. `.github/copilot-instructions.md`
3. `AGENTS.md`
4. `docs/ux-guidelines.md`
5. `docs/c64/c64u-rest-api.md`
6. `docs/c64/c64u-config.yaml`
7. `docs/c64/c64u-ftp.md`
8. `docs/c64/c64u-telnet.yaml`
9. `docs/c64/telnet/c64u-telnet-spec.md`
10. `docs/c64/telnet/c64u-telnet-integration-spec.md`
11. `docs/c64/telnet/c64u-telnet-integration-spec-addendum-1.md`
12. `src/pages/HomePage.tsx`
13. `src/pages/home/components/MachineControls.tsx`
14. `src/pages/home/dialogs/SaveRamDialog.tsx`
15. `src/pages/home/dialogs/SnapshotManagerDialog.tsx`
16. `src/pages/home/dialogs/RestoreSnapshotDialog.tsx`
17. `src/lib/deviceControl/deviceControl.ts`
18. `src/lib/machine/ramOperations.ts`
19. `src/lib/machine/ramDumpStorage.ts`
20. `src/lib/snapshot/snapshotStore.ts`
21. `src/lib/snapshot/snapshotTypes.ts`
22. `src/lib/ftp/ftpClient.ts`
23. `src/lib/native/ftpClient.ts`
24. `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt`
25. `ios/App/App/IOSFtp.swift`
26. `src/lib/telnet/telnetTypes.ts`
27. `src/lib/telnet/telnetActionExecutor.ts`
28. `src/lib/telnet/telnetMenuNavigator.ts`
29. `src/components/archive/OnlineArchiveDialog.tsx`
30. `src/hooks/useOnlineArchive.ts`
31. `src/lib/archive/client.ts`
32. `tests/unit/pages/HomePage.ramActions.test.tsx`
33. `tests/unit/pages/home/components/MachineControls.test.tsx`
34. `tests/unit/pages/home/dialogs/SaveRamDialog.test.tsx`

TASK CLASSIFICATION

Treat the implementation work as `DOC_PLUS_CODE` and `UI_CHANGE`.

- Executable behavior changes.
- Visible Home and CommoServe UI changes.
- Screenshot refreshes may be required, but only for the smallest affected subset.

DEVICE AND CODE REALITY

Build the solution around these facts:

1. REST exposes `PUT /v1/machine:reboot`. There is no documented REST power-cycle endpoint.
2. Telnet `Power & Reset` exposes `Reboot C64`, `Reboot (Clr Mem)`, `Power Cycle`, and `Save REU Memory`.
3. Telnet file-entry context menus expose `Load into REU` and `Preload on Startup`.
4. The config tree exposes `REU Preload`, `REU Preload Image`, and `REU Preload Offset`.
5. The app currently supports FTP list/read, but not FTP upload/write.
6. The current snapshot store is localStorage-backed and only models `program`, `basic`, `screen`, and `custom`.
7. CommoServe preset values come from one direct-HTTP endpoint: `GET /leet/search/aql/presets`.
8. Web has no raw TCP Telnet support in this app.

IMPLEMENTATION GOAL

After this work, Home RAM controls, REU save/restore, and CommoServe preset loading must feel like one deliberate system:

1. Quick actions use the correct transport consistently.
2. REU snapshots behave like first-class snapshots from the user's point of view.
3. Large REU binaries are handled safely on the local device.
4. Long-running REU work shows clear progress.
5. CommoServe opens instantly with sensible values, then quietly converges to live server data.

HOME QUICK ACTIONS

Implement this exact behavior:

1. Primary `Reboot` uses REST only:
   - `PUT /v1/machine:reboot`
   - No Telnet
   - No RAM clearing
2. Primary `Power Cycle` uses Telnet only.
3. Overflow `Reboot (Clear RAM)`:
   - Prefer Telnet `rebootClearMemory`
   - Fall back to REST clear-RAM-then-reboot if Telnet is unavailable or fails
4. Remove overflow `Reboot (Keep RAM)`.
5. `Save REU` remains available from overflow, but it must become the full staged REU workflow described below, not a bare Telnet fire-and-forget action.

REU STORAGE MODEL

Do not store REU binaries in the existing app snapshot store.

Required local-device model:

1. Reuse the existing RAM dump folder permission model if it can safely host REU snapshot files.
2. Store REU snapshots as real files on the local device.
3. If labels, timestamps, or indexing metadata are needed, keep only lightweight metadata in app storage.
4. Keep ordinary C64 RAM snapshots on their existing path unless a migration is clearly required.

This is mandatory because REU snapshots are too large and too binary-heavy for the current localStorage-backed snapshot model.

REU SAVE WORKFLOW

Implement `Save REU` as a real multi-stage workflow:

1. Ensure the local snapshot folder is configured on native platforms.
2. Connect to the C64U over FTP and Telnet.
3. Navigate Telnet to `/Temp`.
4. Trigger `Save REU Memory`.
5. Detect the new `.reu` file created in `/Temp`.
6. FTP-download that exact file to the local snapshot folder.
7. Surface the saved REU snapshot in the restore UI.
8. Clean up the remote `/Temp` file only if cleanup is safe and well-supported.

Do not ship a solution that saves REU only on the device and leaves the app without a persistent local copy.

REU RESTORE WORKFLOW

`Load RAM` must support REU snapshot restore.

When the user restores an REU snapshot:

1. Show a modal with exactly these options:
   - `Load into REU`
   - `Preload on Startup`
2. After the user chooses one:
   - FTP-upload the local `.reu` file to C64U `/Temp`
   - Open Telnet
   - Navigate to `/Temp`
   - Select the uploaded file
   - Open its context menu with `ENTER`
   - Execute the chosen action

Baseline rule:

1. Both REU restore options must work through FTP staging plus Telnet selection.

Optional optimization:

1. `Preload on Startup` may later be implemented through REST config writes to `REU Preload`, `REU Preload Image`, and `REU Preload Offset`, plus reboot.
2. Do not use that path in this task unless it is proven equivalent on real hardware and preserves the exact same user-facing flow.

LOAD RAM UI

Converge `Load RAM` into one restore surface:

1. Existing C64 RAM snapshots remain restorable.
2. REU snapshots appear in the same overall restore surface.
3. REU entries must be clearly distinguishable.
4. Add an `REU` filter or another equally clear grouping mechanism.
5. Non-REU snapshots keep the current restore behavior.
6. REU snapshots use the new two-option restore modal instead of the current overwrite-confirmation modal.

PROGRESS AND BUSY UX

REU save/restore plus FTP transfer takes about 30 seconds. The UI must treat this as a long-running workflow.

Add one shared progress surface with explicit stage reporting.

Minimum stages:

1. Preparing local snapshot folder
2. Connecting to C64U
3. Saving or uploading snapshot
4. Transferring snapshot over FTP
5. Applying REU action on C64U
6. Finalizing local metadata

Rules:

1. Use determinate progress when bytes transferred are known.
2. Use stage-based progress otherwise.
3. Disable conflicting Home machine actions while a REU workflow is active.
4. Tell the user explicitly that this can take around 30 seconds.
5. Log every stage transition and failure with context.

FTP SUPPORT PREREQUISITE

REU save/restore requires FTP upload support. Add it first.

Required scope:

1. JS/native types in `src/lib/native/ftpClient.ts`
2. Shared wrapper support in `src/lib/ftp/ftpClient.ts`
3. Android native upload implementation
4. iOS native upload implementation
5. Web handling only if the platform can actually support the required end-to-end flow; otherwise gate unsupported UI cleanly
6. Tests for upload success, login failure, timeout, overwrite behavior, and error propagation

COMMOSERVE

Use direct HTTP, not Telnet, for CommoServe search presets and results.

Required behavior:

1. On first open, show seeded values instantly:
   - Category: `Apps`, `Demos`, `Games`, `Graphics`, `Music`
   - Date: `1980` through `currentYear`
   - Type: `crt`, `d64`, `d71`, `d81`, `sid`, `t64`, `tap`
   - Sort: `Name`, `Year`
   - Order: `Ascending`, `Descending`
2. On first open per app launch, make one background `getPresets()` request.
3. Replace the seed values with the returned values if the request succeeds.
4. Cache the refreshed values in memory until the app restarts.
5. If the background refresh fails, keep the seeded values and do not block the user.
6. Show this text immediately above the Search button:
   - `You agree you have a necessary license or rights to download any software.`

Do not issue one request per preset type. The server already returns the full preset set in one response.

CONVERGENCE RULES

Strong convergence is mandatory.

1. Do not leave partial REU support.
2. Do not leave one REU path local-only and the other device-only.
3. Do not keep stale alternate flows in the UI.
4. Do not add special-case UX that breaks the Home snapshot mental model.
5. Do not regress current working quick-action routing.
6. Do not replace direct-HTTP CommoServe with Telnet CommoServe.
7. Do not expose unsupported Telnet-dependent REU flows on web as if they were available.

CURRENT CODE TO ALIGN

The implementation must align the codebase and docs with the intended final state.

Important current-state notes:

1. `HomePage` already routes `Power Cycle` through Telnet.
2. `HomePage` already routes primary `Reboot` through REST reboot.
3. `HomePage` already handles `Reboot (Clear RAM)` as Telnet-first with REST fallback.
4. `docs/ux-interactions.md` and `docs/features-by-page.md` are stale around some of these behaviors.
5. `useOnlineArchive` currently fetches presets on hook mount and does not provide the required app-session seed-plus-refresh cache behavior.
6. The FTP stack currently cannot upload files.

LIKELY FILES TO TOUCH

Expect changes in some combination of:

1. `src/pages/HomePage.tsx`
2. `src/pages/home/components/MachineControls.tsx`
3. `src/pages/home/dialogs/SaveRamDialog.tsx`
4. `src/pages/home/dialogs/SnapshotManagerDialog.tsx`
5. `src/pages/home/dialogs/RestoreSnapshotDialog.tsx`
6. `src/lib/deviceControl/deviceControl.ts`
7. `src/lib/machine/ramDumpStorage.ts`
8. `src/lib/snapshot/*`
9. `src/lib/ftp/ftpClient.ts`
10. `src/lib/native/ftpClient.ts`
11. `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt`
12. `ios/App/App/IOSFtp.swift`
13. `src/lib/telnet/*`
14. `src/hooks/useOnlineArchive.ts`
15. `src/components/archive/OnlineArchiveDialog.tsx`
16. `tests/unit/pages/HomePage.ramActions.test.tsx`
17. `tests/unit/pages/home/components/MachineControls.test.tsx`
18. new tests for REU snapshot storage/indexing, save orchestration, restore orchestration, and FTP upload support

VALIDATION

At minimum, the implementation must include:

1. Regression tests for Home quick-action routing and fallback behavior
2. Tests for REU save orchestration
3. Tests for REU restore orchestration
4. Tests proving REU binaries are not stored in the old snapshot store
5. Tests for CommoServe seeded presets plus single-request background refresh caching
6. Tests for the license notice placement
7. Native or unit coverage for FTP upload behavior where possible
8. `npm run test:coverage` with global branch coverage still `>= 91%`

If UI changes affect documentation screenshots, regenerate only the smallest affected subset under `docs/img/`.

ACCEPTANCE CRITERIA

1. The Home quick-action transport matrix matches this prompt exactly.
2. `Reboot (Keep RAM)` no longer exists in the overflow menu.
3. REU save creates the snapshot on C64U `/Temp`, transfers it to the local device, and exposes it for later restore.
4. REU restore stages the local file back to C64U `/Temp` and applies the chosen action through Telnet.
5. The REU workflow is filesystem-backed on the local device, not localStorage-backed.
6. Long-running REU operations show clear progress and block conflicting actions.
7. CommoServe opens with immediate preset values, refreshes them once in the background per app launch, and keeps the legal notice above Search.
8. Unsupported web REU/Telnet flows are clearly gated rather than falsely advertised.
