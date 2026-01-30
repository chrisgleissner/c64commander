# C64 Commander: Tracing System Implementation (Execution Plan)

## Assumptions + Ambiguities
- [x] Authoritative spec is [doc/tracing.md](doc/tracing.md). This matches the “C64 Commander – Tracing Specification” referenced in the prompt.
- [ ] Ambiguities recorded during implementation:
  - [x] Action origin defaults: `useActionTrace()` uses `user` origin; implicit actions created for REST/FTP use `system` origin. No additional public API exists to set `automatic` origin yet.

## Phase 0: Plan bootstrap
- [x] Create live tracing plan in this file without deleting prior plans.

## Phase 1: Discovery + scaffolding
- [x] Inventory existing diagnostics UI, REST/FTP clients, connection routing, and test harnesses.
- [x] Identify where to inject action tracing without changing business flow.
- [x] Identify existing diagnostics export/share mechanisms to extend for traces.

## Phase 2: Core tracing infrastructure
- [x] Add trace session store (rolling 20-minute retention, time-based eviction).
- [x] Define trace event types and redaction utilities.
- [x] Implement trace capture with correlation enforcement and error recording.

## Phase 3: Zero-noise action tracing API
- [x] Implement `useActionTrace(componentName?)` and action name inference.
- [x] Auto-capture UI + device + playback context via TraceContextBridge.
- [x] Support optional scoped sub-traces.

## Phase 4: REST + FTP instrumentation
- [x] Wrap REST client via proxy with request/response trace events.
- [x] Add backend decision event emitted once per correlation.
- [x] Add FTP operation tracing with capture-time redaction.
- [x] Ensure implicit root actions for out-of-trace network calls.

## Phase 5: Storage + export
- [x] Expose clear/get APIs to app and Playwright.
- [x] Add ZIP export with `trace.json` + `app-metadata.json`.
- [x] Trigger export on user action, test completion, and error scenarios (auto-export on trace error).

## Phase 6: UI integration
- [x] Add Settings → Diagnostics → Traces overlay.
- [x] Include raw JSON viewer with read-only controls.
- [x] Add Clear and Export controls.

## Phase 7: Playwright + golden traces
- [x] Add Playwright helpers: `clearTraces()`, `getTraces()`.
- [x] Instrument ≥10% high-value tests with trace assertions and export/recording.
- [x] Add local `--record-traces` mode and CI golden comparison.

## Phase 9: Trace assertion configuration + coverage expansion (10% → 50%)
- [x] Document trace assertion opt-in/out model, strict vs non-strict, and enforcement.
- [x] Document golden trace recording workflow and normalization rules (trace.json/meta.json/app-metadata.json).
- [x] Refactor Playwright trace helpers to centralize configuration and assertions.
- [x] Expand trace assertions to ≥50% of Playwright e2e suites.

### Phase 9 suite coverage tracker
- [x] audioMixer.spec.ts — trace assertions added (config update REST)
- [x] configVisibility.spec.ts — trace assertions added (demo config REST)
- [x] connectionSimulation.spec.ts — trace assertions updated (drives REST)
- [ ] demoConfig.spec.ts — deferred (no backend interactions)
- [x] demoMode.spec.ts — trace assertions added (save & connect REST)
- [x] diskManagement.spec.ts — trace assertions updated (drive power REST)
- [ ] featureFlags.spec.ts — deferred (UI-only)
- [ ] ftpPerformance.spec.ts — deferred (performance-only; trace assertions TBD)
- [x] homeConfigManagement.spec.ts — trace assertions added (config POST)
- [ ] hvsc.spec.ts — deferred (HVSC flow uses mock bridge; trace coverage TBD)
- [x] itemSelection.spec.ts — trace assertions added (FTP list)
- [ ] layoutOverflow.spec.ts — deferred (visual-only)
- [ ] musicPlayer.spec.ts — deferred (empty spec)
- [x] navigationBoundaries.spec.ts — trace assertions added (drive mount REST)
- [x] playback.part2.spec.ts — trace assertions added (FTP list)
- [x] playback.spec.ts — trace assertions updated (runner/config REST)
- [x] playlistControls.spec.ts — trace assertions added (runner REST)
- [ ] screenshots.spec.ts — deferred (visual-only)
- [x] settingsConnection.spec.ts — trace assertions added (info REST)
- [x] settingsDiagnostics.spec.ts — trace assertions added (info REST)
- [ ] ui.spec.ts — deferred (UI-only)
- [ ] uxInteractions.spec.ts — deferred (UI-only)
- [ ] ctaCoverage.spec.ts — deferred (coverage-only)
- [ ] coverageProbes.spec.ts — deferred (coverage-only)

## Phase 8: Verification loop
- [x] Run unit tests, Playwright tests, lint, and build early + often.
- [x] Resolve failures immediately and document in this plan.

### Phase 8 updates
- [x] Unit tests: `npm run test`
  - Fixed `c64api` timeout mapping test to deterministically simulate `Request timed out` (no fake timers).
- [x] Lint: `npm run lint`
- [x] Build: `npm run build`
- [x] Playwright CI mirror + trace validation: `RECORD_TRACES=1 npm run test:e2e:ci`
- [x] Full local build: `./local-build.sh`
  - Note: `./local-build.sh --install` failed installing APK due to signature mismatch on the connected device; reran without install to complete the build.
- [x] Playwright runs during trace expansion:
  - `npm run test:e2e` (multiple runs during trace assertion updates)
  - `npm run test:e2e:ci`
  - `RECORD_TRACES=1 npm run test:e2e:ci`
- [x] Unit tests re-run: `npm run test`
- [x] Lint re-run: `npm run lint`
- [x] Build re-run: `npm run build`
- [x] Full local build re-run: `./local-build.sh`

---

# Plan: Deterministic Tracing + Golden Trace Stability

## Spec + docs
- [x] Update tracing spec to define deterministic numeric IDs and reset semantics.
- [x] Document trace stabilization guarantees (timestamps/relativeMs/host normalization + irrelevant field removal).
- [x] Document golden trace lifecycle and git policy.

## Runtime tracing changes
- [x] Replace UUID generation with deterministic monotonic ID provider for event + correlation IDs.
- [x] Expose test-only reset API for trace ID counters via tracing bridge.
- [x] Ensure trace session reset clears IDs and trace buffer deterministically.

## REST config usage changes
- [x] Audit config fetch usage and replace broad category fetches with item-level endpoints where possible.
- [x] Keep batch updates only where required by config snapshot/apply semantics.
- [x] Update mocks or helpers as needed for item-level calls.

## Test harness + assertions
- [x] Update Playwright trace helpers to reset trace IDs at test start.
- [x] Update trace comparison normalization for numeric IDs + deterministic checks.
- [x] Update trace assertions to match item-level config endpoints.

## Golden trace lifecycle
- [x] Update .gitignore to keep golden traces tracked.
- [x] Ensure golden traces recorded to test-results/traces/golden are committed.

## AGENTS.md update
- [x] Add Golden Trace Stewardship section and rules for LLM agents.

## Verification
- [x] Run unit tests, lint, build.
- [x] Run Playwright with trace recording + validation.
- [x] Run full local build (`./local-build.sh`).

---

# C64 Commander: Playlist + Playback State + SID Volume + Home Layout + HTTP 400 Regression

## Phase 1: Inventory
- [ ] Read key files for current behavior (API client, playback, routing, UI pages, hooks)
- [ ] Locate demo-mode auto-switch logic and transport/host resolution
- [ ] Identify Play page playlist UI implementation and styles
- [ ] Identify playback state storage and observers
- [ ] Identify SID volume propagation path
- [ ] Identify Home page SID layout + data source
- [ ] Identify Playwright mock server and in-app demo mock wiring

## Phase 2: Investigation (forensic, evidence-based)
- [x] Identify commit(s) introducing automatic demo mode
- [x] Identify known-good commit (~1 week ago) where playback and state were correct
- [ ] Diff focus areas:
  - [ ] Transport + host resolution
  - [ ] Demo mode routing and switches
  - [ ] SID playback upload logic
  - [ ] Playback state store/restore/subscriptions
  - [ ] Volume control propagation
  - [ ] Playwright test infra and mocks (in-app vs external mock)
- [ ] Capture and compare HTTP requests:
  - [ ] Device reset (working)
  - [ ] Local SID playback start (failing)
- [ ] Explain why reset works while playback fails
- [ ] Record error output verbatim in notes:
  - [ ]
  ```
  [2026-01-29T22:27:22.560Z] ERROR - PLAYBACK_START: Playback failed
  {
    "operation": "PLAYBACK_START",
    "description": "HTTP 400",
    "item": "1_45_Tune.sid",
    "error": {
      "name": "Error",
      "message": "HTTP 400",
      "stack": "Error: HTTP 400\n    at H2.playSidUpload (https://localhost/assets/index-BoC9eGPX.js:344:15007)\n    at async QY (https://localhost/assets/index-BoC9eGPX.js:394:65712)\n    at async https://localhost/assets/index-BoC9eGPX.js:394:130809\n    at async https://localhost/assets/index-BoC9eGPX.js:394:134820"
    }
  }

  [2026-01-29T22:27:22.553Z] ERROR - Playback failed
  {
    "source": "local",
    "path": "/0-9/1_45_Tune.sid",
    "category": "sid",
    "error": "HTTP 400"
  }
  ```
- [ ] Summarize root cause + fix strategy

### Investigation updates (confirmed)
- [x] Confirmed root cause (HTTP 400): multipart SID upload path uses manual FormData serialization + `CapacitorHttp`, which changes multipart boundaries/transfer semantics and is rejected by Ultimate firmware. Other endpoints use octet-stream or query params and are unaffected.
- [x] Close speculative branches for this issue: DNS/host resolution/auth/smoke/fuzz/timeouts are NOT the root cause of SID upload failures.
- [x] Fix strategy: treat SID multipart upload as an exception; use `fetch` + `FormData` on all platforms and do not set `Content-Type` manually.

## Phase 3: Fixes
- [x] Fix HTTP 400 local SID playback regression
- [x] Preserve playback state across navigation (playback session rebind)
- [x] Fix Play page volume semantics (only enabled SIDs, no enable toggles)
- [x] Fix Home page SID layout and live status updates
- [x] Align playlist UI to required two-line structure and interactions
- [x] Enforce naming: SID Socket 1/2, UltiSID 1/2

## Phase 4: Tests
- [x] Add/extend unit/integration tests for playback state persistence
- [x] Add tests for volume propagation to enabled SIDs only
- [x] Add tests for Home SID layout and live updates
- [x] Strengthen Playwright REST assertions against real C64U mock
- [x] Ensure in-app demo mock vs external mock are explicitly distinguished
- [x] Add evidence artifacts on failures

## Phase 5: UI
- [ ] Verify playlist UI line structure and interactions
- [ ] Verify Home SID layout and live updates
- [ ] Verify Play page volume controls and disabled SID behavior

## Phase 6: Validation
- [x] Run unit tests: `npm run test`
- [x] Run lint: `npm run lint`
- [x] Run typecheck: `npx tsc --noEmit`
- [x] Run build: `npm run build`
- [x] Run e2e tests: `npm run test:e2e`
- [x] Run Android build: `npm run cap:build`

## Phase 7: Cleanup
- [ ] Update documentation if needed (README/doc)
- [ ] Final summary with evidence and test results

## Root cause + Fix strategy
**Confirmed root cause (HTTP 400 local SID playback):**
- `POST /v1/runners:sidplay` is the only multipart endpoint. The current native path serialized `FormData` via `new Response(form)` and sent it via `CapacitorHttp`, changing multipart boundaries/transfer semantics. Ultimate firmware rejects this payload (HTTP 400).
- Other playback paths (`PUT ...?file=...`, octet-stream uploads) are unaffected, so reset and filesystem/FTP playback still work.

**Fix strategy:**
- Treat SID multipart upload as an exception and always use `fetch` + `FormData` (no manual `Content-Type`).
- Keep all other transport logic unchanged.

Confirmed: The HTTP 400 regression in local SID playback is caused by the native multipart upload path for `POST /v1/runners:sidplay`. The current implementation serializes `FormData` into a `Uint8Array` and sends it via `CapacitorHttp`, which alters multipart boundaries and transfer semantics. The Ultimate firmware rejects this payload. `PUT /v1/runners:sidplay?file=...` (FTP/FS) and other upload endpoints remain functional because they use query params or `application/octet-stream`. Fix: always use `fetch` + `FormData` for SID uploads and do not set `Content-Type` manually. Keep other transport logic unchanged.

## Evidence log
- Commit introducing automatic demo mode: merge [0867237] (feat/automatic-demo-mode). Demo mode baseline changes in [6bd4e44].
- Known-good baseline for SID upload behavior: [0cf34df] (pre-auto-demo), where `playSidUpload` used `fetch` with `FormData`.
- Regression evidence: error logs captured in Phase 2 (HTTP 400 on `PLAYBACK_START` for local SID upload).
- API requirement: OpenAPI spec for `/v1/runners:sidplay` requires multipart `file` field with 1–2 binary parts.
- Code diff evidence: `playSidUpload` changed from `fetch(formData)` to native multipart serialization via `CapacitorHttp` (now reverted).

