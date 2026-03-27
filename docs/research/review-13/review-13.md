# Review 13: Telnet Support Consistency and Completion Audit

Date: 2026-03-26
Scope: Telnet support across runtime, UI, diagnostics, tracing, testing, documentation, and screenshots
Method: code and documentation audit only; no production changes; no builds/tests/screenshots executed

## 1. Executive Summary

Telnet support is **partially complete**. The low-level client/session/parser/navigator stack exists and several Telnet-only actions are exposed on Home, but the integration stops short of a consistent product feature.

The largest remaining gaps are structural rather than cosmetic:

- the Telnet action set is incomplete relative to the firmware/spec
- Home quick actions do not match the required canonical model
- Telnet actions are not emitted into the trace/action pipeline used by Diagnostics
- Diagnostics has no first-class Telnet contributor/filter/aggregation model
- documentation, screenshots, and test coverage still describe a REST/FTP-only observability story

Readiness level: **incomplete**

Key risks:

- user-visible Home controls do not match the requested Telnet-backed behavior
- Telnet actions cannot be audited or debugged with the same rigor as REST/FTP actions
- native builds can show Telnet UI even when Telnet capability is not actually available
- follow-up implementation work will continue to churn unless UI, tracing, diagnostics, docs, and tests converge together

## 2. What Is Good

- The Telnet transport stack is real, not a placeholder. `src/lib/telnet/telnetClient.ts`, `src/lib/telnet/telnetSession.ts`, `src/lib/telnet/telnetMenuNavigator.ts`, and the deterministic mock provide a solid base.
- The scheduler boundary already exists. `useTelnetActions()` routes execution through `withTelnetInteraction()` so Telnet work can be serialized with other device interactions.
- Home already proves several useful Telnet surfaces:
  - `Power Cycle` is wired into machine controls in [`src/pages/home/components/MachineControls.tsx`](src/pages/home/components/MachineControls.tsx).
  - printer Telnet actions are exposed in [`src/pages/home/components/PrinterManager.tsx`](src/pages/home/components/PrinterManager.tsx).
  - Soft IEC Telnet actions are exposed in [`src/pages/home/components/DriveManager.tsx`](src/pages/home/components/DriveManager.tsx).
  - `Save REU` is reachable from [`src/pages/home/dialogs/SaveRamDialog.tsx`](src/pages/home/dialogs/SaveRamDialog.tsx).
- The health-check engine already probes Telnet and treats it as a real subsystem in probe ordering (`REST`, `FTP`, `TELNET`, `CONFIG`, `RASTER`, `JIFFY`), so the repository already acknowledges Telnet as an operational dependency.
- Addendum 1 was followed in one important area: CommoServe is not being newly routed through Telnet. The addendum explicitly replaces Telnet-based CommoServe with direct HTTP plus device REST, and the current codebase does not appear to reintroduce a Telnet dependency there.

## 3. Issues (CRITICAL)

### Issue 1 - The implemented Telnet action registry is incomplete

Description:
The firmware/spec action surface is larger than the runtime action registry. The registry omits the full Developer submenu, so the implementation cannot claim full Telnet feature coverage.

Evidence:

- `TELNET_ACTIONS` in [`src/lib/telnet/telnetTypes.ts:136`](src/lib/telnet/telnetTypes.ts:136) includes power/reset, IEC, printer, and config actions, but stops before developer actions.
- The mock fixture in [`src/lib/telnet/telnetTypes.ts:281`](src/lib/telnet/telnetTypes.ts:281) includes `Developer -> Clear Debug Log`, `Save Debug Log`, and `Save EDID to file`.
- The base spec lists those actions as Telnet-only in `doc/c64/telnet/c64u-telnet-integration-spec.md:681-699`.

Impact:

- Telnet feature coverage is not complete.
- The mock and the runtime registry disagree about the available firmware menu.
- Any UI, docs, or diagnostics layer built on top of the registry will under-report capabilities.

Root cause:

- The action abstraction stopped at an initial subset and never converged with the full firmware action inventory.

### Issue 2 - Home quick actions do not match the required canonical Telnet model

Description:
The Home quick-action strip still mixes the old REST model with partial Telnet additions instead of converging on the requested canonical set and mapping.

Evidence:

- [`src/pages/home/components/MachineControls.tsx:97-172`](src/pages/home/components/MachineControls.tsx:97) renders:
  - `Reset`
  - `Reboot`
  - conditional `Power Cycle`
  - `Pause/Resume`
  - `Menu`
  - `Save RAM`
  - `Load RAM`
  - conditional `Reboot (Clear RAM)`
  - `Power Off`
- That diverges from the required order `Reset`, `Reboot`, `Pause/Resume`, `Menu`, `Save RAM`, `Load RAM`, `Power Cycle`, `Power Off`.
- `Reboot` still calls REST reboot via [`src/pages/home/components/MachineControls.tsx:102-109`](src/pages/home/components/MachineControls.tsx:102), while `Reboot (Clear RAM)` remains separately exposed at [`src/pages/home/components/MachineControls.tsx:154-163`](src/pages/home/components/MachineControls.tsx:154).
- `handleRebootClearMemory` still executes REST/RAM-clear logic through [`src/pages/home/hooks/useHomeActions.ts:128-138`](src/pages/home/hooks/useHomeActions.ts:128) and [`src/lib/machine/ramOperations.ts:343`](src/lib/machine/ramOperations.ts:343), not a Telnet action.

Impact:

- The visible behavior does not meet the required UX contract.
- Semantics are duplicated: users see both a generic reboot and a clear-memory reboot.
- The canonical rule “show `Reboot`, map it to `Reboot (Clr Mem)`, hide the raw label” is not satisfied.

Root cause:

- Telnet was added incrementally as extra buttons rather than replacing the original machine-control model.

### Issue 3 - The required quick-action overflow does not exist, so layout and extensibility targets cannot be met

Description:
The Home quick-action area has no `...` overflow to the right of Quick Actions, and secondary Telnet actions are not separated from primary actions.

Evidence:

- No overflow trigger or menu exists in [`src/pages/home/components/MachineControls.tsx`](src/pages/home/components/MachineControls.tsx).
- The same file renders every machine action directly into `ProfileActionGrid`.
- The current grid config is compact `2` columns and medium/expanded `4` columns at [`src/pages/home/components/MachineControls.tsx:76-82`](src/pages/home/components/MachineControls.tsx:76), but the actual item count can exceed eight.
- `Save REU` is currently exposed in the Save RAM dialog via [`src/pages/HomePage.tsx:1173-1196`](src/pages/HomePage.tsx:1173) and tested in [`tests/unit/pages/home/dialogs/SaveRamDialog.test.tsx:217-246`](tests/unit/pages/home/dialogs/SaveRamDialog.test.tsx:217), not in a machine-actions overflow.

Impact:

- Compact mode cannot guarantee the required 2x4 machine-control layout.
- Secondary actions such as `Reboot (Keep RAM)` and `Save REU` have no canonical placement.
- Future Telnet growth will continue to bloat the main action strip.

Root cause:

- The UI model never introduced a primary-vs-secondary action split for machine controls.

### Issue 4 - Device-card Telnet integration is partial and inconsistent

Description:
Printer coverage is present, Soft IEC coverage is partial, and physical drive cards have no Telnet action exposure.

Evidence:

- Printer Telnet footer buttons exist in [`src/pages/home/components/PrinterManager.tsx:229-252`](src/pages/home/components/PrinterManager.tsx:229): `Flush` and `Reset`.
- Soft IEC footer buttons exist in [`src/pages/home/components/DriveManager.tsx:306-330`](src/pages/home/components/DriveManager.tsx:306): `Reset` and `Set Dir`.
- Physical drive cards `A` and `B` have no Telnet footer/action branch in [`src/pages/home/components/DriveManager.tsx:171-334`](src/pages/home/components/DriveManager.tsx:171).
- The unit tests confirm only Soft IEC-specific Telnet exposure in [`tests/unit/pages/home/DriveManager.test.tsx:221-244`](tests/unit/pages/home/DriveManager.test.tsx:221).

Impact:

- Device-card behavior is not aligned with the requested “drive cards expose Reset at minimum and other relevant Telnet actions where appropriate.”
- Telnet support looks incidental rather than systematic across device cards.

Root cause:

- Telnet controls were added where immediately useful, without a card-level action model shared across printer and drive variants.

### Issue 5 - Telnet tracing is defined but not emitted

Description:
The trace session supports `telnet-operation` events, but the Telnet execution path never records them.

Evidence:

- `recordTelnetOperation()` is implemented in [`src/lib/tracing/traceSession.ts:506-531`](src/lib/tracing/traceSession.ts:506).
- `useTelnetActions()` executes the action and logs failures, but it never calls `recordTelnetOperation()`; see [`src/hooks/useTelnetActions.ts:51-98`](src/hooks/useTelnetActions.ts:51).
- `TelnetActionExecutor` logs via `addLog()` only; see [`src/lib/telnet/telnetActionExecutor.ts:53-74`](src/lib/telnet/telnetActionExecutor.ts:53).
- Repository search found no call sites for `recordTelnetOperation(` under `src/`, `tests/`, or `playwright/`.
- The base spec explicitly expects Telnet actions to record trace events in `doc/c64/telnet/c64u-telnet-integration-spec.md:720-726`.

Impact:

- Telnet actions do not appear as first-class trace entries.
- Diagnostics cannot attribute Telnet work to user actions in the same way as REST/FTP.
- Latency, success/failure, and action-history evidence are incomplete.

Root cause:

- Trace schema support was added, but the runtime executor/hook integration was never finished.

### Issue 6 - Diagnostics treats Telnet as a second-class subsystem

Description:
Diagnostics currently models contributors, filters, summaries, and activity counts as `App`, `REST`, and `FTP` only.

Evidence:

- Contributor keys are defined as `App | REST | FTP` in [`src/lib/diagnostics/healthModel.ts:18-20`](src/lib/diagnostics/healthModel.ts:18).
- `getTraceContributor()` and `getActionContributor()` in [`src/components/diagnostics/DiagnosticsDialog.tsx:146-159`](src/components/diagnostics/DiagnosticsDialog.tsx:146) only map REST/FTP/App.
- The contributor filter UI only offers `All`, `App`, `REST`, and `FTP` in [`src/components/diagnostics/DiagnosticsDialog.tsx:611`](src/components/diagnostics/DiagnosticsDialog.tsx:611).
- Action summaries only define REST, FTP, and ERROR effects in [`src/lib/diagnostics/actionSummaries.ts:22-69`](src/lib/diagnostics/actionSummaries.ts:22).
- Duration calculation only looks at `rest-response` and `ftp-operation` in [`src/lib/diagnostics/actionSummaries.ts:154-185`](src/lib/diagnostics/actionSummaries.ts:154).
- Diagnostics activity only tracks REST/FTP in-flight counts in [`src/lib/diagnostics/diagnosticsActivity.ts:9-54`](src/lib/diagnostics/diagnosticsActivity.ts:9) and [`src/hooks/useDiagnosticsActivity.ts:14-60`](src/hooks/useDiagnosticsActivity.ts:14).
- The evidence list copy still says “Problems, actions, logs, and traces” with no Telnet-specific contributor vocabulary in [`src/components/diagnostics/DiagnosticsDialog.tsx:1434-1435`](src/components/diagnostics/DiagnosticsDialog.tsx:1434).

Impact:

- No dedicated Telnet filter exists.
- Telnet actions cannot aggregate under user-initiated action summaries the same way REST/FTP do.
- The diagnostics surface is not consistent with the existing REST/FTP interaction model.

Root cause:

- Diagnostics evolution stopped after REST/FTP integration and did not absorb the later Telnet work.

### Issue 7 - Health checks acknowledge Telnet, but the main health model still drops it

Description:
The repository already probes Telnet in health checks, but the main diagnostics health rollup still collapses everything into `App`, `REST`, and `FTP`.

Evidence:

- The health-check engine includes Telnet in its probe order and execution path:
  - `PROBE_ORDER` includes `TELNET` in [`src/lib/diagnostics/healthCheckState.ts:39`](src/lib/diagnostics/healthCheckState.ts:39).
  - `HealthCheckProbeType` includes `TELNET` and the probe implementation lives in [`src/lib/diagnostics/healthCheckEngine.ts:52-54`](src/lib/diagnostics/healthCheckEngine.ts:52) and [`src/lib/diagnostics/healthCheckEngine.ts:569-597`](src/lib/diagnostics/healthCheckEngine.ts:569).
- `useHealthState()` still builds contributor health with only `App`, `REST`, and `FTP` in [`src/hooks/useHealthState.ts:58-68`](src/hooks/useHealthState.ts:58) and again in [`src/hooks/useHealthState.ts:122-126`](src/hooks/useHealthState.ts:122).
- When a health check fails, Telnet failures get forced into `App` unless they are REST or FTP in [`src/hooks/useHealthState.ts:81-90`](src/hooks/useHealthState.ts:81).

Impact:

- The app admits Telnet matters for health, but the main health indicator and primary-problem model do not represent it accurately.
- Users can see a Telnet probe fail without a stable Telnet contributor in the rest of Diagnostics.

Root cause:

- Health-check probe support was added independently from the steady-state health/contributor model.

### Issue 8 - Telnet capability and protocol selection are still approximated rather than device-aware

Description:
Telnet UI exposure is gated by platform, not by actual device capability, and the action executor still defaults to a menu key instead of detecting the device variant it claims to support.

Evidence:

- `isTelnetAvailable()` returns only `isNativePlatform()` in [`src/hooks/useTelnetActions.ts:23-26`](src/hooks/useTelnetActions.ts:23).
- Home surfaces use `telnet.isAvailable` directly in [`src/pages/HomePage.tsx:536-538`](src/pages/HomePage.tsx:536), [`src/pages/HomePage.tsx:941-944`](src/pages/HomePage.tsx:941), [`src/pages/HomePage.tsx:976-979`](src/pages/HomePage.tsx:976), and [`src/pages/HomePage.tsx:1072-1105`](src/pages/HomePage.tsx:1072).
- `createActionExecutor()` documents “Detects device type for correct F-key,” but still defaults `menuKey` to `"F5"` in [`src/lib/telnet/telnetActionExecutor.ts:28-42`](src/lib/telnet/telnetActionExecutor.ts:28).

Impact:

- Native builds can expose Telnet controls even when the device/firmware path is unavailable or unsuitable.
- Device-family differences remain a protocol risk for real hardware support.

Root cause:

- Capability detection and device-variant resolution were deferred while the UI was built on a platform-only assumption.

### Issue 9 - Documentation is stale and contradictory for Telnet

Description:
Repository docs, in-app docs, and feature inventories still describe a mostly REST/FTP-only world and do not describe the current Telnet state accurately, let alone the target state.

Evidence:

- `README.md` diagnostics summary is generic and does not mention Telnet contributor/filter/action support; see [`README.md:186-196`](README.md:186).
- In-app docs still say the app connects over the REST API in [`src/pages/DocsPage.tsx:31-34`](src/pages/DocsPage.tsx:31).
- In-app Home docs only mention `Reset / Reboot`, `Menu`, `Pause / Resume`, and `Power Off` in [`src/pages/DocsPage.tsx:58-77`](src/pages/DocsPage.tsx:58).
- In-app diagnostics docs still describe action summaries as REST/FTP and traces as REST/FTP requests in [`src/pages/DocsPage.tsx:237-251`](src/pages/DocsPage.tsx:237).
- In-app health-check docs omit Telnet from the order list in [`src/pages/DocsPage.tsx:225-226`](src/pages/DocsPage.tsx:225), while the actual probe order includes Telnet in `src/lib/diagnostics/healthCheckState.ts:39`.
- `doc/features-by-page.md` still documents Home machine actions as `Reset, Reboot, Pause/Resume, Menu, Power Off` and RAM actions including `Reboot (Clear RAM)` via REST in [`doc/features-by-page.md:43-46`](doc/features-by-page.md:43).
- `doc/ux-interactions.md` quick actions table omits the Telnet additions and still lists only `Reset`, `Menu`, `Pause`, `Resume`, `Power Off` in [`doc/ux-interactions.md:125-134`](doc/ux-interactions.md:125).
- `doc/ux-interactions.md` diagnostics controls still describe the older `Clear All`, `Share All`, `Filter entries`, and per-tab share model in [`doc/ux-interactions.md:183-191`](doc/ux-interactions.md:183).
- `docs/diagnostics/index.md` documents screenshots around REST/FTP/app activity only in [`docs/diagnostics/index.md:17-35`](docs/diagnostics/index.md:17).

Impact:

- Current docs are not reliable for either users or implementers.
- Future implementation work risks following stale documentation instead of the actual product direction.

Root cause:

- Telnet implementation advanced in code faster than the documentation set was updated.

### Issue 10 - Screenshot and test coverage do not support full Telnet convergence

Description:
The screenshot corpus and automated test suite do not cover the requested Telnet end state.

Evidence:

- Home screenshot inventory under `doc/img/app/home/` includes overview, sections, dialogs, and profiles, but no quick-actions overflow or Telnet-specific quick-action captures:
  - inventory includes files such as `00-overview-light.png`, `dialogs/01-save-ram-dialog.png`, `sections/03-quick-config-to-drives.png`, and profile overviews
  - inventory does not include overflow-open/closed or Telnet diagnostics shots
- `docs/diagnostics/index.md` lists only REST/FTP/app-oriented diagnostics screenshots in [`docs/diagnostics/index.md:17-35`](docs/diagnostics/index.md:17).
- Playwright machine-controls coverage still asserts REST machine endpoints, not Telnet behavior, in [`playwright/homeInteractivity.spec.ts:130-174`](playwright/homeInteractivity.spec.ts:130).
- `MachineControls` unit tests only check Power Cycle visibility/handler presence in [`tests/unit/pages/home/components/MachineControls.test.tsx:53-64`](tests/unit/pages/home/components/MachineControls.test.tsx:53).
- `useTelnetActions` unit tests cover hook execution and busy-state basics, but not tracing, aggregation, or capability detection beyond native-vs-web in [`tests/unit/hooks/useTelnetActions.test.tsx:74-163`](tests/unit/hooks/useTelnetActions.test.tsx:74).
- Maestro inventory contains no Telnet-focused flows; `find .maestro` showed playback, HVSC, diagnostics export, and FTP/browser flows, but no Telnet machine-control or Telnet diagnostics flows.

Impact:

- The current suite will not protect the required Home/Diagnostics Telnet behavior after implementation.
- The screenshot set cannot serve as visual proof for the requested Telnet UI.

Root cause:

- Tests and screenshots were added around the existing partial Telnet surfaces, not around the desired end state.

## 4. Gaps to Full Completion

This is the exhaustive remaining-work list needed to reach the requested target without further discovery.

### A. Firmware-action coverage

1. Extend the Telnet capability registry to cover every Telnet-only firmware action still in scope, including the Developer submenu.
2. Reconcile the runtime registry with the mock fixture and the written spec so one canonical menu/action inventory exists.
3. Decide which actions remain user-facing, which are diagnostics/developer-only, and which should be hidden but traceable.

### B. Machine-action model

1. Replace the current mixed REST/Telnet quick-action model with the required canonical Home set.
2. Remap visible `Reboot` to Telnet `Reboot (Clr Mem)`.
3. Remove the raw `Reboot (Clear RAM)` label from the primary strip.
4. Preserve `Reset`, `Pause/Resume`, `Menu`, `Save RAM`, `Load RAM`, `Power Cycle`, and `Power Off` in the requested order.
5. Add a dedicated machine overflow immediately to the right of Quick Actions.
6. Populate overflow with at least `Reboot (Keep RAM)` and `Save REU`.
7. Ensure overflow entries do not duplicate primary quick actions.
8. Enforce the compact 2x4 layout for primary actions.

### C. Device-card action model

1. Define the canonical Telnet action set for printer cards.
2. Define the canonical Telnet action set for physical drive cards and Soft IEC cards.
3. Ensure drive cards expose `Reset` at minimum wherever relevant.
4. Align labels with firmware semantics and the requested UX language.
5. Decide whether card-level Telnet actions need overflow affordances of their own.

### D. Tracing and action attribution

1. Emit `telnet-operation` events for every Telnet action execution.
2. Include action id, user-facing label, menu path, duration, result, and normalized failure details.
3. Ensure every Telnet operation is correlated to a user action context.
4. Ensure action start/end plus Telnet operation traces aggregate into a single action summary.
5. Decide whether navigation substeps need separate scope traces for forensic debugging.

### E. Diagnostics integration

1. Add `TELNET` as a first-class diagnostics contributor beside `App`, `REST`, and `FTP`.
2. Add a dedicated Telnet filter in Diagnostics.
3. Extend action summaries to model Telnet effects.
4. Extend problem detection to include failed Telnet operations.
5. Extend contributor chips, filter editor, collapsed rows, expanded rows, and counters to surface Telnet explicitly.
6. Extend in-flight activity tracking to include Telnet.
7. Align heat-map/latency tooling decisions with Telnet, or explicitly document why a Telnet heat-map is out of scope.

### F. Health and capability modeling

1. Fold Telnet probe results into the steady-state contributor model rather than treating Telnet as a special-case probe only.
2. Decide whether Telnet gets its own “last activity” surface analogous to REST/FTP.
3. Replace the platform-only `isNativePlatform()` availability rule with a real Telnet capability signal.
4. Resolve device-type-specific menu-key selection and any other firmware-variant branching needed for real hardware correctness.

### G. Documentation convergence

1. Update `README.md` to describe Telnet-backed controls and Telnet-aware diagnostics accurately.
2. Update the in-app Docs page to describe Telnet connectivity requirements, Home quick actions, overflow behavior, and Diagnostics support.
3. Update `doc/features-by-page.md` so the Home feature inventory reflects the Telnet-backed action model and diagnostics inventory.
4. Update `doc/ux-interactions.md` to reflect the actual Telnet CTAs and modern diagnostics controls.
5. Update diagnostics documentation under `doc/diagnostics/` and `docs/diagnostics/` to include Telnet in contributor/filter/action terminology.
6. Remove contradictions between health-check probe ordering in docs and code.

### H. Screenshot convergence

1. Add screenshots for the updated primary Quick Actions strip.
2. Add screenshots for compact 2x4 layout.
3. Add screenshots for machine overflow closed and open.
4. Add screenshots for drive/printer card Telnet controls.
5. Add screenshots for Diagnostics with Telnet filter and Telnet evidence visible.
6. Update screenshot index docs so those assets are documented and discoverable.

### I. Test convergence

1. Add unit tests for the complete Telnet action registry and action-to-menu mapping.
2. Add unit tests for `recordTelnetOperation()` integration and diagnostics action-summary aggregation.
3. Add unit tests for Diagnostics contributor filtering and problem detection with Telnet events.
4. Add unit tests for the Home machine-action ordering, overflow population, and no-duplication rule.
5. Add Playwright coverage for Telnet-backed quick actions, overflow, compact 2x4 behavior, device-card controls, and Diagnostics Telnet filtering.
6. Add Maestro or equivalent real-device flows for Telnet machine controls and diagnostics visibility where native/network behavior matters.
7. Add end-to-end or agentic evidence for capability detection on real hardware.
8. Re-check Telnet-related branch coverage after implementation and keep it at or above 91% globally.

## 5. Recommended Fixes

1. Define one canonical Telnet capability manifest first.
   - Include action id, firmware menu path, user label, preferred UI surface, fallback transport if any, and diagnostics classification.

2. Rebuild Home machine controls around that manifest rather than patching the current button list.
   - This is the cleanest way to satisfy ordering, overflow, and compact-layout rules together.

3. Finish tracing before expanding UI further.
   - Until `telnet-operation` events exist, Diagnostics work will remain partial and hard to verify.

4. Add `TELNET` as a first-class diagnostics contributor, not a special-case probe.
   - Diagnostics should be able to answer the same questions for Telnet that it already answers for REST and FTP.

5. Converge health, diagnostics, and docs in the same implementation pass.
   - Leaving any one of those behind will recreate the current contradiction between runtime behavior and product documentation.

6. Treat capability detection and device-variant handling as release-blocking for Telnet completion.
   - Platform-only gating is not enough for a protocol feature with real firmware differences.

7. Add screenshot and test work only after the UI/diagnostics model is stable.
   - Otherwise the repository will accumulate churn without durable coverage.

## 6. Prioritization

### Priority 0 - Must fix before claiming complete Telnet support

1. Complete the Telnet action registry.
2. Remap Home quick actions to the required canonical model.
3. Add machine overflow and enforce the compact 2x4 primary layout.
4. Emit `telnet-operation` traces and aggregate them into action summaries.
5. Add `TELNET` as a first-class diagnostics contributor/filter.

### Priority 1 - Required for full UI and observability consistency

1. Converge printer/drive card action exposure.
2. Fold Telnet into health rollups and steady-state diagnostics counters.
3. Replace platform-only Telnet availability with real capability detection.
4. Resolve device-type menu-key selection and other firmware-variant assumptions.

### Priority 2 - Required to close repository consistency

1. Update README, in-app Docs, `doc/features-by-page.md`, `doc/ux-interactions.md`, and diagnostics docs.
2. Refresh screenshot inventories and assets for the final Telnet UI.
3. Add missing unit, Playwright, Maestro, and real-device regression coverage.

## 7. Consistency Analysis

### UI ↔ runtime

- Inconsistent today.
- Runtime exposes Telnet actions such as `powerCycle`, `printerFlush`, and `iecSetDir`, but Home still centers its machine-control contract on the older REST model.

### Runtime ↔ tracing

- Inconsistent today.
- Telnet has a runtime executor and a trace schema, but no emitted Telnet trace events.

### Tracing ↔ diagnostics

- Inconsistent today.
- Diagnostics only understands REST/FTP/App contributors even though the trace layer defines `telnet-operation`.

### Health checks ↔ diagnostics

- Inconsistent today.
- Health checks probe Telnet, but the persistent contributor model and primary-problem mapping still collapse Telnet into other categories.

### UI ↔ docs

- Inconsistent today.
- Docs do not describe the Telnet-backed controls that already exist, and they also do not describe the requested target model that should replace the current one.

### UI ↔ screenshots

- Inconsistent today.
- The screenshot corpus has no evidence for the required Telnet quick-action overflow or Telnet diagnostics filter.

### Tests ↔ product intent

- Inconsistent today.
- Existing tests protect partial Telnet plumbing and the older REST quick-action model, not the requested converged Telnet experience.

## 8. Coverage Analysis

### Areas with useful existing coverage

- Telnet transport/session/navigation basics:
  - `tests/unit/telnet/*`
  - `tests/unit/hooks/useTelnetActions.test.tsx`
- Current printer and Soft IEC button presence:
  - `tests/unit/pages/home/components/PrinterManager.test.tsx`
  - `tests/unit/pages/home/DriveManager.test.tsx`
- Save REU dialog entry point:
  - `tests/unit/pages/home/dialogs/SaveRamDialog.test.tsx`
- Telnet health probe support:
  - health-check engine/unit coverage in the diagnostics subsystem

### Missing or weak coverage

- No unit coverage for complete action-registry parity with the firmware/spec.
- No unit coverage for visible `Reboot` mapping to Telnet clear-memory semantics.
- No unit coverage for the required primary-action ordering or compact 2x4 rule.
- No unit coverage for quick-action overflow population and no-duplication behavior.
- No unit coverage for `recordTelnetOperation()` integration because it is not used.
- No unit coverage for diagnostics contributor filtering, summaries, or problem detection with Telnet traces.
- No Playwright coverage for Telnet-backed machine actions, overflow, or Telnet diagnostics.
- No Maestro coverage for Telnet machine-control flows.
- No real-device proof for capability detection or firmware-variant key selection.

### Coverage conclusion

The repository has enough low-level Telnet tests to support implementation, but not enough cross-layer coverage to certify full Telnet support. The missing coverage is concentrated exactly where the remaining work is concentrated: Home action model, Telnet tracing, diagnostics contributor integration, and end-to-end user flows.

## Final Assessment

Telnet support is not blocked by missing plumbing; it is blocked by incomplete convergence. The next implementation pass should treat Telnet as a full interaction family, not a set of extra buttons. Until the action registry, Home model, diagnostics pipeline, docs, screenshots, and tests all converge on the same contract, Telnet support should be considered incomplete.
