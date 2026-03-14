# C64 Commander Production Readiness Audit
Review 6

## Executive Summary

C64 Commander has strong production-oriented foundations: broad automated test coverage, explicit diagnostics and redaction, hardened web-server auth/session handling, native secure-storage implementations on Android and iOS, and reproducible web container builds. The repository also shows sustained prior readiness work through multiple research and review cycles.

After incorporating repository evidence and operator clarifications supplied on March 13, 2026, the current verdict is **READY WITH MINOR FIXES** for the actively supported rollout scope. The remaining work is concrete and repo-backed: the web service worker can keep stale shells across deploys, the dependency audit backlog is not cleared, release/version metadata is inconsistent, playlist persistence is still below the documented scale target, TypeScript/static-boundary discipline is weak in large hotspots, Android backup policy is only partially constrained, shipped web-server code sits outside the main coverage gate, and a small amount of build logic still swallows exceptions.

## Scope and Method

This audit reviewed the repository structure, production code, tests, native layers, CI/CD workflows, build tooling, release configuration, security posture, and project documentation. Evidence came from source files, configuration files, test suites, workflow definitions, repository metadata, and local command output captured during the audit.

All documents in `doc`, `doc/c64`, `doc/diagnostics`, and `doc/testing` were read before the main audit began, as required. Additional documentation reviewed during the audit included `README.md`, `docs/**`, `ci/telemetry/README.md`, `agents/README.md`, `c64scope/README.md`, `tests/**/README.md`, and prior `doc/research/review-*` materials.

The audit also incorporates operator scope clarifications provided on March 13, 2026:

- Paid Apple Developer signing/distribution is not in current scope; the present iOS path is the sideload-oriented flow already documented in `README.md:77-84`.
- Android Play upload is already operational; repository TODOs and comments that imply otherwise are documentation drift rather than release blockers.
- Device HTTP/FTP transport is constrained by current C64 Ultimate protocol support and is not treated as a defect in this review; the repository already documents that model in `README.md:267-299`.
- GitHub Actions version-tag usage is an intentional repository policy and is not treated as an audit finding in this review.

The codebase areas reviewed included:

- Shared app runtime in `src/`
- Android native layer in `android/`
- iOS native layer in `ios/`
- Web server runtime in `web/server/src/`
- Automated test suites in `tests/`, `playwright/`, `.maestro/`, `ios/native-tests/`, and `android/app/src/test/`
- Build and release automation in `package.json`, `build`, and `.github/workflows/*.yaml`

## Repository Overview

C64 Commander is a React + Vite + Capacitor application with three delivery modes:

- Native mobile shells for Android and iOS using shared TypeScript UI/runtime code plus native plugins for secure storage, FTP, file picking, HVSC ingestion, and background execution.
- A self-hosted web deployment mode composed of the built frontend plus a Node-based companion server in `web/server/`.
- Test and research infrastructure spanning Vitest, Playwright, Maestro, Android emulator smoke runs, iOS native Swift tests, contract tests, fuzzing, telemetry monitors, and agentic app-first probes.

Architecturally, the central runtime responsibilities are split across:

- Device communication and safety governance: `src/lib/c64api.ts`, `src/lib/deviceInteraction/deviceInteractionManager.ts`, `src/lib/connection/connectionManager.ts`
- Playback and HVSC handling: `src/pages/MusicPlayerPage.tsx`, `src/pages/PlayFilesPage.tsx`, `src/lib/hvsc/**`, `src/hooks/useSidPlayer.tsx`
- Diagnostics and tracing: `src/lib/diagnostics/**`, `src/lib/tracing/**`
- Web-platform auth/proxy/runtime: `web/server/src/**`
- Native secure storage and platform bridges: Android `SecureStoragePlugin.kt`, iOS `AppDelegate.swift`

## Documented Expectations and Constraints

The documentation set establishes the following repository-wide expectations and constraints:

- The shared TypeScript runtime is the primary implementation surface; native code should stay narrowly scoped to platform capabilities (`doc/architecture.md`, `doc/developer.md`).
- C64 Ultimate communication is defined around REST API version `0.1`, optional `X-Password` auth, FTP port `21`, and documented UDP stream control behavior (`doc/c64/c64u-openapi.yaml`, `doc/c64/c64u-rest-api.md`, `doc/c64/c64u-ftp.md`, `doc/c64/c64u-stream-spec.md`).
- Tracing is intended to be always-on, bounded, redacted at capture/export time, and regression-checked through golden fixtures (`doc/diagnostics/tracing-spec.md`, `doc/diagnostics/action-summary-spec.md`).
- Large playlist and HVSC workflows are intended to scale via app-owned persistent data and query-driven UX rather than page-local lists (`doc/db.md`, `doc/ux-guidelines.md`, `doc/architecture.md`).
- Testing policy is intentionally strict: merged coverage targets at 90% line and branch coverage, evidence-driven Playwright runs, Maestro conventions, Android physical-device validation, contract testing, fuzzing, and agentic full-app coverage (`doc/code-coverage.md`, `doc/testing/**`).
- The user-facing network model is already documented as HTTP/FTP because that is what the current device supports (`README.md:267-299`).
- Current repository docs position iOS around sideload installation rather than paid-developer App Store/TestFlight distribution (`README.md:77-84`).

## What Is Working Well

- The web server has real security controls, not placeholder auth. It sets CSP, `X-Frame-Options`, `X-Content-Type-Options`, and HSTS when appropriate in `web/server/src/securityHeaders.ts:11-25`; session cookies are `HttpOnly` and `SameSite=Lax` in `web/server/src/authState.ts:92-115`; host input is sanitized and restricted in `web/server/src/hostValidation.ts:58-115`.
- The web-server security behavior is exercised by focused tests, including auth, rate limiting, cache headers, malformed paths, and proxy behavior in `tests/unit/web/webServer.test.ts:71-257`.
- Native credential storage uses platform security primitives rather than plaintext app storage: Android uses `EncryptedSharedPreferences` and `MasterKey` in `android/app/src/main/java/uk/gleissner/c64commander/SecureStoragePlugin.kt:28-36`; iOS uses Keychain operations in `ios/App/App/AppDelegate.swift:246-295`. Shared runtime tests verify that passwords are not written into `localStorage` in `tests/unit/secureStorage.test.ts:36-44`.
- Diagnostics and trace handling are materially stronger than a typical app baseline. The trace session enforces retention and size limits in `src/lib/tracing/traceSession.ts:28-30,66-85`; redaction covers credentials, cookies, tokens, and filesystem URIs in `src/lib/tracing/redaction.ts:11-64`; golden action-summary regression tests exist in `tests/unit/diagnostics/actionSummariesGolden.test.ts:9-205`.
- Device interaction is explicitly governed to prevent uncontrolled request storms. `src/lib/deviceInteraction/deviceInteractionManager.ts:95-175` implements prioritized scheduling, `src/lib/deviceInteraction/deviceInteractionManager.ts:214-255` defines cooldown/backoff/circuit-breaker behavior, and related polling-governance tests exist in `tests/unit/query/c64PollingGovernance.test.ts:28-70`.
- Connection handling includes degraded-mode behavior instead of dead-end failures. `src/lib/connection/connectionManager.ts:117-194` probes both primary and fallback paths, and `tests/unit/connection/connectionManager.test.ts:128-205` covers demo fallback and recovery to a real device.
- License and notice handling is explicit and automated. `scripts/generate-third-party-notices.mjs:81-260` builds a multi-ecosystem notices file, `THIRD_PARTY_NOTICES.md:1-5` shows generated output, and the Android workflow enforces notice generation/checks in `.github/workflows/android.yaml:21-44`.
- The web container build is reasonably reproducible and deployment-oriented. It uses Node 24 in both stages, `npm ci`, a non-root runtime user, a dedicated config mount, and a healthcheck in `web/Dockerfile:3-37`.

## Issues and Risks

### R6-04

**Severity:** MEDIUM

**Description:** The web service worker can keep stale application shells and assets after deployment.

**Evidence:**

- The service worker uses a fixed cache key, `c64commander-static-v1`, in `public/sw.js:1`.
- It precaches `/` and `/index.html` in `public/sw.js:2-10`.
- Same-origin `GET` requests are served from cache first in `public/sw.js:43-52`.
- Production web mode always registers `/sw.js` in `src/lib/startup/serviceWorkerRegistration.ts:20-34`.
- The server intentionally marks `index.html` as `no-store` in `web/server/src/staticAssets.ts:9-15`, but the service worker overrides that behavior by caching it.
- Existing service-worker tests only cover registration and registration-failure logging in `tests/unit/startup/serviceWorkerRegistration.test.ts:20-64`; they do not test cache rollover or update invalidation.

**Impact:** Web deployments can keep serving stale shells after a release. That creates rollout inconsistency and complicates support when operators expect a deployed frontend update to be immediately active.

### R6-06

**Severity:** MEDIUM

**Description:** The JavaScript dependency set has unresolved audited vulnerabilities in the build and test toolchain.

**Evidence:**

- `npm audit --json` reported 9 vulnerabilities total: 5 high, 1 moderate, 3 low.
- Directly affected packages include `@capacitor/cli`, `ftp-srv`, `ajv`, and `jsdom`.
- Transitive advisories include `tar`, `ip`, `minimatch`, `http-proxy-agent`, and `@tootallnate/once`.
- The project pins `tar` to `7.5.9` in `package.json:192-196`, but the advisory range still covers `<=7.5.10`.

**Impact:** The reported issues primarily affect developer and CI tooling rather than the shipped runtime, but they still weaken supply-chain posture for local builds, CI, and packaging.

### R6-07

**Severity:** MEDIUM

**Description:** Versioning and release source-of-truth are inconsistent.

**Evidence:**

- `package.json:4` reports version `0.1.0`.
- Vite derives the displayed app version from Git tags before `package.json` in `vite.config.ts:58-71`.
- The web publish workflow logs a tag/package mismatch and still continues in `.github/workflows/web.yaml:289-293`.
- README installation examples still reference `0.5.0` artifact names in `README.md:72-80`.

**Impact:** Release artifacts, UI-visible versioning, and package metadata do not share one enforced source of truth. That weakens release traceability and documentation accuracy.

### R6-08

**Severity:** MEDIUM

**Description:** Playlist persistence and query behavior do not yet meet the documented large-scale target and include weak recovery behavior.

**Evidence:**

- `doc/db.md:11-15` states that the current repository adapters are temporary and the target design is app-owned relational storage with query-backed access.
- The repository factory falls back to `localStorage` outside native IndexedDB-capable paths in `src/lib/playlistRepository/factory.ts:10-21`.
- IndexedDB queries sort, filter, and paginate after loading entire playlist state in memory in `src/lib/playlistRepository/indexedDbRepository.ts:203-247`.
- The `localStorage` repository does the same in `src/lib/playlistRepository/localStorageRepository.ts:156-196`.
- IndexedDB schema mismatch or load failure resets state after only `console.warn` logging in `src/lib/playlistRepository/indexedDbRepository.ts:103-121`.
- The `localStorage` repository preserves a raw backup on version mismatch but resets on JSON parse failure in `src/lib/playlistRepository/localStorageRepository.ts:73-103`.

**Impact:** Large playlists and HVSC-derived collections are still handled by full in-memory scans in active repositories. Recovery from corruption or schema mismatch is also weakly observable and can be lossy.

### R6-09

**Severity:** MEDIUM

**Description:** TypeScript safety and module-boundary discipline are relaxed in critical hotspots.

**Evidence:**

- Root TypeScript config disables `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, and `strictNullChecks` in `tsconfig.json:4-15`.
- App TypeScript config sets `strict: false` and also disables `noImplicitAny` in `tsconfig.app.json:18-23`.
- Multiple central files exceed the repository’s modularization guardrails: `src/components/disks/HomeDiskManager.tsx` is 2055 lines, `src/lib/c64api.ts` is 2032 lines, `src/pages/SettingsPage.tsx` is 1874 lines, `src/lib/hvsc/hvscIngestionRuntime.ts` is 1324 lines, and `src/pages/PlayFilesPage.tsx` is 1224 lines.

**Impact:** Core runtime areas are harder to review and change safely. The relaxed compiler posture also reduces static detection of nullability and implicit-any regressions in the most complex modules.

### R6-10

**Severity:** MEDIUM

**Description:** Android backup remains enabled for part of the application state.

**Evidence:**

- The manifest enables backups with `android:allowBackup="true"` in `android/app/src/main/AndroidManifest.xml:4-13`.
- Backup exclusions cover secure storage, the WebView store, and databases in `android/app/src/main/res/xml/backup_rules.xml:2-6` and `android/app/src/main/res/xml/data_extraction_rules.xml:2-12`.
- The exclusions are selective rather than a full backup opt-out.

**Impact:** Sensitive credential storage is excluded, but not all app state is. Diagnostics data, settings, or other app-managed state outside the excluded areas can still participate in backup or device-transfer flows.

### R6-11

**Severity:** LOW

**Description:** Repository documentation contains production-relevant contradictions and stale guidance.

**Evidence:**

- `docs/privacy-policy.md:7-9,32-37` says the app does not collect crash reporting data and does not send data to developer-operated servers, but the runtime can initialize Sentry when `VITE_SENTRY_DSN` is set in `src/lib/observability/sentry.ts:11-21`.
- `tests/contract/README.md:6-9` says `Node.js 18+`, while the repository engine requirement is `>=24 <25` in `package.json:7-10`.
- README installation examples still reference `0.5.0` artifact names in `README.md:72-80`.
- `AGENTS.md:48-49` still contains Android release-signing TODO text that no longer matches the actual operational state described by the operator on March 13, 2026.

**Impact:** Contributors and operators can follow outdated assumptions about privacy behavior, toolchain requirements, artifact naming, and release status.

### R6-12

**Severity:** MEDIUM

**Description:** The primary JavaScript coverage gate excludes shipped web-server runtime code.

**Evidence:**

- Vitest coverage explicitly excludes `web/server/**` in `vitest.config.ts:72-97`.
- The repository still maintains focused web-server tests in `tests/unit/web/webServer.test.ts:71-257`.
- Coverage aggregation and threshold enforcement are built around the generated LCOV files in `scripts/collect-coverage.sh:9-37`, `scripts/check-coverage-threshold.mjs:5-9,109-120`, and `codecov.yml:6-19`.

**Impact:** The web server is production code for the web deployment target, but the main JavaScript coverage threshold does not measure it. That leaves a measurable blind spot between “tests exist” and “coverage gate protects the code.”

### R6-13

**Severity:** LOW

**Description:** Android version derivation silently swallows exceptions in Gradle.

**Evidence:**

- `android/app/build.gradle:21-27` catches `Exception ignored` while resolving the version name from Git.
- `android/app/build.gradle:38-44` does the same while resolving the version code from commit count.
- Repository policy explicitly forbids silent exception swallowing in `AGENTS.md`.

**Impact:** Version-derivation failures can be hidden during local or CI builds, making release metadata harder to debug and violating the project’s own exception-handling policy.

## Remediation Plan

| Issue | Exact corrective action | Suggested implementation approach | Affected files or subsystems | Priority |
| --- | --- | --- | --- | --- |
| R6-04 | Make web deployments update-safe. | Version the service-worker cache from build metadata, stop using cache-first for the app shell, add service-worker lifecycle/update tests, and document cache-busting behavior for operators. | `public/sw.js`, `src/lib/startup/serviceWorkerRegistration.ts`, service-worker tests, web deployment docs | P0 |
| R6-06 | Clear the audited dependency backlog. | Upgrade or replace vulnerable direct packages first (`@capacitor/cli`, `ftp-srv`, `ajv`, `jsdom`), refresh overrides, rerun `npm audit`, and record any accepted residual risk explicitly. | `package.json`, `package-lock.json`, dependent scripts/tests | P1 |
| R6-07 | Enforce one release version source of truth. | Decide whether Git tags or `package.json` own semantic versioning, make all build surfaces consume the same source, and fail or remove mismatch-tolerant paths instead of logging and continuing. | `package.json`, `vite.config.ts`, `.github/workflows/web.yaml`, `README.md` | P1 |
| R6-08 | Move playlist persistence toward the documented query-backed model. | Introduce indexed/queryable storage for playlist rows and sessions, push filtering/sorting into the storage layer, add explicit migration handling, and preserve recovery artifacts on parse/load failure. | `src/lib/playlistRepository/**`, `doc/db.md`, playlist tests | P1 |
| R6-09 | Raise static-safety and modularity standards in hotspot files. | Re-enable stricter TypeScript options incrementally, split the largest files by responsibility, and use regression tests to preserve behavior while carving out smaller modules. | `tsconfig*.json`, `src/lib/c64api.ts`, `src/pages/SettingsPage.tsx`, `src/pages/PlayFilesPage.tsx`, `src/components/disks/HomeDiskManager.tsx`, `src/lib/hvsc/hvscIngestionRuntime.ts` | P1 |
| R6-10 | Tighten Android backup policy. | Decide whether the app should opt out of backups entirely; if yes, disable backup globally, or otherwise document and explicitly scope which non-secret state is allowed to transfer. | `android/app/src/main/AndroidManifest.xml`, backup XML rules, privacy/docs | P2 |
| R6-11 | Remove documentation contradictions and stale rollout notes. | Update privacy language to describe optional Sentry capability accurately, align Node version guidance with repository engines, refresh artifact examples, and remove stale Android release TODO text. | `docs/privacy-policy.md`, `tests/contract/README.md`, `README.md`, `AGENTS.md` | P1 |
| R6-12 | Put the web server under the same measurable coverage gate as shipped frontend code. | Remove `web/server/**` from the main coverage exclusion list or add a dedicated enforced server threshold in CI, then merge/report it with the same branch target. | `vitest.config.ts`, coverage scripts, CI coverage jobs | P1 |
| R6-13 | Remove silent exception swallowing from Gradle build logic. | Replace ignored catches with explicit logging or contextual rethrows and add a small build-logic regression check if version derivation is retained. | `android/app/build.gradle` | P2 |

## Test Coverage Assessment

The repository has unusually broad test infrastructure for an app of this size:

- 258 unit-test files under `tests/unit/`
- 39 Playwright specs and fuzz files at the top level of `playwright/`
- 42 Maestro YAML flows under `.maestro/`
- Android emulator smoke infrastructure in `tests/android-emulator/`
- Contract harnesses and mock servers in `tests/contract/`
- Native Swift tests in `ios/native-tests/` with CI coverage export in `.github/workflows/ios.yaml:82-118`

Coverage governance is also explicitly documented and automated:

- Merged coverage workflow and threshold policy are documented in `doc/code-coverage.md`.
- CI threshold logic enforces 90% line and 90% branch coverage through `scripts/check-coverage-threshold.mjs:5-9,109-120`.
- Codecov mirrors the same 90% project and patch targets in `codecov.yml:6-19`.

The strongest testing areas are:

- Web-server auth/security behavior (`tests/unit/web/webServer.test.ts`)
- Secure-storage behavior (`tests/unit/secureStorage.test.ts`)
- Diagnostics, tracing, redaction, and golden-summary derivation (`tests/unit/tracing/**`, `tests/unit/diagnostics/**`)
- Connection safety and degraded-mode logic (`tests/unit/connection/**`, `tests/unit/query/**`)
- HVSC and playback logic, which have extensive unit coverage

The main test gaps that still matter for rollout readiness are:

- The main JavaScript coverage gate excludes `web/server/**`, leaving shipped web-server code outside the branch-coverage threshold.
- Service-worker update semantics are not directly tested; only registration is tested.
- Playlist persistence recovery and large-scale query behavior are still under-tested relative to the documented target model.

## Build and Release Assessment

The repository has solid reproducibility building blocks:

- Node is pinned to major version 24 in `package.json:7-10`, `.github/workflows/android.yaml:31-35`, `.github/workflows/web.yaml:45-48`, and `web/Dockerfile:3,21`.
- Builds use `npm ci` in CI and Docker (`.github/workflows/web.yaml:50-54`, `web/Dockerfile:5-6,28-29`).
- The Docker runtime runs as non-root and exposes a healthcheck in `web/Dockerfile:21-37`.
- Release assets are named deterministically for Android in `android/app/build.gradle:127-139`.

Within the current rollout scope, the main build and release weaknesses are no longer “missing release lanes”; they are metadata and documentation drift:

- Android Play upload is operational per operator-provided release evidence from March 13, 2026, but stale TODO/documentation text still implies unfinished setup.
- iOS distribution is currently documented as a sideload path in `README.md:77-84`; this review does not treat a paid-developer signing lane as a blocker because that scope was explicitly excluded.
- Version-source drift between `package.json`, Git-derived build info, and README artifact examples remains unresolved.
- Web rollout safety is weakened by the current service-worker cache strategy.

## Security Assessment

Positive security controls present today:

- Native password storage uses encrypted OS-managed storage on Android and Keychain on iOS.
- The web server validates host inputs, restricts override behavior by default, emits security headers, and uses authenticated session cookies.
- Trace export and diagnostic surfaces redact passwords, tokens, cookies, and sensitive URIs before exposure.

Security-relevant constraints and remaining risks:

- Device transport follows the current C64 Ultimate protocol surface: HTTP and FTP only. The repository already documents that constraint in `README.md:267-299`, and this review does not classify it as a flaw because the device currently does not offer HTTPS/FTPS.
- Android backups remain enabled for some non-secret state.
- The repository carries unresolved audited vulnerabilities in build/test dependencies.

Overall, the security posture is acceptable for the app’s trusted-LAN/device-admin model, with the remaining actionable work concentrated in dependency hygiene, backup scope, and documentation accuracy.

## Documentation Assessment

Documentation that is accurate and aligned with the codebase:

- The README network-security section (`README.md:267-299`) matches the current HTTP/FTP device model.
- The README web-server password model (`README.md:283-299`) matches the current session-cookie and password-injection implementation.
- The diagnostics and tracing documents accurately describe the always-on, redacted, bounded tracing model implemented in `src/lib/tracing/**`.
- The code-coverage documentation matches the merged-coverage and threshold scripts in the repository.

Documentation drift or contradiction:

- `docs/privacy-policy.md` makes absolute claims about no crash reporting or developer-server transmission, while the runtime can initialize Sentry when configured.
- `tests/contract/README.md` still documents Node 18+, but the repository engine policy is Node 24.
- README installation examples still use `0.5.0` example artifact names.
- `AGENTS.md:48-49` still presents Android release signing as unfinished setup.

Missing or under-specified rollout-critical documentation:

- There is no repository document that records the accepted current rollout scope decisions raised during this review: iOS sideload-only distribution, Android Play upload already operational, C64U transport limited by device capability, and GitHub Actions version-tag usage as an intentional project choice.
- Web deployment documentation does not describe service-worker cache invalidation behavior or operator steps for safe rollout and rollback after frontend updates.

## Production Readiness Verdict

**READY WITH MINOR FIXES**

This verdict follows the accepted current scope recorded in the review. After removing the out-of-scope or operator-closed items, the remaining findings are all fixable without changing the fundamental release model:

- Web deployments need service-worker cache invalidation work before the next release cycle.
- Version metadata and several repository documents need cleanup so the published state matches the repository state.
- Dependency hygiene, playlist persistence, TypeScript strictness, Android backup scope, web-server coverage gating, and Gradle exception handling still need targeted hardening work.

Those items are real and should be scheduled, but they do not block the currently supported Android/web rollout model described by the repository plus the March 13, 2026 operator clarifications.
