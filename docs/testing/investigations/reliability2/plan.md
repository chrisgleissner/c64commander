# Reliability 2 Implementation Plan

Date: 2026-03-06
Source: `docs/testing/investigations/reliability2/analysis.md`

## 1. Goal

Close R2-1..R2-14 with deterministic behavior, explicit failure reporting, reproducible tests, and validated Android real-device connectivity.

## 2. Execution order

1. R2-9 Android transport regression fix hardening (already hotfixed, keep guarded).
2. R2-11 HVSC native archive compatibility remediation.
3. R2-12 HVSC state consistency convergence.
4. R2-10 hostname fallback/discovery resilience.
5. R2-1 HVSC cancel convergence (state-machine correctness).
6. R2-2 Android FTP timeout/cancel hardening.
7. R2-6 non-song auto-advance fallback duration.
8. R2-3 source navigator stale-request correctness.
9. R2-5 playback repository local `sourceId` recovery.
10. R2-7 volume failure reporting/unhandled promise safety.
11. R2-4 disk-library device isolation.
12. R2-8 HVSC listener lifecycle cleanup race.
13. R2-13 Android service-worker startup noise cleanup.
14. R2-14 RAM dump/restore parity with working shell scripts.

## 3. Issue plans

### R2-1 HVSC cancel convergence

Implementation:

1. Introduce explicit cancellation sentinel/class and branch on `classifyError(...).category === "cancelled"` in both top-level ingest catch blocks.
2. Keep final state deterministic for cancellation (`idle` + `Cancelled`), never overwrite with `error`.
3. Ensure emitted progress uses cancellation stage/message, not generic `error` stage.

Tests:

1. Add unit tests to `tests/unit/hvsc/hvscIngestionRuntime.test.ts` for cancel during install/update and cancel during cached ingest.
2. Assert final state is cancelled/idle and no terminal `error` overwrite occurs.

Acceptance:

1. Cancel requests never finish with `ingestionState: "error"` unless root cause is non-cancel failure.

### R2-9 Android transport regression (implemented + harden)

Implementation:

1. Keep [capacitor.config.ts](../../../../capacitor.config.ts) with `server.androidScheme: "http"` for Android-hosted WebView runtime.
2. Keep `CapacitorHttp.enabled: true` so `fetch`/XHR use native transport on Android and bypass WebView mixed-content/CORS limitations for C64U HTTP APIs.
3. Add regression notes in release checklist to avoid accidental rollback of either switch.

Tests:

1. Add Android integration smoke test/assertion for startup probe to real host (`/v1/info`) without demo fallback.
2. Add unit guard test over effective runtime config serialization if feasible.

Acceptance:

1. Android startup with reachable C64U does not enter demo mode due browser transport policy.

### R2-2 Android FTP timeout/cancel hardening

Implementation:

1. Configure Apache `FTPClient` connect timeout, default timeout, and data timeout before connect/retrieve.
2. Add plugin-level per-call timeout option with safe default.
3. Add cancellation hook or bounded worker strategy so blocked task cannot stall queue indefinitely.
4. Surface timeout reason in `call.reject` and structured logs.

Tests:

1. Extend `android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt` with timeout behavior tests.
2. Add test for one hung call not blocking subsequent calls beyond bounded timeout.

Acceptance:

1. FTP list/read calls terminate with deterministic timeout errors under network stall.

### R2-11 HVSC native archive compatibility

Implementation:

1. Audit current Apache Commons Compress support matrix versus live HVSC baseline method chain `[3, 4, 1]`.
2. Upgrade decoder path or add fallback extraction backend for unsupported 7z method sets.
3. Add preflight archive-method detection so unsupported formats fail fast with actionable error.

Tests:

1. Add Android instrumentation/unit fixture that reproduces method `[3, 4, 1]` and asserts successful extraction (or deterministic classified failure with fallback trigger).
2. Add ingestion plugin test for unsupported-method classification branch.

Acceptance:

1. Baseline HVSC archive ingests successfully on target Android devices, or falls back automatically to a supported extraction path.

### R2-12 HVSC status-state convergence

Implementation:

1. Make failure transitions atomic across `ingestionState`, extraction status, and summary/error payload.
2. Ensure terminal failure cannot leave extraction marked `in-progress` or install state `installing`.
3. Consolidate status writes in a single reducer/transaction-style helper.

Tests:

1. Add runtime tests asserting no mixed terminal states after ingestion failure.
2. Add Playwright/diagnostics assertion that UI status and persisted state agree after failure.

Acceptance:

1. Any HVSC failure ends in one coherent terminal state (`error`) with matching UI + persisted state.

### R2-10 Hostname fallback/discovery resilience

Implementation:

1. Add DNS-failure classification at discovery layer and surface explicit host-resolution guidance in UI.
2. Prefer last-known-good IP fallback when hostname resolution fails and fallback is trusted.
3. Consider optional mDNS/bonjour discovery path for local `c64u` naming assumptions.

Tests:

1. Add discovery tests covering `unknown host` for `c64u` with reachable fallback IP.
2. Add UI tests for interstitial messaging and fallback-save path.

Acceptance:

1. Users are not trapped in demo mode when hostname DNS fails but device is reachable by IP.

### R2-6 Non-song auto-advance fallback duration

Implementation:

1. Apply `durationFallbackMs` for non-song categories when item duration is absent.
2. Ensure playlist item duration is updated to resolved fallback when playback starts.
3. Confirm guard arming behavior is unchanged for explicit per-item durations.

Tests:

1. Add integration-level unit tests for `usePlaybackController` with `prg`/`crt`/`disk` entries lacking duration.
2. Add Playwright coverage for non-song auto-advance using only global duration setting.

Acceptance:

1. Non-song tracks auto-advance on configured duration when no per-item duration exists.

### R2-3 Source navigator stale-request correctness

Implementation:

1. Guard catch path with token check before mutating `error`.
2. Guard `setIsLoading(false)` with token check so old request cannot clear new request loading.
3. Keep loading indicator hide behavior token-scoped.

Tests:

1. Extend `tests/unit/sourceNavigation/useSourceNavigator.test.ts` with stale-failure ordering tests.
2. Add assertion that stale request cannot flip `isLoading` false while newer request is pending.

Acceptance:

1. Only the newest in-flight request can mutate navigator state.

### R2-5 Local `sourceId` recovery in repository hydration

Implementation:

1. Persist local source identifier explicitly in repository track data (new field or encoded locator contract).
2. Add backward-compatible hydration path: parse legacy records from `trackId` when explicit field absent.
3. Keep existing data readable without migration failure.

Tests:

1. Add repository-hydration tests for local tracks preserving `sourceId`.
2. Add backward-compat tests for existing stored schema.

Acceptance:

1. Local playlist restore always resolves correct source binding after restart.

### R2-7 Volume failure reporting and async safety

Implementation:

1. Replace silent `catch { return; }` in `scheduleVolumeUpdate` with structured logging and user-facing failure signal strategy.
2. Wrap `handleToggleMute` invocation in explicit async error handling in `PlayFilesPage`.
3. Keep UI state convergence behavior from reliability1 (no optimistic mute/unmute on failed write).

Tests:

1. Extend `tests/unit/playFiles/volumeMuteRace.test.ts` for debounced write-failure observability.
2. Add test to verify mute-toggle failure is handled and logged.

Acceptance:

1. No silent exception swallowing in volume/mute path.

### R2-4 Disk library device isolation

Implementation:

1. On `uniqueId` change, reset in-memory disks/runtime state before loading new device library.
2. Use `lastUniqueIdRef` for explicit boundary detection.
3. Preserve same-device merge behavior only when IDs match.

Tests:

1. Extend `tests/unit/hooks/useDiskLibrary.test.ts` with rerendered `uniqueId` switch scenario.
2. Assert old-device disks are removed from state.

Acceptance:

1. Disk lists are device-scoped and never cross-contaminate.

### R2-8 HVSC progress listener cleanup race

Implementation:

1. Add mounted/disposed guard around async listener registration.
2. If cleanup occurs before registration resolves, immediately call `remove` once handler arrives.
3. Add single-flight listener registration contract to avoid duplicate listeners.

Tests:

1. Add hook test for unmount-before-registration-resolve path.
2. Assert listener remove is still called exactly once.

Acceptance:

1. No dangling HVSC progress listeners after unmount/rerender races.

### R2-13 Android service-worker startup noise

Implementation:

1. Guard service-worker registration behind web/PWA runtime checks; skip on Capacitor Android host runtime.
2. Downgrade unavoidable registration failures to debug-level diagnostics with clear category.

Tests:

1. Add runtime test for Capacitor platform ensuring service worker registration path is skipped.

Acceptance:

1. No repeated startup error logs for service-worker registration on Android Capacitor runtime.

### R2-14 RAM dump/restore parity with working shell scripts

Implementation:

1. Audit the exact behavior of `scripts/ram_read.py` and `scripts/ram_write.py` and treat them as the reference protocol.
2. Keep save-RAM behavior aligned with the script sequence: pause once, read 64 KiB sequentially in 16 x 4 KiB blocks, resume once.
3. Change load-RAM behavior to match the script sequence exactly: pause once, send the full 64 KiB image in one `writemem` request to address `0000`, resume once.
4. Remove conflicting chunked-write assumptions and comments from the TypeScript RAM restore path.
5. Keep existing size validation and error reporting, but do not change the protocol ordering relative to the reference scripts.

Tests:

1. Update `tests/unit/machine/ramOperations.test.ts` to assert the exact save/load call sequence and payload sizes used by the scripts.
2. Add a regression test that load-RAM performs exactly one `writeMemoryBlock("0000", fullImage)` call for a 64 KiB image.
3. Keep the Home page RAM action tests green to ensure the buttons still call the same handler surface.

Acceptance:

1. The Save RAM and Load RAM buttons use the same device protocol as the working `scripts/ram_read.py` and `scripts/ram_write.py` flows.
2. Restoring a valid 64 KiB RAM image performs exactly one full-image write request after pause and before resume.

## 4. Verification gates

Run all gates after implementation:

1. `npm run lint`
2. `npm run test`
3. `npm run build`
4. `npm run test:coverage`
5. `node scripts/check-coverage-threshold.mjs` (global branch coverage >= 90%)
6. `npm run test:e2e`
7. If Playwright trace semantics changed: regenerate golden traces and run `npm run validate:traces`
8. If Playwright evidence changed: `npm run validate:evidence`
9. If Maestro flows changed and runtime is available: `npm run maestro:gating`
10. Device validation: install debug APK on Samsung Note 3 (`211...`), verify `Connected` state and real `/v1/info` calls in `logcat`

## 5. Deliverables

1. Updated code + tests for R2-1..R2-13.
2. `docs/testing/investigations/reliability2/execution-log.md` with timestamped commands/results.
3. `docs/testing/investigations/reliability2/convergence-report.md` with per-issue before/after evidence.
4. Optional `convergence-status.json` if a machine-readable tracker is needed by CI.
