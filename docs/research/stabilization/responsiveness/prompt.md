# Android Responsiveness Stabilization Prompt

Date: 2026-05-06
Type: Strict execution prompt
Primary inputs:

- [research.md](./research.md)
- [plan.md](./plan.md)

Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## Role

You are the implementation engineer responsible for shipping the full Android responsiveness stabilization described in [research.md](docs/research/stabilization/responsiveness/research.md), following the sequencing in [plan.md](docs/research/stabilization/responsiveness/plan.md).

This is not a research pass.
This is not a partial fix.
This is not permission to land Phase 1 and stop because the cold start "feels faster".

You must implement fixes for **every** research ID listed in [research.md Section 6](./research.md#6-severity-ordered-punch-list) — none may be silently dropped. After each phase, you must run the phase gate defined in [plan.md Section 5](./plan.md#5-detailed-phases) before continuing. Before declaring the work complete, you must rerun the live measurements from [research.md Section 5](./research.md#5-live-measurements-summary) on the attached Pixel 4 against a real `u64` and record the before/after deltas in [plan.md Section 8](./plan.md#8-live-measurement-results).

## Objective

Bring the Android build of C64 Commander to production responsiveness, defined as:

- cold start ≤ 500 ms on Pixel 4 (debug APK)
- 12-stroke CPU Speed slider drag with concurrent Telnet activity: ≤ 5 % janky frames, p99 ≤ 32 ms
- 5-tab navigation: ≤ 2 % janky frames, p99 ≤ 32 ms
- 16-stroke isolated slider drag: 0 % janky (no regression of slider work)
- zero `Msg: undefined` spam in foreground logcat
- zero ENOENT noise from `c64u-smoke.json` at cold launch
- zero CapacitorHttp/CapacitorCookies plugin lines for C64U URLs in logcat
- no production chunk above 250 KB gzipped
- on-device hostname-based connection (mDNS) succeeds, or fails with an actionable error

Functional correctness must be preserved end-to-end:

- the slider stabilization already in place must not regress
- every existing test must still pass
- no exception is silently swallowed in any changed code path

## Authoritative Inputs

Read these before editing:

- `README.md`
- `.github/copilot-instructions.md`
- `AGENTS.md` (especially Phase 5a — deploy and validate on Pixel 4)
- `docs/ux-guidelines.md`
- [research.md](./research.md) — especially Sections 1–6 and Section 9 (reproduction notes)
- [plan.md](./plan.md) — especially Sections 4 (phase summary), 5 (detailed phases), 6 (research-ID acceptance), 8 (measurements table)

Then read the smallest relevant set of implementation files for the current phase, scoped by [plan.md Section 3](./plan.md#3-impact-map). Do not pre-load all impacted files at once.

## Non-Negotiable Rules

1. [research.md](./research.md) is authoritative for the problem statement, evidence, and acceptance conditions.
2. [plan.md](./plan.md) is authoritative for sequencing, gating, and measurement cadence.
3. Implement the phases in the order defined by the plan: 0 → 1 → 2 → 3 → 4 → 5 → 6. Do not skip ahead.
4. **After each phase, run the phase gate defined in [plan.md Section 5](./plan.md#5-detailed-phases). Do not start the next phase until the gate is green.**
5. **After each non-trivial change inside a phase, run the focused test set for the touched files** (Vitest with explicit paths, plus `cd android && ./gradlew testDebugUnitTest` when Kotlin is touched). This is the test-cadence rule from the plan; its purpose is to catch silent breakage as soon as it happens, not at the end of a phase.
6. Before declaring the entire task complete, rerun the live measurement scenarios from [research.md Section 5](./research.md#5-live-measurements-summary) on the attached Pixel 4 and fill the **After** and **Delta** columns of [plan.md Section 8](./plan.md#8-live-measurement-results). Every "Target" must show "Pass". If any does not, iterate or document a concrete blocker.
7. Global branch coverage must remain `>= 91%` after every phase, not just at the end.
8. Do not introduce arbitrary sleeps, weaken assertions, comment-out failing tests, skip tests, or hide failures to make a phase gate go green.
9. Do not silently swallow exceptions; surface failures with context per the CLAUDE.md exception-handling rule.
10. Every bug fix or migration edge case discovered during implementation must get a targeted regression test in the narrowest deterministic suite that proves it.
11. Do not regress the slider stabilization already in place. The slider primitive (`useDeviceBoundSlider`), the firmware-error-aware write path (`assertConfigWriteAccepted`), and the migrated call sites must continue to work end-to-end.
12. Do not claim tests, builds, screenshot updates, or device deploys you did not actually run.
13. Do not widen scope. The "Out of Scope" list in [plan.md Section 7](./plan.md#7-out-of-scope) is binding.

## Required End State

The implementation is only complete when every item below is true.

### HTTP transport (Phase 1)

- `CapacitorHttp.enabled = false` in [capacitor.config.ts](../../../../capacitor.config.ts) and the regenerated `android/app/src/main/assets/capacitor.config.json`
- `tests/unit/capacitorConfig.test.ts` exists and fails when `CapacitorHttp.enabled` is `true` without an explicit exemption
- on-device logcat has no `D/Capacitor … Handling CapacitorHttp request` lines for C64U URLs and no `I/CapacitorCookies` lines for C64U URLs
- `INTERACTIVE_CONTROL_TIMEOUT_MS = 1500` and `BACKGROUND_REQUEST_TIMEOUT_MS = 3000` are defined and used in [src/lib/c64api.ts](../../../../src/lib/c64api.ts); user-tappable controls use the interactive budget; polling and prefetch use the background budget

### Runtime correctness (Phase 2)

- `MdnsResolverPlugin.kt` exists and exposes a `resolve(host)` method backed by Android `NsdManager`
- `src/lib/native/mdnsResolver.ts` provides a typed wrapper plus a web stub
- the discovery probe in [src/lib/connection/connectionManager.ts](../../../../src/lib/connection/connectionManager.ts) uses the resolver on Android when the configured host is bare-name
- DNS failure surfaces a user-actionable error in the OFFLINE banner and the diagnostics ring buffer; it is no longer logged at `debug` only
- the smoke-mode loader probes `c64u-smoke.json` via `Filesystem.stat` (or equivalent) before reading; cold-launch logcat has zero ENOENT stack traces for that path
- the `Msg: undefined` Capacitor Console source has been identified, replaced with structured `addLog(...)`, and a 30-second Home page session emits zero such lines
- an ESLint rule bans `console.log` in `src/lib/telnet/**` and `src/lib/diagnostics/**`
- a transport-error normalizer (`normalizeTransportError`) maps DNS, no-route, refused, reset/EPIPE, and timeout failures to user-actionable messages
- [MainActivity.kt](../../../../android/app/src/main/java/uk/gleissner/c64commander/MainActivity.kt) `ensureCapacitorPluginAssetPath` distinguishes recoverable from unrecoverable failures and throws on the unrecoverable branch; an Android JVM unit test covers both branches

### Bundle composition (Phase 3)

- `vite.config.ts` defines an explicit `manualChunks` map (`vendor-react`, `vendor-router`, `vendor-query`, `vendor-radix`, `vendor-ui`, `vendor-motion`, `vendor-icons`, `vendor-hvsc`, `vendor-misc`)
- `npm run build` produces no chunk above 250 KB gzipped
- a `scripts/check-bundle-budgets.mjs` (or equivalent) is wired into `npm run lint` and fails when the cap is exceeded
- `PlayFilesPage` lazy-loads `useHvscLibrary` only when the HVSC source pane opens, and lazy-loads `usePlaybackController` only when a track is queued
- cold-start time on Pixel 4 is ≤ 500 ms; logcat MimeMap long monitor contention is `< 100 ms` or fewer than 2 events per cold launch

### Module size and re-render scope (Phase 4)

- every file flagged in [research.md R-MOD-1](./research.md#r-mod-1-high-several-pages-and-hooks-blow-past-the-6001000-line-modularity-guardrail) is below 1000 LOC after the split, and below 600 LOC where reasonably possible
- `c64api.ts` is split into `src/lib/c64api/{transport,system,config,playback,disks}.ts` with a thin re-export at the original path; existing imports do not break
- `healthCheckEngine.ts` is split into per-probe modules under `src/lib/diagnostics/probes/`
- `HomeDiskManager.tsx`, `DiagnosticsDialog.tsx`, `SettingsPage.tsx`, `PlayFilesPage.tsx`, `LightingStudioDialog.tsx` are each split into multiple sibling components per the plan
- `useHvscLibrary.ts`, `hvscIngestionRuntime.ts`, `usePlaybackController.ts`, `savedDevices/store.ts` are each split by responsibility while preserving public API
- `HomePage.tsx` is reduced by hoisting Quick Actions, Quick Config, Drives, Streams, Lighting Summary, Audio Mixer into siblings
- `HvscIngestionPlugin.kt`, `HvscArchiveExtractor.kt`, `FolderPickerPlugin.kt` are split by responsibility
- `Thread.sleep(50)` in `HvscArchiveExtractor.kt` is replaced with a signal-based wait (`BlockingQueue.poll(50, MILLISECONDS)` or `CountDownLatch.await(50, MILLISECONDS)`)
- tab-navigation jank ≤ 2% and HomePage hydration during tab return shows no frame above 50 ms

### Background polling and reconciliation (Phase 5)

- `useTelnetActions()` caches per-connection support detection; session-startup probes are consolidated; completed Telnet reads are marshalled through `MessageChannel.postMessage` (or equivalent) so they never land inside a frame budget
- `c64PollingGovernance.ts` exposes a `pollingPauseRegistry` with `acquirePause()` / release semantics
- `useDeviceBoundSlider.ts` acquires a polling pause on first drag tick and releases on commit + reconciliation settle
- the optimistic-override store in [src/hooks/useAuthoritativeConfigValueState.ts](../../../../src/hooks/useAuthoritativeConfigValueState.ts) uses a trim/coerce-aware equality function instead of strict `Object.is`; non-default callers can supply a custom comparator
- 12-stroke CPU Speed slider drag with Telnet active shows ≤ 5% jank and 0 frames above 32 ms

### Documentation, validation, closure (Phase 6)

- [docs/ux-guidelines.md](../../../../docs/ux-guidelines.md) documents:
  - the Android responsiveness invariants (cold start, slider drag, tab transition budgets)
  - the polling-pause contract during user-driven interaction
  - the mDNS / IP fallback story for Android
- [docs/testing/test-architecture.md](../../../../docs/testing/test-architecture.md) documents the frame-stat regression scenarios introduced in phases 1, 3, and 5
- [README.md](../../../../README.md) "First Connection" section mentions IP fallback on Android until mDNS is broadly reliable
- [plan.md Section 8](./plan.md#8-live-measurement-results) is fully populated with After numbers, Deltas, and Pass markers; **every Target shows Pass**

## Required Architectural Decisions

Implement these decisions directly. Do not leave them open. Document the chosen value, not just the option set.

### HTTP transport

- Disable `CapacitorHttp` globally for this app; do not enable it for any LAN URL pattern.
- Add a CI guard so the flag cannot regress without an explicit exemption comment in `capacitor.config.ts`.
- Define exactly two production timeout buckets for non-upload, non-playback requests: `INTERACTIVE_CONTROL_TIMEOUT_MS = 1500` and `BACKGROUND_REQUEST_TIMEOUT_MS = 3000`. Discovery uses progressively shorter retry budgets so the OFFLINE banner appears within ~3 s.

### Hostname resolution

- Add `MdnsResolverPlugin` for Android using `NsdManager`.
- The resolver is the first lookup step on Android when the host is bare-name; if it fails, surface an actionable error.
- Web and iOS keep current resolution; the plugin's web stub is a no-op.

### Bundle composition

- The `manualChunks` map is explicit and is the source of truth. Do not rely on Rollup defaults.
- Bundle budgets: 250 KB gzipped per chunk in production. Enforced by lint guard.

### Telnet off the render thread

- Telnet menu reads complete onto a non-React message channel (`MessageChannel`/`requestIdleCallback`); React state updates derived from those reads happen on `idle` ticks during user interaction.
- Per-connection support detection is cached for the lifetime of the connection; only a connection-state change forces a re-probe.

### Polling pause contract

- A single `pollingPauseRegistry` mediates between sliders/dialogs and `refetchInterval`-driven queries.
- The slider hook acquires a pause on first drag tick, releases on commit + reconciliation settle.
- Drives idle interval rises to 60 s when no recent user mount/unmount; falls back to 30 s for 2 min after one.

### Optimistic-override reconciliation

- Default equality is trim-aware for strings and coerces single-token numerics across number ↔ string.
- Callers may supply a custom equality function for non-default cases.
- The new equality must be unit-tested for the trim and number/string drift cases that originally produced the CPU Speed freeze.

## Execution Model

Implement in the phases defined in [plan.md Section 5](./plan.md#5-detailed-phases). The minimum expected order is:

0. Baseline measurement and harness check-in.
1. HTTP transport: `CapacitorHttp`, cookies, timeout buckets.
2. Runtime correctness: mDNS, ENOENT, console-undefined, transport-error normalizer, MainActivity fail-fast.
3. Bundle composition: vendor-chunk split, lazy-load Play page internals, bundle-budget guard.
4. Module size and re-render scope: TS file splits in the order defined by the plan, then Kotlin plugin splits.
5. Background polling and reconciliation: drives-pause-during-drag, Telnet off render thread, trim/coerce equality.
6. Documentation, live re-measurement, completion validation.

Do not start broad demolition (Phase 4 splits) before the HTTP transport, runtime correctness, and bundle composition fixes have stabilized; otherwise large diffs will collide and the test gate becomes unreadable.

## Required Tests and Regression Coverage

Your implementation must include targeted coverage for, at minimum:

- Phase 1
  - `tests/unit/capacitorConfig.test.ts` fails when `CapacitorHttp.enabled = true` without exemption
  - timeout-bucket usage assertions in `tests/unit/c64api.test.ts`
- Phase 2
  - mDNS resolver path: Android resolves `u64` via the plugin; failure surfaces an actionable error in `connectionManager`
  - smoke-mode loader uses stat-then-read; absence of file does not log ENOENT at ERROR
  - structured `addLog` replaces the `Msg: undefined` source; ESLint guard enforces the new policy
  - `normalizeTransportError` maps each error class to the expected message
  - `MainActivityAssetPathTest.kt` covers recoverable and unrecoverable branches
- Phase 3
  - bundle-budget guard fails when any chunk exceeds 250 KB gzipped
  - lazy-loading of HVSC library and playback controller in `PlayFilesPage` (a unit test that asserts the dynamic-import boundary, plus a Playwright test that asserts the initial PlayFilesPage chunk does not pull in the HVSC bundle)
- Phase 4
  - per-split focused tests for every file split; existing test paths must continue to work or be updated minimally
  - HomePage subtree-state test confirming Quick Actions and Quick Config no longer cause a top-level rerender on every poll
  - Android JVM unit tests for split Kotlin plugins
- Phase 5
  - drives poll skips during a sustained slider drag and resumes after commit
  - trim/coerce-aware reconciliation clears pending for `" 4"` vs `4` and for whitespace drift
  - Telnet menu read does not schedule React work during a slider drag
- Phase 6
  - Playwright + Android emulator scenario: 10-second CPU Speed drag asserts ≤ 2 % jank and p99 ≤ 32 ms
  - frame-stat regression scenario from [plan.md Section 5 Phase-3 gate](./plan.md#phase-3-bundle-composition) and [Phase-5 gate](./plan.md#phase-5-background-polling-and-reconciliation)

Add or update the narrowest deterministic tests in the relevant suites. Do not let coverage of touched files drop below the pre-change number.

## Required Validation

Because this task changes executable behavior, after the final phase the validation must include:

- `npm run lint`
- `npm run test`
- `npm run test:coverage` with global branch coverage `>= 91%`
- `cd android && ./gradlew testDebugUnitTest jacocoTestReport`
- `npm run build`
- `npm run cap:build`
- `npm run android:apk`
- APK installed on the attached Pixel 4 (preferred serial prefix `9B0`); on-device validation of:
  - cold start to Home with `Device: Ultimate-…-… HEALTHY` reached within ≤ 3 s
  - CPU Speed slider drag remains smooth
  - Tab navigation Home → Play → Disks → Config → Settings → Home is smooth
  - Quick Actions Reset / Reboot / Pause respond within their interactive budget
  - Settings → Saved Devices → connect by hostname `u64` works (mDNS path)
- live measurement re-run on the same Pixel 4 + `u64`, with [plan.md Section 8](./plan.md#8-live-measurement-results) fully populated; **every Target must show Pass**

If visible documented UI changes (the README example, or copy edits to the OFFLINE banner / Add-Device dialog), refresh only the smallest affected screenshots under `docs/img/`. Do not regenerate screenshots for behavior-only stabilization.

## Output Requirements

At completion, report:

- which phases of [plan.md](./plan.md) were completed
- which research IDs are now closed, with their code, test, and measurement anchors
- the final-gate validation commands you actually ran, with their results
- the populated [plan.md Section 8](./plan.md#8-live-measurement-results) table (after-numbers and deltas)
- whether the APK was deployed and validated on the Pixel 4, or a documented hardware/adb blocker
- whether any documentation or screenshot updates were made
- any remaining known risk or follow-up item — explicitly note that nothing was silently dropped

## Failure Rules

Stop and report a blocker instead of guessing if any of the following occurs:

- disabling `CapacitorHttp` causes a regression that cannot be diagnosed within the scope of this task (e.g. a previously-undocumented dependency on the interceptor)
- the Android `NsdManager` mDNS path proves unreliable on the test network and the actionable-error UX cannot be validated end-to-end
- the bundle-budget guard cannot be satisfied without removing functionality (e.g. a single non-tree-shakeable dependency exceeds 250 KB gzipped)
- a TS or Kotlin file split exposes hidden coupling that requires a wider rewrite than the plan assumes
- the polling-pause contract conflicts with an existing `refetchInterval` semantics that cannot be migrated within this task
- live measurement after Phase 6 misses a target that cannot be improved without a deeper architectural change
- on-device validation cannot be performed because the Pixel 4 is unreachable or the C64U is unreachable; in this case document the blocker, do not claim success
- any phase-gate test failure cannot be fixed inside the phase without violating the non-negotiable rules

A blocker report must include: which research ID is affected, what was attempted, what the observed failure mode is, and what wider change would be required. Do not silently move on or downgrade scope.
