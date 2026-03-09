# Agentic Test Review

## 1. Executive Summary

The current `doc/testing/agentic-tests/` set is not sufficient to drive a fully autonomous LLM test system across the actual C64 Commander feature surface. It is narrowly optimized around one mixed-format physical playback regression and a new `c64scope` server, while the repository exposes a much broader app: connection and demo-mode state machines, machine control, RAM dump/load, disk and printer management, stream control, app-config persistence, diagnostics export, settings import/export, HVSC lifecycle management, and multiple background or lock-screen behaviors.

The biggest defects are:

- The documentation does not start from the real repository feature surface.
- The oracle model is overwhelmingly A/V-centric and cannot validate many user-visible outcomes.
- The exploration model is too weak for autonomous feature discovery outside a curated playback flow.
- Safety constraints are incomplete for destructive or resource-heavy actions.
- The design is Android-only even though the stated objective covers Android and iOS.
- Existing observability and test infrastructure already present in the repo is underused.

The current documents are usable as a starting point for one playback-focused physical proof. They are not sufficient as the handoff for a full-feature-surface autonomous exploratory system.

## 1A. Remediation Landing Map

The remediation docs that address these findings now live in:

- `agentic-feature-surface.md` for the repository-derived scope inventory
- `agentic-coverage-matrix.md` for coverage, safety class, oracle class, and blocker status
- `agentic-action-model.md` for route discovery, preconditions, postconditions, recovery, and escape rules
- `agentic-oracle-catalog.md` for non-A/V and mixed-oracle policy
- `agentic-observability-model.md` for app diagnostics, log, trace, and `c64scope` correlation
- `agentic-safety-policy.md` for bounded autonomy and destructive-action limits
- `agentic-android-runtime-contract.md` for connection, demo-mode, and background-playback behavior
- `agentic-infrastructure-reuse.md` for Playwright, Maestro, and Android JVM reuse
- `agentic-open-questions.md` for the remaining explicit blockers
- `agentic-test-architecture.md`, `c64scope-spec.md`, `agentic-test-implementation-plan.md`, and `c64scope-delivery-prompt.md` for the synchronized implementation-facing architecture and handoff

## 2. Scope and Review Method

This review covered:

- `doc/testing/agentic-tests/**`
- relevant surrounding docs under `doc/testing/**`
- route and page structure in `src/App.tsx`, `src/components/TabBar.tsx`, and `src/pages/**`
- hardware-facing and persistence-heavy modules in `src/lib/**` and `src/hooks/**`
- existing Playwright, Maestro, and Android JVM test assets in `playwright/**`, `.maestro/**`, and `android/app/src/test/**`

Method:

1. Inventory the actual user-visible and hardware-visible feature surface from the repository.
2. Extract the stated architecture, assumptions, tooling, and constraints from the existing agentic-test documents.
3. Map documented scope against actual feature scope.
4. Evaluate whether the documented system can discover actions, execute them safely, and prove outcomes with reliable oracles.
5. Convert findings into an implementation-oriented remediation plan for a follow-up LLM.

Important repository-derived facts:

- The app routes are Home, Play, Disks, Config, Settings, Docs, Licenses, plus a hidden test probe route.
- The current agentic docs are centered on Android and `droidmind`; no equivalent iOS control owner is defined.

## 3. Repository-Derived Feature Surface

### Home

- System info and connection state display.
- Machine controls: reset, reboot, pause/resume, menu button, power off.
- RAM workflows: save RAM, load RAM, reboot and clear RAM, RAM dump folder selection.
- Quick config: CPU speed, turbo coupling, video modes, HDMI scanlines, joystick swap.
- LED controls: mode, fixed color, intensity, SID select, tint.
- SID controls: per-chip enable/disable, address routing, volume, pan, UltiSID profiles, silence/reset action.
- Drive summary and inline drive management for Drive A, Drive B, and Soft IEC.
- Printer management: enable/disable, bus ID, printer output/config items, printer reset.
- Stream controls: edit stream endpoints and start/stop streams.
- Config actions: save/load/reset flash config, save/load/manage app-side config snapshots.

High-risk traits:

- Hardware-coupled: machine control, RAM operations, SID routing, drive/printer reset, stream start/stop.
- Destructive or irreversible: power off, reset, reboot clear RAM, flash config reset, flash config load.
- Multi-oracle: several actions require UI, REST, RAM-state, filesystem, or device-state validation.

### Play

- Source selection across local storage, C64 Ultimate storage, and HVSC.
- Playlist creation from files or folders, recursive import, add-more flows, item filtering, bulk removal.
- Playback transport: play, stop, pause/resume, previous, next.
- Queue behavior: shuffle, repeat, reshuffle, current-item tracking, progress, elapsed/remaining totals.
- Volume and mute control synchronized against device audio mixer state.
- Song controls: custom duration, songlength file import, subsong selection, multi-song SID handling.
- Mixed-format playback via `sid`, `mod`, `prg`, `crt`, and disk image flows.
- Playback persistence keyed by device, including playlist and session restore.
- Background execution integration and lock-screen auto-advance support on Android.
- HVSC lifecycle: download/install, ingest, cancel, reset status, browse after install.

High-risk traits:

- Asynchronous and long-running: HVSC download/extract/index, folder scans, playback transitions.
- Background behavior: lock-screen and background auto-advance.
- Mixed control/oracle surfaces: UI, REST, FTP, filesystem, diagnostics, and native background events.

### Disks

- Disk library persistence per device.
- Add disks from local or C64U sources, including folder recursion and progress overlays.
- Mount/eject disks to Drive A or B.
- Drive power on/off, drive reset, bus ID changes, drive type changes.
- Soft IEC default path selection.
- Disk metadata display, grouping, rename, delete, bulk delete.
- Disk DOS status display and status-detail dialogs.

High-risk traits:

- Hardware-coupled: mount/eject, drive state changes, Soft IEC path changes.
- Destructive: delete and bulk delete, drive resets, power toggles.
- Multi-step stateful workflows: import, library persistence, grouped rotation, mounted-state preservation.

### Config

- Category search and expansion across the full C64 Ultimate configuration space.
- Per-item editing with immediate apply semantics.
- Audio Mixer special handling, including per-item writes, batch writes, and solo-routing snapshots.
- Clock synchronization flow.
- Audio Mixer reset-to-defaults flow.

High-risk traits:

- Extremely broad feature surface; categories are repository- and device-dependent.
- Many settings need feature-specific oracles beyond “request succeeded”.
- Some changes are immediate hardware mutations with unclear safe exploration limits.

### Settings

- Appearance theme selection.
- Connection host/password changes and manual reconnect.
- Demo-mode and discovery behavior configuration.
- Diagnostics dialog with Errors, Logs, Traces, and Actions tabs.
- Diagnostics export/share and diagnostics clearing.
- Debug logging toggle and Android SAF diagnostics.
- Settings export/import.
- List preview limit and disk autostart mode.
- HVSC enablement and developer-only base URL override.
- Device Safety mode presets and advanced throttling/backoff/circuit controls.
- About screen, developer mode unlock, REST API docs link, open-source licenses navigation.

High-risk traits:

- Persistence-heavy.
- Cross-platform differences in sharing, filesystem access, and diagnostics collection.
- Some settings directly alter safety and retry behavior for the whole app.

### Docs and Support Surfaces

- Built-in help content covering setup, home, play, disks, config, settings, and diagnostics guidance.
- Open-source licenses page.
- Demo-mode interstitial and connection popover/indicator behavior.
- Global diagnostics overlay and trace capture infrastructure.
- Hidden coverage probe and heartbeat surfaces for test builds.

Risk note:

- These are lower-risk than machine control or playback, but still user-visible and should not be silently ignored in a “full feature surface” strategy.

### Cross-Cutting Runtime and Platform Behaviors

- Connection discovery, startup discovery window, background rediscovery, sticky real-device lock, and demo fallback.
- REST-vs-native transport differences in `src/lib/c64api.ts` and `src/lib/connection/connectionManager.ts`.
- FTP access via native plugin wrapper.
- Android-specific background execution plugin.
- Existing diagnostics, trace, and export facilities.
- Existing mock/demo infrastructure, smoke mode, and fuzz mode.

High-risk traits:

- Partial observability if only UI and C64 A/V are observed.
- Platform-specific behavior differences across Android, iOS, and web paths.

## 4. Existing Agentic-Test Document Set Reviewed

| File | Current role | Observed scope bias |
| --- | --- | --- |
| `doc/testing/agentic-tests/agentic-test-architecture.md` | Defines three-server model and app-first playback testing | Playback-centric; assumes Android + `droidmind`; weak full-surface coverage model |
| `doc/testing/agentic-tests/c64scope-spec.md` | Defines `c64scope` tool groups, artifacts, and A/V assertions | Strong on capture semantics; weak on non-A/V feature validation |
| `doc/testing/agentic-tests/agentic-test-implementation-plan.md` | Delivery phases for `c64scope` and one mixed-format regression | Oriented to one baseline case, not repository-wide exploratory coverage |
| `doc/testing/agentic-tests/c64scope-delivery-prompt.md` | Prompt for an implementation LLM | Repeats playback-focused assumptions; does not protect against repo-wide drift |

Surrounding evidence that materially affects the review:

- `doc/testing/maestro.md`
- `doc/testing/physical-device-matrix.md`
- `doc/testing/testing-infrastructure-review.md`

These surrounding docs already acknowledge native/runtime coverage gaps, platform differences, and real-device validation needs that the agentic-test docs do not fully incorporate.

## 5. Critique of Existing Documentation

### Correctness

- The documents correctly identify the need for app-first validation and the need to avoid bypassing C64 Commander with direct C64 control.
- They are not correct as a statement of overall scope. The repository feature surface is far broader than the mixed-format playback case described in `agentic-test-architecture.md` and `agentic-test-implementation-plan.md`.
- The architecture is also not correct for the stated Android+iOS objective because `c64scope-spec.md` and `agentic-test-architecture.md` define only `droidmind` as the mobile-control owner.

### Completeness

- Major user-visible areas are omitted or only implied: connection/demo-mode logic, settings persistence/import/export, diagnostics export, device-safety controls, drive and printer management, stream control, app-config snapshots, and RAM dump/load.
- The docs do not include a repository-derived feature inventory, coverage matrix, or per-feature action/oracle requirements.
- The docs do not explain how to cover read-only but user-visible surfaces such as Docs and Licenses, nor do they explicitly state if those are out of scope.

### Internal Consistency

- The documents say “fully autonomous” and “real hardware”, but the defined baseline is only one curated playback case.
- The docs prohibit dependence on Maestro for the baseline design, yet the repository already contains platform-specific Maestro knowledge that is highly relevant to native affordances and should be integrated rather than ignored.
- The delivery prompt requires `c64u-openapi.yaml` and `c64u-ftp.md` only late in the plan, even though many action and oracle decisions depend on REST/FTP semantics much earlier.

### Exploration Model

- Tool discovery is documented; app exploration is not.
- There is no model for discovering routes, dialogs, hidden controls, conditional sections, feature flags, or device-dependent options.
- There is no page-specific action catalog, no precondition/postcondition model, and no decomposition for complex workflows such as HVSC ingest, disk import, or diagnostics export.

### Oracle Quality

- The existing oracle model is dominated by video/audio signatures and occasional RAM reads.
- That is insufficient for validating many repository features:
  - settings persistence
  - diagnostics export contents
  - drive type/bus/path changes
  - stream endpoint edits and stream lifecycle
  - app-config save/load/revert behavior
  - demo-mode transitions and sticky real-device lock
  - device-safety parameter changes
- The documents do not define when UI-only, REST-visible, FTP-visible, filesystem-visible, log-visible, or trace-visible outcomes are acceptable.

### Observability

- The docs invent strong new `c64scope` artifacts but underuse existing observability already present in the app:
  - diagnostics logs
  - trace events
  - action summaries
  - diagnostics ZIP export
  - Android plugin logs
  - existing test probes and heartbeat
- There is no explicit strategy for reading or correlating app-side diagnostics with external physical evidence.
- Asynchronous progress states are handled for the proposed capture engine, but not comprehensively for app-native long-running workflows such as HVSC ingestion, folder scans, settings import, or background rediscovery.

### Assertion Robustness

- The docs do not define “strong enough” assertions for non-playback workflows.
- They do not define confidence thresholds or anti-false-positive rules for UI-only observations.
- They do not require independent confirmation of destructive actions before and after the action.

### Safety and Bounded Autonomy

- The docs constrain `c64bridge`, but not the autonomous agent’s use of the app itself.
- Missing bounded-autonomy rules include:
  - repeated HVSC downloads or repeated long ingests
  - config-flash save/load/reset loops
  - repeated power-off/reboot/reset sequences
  - RAM overwrite/restore safety
  - deletion and bulk deletion in the disk library
  - device-safety mode changes
  - repeated stream toggling or network hammering
- There is no explicit test-lab budget for retries, action frequency, max mutation counts, or cleanup guarantees.

### Traceability

- `scope_session.record_step` is a good start, but there is no repository-wide schema tying steps to feature area, preconditions, expected oracle, or cleanup.
- The proposed artifact model does not explain how to correlate app diagnostics export, logcat, Playwright trace, or Maestro evidence with `c64scope` evidence.

### Maintainability and Extensibility

- The current docs are optimized for one server and one case manifest, not for a growing library of page-specific exploratory playbooks.
- There is no documented pattern for adding new feature-specific oracles, state references, or platform-specific action adapters.
- There is no mechanism to keep documentation aligned with changing routes, page sections, or feature flags.

### Suitability for Android and iOS

- Android is partially addressed through `droidmind`.
- iOS is not addressed with any concrete control path, tool owner, or OS-specific lifecycle/permission strategy.
- Existing repository evidence already shows iOS-specific Maestro constraints and WKWebView differences, but the agentic docs do not account for them.

### Suitability for Real Hardware and Exploratory Execution

- The docs are suitable for a narrow physical playback proof.
- They are not suitable for broad exploratory execution because they do not define safe coverage boundaries, action selection strategy, or reliable non-playback oracles.
- They do not distinguish repository features that are directly testable now from features that require new instrumentation or human-written expected-behavior contracts.

### Alignment with Existing Test Infrastructure

- The docs barely integrate:
  - Playwright golden traces and evidence bundles
  - Maestro native smoke and iOS flows
  - Android JVM plugin tests
  - physical-device validation matrix
  - diagnostics export and trace infrastructure already in the app
- This is a missed opportunity. The follow-up system should use existing assets as seed cases, oracle hints, and observability contracts.

## 6. Gap Analysis

| Feature area | Repository evidence | Documentation status | Testability with current documented approach | Primary gap |
| --- | --- | --- | --- | --- |
| Connection discovery, demo mode, background rediscovery | `src/lib/connection/connectionManager.ts`, `src/components/ConnectionController.tsx`, Playwright connection specs | Partial | Weak and indirect | No explicit oracle or action model for discovery-state transitions, sticky real-device lock, or demo interstitial behavior |
| Home machine control and RAM workflows | `src/pages/HomePage.tsx`, `src/pages/home/hooks/useHomeActions.ts`, `src/lib/machine/ramOperations.ts` | Missing | Unsafe / under-specified | No bounded-autonomy policy, no RAM/file-system oracle contract, no expected-behavior specs |
| Home quick config, LED, SID, streams, printer | `src/pages/HomePage.tsx`, home components | Missing | Mostly unverifiable | A/V capture is not enough; REST/device-state/log oracles are not defined |
| Play mixed-format playback | `src/pages/PlayFilesPage.tsx`, `src/lib/playback/playbackRouter.ts` | Explicit | Partial | Good physical-start direction, but queue-building, source access, duration propagation, and filesystem/FTP oracles are incomplete |
| Play background / lock-screen behavior | `src/pages/PlayFilesPage.tsx`, `src/lib/native/backgroundExecution.ts`, Maestro edge flows | Missing | Weak | No platform contract for background auto-advance, lock behavior, or Android vs iOS differences |
| HVSC install / ingest / cancel / resume / browse | `src/pages/playFiles/hooks/useHvscLibrary.ts`, `.maestro/smoke-hvsc*.yaml`, `.maestro/edge-hvsc-*.yaml` | Partial | Weak | No long-running workflow model, no cancellation/resume oracle contract, no download safety budget |
| Disk library, drive config, Soft IEC, delete/group/rename | `src/components/disks/HomeDiskManager.tsx`, `src/lib/disks/**` | Missing | Unsafe / partial | No non-A/V oracle set, no destructive-action constraints, no library-persistence contract |
| Config browser breadth | `src/pages/ConfigBrowserPage.tsx` | Partial | Poor | No coverage model for category breadth, no action decomposition, no per-setting oracle strategy |
| Settings, diagnostics, import/export, safety controls | `src/pages/SettingsPage.tsx`, `src/lib/diagnostics/diagnosticsExport.ts`, `src/lib/config/settingsTransfer.ts` | Missing | Poor | Existing docs do not model filesystem/share/log/trace oracles or persistence assertions |
| Docs and licenses | `src/pages/DocsPage.tsx`, `src/pages/OpenSourceLicensesPage.tsx` | Missing | Simple but unplanned | No statement of whether read-only user-visible surfaces are included or explicitly out of scope |
| Existing Playwright / Maestro / Android test infrastructure | `playwright/**`, `.maestro/**`, `android/app/src/test/**` | Partial | Underused | No integration plan for existing evidence, fixtures, native affordance coverage, or reusable cases |
| iOS execution | `.maestro/ios-*.yaml`, README iOS notes | Missing | Blocked | No iOS automation/control owner in the current three-server architecture |

## 7. Issue Register

### ATR-001

**Title**
Feature surface is materially under-scoped.

**Evidence**

- The app exposes Home, Play, Disks, Config, Settings, Docs, and Licenses routes, plus cross-cutting connection, diagnostics, and background behaviors.
- The existing docs define only one mixed-format playback-centered baseline.

**Affected Areas**

- All major pages except the curated playback case.

**Impact**

- A follow-up LLM will optimize for the wrong surface and silently omit major user-visible functionality.

**Recommendation**

- Add a repository-derived feature inventory and a mandatory coverage matrix before any further architecture or implementation work.

**Implementation Notes**

- Inventory routes, page sections, dialogs, background behaviors, and destructive operations.
- Explicitly mark read-only surfaces versus state-mutating surfaces.

**Dependency / Clarification Needed**

- None.

### ATR-002

**Title**
The oracle model is too A/V-centric for the actual app.

**Evidence**

- `c64scope-spec.md` and `agentic-test-architecture.md` focus on video/audio capture, signal assertions, and limited RAM reads.
- Repository features like diagnostics export, settings import/export, drive configuration, and app-config snapshots require filesystem, REST, trace, and persistence oracles.

**Affected Areas**

- Settings, diagnostics, disks, config, Home quick config, connection/demo, HVSC lifecycle.

**Impact**

- The agent will mistake “UI changed” or “signal changed” for “feature worked”.

**Recommendation**

- Define a multi-oracle catalog per feature: UI, REST, FTP, filesystem, diagnostics, trace, RAM, and physical A/V where applicable.

**Implementation Notes**

- For each feature, document primary oracle, fallback oracle, and disallowed weak oracles.

**Dependency / Clarification Needed**

- Human clarification is needed where expected behavior is not yet written down.

### ATR-003

**Title**
No autonomous exploration model exists beyond tool discovery.

**Evidence**

- The docs define MCP-tool discovery and playbooks, but not route discovery, page-state discovery, dialog handling, feature-flag discovery, or precondition/postcondition inference.

**Affected Areas**

- All autonomous exploratory execution.

**Impact**

- The follow-up LLM will drift into brittle scripted behavior or unsafe guesswork.

**Recommendation**

- Add page-area exploration models with action catalogs, entry conditions, visible-state markers, expected transitions, and escape/recovery paths.

**Implementation Notes**

- At minimum cover Home, Play, Disks, Config, Settings, and Docs.

**Dependency / Clarification Needed**

- None.

### ATR-004

**Title**
The architecture is Android-only but the objective is Android and iOS.

**Evidence**

- `agentic-test-architecture.md` and `c64scope-spec.md` define `droidmind` as the mobile-control owner.
- The repo contains iOS-specific Maestro flows, but no agentic iOS control-plane design.

**Affected Areas**

- Any claim of full cross-platform autonomous coverage.

**Impact**

- The current architecture cannot satisfy the stated Android+iOS objective.

**Recommendation**

- Declare this as a blocker and define an iOS control owner and lifecycle model before implementation proceeds beyond Android-only scope.

**Implementation Notes**

- Either explicitly narrow scope to Android-first or add a concrete iOS peer/tooling strategy.

**Dependency / Clarification Needed**

- Human decision required: Android-only phase first, or immediate Android+iOS architecture.

### ATR-005

**Title**
Destructive and resource-heavy actions are not bounded.

**Evidence**

- The docs bound `c64bridge` usage but not app-driven destructive actions.
- The repo exposes power off, reset, RAM overwrite, disk delete, bulk delete, flash config load/reset/save, HVSC downloads, and safety-mode changes.

**Affected Areas**

- Home, Disks, Config, Settings, Play HVSC.

**Impact**

- An autonomous agent can damage state, overuse hardware/network, or create non-deterministic lab conditions.

**Recommendation**

- Define an action-safety taxonomy and per-run mutation budget.

**Implementation Notes**

- Include allowed, guarded, forbidden, and human-confirmation-required classes.
- Require cleanup plans for every mutating case.

**Dependency / Clarification Needed**

- Human decision required for which destructive actions are allowed in unattended runs.

### ATR-006

**Title**
Existing in-app observability is not incorporated into the plan.

**Evidence**

- The app already exposes diagnostics logs, trace events, action summaries, diagnostics ZIP export, test heartbeat, and native plugin logs.
- The current docs mostly describe new `c64scope` artifacts.

**Affected Areas**

- Failure triage, oracle robustness, asynchronous workflows, native/runtime debugging.

**Impact**

- The follow-up system will recreate observability badly or miss high-value existing evidence.

**Recommendation**

- Add an observability section that explicitly reuses in-app diagnostics, traces, exports, logcat, and existing evidence bundles.

**Implementation Notes**

- Define which artifacts are authoritative for app-side state and which belong to `c64scope`.

**Dependency / Clarification Needed**

- None.

### ATR-007

**Title**
Connection/demo-mode behavior lacks a first-class specification.

**Evidence**

- `src/lib/connection/connectionManager.ts` includes startup discovery window, manual/background discovery, demo interstitials, sticky real-device lock, smoke/fuzz overrides, and transition-specific side effects.
- The agentic docs do not model these states.

**Affected Areas**

- Startup, reconnects, demo fallback, recovery, real-vs-mock correctness.

**Impact**

- The agent cannot reliably classify discovery failures or verify correct demo/real transitions.

**Recommendation**

- Add a connection-state contract with explicit states, triggers, side effects, oracles, and expected cleanup.

**Implementation Notes**

- Reuse terminology from the actual connection state machine.

**Dependency / Clarification Needed**

- Some expected behaviors need human confirmation, especially for edge timing and demo interstitial semantics.

### ATR-008

**Title**
Long-running and cancel/resume workflows are under-specified.

**Evidence**

- HVSC install/ingest/cancel/reset exists in `useHvscLibrary`.
- Disk/file import scans expose progress overlays.
- Existing Maestro flows already target HVSC lifecycle edges.

**Affected Areas**

- HVSC, local/disk import, diagnostics export, settings import, background rediscovery.

**Impact**

- The follow-up LLM will not know how long to wait, what progress monotonicity means, or how to classify interrupted states.

**Recommendation**

- Add asynchronous workflow contracts for each long-running operation.

**Implementation Notes**

- Include progress states, timeout budgets, cancel semantics, retry semantics, and final-state assertions.

**Dependency / Clarification Needed**

- Human clarification may be needed where current UX is ambiguous.

### ATR-009

**Title**
Config breadth is not decomposed into testable feature groups.

**Evidence**

- `ConfigBrowserPage.tsx` exposes the full category list and category-dependent controls.
- The current docs treat config mostly as generic “app-driven C64 control”.

**Affected Areas**

- Config browser and many Home shortcuts.

**Impact**

- Autonomous coverage will either be shallow or unsafe.

**Recommendation**

- Add a config taxonomy that groups categories by oracle type, risk, and test strategy.

**Implementation Notes**

- Separate smoke-safe categories from high-risk categories.
- Reuse existing category names from repository code and API.

**Dependency / Clarification Needed**

- Human input may be needed for high-risk categories that should never be mutated automatically.

### ATR-010

**Title**
Disk-management workflows lack explicit oracles and safety rules.

**Evidence**

- `HomeDiskManager.tsx` supports mount/eject, drive power/reset, bus/type changes, Soft IEC path, rename, group, delete, and bulk delete.
- Existing docs do not model disk-library persistence or destructive disk-library actions.

**Affected Areas**

- Disks page and Home drive summaries.

**Impact**

- The agent cannot prove that a disk action affected the real device correctly or safely.

**Recommendation**

- Add disk-management contracts with separate oracles for library state, mounted hardware state, and filesystem-visible side effects.

**Implementation Notes**

- Do not collapse mount/eject, drive config, and library curation into one “disk feature”.

**Dependency / Clarification Needed**

- Human decision required on whether delete/bulk-delete belongs in autonomous exploratory runs.

### ATR-011

**Title**
Background and lock-screen behavior is not specified per platform.

**Evidence**

- `PlayFilesPage.tsx` integrates Android background execution and due-at scheduling.
- Existing Maestro flows cover lock-screen and background execution checks.
- The agentic docs do not define Android vs iOS expectations.

**Affected Areas**

- Play auto-advance, lifecycle recovery, connection rediscovery.

**Impact**

- The follow-up LLM will not know what is a product bug versus a platform limitation.

**Recommendation**

- Document platform-specific lifecycle expectations and admissible evidence for Android and iOS separately.

**Implementation Notes**

- Include lock, unlock, background, foreground, and interruption cases.

**Dependency / Clarification Needed**

- Human clarification needed for intended iOS lock-screen behavior.

### ATR-012

**Title**
Implementation handoff quality is too weak for a follow-up LLM.

**Evidence**

- The current docs do not provide a feature coverage matrix, issue register, remediation checklist, or blockers list.
- Several phrases rely on implicit knowledge such as “where the app currently has a gap”.

**Affected Areas**

- All downstream implementation work.

**Impact**

- The next LLM will invent scope, invent oracles, or miss dependencies.

**Recommendation**

- Add explicit issue tracking, sequencing, blockers, and concrete work products.

**Implementation Notes**

- Use stable issue IDs and file-level deliverables.

**Dependency / Clarification Needed**

- None.

### ATR-013

**Title**
Existing Playwright, Maestro, and Android test assets are not used as seed knowledge.

**Evidence**

- `playwright/**` already covers diagnostics, playback, disk management, connection simulation, golden traces, and evidence bundling.
- `.maestro/**` already covers Android and iOS launch, playback entry, diagnostics, FTP browse, config persistence, HVSC lifecycle, file picker, lock/background, and RAM restore edges.
- Android JVM tests cover native plugins such as background execution, FTP, diagnostics bridge, HVSC ingestion, secure storage, and mock servers.

**Affected Areas**

- Infrastructure reuse, platform realism, observability, existing oracle hints.

**Impact**

- The follow-up system will duplicate work and ignore tested native/platform constraints.

**Recommendation**

- Add an infrastructure-reuse plan that maps existing suites to agentic coverage roles.

**Implementation Notes**

- Reuse flows as oracle hints and case seeds, not as the only runtime path.

**Dependency / Clarification Needed**

- None.

### ATR-014

**Title**
Several expected behaviors are not specified clearly enough to test autonomously.

**Evidence**

- The repository contains behavior, but not always a written contract, for:
  - background auto-advance under lock
  - demo-mode selection timing and interstitial rules
  - correct outcome for many config mutations
  - acceptable HVSC cancel/resume semantics
  - diagnostics export contents and required fields
  - what constitutes success for power, reset, and stream controls

**Affected Areas**

- Play, connection, settings, Home, Config, HVSC.

**Impact**

- The autonomous agent will guess.

**Recommendation**

- Record explicit blockers where human-written expected behavior is missing, and require those contracts before implementation of the affected cases.

**Implementation Notes**

- Do not treat “the current UI does something” as sufficient specification.

**Dependency / Clarification Needed**

- Human clarification required.

## 8. Recommended Remediation Plan

### Phase A. Re-scope the documentation set around the actual repository

- Establish Android-only vs Android+iOS scope explicitly.
- Add a repository-derived feature inventory and a coverage matrix before any further implementation design.
- Separate “baseline physical playback proof” from “full feature-surface autonomous exploratory coverage”.

### Phase B. Define the action and oracle contracts per feature area

- Introduce page/feature-specific exploration models.
- Create a multi-oracle catalog covering UI, REST, FTP, filesystem, diagnostics, traces, RAM, and C64 A/V.
- Mark each feature as directly testable, indirectly testable, blocked on instrumentation, or blocked on missing specification.

### Phase C. Add bounded-autonomy and safety policy

- Classify actions into safe/read-only, guarded mutation, destructive mutation, and prohibited.
- Define retry budgets, network budgets, download budgets, cleanup rules, and reset semantics.
- Require explicit cleanup and state-reset steps after every mutating case.

### Phase D. Integrate existing infrastructure instead of replacing it conceptually

- Reuse Playwright evidence and golden-trace semantics for app-level observability.
- Reuse Maestro flows as platform/native affordance knowledge, especially for iOS and Android lock/file-picker constraints.
- Reuse Android JVM plugin-test knowledge for native side-effect expectations and failure modes.

### Phase E. Close specification blockers

- Document expected behaviors that currently rely on inference.
- Keep unresolved behaviors in a separate blockers section so the next LLM does not silently guess.

### Sequencing Guidance For The Follow-Up LLM

1. Fix scope, inventory, and coverage mapping first.
2. Define oracles and safety policy second.
3. Resolve platform-control ownership and iOS blocker before claiming cross-platform coverage.
4. Only then update `c64scope`/architecture/implementation-plan docs.
5. Do not build new automation or artifacts from the current playback-only assumptions until the documentation set is widened.

## 9. Implementation Checklist

### Phase 0. Scope and Coverage Baseline

- [ ] Update `doc/testing/agentic-tests/agentic-test-architecture.md` to separate `baseline playback proof` from `full feature-surface autonomous coverage`.
- [ ] Add an explicit scope statement that either narrows the immediate effort to Android or defines the iOS control owner and execution model.
- [ ] Create `doc/testing/agentic-tests/agentic-feature-surface.md` with a repository-derived inventory grouped by route, page area, and cross-cutting runtime behavior.
- [ ] Create `doc/testing/agentic-tests/agentic-coverage-matrix.md` mapping every major feature area to documentation status, oracle type, automation path, and blocker state.

### Phase 1. Action Model

- [ ] Create `doc/testing/agentic-tests/agentic-action-model.md` describing route discovery, page entry conditions, dialog handling, recovery paths, and feature-flag/conditional-surface discovery.
- [ ] Define a page-specific action catalog for Home.
- [ ] Define a page-specific action catalog for Play.
- [ ] Define a page-specific action catalog for Disks.
- [ ] Define a page-specific action catalog for Config.
- [ ] Define a page-specific action catalog for Settings.
- [ ] Define a page-specific action catalog for Docs/Licenses and mark whether they are mandatory coverage or low-priority read-only coverage.

### Phase 2. Oracle and Observability Model

- [ ] Create `doc/testing/agentic-tests/agentic-oracle-catalog.md` listing, for each feature, the primary oracle, fallback oracle, and forbidden weak oracles.
- [ ] Add explicit oracle definitions for connection/demo-mode transitions.
- [ ] Add explicit oracle definitions for machine control and RAM workflows.
- [ ] Add explicit oracle definitions for playback, queue progression, and lock/background behavior.
- [ ] Add explicit oracle definitions for disk-library state, mount state, drive configuration, and Soft IEC changes.
- [ ] Add explicit oracle definitions for settings persistence, settings import/export, diagnostics export, and app-config snapshot workflows.
- [ ] Add explicit oracle definitions for HVSC download/install/ingest/cancel/resume flows.
- [ ] Update `doc/testing/agentic-tests/c64scope-spec.md` to state which assertions belong to `c64scope` and which must be satisfied using existing app diagnostics, trace, REST, FTP, or filesystem evidence.
- [ ] Add an observability section that explicitly reuses existing app diagnostics logs, traces, diagnostics ZIP export, logcat, Playwright evidence, and Maestro artifacts.

### Phase 3. Safety and Bounded Autonomy

- [ ] Create `doc/testing/agentic-tests/agentic-safety-policy.md` with action classes: read-only, guarded mutation, destructive mutation, and prohibited.
- [ ] Define per-run limits for HVSC downloads/ingests, resets, reboots, power-off actions, flash config mutations, and delete operations.
- [ ] Define cleanup contracts for disk mounts, stream toggles, config mutations, demo/mock state, and playback/background state.
- [ ] Update `agentic-test-architecture.md` to add app-level safety constraints, not just `c64bridge` constraints.
- [ ] Add explicit failure behavior for “unsafe to continue”, “cleanup required”, and “human confirmation required”.

### Phase 4. Platform and Runtime Contracts

- [ ] Add a platform section documenting Android-specific lifecycle, permissions, background execution, file-picker, and logcat evidence expectations.
- [ ] Add an iOS section documenting current execution constraints, required control owner, and known WKWebView/native limitations.
- [ ] Update the docs to reflect the real connection state machine: startup discovery, manual reconnect, background rediscovery, demo interstitial, sticky real-device lock, smoke mode, and fuzz mode.
- [ ] Define which features are unsupported or reduced on iOS until an iOS automation/control path exists.

### Phase 5. Infrastructure Reuse

- [ ] Create `doc/testing/agentic-tests/agentic-infrastructure-reuse.md` mapping existing Playwright suites to reusable oracle/evidence patterns.
- [ ] Map existing Maestro Android flows to native affordance coverage and edge-case seeds.
- [ ] Map existing Maestro iOS flows to current iOS coverage and gaps.
- [ ] Map Android JVM plugin tests to native-side assumptions and failure modes relevant to the agentic system.
- [ ] Update `c64scope-delivery-prompt.md` so the next implementation LLM must read the reuse map before adding new infrastructure.

### Phase 6. Specification Closure

- [ ] Create `doc/testing/agentic-tests/agentic-open-questions.md` with behavior questions that require human clarification before implementation.
- [ ] For each blocked feature area, record whether the blocker is missing expected behavior, missing instrumentation, missing platform support, or intentional out-of-scope.
- [ ] Update `agentic-test-implementation-plan.md` so blocked items are separated from directly implementable items.
- [ ] Add explicit acceptance criteria for the documentation remediation itself before any new server or automation implementation starts.

## 10. Blockers and Open Questions

### Blockers

- The current architecture has no iOS control owner. The three-server model as written is insufficient for the stated Android+iOS objective.
- Several high-risk user-visible behaviors do not have explicit expected-behavior contracts, so autonomous validation would currently require guesswork.

### Open Questions Requiring Human Clarification

- Is the immediate scope Android-only, or must the next implementation phase include a concrete iOS automation/control design?
- Which destructive actions are allowed in unattended exploratory runs: power off, reboot clear RAM, flash config reset/load, disk delete, bulk delete, RAM restore, device-safety mode changes?
- What is the expected behavior for lock-screen playback and next-track progression on Android and on iOS?
- What exact outcomes define success for demo-mode transitions, demo interstitial display rules, and sticky real-device lock behavior?
- What exact contents must be present in diagnostics export artifacts for the feature to be considered correct?
- Which Config categories are safe for autonomous mutation, and which must remain read-only until human approval exists?
- Is adding app-side instrumentation allowed if existing diagnostics/traces are insufficient for a reliable oracle?
- Are Docs and Licenses mandatory coverage targets or explicitly low-priority read-only targets?

## 11. Acceptance Criteria

Documentation remediation is complete only when all of the following are true:

- The documentation set contains a repository-derived feature inventory broader than the current playback-centered docs.
- Every major repository-derived feature area is mapped to documentation coverage and testability status.
- Every feature area lists its required action model and its acceptable oracle model.
- Unsafe, destructive, and resource-heavy actions are classified and bounded.
- Existing Playwright, Maestro, Android plugin-test, and diagnostics infrastructure is explicitly integrated into the plan.
- Android and iOS scope is explicit; if iOS is not yet implementable, that is called out as a blocker rather than ignored.
- Human-written expected-behavior gaps are isolated into an explicit blocker list.
- The updated implementation checklist is concrete enough for a follow-up LLM to execute without inventing scope or oracles.
- The documentation distinguishes clearly between:
  - features the app exposes
  - features the docs mention
  - features the framework can directly test
  - features that require indirect assertions
  - features blocked by missing specs or instrumentation
