# Review 14: Telnet, CommoServe, HVSC, and Interactive REST Performance Audit

Date: 2026-03-30
Classification: DOC_ONLY
Scope: telnet-based flows, CommoServe flow, HVSC download -> ingest -> playlist -> playback flow, and slow interactive REST writes such as LED color changes
Method: failure-first code audit only; no production changes; no builds, tests, or screenshots executed

## 1. Executive Summary

This review started from an intentionally harsh assumption: treat the recently added telnet, CommoServe, and HVSC flows as if they do not work, then inspect the codebase for the most likely reasons.

The result is not "nothing works." The codebase already contains substantial implementation and much better telnet observability than the previous review described. The larger risks now are convergence gaps, brittle workflow assumptions, and one confirmed performance issue in the lighting sliders.

Readiness level:

- Telnet core stack: usable, but not yet fully converged at the Home action model and still brittle in menu/file-browser workflows
- CommoServe: functional path exists, but the add-to-playlist execution model is likely to feel stalled or unresponsive under real network conditions
- HVSC: significantly more complete and better covered than assumed, but state/UX semantics are muddy around download vs ingest/install
- Interactive REST writes: LED slider lag has a concrete code-level cause

Highest-priority risks:

- the Home reboot model needs to be documented and tested as a split model: primary REST reboot, overflow telnet clear-RAM reboot
- telnet file-browser workflows depend on fixed menu labels and screen progression assumptions
- CommoServe downloads binaries during playlist add, sequentially, with no end-to-end cancellation
- LED sliders perform duplicate immediate writes by design, which is a credible root cause for the observed lag

## 2. What Is Already In Better Shape Than Expected

- Telnet diagnostics and tracing are no longer missing in the way described by Review 13. [`src/hooks/useTelnetActions.ts`](../../../src/hooks/useTelnetActions.ts), [`src/lib/tracing/traceSession.ts`](../../../src/lib/tracing/traceSession.ts), [`src/lib/diagnostics/healthModel.ts`](../../../src/lib/diagnostics/healthModel.ts), [`src/lib/diagnostics/actionSummaries.ts`](../../../src/lib/diagnostics/actionSummaries.ts), and [`src/components/diagnostics/DiagnosticsDialog.tsx`](../../../src/components/diagnostics/DiagnosticsDialog.tsx) now model telnet as a first-class subsystem.
- The telnet action inventory is broader than the prior review stated. [`src/lib/telnet/telnetTypes.ts`](../../../src/lib/telnet/telnetTypes.ts) includes developer actions such as `clearDebugLog`, `saveDebugLog`, and `saveEdidToFile`.
- HVSC already has meaningful automated coverage beyond unit tests. There is dedicated Playwright coverage in [`playwright/hvsc.spec.ts`](../../../playwright/hvsc.spec.ts) and multiple Maestro flows under [`.maestro/`](../../../.maestro/), including `smoke-hvsc.yaml` and `edge-hvsc-ingest-lifecycle.yaml`.
- The archive client itself is not a placeholder. [`src/lib/archive/client.ts`](../../../src/lib/archive/client.ts) contains a direct HTTP implementation with timeout/error wrapping and native/web transport handling.

These improvements matter because they shift the work from "build the subsystem" to "finish convergence and remove the failure-prone edges."

## 3. Issues

### Issue 1 - Home reboot semantics must remain an intentional split model and should be documented and tested that way

Severity: CRITICAL

Description:
The visible Home `Reboot` action uses the keep-RAM REST/device-control path, while telnet `rebootClearMemory` sits in overflow. Review 14 initially treated this as a convergence gap, but the intended product model is now explicit: primary `Reboot` should remain REST-backed, and overflow `Reboot (Clear RAM)` should remain the telnet-backed path. The issue is therefore not that the split exists, but that the split must be documented, preserved deliberately, and protected with regression coverage.

Evidence:

- [`src/pages/HomePage.tsx`](../../../src/pages/HomePage.tsx) defines `handleReboot()` via `deviceControl.rebootKeepRam()` and defines a separate `handleRebootClearMemory()` that prefers `telnet.executeAction("rebootClearMemory")`.
- [`src/pages/home/components/MachineControls.tsx`](../../../src/pages/home/components/MachineControls.tsx) renders `Reboot` in the primary 2x4 action grid and moves the clear-memory variant out of band.
- [`tests/unit/pages/HomePage.ramActions.test.tsx`](../../../tests/unit/pages/HomePage.ramActions.test.tsx) explicitly locks in the current behavior with tests for quick reboot through REST and clear-RAM reboot through the overflow menu.

Impact:

- The current code may already match the intended behavior, but the intended behavior was ambiguous in the review and can easily regress without explicit documentation and tests.
- Future cleanup work could accidentally "simplify" the model by moving `Reboot` onto telnet or by removing the clear-RAM overflow path.
- User expectations and implementation semantics need to be spelled out unambiguously.

Root cause:

- The reboot model is intentionally split, but that intent was not captured clearly enough in the review guidance.

### Issue 2 - Telnet browser workflows are still brittle even though the low-level telnet stack is real

Severity: HIGH

Description:
The low-level telnet stack is substantial, but the higher-level workflows that navigate menus and file browsers still appear dependent on fixed menu labels, bounded step counts, and stable screen structure. They also need to be resilient to telnet visualization changes such as different ASCII border characters and to menu item reordering.

Evidence:

- [`src/lib/reu/reuTelnetWorkflow.ts`](../../../src/lib/reu/reuTelnetWorkflow.ts) and [`src/lib/config/configTelnetWorkflow.ts`](../../../src/lib/config/configTelnetWorkflow.ts) drive menu/file-browser sequences through deterministic navigation logic.
- The same workflows define hard execution limits such as `MAX_BROWSER_STEPS` and `BROWSER_STEP_TIMEOUT_MS`, which is useful for safety but also reveals tight coupling to expected screen progression.
- The failure-prone assumption is not just latency. Any parser or navigator logic that depends on exact box-drawing characters, border glyphs, or positional menu order will be fragile under firmware presentation changes.
- These paths are exactly where real-device variance, firmware changes, or intermittent telnet screen timing tend to surface.

Impact:

- "Telnet works in unit tests" may not translate cleanly to real-device robustness.
- REU save/restore and config file workflows are likely the first telnet features to regress when menu structure or latency changes.
- Cosmetic telnet rendering changes or menu reordering could break workflows even when the underlying firmware capability is still present.

Root cause:

- Workflow automation is still too screen-shape-driven rather than tolerant of presentation variance and state-driven matching.

### Issue 3 - CommoServe performs eager, sequential binary downloads while adding items to the playlist

Severity: HIGH

Description:
The CommoServe add flow does not merely select archive items. It resolves entries, downloads the playable binary, builds a play plan, and creates playlist items during the add-to-playlist action itself.

Evidence:

- [`src/pages/playFiles/handlers/addFileSelections.ts`](../../../src/pages/playFiles/handlers/addFileSelections.ts) special-cases `source.type === "commoserve"`.
- For each selection it runs:
  - `archiveClient.getEntries(...)`
  - `archiveClient.downloadBinary(...)`
  - `buildArchivePlayPlan(binary)`
  - playlist item creation with embedded runtime file state
- The loop is sequential, not parallel or backgrounded.

Impact:

- A user can experience "Add items" as slow, frozen, or unreliable before playback even begins.
- Multi-select archive adds amplify latency linearly.
- Any transient archive/network issue blocks playlist assembly directly in the foreground path.
- The current behavior misses a better product model: fast playlist adds with deferred download at playback time and local caching thereafter.

Root cause:

- The current model treats playlist add as a full download-and-materialize operation rather than a lightweight selection/queueing step.

### Issue 4 - CommoServe add flow has no clear end-to-end cancellation once downloads begin

Severity: HIGH

Description:
The UI has a concept of canceling scans, but the CommoServe archive-add path does not thread cancellation through the download/entry-resolution work that matters most.

Evidence:

- [`src/components/itemSelection/ItemSelectionDialog.tsx`](../../../src/components/itemSelection/ItemSelectionDialog.tsx) supports `onCancelScan`.
- The CommoServe branch in [`src/pages/playFiles/handlers/addFileSelections.ts`](../../../src/pages/playFiles/handlers/addFileSelections.ts) does not accept or propagate an `AbortSignal` while resolving entries and downloading binaries.
- The foreground add loop therefore has no obvious user-controlled abort once archive downloads have started.

Impact:

- A stalled or slow archive add cannot be interrupted cleanly.
- The UI contract suggests cancelability in related flows, but CommoServe’s expensive path does not actually honor it.

Root cause:

- Cancellation support exists at the browsing/search layer, not at the archive-materialization layer.

### Issue 5 - CommoServe is still outside the normal source-navigation contract

Severity: MEDIUM

Description:
CommoServe appears in the shared source model, but it is not implemented as a real source adapter. The app works by special-casing the UI and add handler instead. It is also the outlier in playlist semantics: other sources mostly add stable references and resolve runtime access later, while CommoServe materializes runtime file state during playlist add.

Evidence:

- [`src/lib/sourceNavigation/archiveSourceAdapter.ts`](../../../src/lib/sourceNavigation/archiveSourceAdapter.ts) returns a `SourceLocation` whose `listEntries` and `listFilesRecursive` both resolve to empty arrays.
- [`src/components/itemSelection/ItemSelectionDialog.tsx`](../../../src/components/itemSelection/ItemSelectionDialog.tsx) routes CommoServe through a separate `ArchiveSelectionView` rather than the standard browser path.
- [`src/pages/playFiles/handlers/addFileSelections.ts`](../../../src/pages/playFiles/handlers/addFileSelections.ts) contains a dedicated CommoServe execution branch.
- The same CommoServe branch downloads archive bytes during playlist add and stores an in-memory runtime file on the playlist item.
- [`src/pages/playFiles/hooks/usePlaybackPersistence.ts`](../../../src/pages/playFiles/hooks/usePlaybackPersistence.ts) rebuilds runtime access for `local` and `hvsc`, but there is no equivalent CommoServe rehydration path.

Impact:

- The feature works, but it is structurally divergent.
- Maintenance cost is higher because CommoServe behavior is spread across special cases instead of a single source-navigation contract.
- Future work such as cancellation, lazy loading, and selection progress will keep forking unless this is either normalized or explicitly accepted as intentionally distinct.
- Debugging and persistence are harder because the long-term source of truth is not a stable archive reference.

Root cause:

- CommoServe was added as an online archive overlay and was allowed to bypass the cleaner reference-first playlist model already used elsewhere.

### Issue 6 - The playlist model should converge on stable references at add time and runtime resolution at play time

Severity: HIGH

Description:
The cleanest cross-source rule already emerging in the codebase is: playlist add captures a stable reference, and playback resolves the expensive or environment-specific runtime access later. `ultimate`, `local`, and `hvsc` already mostly follow this model. CommoServe does not.

Evidence:

- [`src/pages/PlayFilesPage.tsx`](../../../src/pages/PlayFilesPage.tsx) builds playlist items from `PlayableEntry` into a compact `PlayRequest` plus metadata rather than persisting raw bytes.
- [`src/pages/playFiles/hooks/usePlaybackController.ts`](../../../src/pages/playFiles/hooks/usePlaybackController.ts) reconstructs local runtime files on demand and resolves HVSC playback wrappers at play time.
- [`src/pages/playFiles/hooks/usePlaybackPersistence.ts`](../../../src/pages/playFiles/hooks/usePlaybackPersistence.ts) rehydrates `local` and `hvsc` items from stored references.
- [`src/pages/playFiles/handlers/addFileSelections.ts`](../../../src/pages/playFiles/handlers/addFileSelections.ts) makes CommoServe the exception by downloading and embedding runtime file state during playlist add.

Impact:

- The source model is harder to explain because one source behaves fundamentally differently.
- Debugging is harder because the persisted playlist item is not the real source of truth for CommoServe.
- Long-term maintenance gets messier because caching, rehydration, and failure handling are not aligned across source types.

Root cause:

- The repository has implicitly evolved toward a reference-first playlist model, but that model has not yet been made explicit and enforced for all source types.

### Issue 7 - LED color and intensity sliders perform duplicate immediate writes by design

Severity: CRITICAL

Description:
The slider lag complaint has a direct code-level explanation. Lighting sliders currently invoke interactive writes both while dragging and again on commit, and those writes go through the immediate config-write path.

Evidence:

- [`src/pages/home/components/LightingSummaryCard.tsx`](../../../src/pages/home/components/LightingSummaryCard.tsx) wires the sliders with both `onValueChangeAsync` and `onValueCommitAsync`, each calling `interactiveWrite(...)`.
- [`src/components/ui/slider.tsx`](../../../src/components/ui/slider.tsx) and [`src/lib/ui/sliderBehavior.ts`](../../../src/lib/ui/sliderBehavior.ts) implement a throttled change queue plus an immediate commit callback.
- [`src/hooks/useInteractiveConfigWrite.ts`](../../../src/hooks/useInteractiveConfigWrite.ts) sends writes through `useC64UpdateConfigBatch()` with `{ immediate: true, skipInvalidation: true }`.
- [`src/lib/c64api.ts`](../../../src/lib/c64api.ts) bypasses queued config scheduling when `immediate: true`.
- [`tests/unit/pages/home/components/LightingSummaryCard.test.tsx`](../../../tests/unit/pages/home/components/LightingSummaryCard.test.tsx) explicitly documents the current behavior: `onValueChangeAsync and onValueCommitAsync trigger interactiveWrite`.

Impact:

- Slider release can trigger an extra immediate REST write even after a drag preview already sent one.
- The UI can feel sticky or laggy under rapid interaction.
- This is especially visible for LED color/intensity because the user is performing fine-grained, repeated adjustments.

Root cause:

- The slider contract and interactive config-write contract are both individually reasonable, but their combination duplicates final-value writes.

### Issue 8 - HVSC install/ingest state and UI copy are semantically muddy

Severity: MEDIUM

Description:
HVSC is much more complete than initially assumed, but the UI still conflates download, extraction/indexing, ingest, install/update, and ready state in ways that make troubleshooting harder.

Evidence:

- [`src/pages/playFiles/hooks/useHvscLibrary.ts`](../../../src/pages/playFiles/hooks/useHvscLibrary.ts) treats `handleHvscInstall()` as the operation that checks for updates, installs or updates HVSC, and then marks both download and extraction summary states as success.
- The same hook exposes a separate `handleHvscIngest()` path via `ingestCachedHvsc("hvsc-ingest")`.
- [`src/pages/playFiles/components/HvscControls.tsx`](../../../src/pages/playFiles/components/HvscControls.tsx) labels the primary action `Download HVSC`, exposes a second action `Ingest HVSC`, and reports success text as `HVSC downloaded successfully` while also reporting ingested song counts.

Impact:

- Users and future maintainers can struggle to distinguish cached archive state from fully indexed playable-library state.
- Failure triage becomes harder because success/failure messages do not reflect the real operation boundaries precisely.

Root cause:

- The implementation evolved into a multi-stage lifecycle, but the UI copy still reflects an earlier "download first" mental model.

### Issue 9 - Confidence is uneven across the target flows

Severity: MEDIUM

Description:
Coverage exists, but it is not evenly distributed across the flows under review.

Evidence:

- HVSC has unit, Playwright, and Maestro coverage in [`playwright/hvsc.spec.ts`](../../../playwright/hvsc.spec.ts) and [`.maestro/`](../../../.maestro/).
- Telnet has solid unit-level coverage around hooks and diagnostics, such as [`tests/unit/hooks/useTelnetActions.test.tsx`](../../../tests/unit/hooks/useTelnetActions.test.tsx), but the workflow-heavy browser paths are less directly protected.
- CommoServe has good unit coverage for archive hooks and selection UI, but no equivalent strong evidence of end-to-end behavioral validation for the foreground download-to-playlist path.

Impact:

- Confidence in the underlying pieces is higher than confidence in the composed user flows.
- The riskiest regressions are likely to be in orchestration and cancellation behavior, not in low-level helpers.

Root cause:

- Test investment has been stronger on isolated subsystems than on the user-visible convergence paths.

## 4. Recommended Implementation Order

1. Fix interactive lighting writes first.
   This is the clearest confirmed performance defect and the easiest user-visible win.

2. Lock in Home reboot semantics.
   Keep primary `Reboot` on REST and keep overflow `Reboot (Clear RAM)` on telnet, then document and test that split explicitly.

3. Harden telnet workflow automation.
   Focus on REU/config file-browser paths, including resilience to border-character changes and menu reordering, not the already-solid transport layer.

4. Converge the playlist model first.
   Make the reference-first rule explicit across source types, then rework CommoServe to fit it cleanly.

5. Rework CommoServe playlist-add execution.
   Keep add lightweight, defer archive download to playback time with local caching, and persist enough archive metadata to rehydrate and debug the item cleanly.

6. Clarify HVSC lifecycle semantics.
   Fix the state/copy model after the execution paths above are stable.

7. Add end-to-end confidence around the changed flows.
   Favor targeted integration/Playwright/Maestro coverage over broad new unit-only coverage.

## 5. Target End State

The app should converge on this behavior:

- Home `Reboot` remains the canonical REST reboot action, while overflow `Reboot (Clear RAM)` remains the telnet action, with no ambiguity between the two.
- Telnet workflow automation tolerates real-device latency, border-style changes, and menu reordering without breaking core flows.
- Playlist items use a clean, consistent model across sources: add stores stable references, playback resolves runtime access.
- CommoServe selection does not feel like a blocking foreground import job with no escape hatch.
- CommoServe playlist add remains fast because archive binaries are fetched on demand at playback time, reused from local cache after the first successful download, and driven by persisted archive identifiers rather than transient in-memory files.
- Interactive sliders remain responsive without duplicate final REST writes.
- HVSC status text reflects the actual lifecycle stages: cache/download, ingest/index, ready, failure, recovery.
- Validation and documentation describe the implementation that actually ships, not an older mental model.

## 6. Validation Expectations For Follow-Up Implementation

If a follow-up task changes code for these issues, it should be treated as `DOC_PLUS_CODE` and should include the smallest honest validation set required by repository policy, including:

- `npm run test:coverage`
- `npm run lint`
- `npm run build`
- targeted Playwright and/or Maestro runs for any changed visible flows
- dedicated telnet edge-case tests that prove parser and workflow resilience across alternate border ASCII styles and reordered menu items
- screenshot refresh only where visible documented UI changes

No such validation was run for this audit because this review intentionally made documentation-only changes.
