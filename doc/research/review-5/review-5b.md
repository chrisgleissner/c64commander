# Production Readiness Assessment — C64 Commander (Review 6)

**Date:** 2026-02-28
**Commit:** `cf7d0826a429802524b6ee86beb73e81449f4e04` (branch `fix/review-5`)
**Assessor:** Automated assessment via repository inspection + command execution

---

# 0. Executive Summary

C64 Commander is a well-structured Capacitor application with strong fundamentals: comprehensive test coverage (91.6% statements, 84.3% branches across 2204 unit tests), robust diagnostics/tracing infrastructure, and a thoughtful security design for its domain (controlling a LAN-attached C64 Ultimate device).

**Critical issues requiring attention before wider release:**

1. **basic-ftp path traversal CVE** (PRA-001) — critical production dependency vulnerability with a fix available.
2. **No security headers on web server** (PRA-006) — the custom Node.js server sends no CSP, HSTS, or X-Frame-Options headers.
3. **Android release minification disabled** (PRA-013) — R8/ProGuard is off for release builds, shipping unobfuscated code.
4. **No dependency update automation** (PRA-004) — neither Dependabot nor Renovate is configured.
5. **README license badge mismatch** (PRA-029) — badge says GPL v2, LICENSE file is GPL v3.

**Key strengths:**

- Comprehensive structured tracing system with PII redaction at capture time
- Device safety controls (circuit breaker, backoff, concurrency limits)
- Strong error boundary and unhandled rejection capture
- Thorough CI pipeline with 12-shard E2E, Maestro smoke tests, and coverage gates
- Excellent internal documentation (diagnostics specs, UX guidelines, testing docs)

**Recommendation:** Ship with mitigations (see Chapter 19).

---

# 1. Scope and Method

## Scope

Full production readiness assessment covering Android, iOS, and Web platforms for the C64 Commander application. All source code, CI/CD pipelines, documentation, dependencies, and build artifacts were inspected.

## Method

1. Static analysis of all source files, configurations, and CI workflows
2. Command execution for builds, tests, linting, and dependency auditing
3. Documentation review of all files under `doc/`, `docs/`, and `.github/`
4. Dependency audit via `npm audit`
5. Cross-referencing findings against platform-specific best practices

## Environment

| Item | Value |
|------|-------|
| Node.js | v24.11.0 |
| npm | 11.6.1 |
| Java | OpenJDK Corretto 25.0.1 |
| OS | Linux (Ubuntu) |
| Git HEAD | `cf7d0826a429802524b6ee86beb73e81449f4e04` |

## Commands Executed

| Command | Result |
|---------|--------|
| `npm run lint` | Pass — 0 errors |
| `npm run build` | Pass — 5.00s, 5.4 MB dist |
| `npm run test` | Pass — 232 files, 2204 tests |
| `npm run test:coverage` | Pass — 91.6% stmts, 84.32% branches |
| `npm run build:web-server` | Pass |
| `npm audit --omit dev` | 1 critical vulnerability |
| `npm audit` | 6 vulnerabilities (1 critical, 4 high, 1 moderate) |
| `./gradlew assembleDebug` | Pass — 32s, 138 tasks |
| `./gradlew test` | FAIL — 86/113 tests failed (Robolectric incompatible with Java 25) |

---

# 2. System Inventory

## Application Identity

| Field | Value |
|-------|-------|
| Name | C64 Commander |
| Package | `uk.gleissner.c64commander` |
| Version | 0.1.0 (package.json) |
| License | GPL v3 (LICENSE file) |
| Platforms | Android, iOS, Web (Docker) |

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| UI framework | React | ^18.3.1 |
| Build tool | Vite | ^5.4.21 |
| Native shell | Capacitor | ^6.2.1 |
| State management | TanStack Query | ^5.83.0 |
| CSS | Tailwind CSS | ^3.4.17 |
| UI components | Radix UI + shadcn/ui | Various |
| Language | TypeScript | ^5.8.3 |
| Test framework | Vitest | ^3.2.4 |
| E2E framework | Playwright | ^1.48.2 |
| Web server | Custom Node.js http.createServer | — |

## Platform SDK Targets

| Platform | Min | Target/Compile | Language |
|----------|-----|----------------|----------|
| Android | API 22 (5.1) | API 35 (15) | Kotlin 1.9.22 |
| iOS | 13.0 (project) / 15.0 (Podfile) | — | Swift 5.0 |
| Web | Evergreen browsers | — | TypeScript → ES modules |

## Build Outputs

| Artifact | Size |
|----------|------|
| Web dist (total) | 5.4 MB |
| Main JS bundle | 642 KB (208 KB gzipped) |
| Total JS (51 chunks) | ~1.5 MB |
| CSS | 78 KB |
| Android debug APK | Built successfully |

## CI Infrastructure

| Workflow | Trigger | Jobs | Runner |
|----------|---------|------|--------|
| android.yaml | push/PR/dispatch | 9 | ubuntu-latest |
| web.yaml | push/PR/dispatch | 2 | ubuntu-latest |
| ios.yaml | push/PR/dispatch | 6 | macos-latest |
| fuzz.yaml | daily 03:00 UTC / dispatch | 2 | ubuntu-latest |

---

# 3. Architecture and Repository Structure

## Module Boundaries

The codebase follows a clear layered architecture:

- **UI layer**: `src/pages/` (7 routes), `src/components/` (shared UI)
- **Hooks/data layer**: `src/hooks/`, `src/lib/c64api.ts`
- **Song sources**: `src/lib/sources/` (local FS, HVSC, Ultimate)
- **HVSC module**: `src/lib/hvsc/` (ingestion, indexing, browse)
- **Native bridges**: `src/lib/native/` (platform-specific implementations)
- **SID playback**: `src/lib/sid/`, `src/pages/playFiles/`
- **Diagnostics**: `src/lib/diagnostics/`, `src/lib/tracing/`, `src/lib/logging.ts`
- **Android native**: `android/app/src/main/java/uk/gleissner/c64commander/` (14 Kotlin files)
- **iOS native**: `ios/App/App/` (7 Swift files)
- **Web server**: `web/server/src/index.ts` (single file, 843 lines)

## Capacitor Plugin Usage

8 custom Capacitor plugins registered per platform:

| Plugin | Android | iOS | Web |
|--------|---------|-----|-----|
| BackgroundExecution | Full | Stub (30s background task) | Stub |
| DiagnosticsBridge | Full | Full | Stub |
| FolderPicker | Full (SAF) | Full (UIDocumentPicker) | N/A |
| MockC64U | Full | Full | N/A |
| FeatureFlags | DataStore | UserDefaults | localStorage |
| FtpClient | commons-net | CFStream | Web proxy |
| HvscIngestion | Full (7z) | Delegated to JS | JS |
| SecureStorage | EncryptedSharedPreferences | Keychain | Server-side |

## Native Bridge Error Propagation

Android plugins use `call.reject(message, exception)` consistently. iOS plugins use `call.reject(message)`. The JS side receives these as rejected promises caught by `try/catch` in hooks and pages. No silent error swallowing was detected in the bridge layer.

## Configuration and Environment Handling

- Build-time: Vite `define` injects `__APP_VERSION__`, `__GIT_SHA__`, `__BUILD_TIME__`
- Runtime: `localStorage`-backed tunables for device safety, discovery timing, debug flags
- Web server: `web-config.json` file + environment variables (`PORT`, `HOST`, `WEB_CONFIG_DIR`, etc.)
- No multi-environment profiles (dev/staging/prod). Environment differentiation is implicit via `VITE_WEB_PLATFORM` and `VITE_COVERAGE` flags.

## Feature Flags

Single feature flag (`hvsc_enabled`) with a full architecture: definition → manager → repository → native plugin per platform. Falls back to defaults on failure. Architecture supports adding more flags.

---

# 4. Build and Release Pipelines

## Android Pipeline (android.yaml)

9 jobs: `web-unit` → `web-build-coverage` → `web-screenshots` + `web-e2e` (12 shards) → `web-coverage-merge` → `android-tests` + `android-maestro` → `android-packaging` → `release-artifacts`.

- Debug APK on every PR/push; release APK/AAB on git tags only
- Coverage merged from unit + screenshot + E2E via `lcov-result-merger`
- Codecov uploaded with 80% project/patch targets
- Google Play internal track upload via `r0adkll/upload-google-play@v1`
- GitHub Release created with APK + AAB on tags

## iOS Pipeline (ios.yaml)

6 jobs: `ios-prepare` → `ios-build-simulator` → `ios-maestro-tests` (4 groups) → `ios-maestro-aggregate` + `ios-package-altstore` + `ios-package-paid` (placeholder).

- Simulator builds only (`CODE_SIGNING_ALLOWED=NO`)
- Unsigned IPA uploaded to GitHub Releases on tags
- Paid signing lane is a placeholder (gated on `vars.IOS_PAID_SIGNING_ENABLED`)
- Uses `vars.IOS_ROLLOUT_STAGE` (A/B/C) for progressive feature rollout

## Web Pipeline (web.yaml)

2 jobs: `web-build-and-test` (matrix: amd64, arm64) → `web-docker-publish`.

- Multi-stage Docker build (`node:24-trixie-slim`)
- Smoke test: health check + Playwright auth tests
- Docker resource limits enforced: 512 MB memory, 2 CPUs
- Multi-arch image published to GHCR on tags
- Telemetry monitoring in CI via CSV + charts

## Fuzz Pipeline (fuzz.yaml)

2 jobs: deterministic (seed 4242) + random seed. Daily schedule at 03:00 UTC. 5-minute default budget, 2-hour on schedule.

## ISSUE — Google Play upload action not SHA-pinned

- **ID:** PRA-001
- **Area:** CI/CD, SupplyChain
- **Evidence:** `.github/workflows/android.yaml` L1322: `r0adkll/upload-google-play@v1`
- **Problem:** The Google Play upload action uses a mutable tag (`@v1`) instead of a SHA pin. Tag mutation is a known supply-chain attack vector.
- **Risk:** A compromised tag could inject malicious code into the release pipeline, potentially exfiltrating the Play service account JSON secret.
- **Severity:** Major
- **Likelihood:** Low — requires upstream compromise
- **User impact:** High — supply-chain compromise could distribute malicious APK
- **Operational impact:** High — credential exfiltration
- **Effort:** S
- **Fix outline:** Pin to a specific commit SHA: `r0adkll/upload-google-play@<sha>`.
- **Verification:** Verify the SHA matches the expected release tag.
- **Dependencies:** None

## ISSUE — Maestro CLI installed via curl pipe

- **ID:** PRA-002
- **Area:** CI/CD, SupplyChain
- **Evidence:** `.github/workflows/android.yaml` L648, `.github/workflows/ios.yaml` L179-184: `curl -Ls "https://get.maestro.mobile.dev" | bash`
- **Problem:** Maestro CLI is installed by piping a remote script into bash without checksum verification.
- **Risk:** A compromised CDN or DNS hijack could execute arbitrary code on CI runners.
- **Severity:** Major
- **Likelihood:** Low — requires CDN compromise
- **User impact:** Medium — compromised CI could produce tainted artifacts
- **Operational impact:** High — runner compromise
- **Effort:** S
- **Fix outline:** Pin Maestro to a specific version and verify a SHA-256 checksum after download.
- **Verification:** Compare installed binary checksum against a known-good value.
- **Dependencies:** None

## ISSUE — Workflow permissions broader than needed on PRs

- **ID:** PRA-003
- **Area:** CI/CD, Security
- **Evidence:** `.github/workflows/android.yaml` L13-14: `contents: write`, `.github/workflows/ios.yaml` L13-14: `contents: write`
- **Problem:** `contents: write` is granted at workflow level, applying to all jobs including PR builds that only need read access. Write permissions should be scoped to release jobs only.
- **Risk:** A compromised step in a PR job could write to the repository.
- **Severity:** Minor
- **Likelihood:** Low — requires step compromise
- **User impact:** Low
- **Operational impact:** Medium — repo write access on untrusted PRs
- **Effort:** S
- **Fix outline:** Move `contents: write` to per-job `permissions` blocks on `release-artifacts` and `ios-package-altstore` only. Set workflow-level to `contents: read`.
- **Verification:** Run a PR build and confirm all jobs succeed with read-only permissions.
- **Dependencies:** None

## ISSUE — No dependency update automation

- **ID:** PRA-004
- **Area:** SupplyChain
- **Evidence:** No `.github/dependabot.yml` or `.github/renovate.json` exists.
- **Problem:** npm dependencies and GitHub Actions versions are not automatically tracked for security updates.
- **Risk:** Known vulnerabilities in dependencies accumulate without notification. The current `basic-ftp` CVE (PRA-009) is an example.
- **Severity:** Major
- **Likelihood:** High — vulnerabilities appear regularly in the npm ecosystem
- **User impact:** Medium — unpatched CVEs
- **Operational impact:** Medium — manual tracking burden
- **Effort:** S
- **Fix outline:** Add `.github/dependabot.yml` with `npm` and `github-actions` ecosystems. Configure weekly schedule.
- **Verification:** Verify Dependabot opens PRs within one week of the configuration commit.
- **Dependencies:** None

## ISSUE — No CODEOWNERS file

- **ID:** PRA-005
- **Area:** CI/CD
- **Evidence:** No `.github/CODEOWNERS` file exists.
- **Problem:** No mandatory code review is enforced for security-sensitive paths (workflow files, signing config, native bridges).
- **Risk:** Changes to CI workflows or signing configuration could be merged without specialized review.
- **Severity:** Minor
- **Likelihood:** Medium — single-developer project but good practice for scaling
- **User impact:** Low
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Create `.github/CODEOWNERS` mapping `.github/workflows/`, `android/keystore/`, and `scripts/print_keystore_secrets.sh` to repository owners.
- **Verification:** Verify PR to a protected path requires owner approval.
- **Dependencies:** None

---

# 5. Security and Privacy

## Network Security

The C64 Ultimate device communicates exclusively over cleartext HTTP. This is a hardware limitation, not an application choice. The app's security posture is designed around this constraint:

- **Android:** `android:usesCleartextTraffic="true"` in AndroidManifest.xml (global). No `network_security_config.xml` for domain-scoped control.
- **iOS:** `NSAllowsLocalNetworking = true` in Info.plist. Non-local traffic requires HTTPS (ATS enforced).
- **Web:** Server proxies REST/FTP to the device, so the browser never makes direct cleartext requests. Session cookie is `HttpOnly; SameSite=Lax`.

## Credential Storage

| Platform | Method | Evidence |
|----------|--------|---------|
| Android | EncryptedSharedPreferences (AES-256-GCM via AndroidX Security Crypto) | `SecureStoragePlugin.kt` |
| iOS | Keychain Services | `NativePlugins.swift` SecureStoragePlugin |
| Web | Server-side `web-config.json` (not in browser) | `web/server/src/index.ts` L738-766 |

The device password is sent as `X-Password` header on every REST call. The web server injects this header server-side when proxying, so the browser never sees the raw password value.

## Sensitive Data Logging

Password values are never logged. The tracing system records `hasPasswordHeader: boolean` instead of the password value. Export redaction (`exportRedaction.ts`) scrubs passwords, tokens, IPs, hostnames, URLs, and file paths before share/export.

## Privacy Policy

The privacy policy (`docs/privacy-policy.md`) accurately reflects the app's behavior: no personal data collected, local-only storage, no analytics or crash reporting services.

## ISSUE — No web server security headers

- **ID:** PRA-006
- **Area:** Web, Security
- **Evidence:** `web/server/src/index.ts` — complete absence of security headers. No CSP, HSTS, X-Frame-Options, X-Content-Type-Options, or Referrer-Policy.
- **Problem:** The custom Node.js web server sends no security headers. This exposes the web platform to clickjacking, MIME sniffing, and XSS vectors.
- **Risk:** An attacker on the same network could iframe the app or exploit a future XSS to access the C64U device password.
- **Severity:** Critical
- **Likelihood:** Medium — local network deployment reduces exposure, but Docker instances may be internet-facing
- **User impact:** High — potential credential theft
- **Operational impact:** Medium
- **Effort:** S
- **Fix outline:** Add response headers in the server's request handler: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security` (when behind TLS).
- **Verification:** `curl -I http://localhost:8064/` and verify all headers present.
- **Dependencies:** None

## ISSUE — Android cleartext traffic globally enabled without domain restriction

- **ID:** PRA-007
- **Area:** Android, Security
- **Evidence:** `android/app/src/main/AndroidManifest.xml` L10: `android:usesCleartextTraffic="true"`. No `network_security_config.xml` exists.
- **Problem:** All HTTP traffic is permitted to any host. The app only needs cleartext to the C64U device on the local network.
- **Risk:** If the WebView loads third-party content or a future feature adds external API calls, those would also use cleartext.
- **Severity:** Minor
- **Likelihood:** Low — current code only targets the C64U device and HVSC download (which uses HTTPS)
- **User impact:** Low
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Add `android/app/src/main/res/xml/network_security_config.xml` with `<domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">*</domain></domain-config>` scoped to local addresses. Reference it via `android:networkSecurityConfig` in the manifest.
- **Verification:** Verify HVSC download still works (HTTPS) and C64U device communication works (HTTP).
- **Dependencies:** None

## ISSUE — Web server Cache-Control prevents all caching

- **ID:** PRA-008
- **Area:** Web, Performance
- **Evidence:** `web/server/src/index.ts` — static file serving uses `Cache-Control: no-store` on all responses including immutable hashed assets.
- **Problem:** Vite-built assets have content hashes in filenames and are immutable. Serving them with `no-store` forces browsers to re-download on every page load.
- **Risk:** Increased bandwidth usage and slower page loads, especially on mobile or constrained networks.
- **Severity:** Minor
- **Likelihood:** High — affects every page load
- **User impact:** Medium — slower load times
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** For files matching `/assets/*` with hash in filename, set `Cache-Control: public, max-age=31536000, immutable`. Keep `no-store` for `index.html` and API responses.
- **Verification:** Load the web app, check DevTools Network tab for cache headers on JS/CSS assets.
- **Dependencies:** None

---

# 6. Dependency and Supply Chain Risk

## npm Audit Results

### Production Dependencies

```
basic-ftp  <5.2.0 — CRITICAL
  Path Traversal in downloadToDir()
  GHSA-5rq4-664w-9x2c
  Fix: npm audit fix
```

### All Dependencies (including dev)

```
6 vulnerabilities total:
  1 critical  — basic-ftp path traversal
  4 high      — minimatch ReDoS (3 instances in dev deps) + rollup path traversal
  1 moderate  — minimatch ReDoS
```

## Overrides

`package.json` pins three transitive dependencies via `overrides`:
- `esbuild: 0.25.0` — MIT
- `sucrase: 3.35.1` — MIT
- `tar: 7.5.9` — ISC

## Outdated Tool Versions

| Tool | Current | Latest (approx) | Risk |
|------|---------|-----------------|------|
| Gradle | 8.2.1 | 8.12.x | Missing security/performance fixes |
| AGP | 8.2.1 | 8.7.x | `suppressUnsupportedCompileSdk=35` is a workaround |
| Kotlin | 1.9.22 | 2.1.x | Missing K2 compiler improvements |
| Capacitor | 6.2.1 | Latest 6.x | Potential bug fixes |

## ISSUE — Critical basic-ftp CVE in production dependency

- **ID:** PRA-009
- **Area:** SupplyChain, Security
- **Evidence:** `npm audit --omit dev` output: `basic-ftp <5.2.0 — GHSA-5rq4-664w-9x2c (critical)`
- **Problem:** `basic-ftp` has a path traversal vulnerability in its `downloadToDir()` method. This dependency is used in the web server's FTP proxy (`web/server/src/index.ts`).
- **Risk:** A malicious FTP server (or compromised C64U device) could write files outside the intended directory via crafted filenames during FTP operations.
- **Severity:** Critical
- **Likelihood:** Low — requires a compromised FTP server on the local network
- **User impact:** High — arbitrary file write on the web server host
- **Operational impact:** High — server compromise
- **Effort:** S
- **Fix outline:** Run `npm audit fix` to update `basic-ftp` to ≥5.2.0. Verify FTP proxy functionality with updated version.
- **Verification:** `npm audit --omit dev` reports 0 vulnerabilities.
- **Dependencies:** None

## ISSUE — Rollup path traversal vulnerability (dev dependency)

- **ID:** PRA-010
- **Area:** SupplyChain
- **Evidence:** `npm audit` output: `rollup 4.0.0-4.58.0 — GHSA-mw96-cpmx-2vgc (high)`
- **Problem:** Vite's bundler (rollup) has a path traversal vulnerability for arbitrary file write. This is a build-time risk only.
- **Risk:** A malicious npm package with crafted imports could write files during the build process.
- **Severity:** Minor
- **Likelihood:** Low — requires malicious dependency in the project
- **User impact:** Low — build-time only
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Run `npm audit fix` or pin rollup ≥4.58.1 in overrides.
- **Verification:** `npm audit` shows no rollup vulnerability.
- **Dependencies:** None

## ISSUE — Gradle and AGP significantly outdated

- **ID:** PRA-011
- **Area:** Android, SupplyChain
- **Evidence:** `android/gradle/wrapper/gradle-wrapper.properties`: Gradle 8.2.1. `android/build.gradle` L7: AGP 8.2.1. `org.gradle.warning.mode=none` in `gradle.properties` suppresses warnings.
- **Problem:** Gradle 8.2.1 is ~2 years behind the current 8.12.x. AGP 8.2.1 uses `suppressUnsupportedCompileSdk=35` to silence compatibility warnings with compileSdk 35.
- **Risk:** Missing security patches, performance improvements, and Android 15 compatibility fixes. Warning suppression hides potential build issues.
- **Severity:** Minor
- **Likelihood:** Medium — older toolchains accumulate issues
- **User impact:** Low
- **Operational impact:** Medium — technical debt
- **Effort:** M
- **Fix outline:** Upgrade Gradle to latest 8.x, AGP to latest 8.x compatible version. Remove `suppressUnsupportedCompileSdk` and `warning.mode=none`. Fix any surfaced warnings.
- **Verification:** `./gradlew assembleDebug` and `./gradlew test` both pass without suppressions.
- **Dependencies:** None

---

# 7. Data Storage and Migration Strategy

## Storage Backends

| Store | Platform | Backend | Max Size |
|-------|----------|---------|----------|
| Device password | Android | EncryptedSharedPreferences | Tiny |
| Device password | iOS | Keychain | Tiny |
| Device password | Web | Server JSON file | Tiny |
| HVSC song index | Native | Capacitor Filesystem JSON + localStorage mirror | Potentially large (70k+ songs) |
| HVSC song index | Web | localStorage only | ~5-10 MB quota |
| Playlists | All | IndexedDB (primary) + localStorage (fallback) | Unlimited / ~5-10 MB |
| App settings | All | localStorage | Small |
| Feature flags | Android/iOS | DataStore/UserDefaults | Tiny |
| Feature flags | Web | localStorage | Tiny |
| Logs | All | localStorage | 500 entries |
| FTP cache | All | localStorage (LRU) | Variable |

## Migration Strategy

The app uses **version stamps with destructive reset** rather than incremental migration scripts:
- Schema version is baked into storage keys or checked on load
- Version mismatch → discard data, start fresh
- No forward migration paths exist

Two legacy migrations exist: HVSC media index key migration and device host URL migration.

## ISSUE — No incremental data migration strategy

- **ID:** PRA-012
- **Area:** Data
- **Evidence:** `src/lib/hvsc/hvscBrowseIndexStore.ts` L19: `SCHEMA_VERSION = 1`, `src/lib/playlistRepository/indexedDbRepository.ts` L26: `DB_VERSION = 1` — both discard data on version mismatch.
- **Problem:** Any schema version bump silently discards all user data for that store. Playlists, HVSC index, and app settings would be lost without warning.
- **Risk:** A future update that changes data format will cause silent data loss. Users have no backup/export mechanism for playlists.
- **Severity:** Major
- **Likelihood:** Medium — schema changes are inevitable as the app matures
- **User impact:** High — silent playlist loss
- **Operational impact:** Low
- **Effort:** M
- **Fix outline:** Implement incremental migration functions indexed by version number. On version mismatch, run the chain of migrations from current → target. Add a playlist export feature as a safety net.
- **Verification:** Bump test schema version, verify data survives migration. Test rollback by loading old-version data.
- **Dependencies:** None

---

# 8. Runtime Stability and Error Handling

## Error Boundaries

- `AppErrorBoundary` (class component in `src/App.tsx` L248-280) wraps all routes. Logs error + component stack via `addErrorLog`. Renders a fallback "Something went wrong" card with Reload button.

## Global Error Listeners

- `GlobalErrorListener` component captures `window.error` and `unhandledrejection` events, correlates them with the active action trace, and logs via `addErrorLog`.
- `beforeunload` listener in `traceBridge.ts` persists trace data before page unload.

## Retry Semantics

- REST API: Single retry after idle recovery threshold for idempotent methods (GET/HEAD/OPTIONS). SID uploads retry up to 3x with exponential backoff.
- Circuit breaker: Opens after consecutive failures, holds for configurable cooldown.
- FTP: Stateless per-request through the bridge layer; no persistent connection to manage.

## Resource Cleanup

All `useEffect` hooks return cleanup functions. All `setInterval` calls have matching `clearInterval`. AbortController is used extensively (20+ instances) for cancellable fetch operations.

## Trace Buffer Memory

The trace session allows up to 50 MB in-memory with 30-minute retention and 25,000 event cap. Eviction is FIFO. This ceiling is generous for a mobile app.

No issues identified in this chapter. The error handling and cleanup patterns are thorough and consistent.

---

# 9. Performance and Resource Usage

## Startup Path

The startup is carefully staged:
1. **Synchronous**: `initializeRuntimeMotionMode()` — detects low-end devices (≤4 cores / ≤4 GB RAM)
2. **Render**: All 7 page routes use `React.lazy()` with dynamic imports
3. **Post-paint deferred**: `requestAnimationFrame` → `requestAnimationFrame` → `requestIdleCallback` chain for font loading, trace hooks, secure-storage priming
4. **First-meaningful-interaction hook**: Diagnostics bridge, debug snapshot publisher, and web server log bridge load only after the first real user interaction

## Bundle Size

| Metric | Value |
|--------|-------|
| Total dist | 5.4 MB |
| Main JS bundle | 642 KB (208 KB gzip) |
| Largest lazy chunk | PlayFilesPage 108 KB |
| Total JS | ~1.5 MB across 51 chunks |
| CSS | 78 KB |

The main bundle at 642 KB is moderately large. No `manualChunks` configuration or bundle analyzer is configured. `chunkSizeWarningLimit` is raised to 1200 KB (default 500 KB).

## Startup Performance Budgets

CI-enforced budgets via `scripts/startup/assert-startup-budgets.mjs`:

| Metric | Budget |
|--------|--------|
| StartupRequestCount (p95) | ≤ 25 |
| TTFSC p50 | ≤ 5000 ms |
| TTFSC p95 | ≤ 8000 ms |
| UserTriggeredCommandLatency p95 | ≤ 900 ms |
| DuplicateStartupConfigKeyRequests | 0 |

Current baseline shows excellent numbers (p95 request count = 1).

## Known Performance Issue — Info Polling Storm

The forensic trace analysis (`doc/diagnostics/trace-forensic-analysis.md`) identified `/v1/info` as 54% of all REST traffic (3,290 of 6,083 requests across 294 test traces). ≥5 requests within 500 ms appeared in 272/294 traces. The document rates the overall risk as "unsafe" for device stability.

No additional performance issues identified. The application already includes device safety controls (circuit breaker, backoff, concurrency limits) to mitigate the polling concern.

---

# 10. Observability and Diagnostics

## Tracing System

Always-on structured tracing with:
- Semantic action traces with correlation IDs
- REST and FTP interactions causally linked to user/system actions
- Events: `action-start`, `action-end`, `rest-request`, `rest-response`, `ftp-operation`, `error`, `backend-decision`
- Deterministic IDs (`EVT-0000`–`EVT-9999`, `COR-0000`–`COR-9999`) for test reproducibility
- PII redaction at capture time
- 30-min / 25k events / 50 MB retention with FIFO eviction

## Application Logs

localStorage-backed ring buffer (500 entries max). Levels: debug, info, warn, error. Console bridge intercepts `console.warn`/`console.error` and mirrors to the log store.

## User-Facing Diagnostics

`GlobalDiagnosticsOverlay` provides an in-app overlay showing:
- Live trace event count, REST/FTP in-flight counts, error counts
- Action summaries with REST/FTP effects
- Log viewer with level filtering

## Export

ZIP export of logs, traces, and actions with PII redaction. Uses `navigator.share()` where available, falls back to download.

## ISSUE — No remote crash reporting

- **ID:** PRA-013
- **Area:** Observability
- **Evidence:** No references to Sentry, Bugsnag, Crashlytics, or any crash reporting SDK in `package.json` or native code. Confirmed in `doc/architecture.md` L140-141: crash reporting relies on Google Play Console Android Vitals only.
- **Problem:** Errors only persist locally (localStorage logs + trace buffer). If the app crashes hard, in-memory traces are lost. There is no aggregated error visibility for the developer.
- **Risk:** Field crashes go undetected unless users manually export and share diagnostics.
- **Severity:** Minor
- **Likelihood:** High — crashes will occur in the field
- **User impact:** Low — app has error boundary with reload option
- **Operational impact:** Medium — blind to field issues
- **Effort:** M
- **Fix outline:** Integrate a lightweight crash reporting service (Sentry, Bugsnag) with source maps for web and native crash capture. Gate behind a privacy consent toggle if needed.
- **Verification:** Trigger a test crash, verify it appears in the crash reporting dashboard.
- **Dependencies:** Privacy policy update required

---

# 11. UX, Accessibility, and Localization

## Accessibility

**Strengths:**
- Good `aria-label` coverage on interactive elements across pages
- `sr-only` classes on icon-only buttons (close, carousel, breadcrumb)
- `aria-hidden="true"` on decorative icons
- Focus-visible flash animation for keyboard users
- Global overflow-wrap protection for text elements

**Gaps:**
- No automated a11y testing (no axe-core, jest-axe, or Lighthouse CI)
- `role=` usage is sparse — many interactive `div` elements lack semantic roles
- No `aria-live` regions for dynamic content updates
- No skip-navigation link

## Touch Targets

Button sizes: default 40px, sm 36px, lg 44px, icon 40×40px. The 44px minimum (WCAG recommendation) is enforced on list action buttons via `min-h-[44px]` but not globally. Default and sm buttons at 36-40px are below the recommendation.

## Localization

No localization framework exists. All user-facing strings are hardcoded in English. No infrastructure for future localization (no i18n, i18next, or similar).

## Text Scaling

Tailwind rem-based font sizes used throughout. Some hardcoded pixel sizes (`text-[11px]`) do not scale with user font preferences. Global `overflow-wrap: anywhere` prevents text overflow. Safe-area insets are handled on body and tab bar.

## UX Documentation

Excellent internal documentation: `doc/ux-guidelines.md` (386 lines) and `doc/ux-interactions.md` (416 lines) with full CTA inventory, importance ratings, and coverage mapping.

## ISSUE — No automated accessibility testing

- **ID:** PRA-014
- **Area:** Accessibility
- **Evidence:** No `axe-core`, `jest-axe`, or `@axe-core/playwright` in `package.json`. No a11y test files.
- **Problem:** Accessibility regressions can be introduced without detection. Manual testing is insufficient for catching WCAG violations at scale.
- **Risk:** Users with screen readers or other assistive technologies may encounter broken interactions.
- **Severity:** Minor
- **Likelihood:** Medium — each UI change could regress a11y
- **User impact:** Medium — assistive technology users affected
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Add `@axe-core/playwright` and include `checkA11y()` in existing Playwright tests for key pages. Add `jest-axe` to component tests.
- **Verification:** Run Playwright tests with a11y checks enabled; verify 0 violations on core pages.
- **Dependencies:** None

## ISSUE — No localization infrastructure

- **ID:** PRA-015
- **Area:** UX
- **Evidence:** Grep for `i18n`, `i18next`, `intl`, `locale`, `translate` returned zero framework results. All strings are hardcoded English in JSX.
- **Problem:** The app cannot be translated without significant refactoring. Growing international user base (C64 community is global) would benefit from localization.
- **Risk:** Limited market reach. Users who don't read English cannot use the app effectively.
- **Severity:** Minor
- **Likelihood:** Medium — multi-language support commonly requested
- **User impact:** Medium — non-English speakers
- **Operational impact:** Low
- **Effort:** L
- **Fix outline:** Integrate `react-i18next`. Extract all user-facing strings to translation files. Start with English as the default locale.
- **Verification:** Switch locale to a test language; verify all visible strings are translated.
- **Dependencies:** None

## ISSUE — Touch targets below 44px on default buttons

- **ID:** PRA-016
- **Area:** UX, Accessibility
- **Evidence:** `src/components/ui/button.tsx` L30-37: default `h-10` (40px), sm `h-9` (36px). The 44px minimum is only enforced via `min-h-[44px]` on specific list action buttons.
- **Problem:** Default and small buttons fall below the WCAG 2.1 Level AAA 44×44px touch target recommendation. This affects users with motor impairments.
- **Risk:** Increased miss-tap rate, especially on small-screen devices.
- **Severity:** Minor
- **Likelihood:** Medium — affects every interaction
- **User impact:** Medium — usability degradation
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Increase default button height to `h-11` (44px) or add consistent `min-h-[44px]` across interactive components.
- **Verification:** Visual inspection and automated touch-target audit on key pages.
- **Dependencies:** None

---

# 12. Platform Specific - Android

## SDK Configuration

| Setting | Value | File |
|---------|-------|------|
| namespace | `uk.gleissner.c64commander` | `android/app/build.gradle` L58 |
| compileSdk | 35 | `android/variables.gradle` |
| minSdk | 22 | `android/variables.gradle` |
| targetSdk | 35 | `android/variables.gradle` |
| Java/Kotlin compat | Java 17 | `android/app/build.gradle` |
| Kotlin | 1.9.22 | `android/build.gradle` |
| Gradle | 8.2.1 | `gradle-wrapper.properties` |
| AGP | 8.2.1 | `android/build.gradle` |

## Signing

- Release signing loaded from `.env` or `key.properties`, with environment variable fallbacks
- Keystore file: `android/keystore/release.keystore` (gitignored)
- `key.properties` is in `.gitignore` (line 53)
- CI decodes keystore from `ANDROID_KEYSTORE_BASE64` secret

## Permissions

| Permission | Purpose |
|-----------|---------|
| `INTERNET` | C64U REST/FTP communication |
| `FOREGROUND_SERVICE` | Background SID playback |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | Media session for playback |
| `WAKE_LOCK` | Keep device awake during playback |

Minimal permission set.

## Native Code

14 Kotlin files totaling ~4,100 lines. 8 Capacitor plugins covering background execution, diagnostics, FTP, folder picking, HVSC ingestion, mock server, feature flags, and secure storage.

## ISSUE — Android release build minification disabled

- **ID:** PRA-017
- **Area:** Android, Security, Performance
- **Evidence:** `android/app/build.gradle` L126-137: `release { minifyEnabled false }`. The `minifiedDebug` build type has `minifyEnabled true`, but the actual release build type does not.
- **Problem:** Release APKs ship unminified, unobfuscated code. The APK is larger than necessary, and reverse engineering is trivial.
- **Risk:** Larger download size. Code inspection reveals internal implementation details. ProGuard/R8 rules are configured but not applied.
- **Severity:** Major
- **Likelihood:** High — every release build affected
- **User impact:** Medium — larger APK download
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Set `minifyEnabled true` and `shrinkResources true` in the `release` block. Test that all kept classes (xz, commons-compress) survive R8 with existing ProGuard rules.
- **Verification:** Build release APK, verify it's smaller, run basic functionality test.
- **Dependencies:** None

## ISSUE — No backup rules for Android 12+

- **ID:** PRA-018
- **Area:** Android, Data
- **Evidence:** `android/app/src/main/AndroidManifest.xml` L9: `android:allowBackup="true"`. No `backup_rules.xml` or `data_extraction_rules.xml` exists under `android/app/src/main/res/xml/`.
- **Problem:** Android 12+ auto-backup scope is undefined. All app data including potentially sensitive EncryptedSharedPreferences and WebView storage could be backed up to Google Drive.
- **Risk:** Encrypted storage credentials may be backed up in a way that causes failures on restore (different device key). User data could leak via cloud backup.
- **Severity:** Minor
- **Likelihood:** Medium — Android auto-backup is on by default
- **User impact:** Low — restore may fail silently
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Create `android/app/src/main/res/xml/data_extraction_rules.xml` excluding `EncryptedSharedPreferences`. Reference via `android:dataExtractionRules` in manifest.
- **Verification:** Verify `adb backup` excludes sensitive data.
- **Dependencies:** None

## ISSUE — Android JVM tests fail on Java 25

- **ID:** PRA-019
- **Area:** Android, Testing
- **Evidence:** `./gradlew test` output: 86/113 tests failed with `NoClassDefFoundError` at `Shadows.java:2748` and `IllegalArgumentException` at `ClassReader.java:200`. Java version: OpenJDK Corretto 25.0.1.
- **Problem:** Robolectric 4.11.1 is incompatible with Java 25. The ASM bytecode library used by Robolectric cannot read Java 25 class files. CI uses a different Java version (likely 17), so this only affects local development.
- **Risk:** Developers on Java 25 cannot run Android unit tests locally. This creates a feedback gap between local development and CI.
- **Severity:** Minor
- **Likelihood:** Medium — developers may use newer JDK versions
- **User impact:** Low
- **Operational impact:** Medium — local test failure
- **Effort:** S
- **Fix outline:** Upgrade Robolectric to a version supporting Java 25 bytecode, or document JDK 17 as the required version for Android tests. Consider pinning via `JAVA_HOME` in the `build` script.
- **Verification:** `./gradlew test` passes on the required JDK version.
- **Dependencies:** None

## ISSUE — Deprecated MediaSession APIs in BackgroundExecutionService

- **ID:** PRA-020
- **Area:** Android
- **Evidence:** `./gradlew assembleDebug` warnings: `BackgroundExecutionService.kt:203` — `FLAG_HANDLES_MEDIA_BUTTONS` and `FLAG_HANDLES_TRANSPORT_CONTROLS` deprecated. `BackgroundExecutionService.kt:259` — `requestAudioFocus` deprecated. `BackgroundExecutionService.kt:282` — `abandonAudioFocus` deprecated.
- **Problem:** The background service uses deprecated MediaSession and AudioManager APIs. These work on current Android versions but may be removed in future API levels.
- **Risk:** Build warnings. Potential breakage on future Android versions.
- **Severity:** Trivial
- **Likelihood:** Low — deprecation warnings are forward-looking
- **User impact:** Low
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Migrate to `MediaSessionCompat` and `AudioFocusRequest` APIs from AndroidX.
- **Verification:** `./gradlew assembleDebug` produces zero deprecation warnings.
- **Dependencies:** None

---

# 13. Platform Specific - iOS

## Configuration

| Setting | Value | Source |
|---------|-------|--------|
| Deployment target (project) | 13.0 | `project.pbxproj` |
| Deployment target (Podfile) | 15.0 | `ios/App/Podfile` |
| Bundle ID | `uk.gleissner.c64commander` | `project.pbxproj` |
| Marketing version | 1.0 | `project.pbxproj` |
| Current project version | 1 | `project.pbxproj` |
| Swift version | 5.0 | `project.pbxproj` |
| Device family | 1,2 (iPhone + iPad) | `project.pbxproj` |

## ATS (App Transport Security)

`NSAllowsLocalNetworking = true` — only local network HTTP is allowed. All non-local traffic requires HTTPS. This is appropriate for the C64U use case.

## Native Code

7 Swift files totaling ~3,139 lines. Registered plugins: FolderPicker, FtpClient, SecureStorage, FeatureFlags, BackgroundExecution, DiagnosticsBridge, MockC64U.

## ISSUE — iOS deployment target mismatch

- **ID:** PRA-021
- **Area:** iOS
- **Evidence:** `ios/App/App.xcodeproj/project.pbxproj` L310: `IPHONEOS_DEPLOYMENT_TARGET = 13.0`. `ios/App/Podfile` L3: `platform :ios, '15.0'`.
- **Problem:** The Xcode project targets iOS 13.0, but CocoaPods specifies iOS 15.0. Pods will only build for iOS 15+, making the effective minimum iOS 15.0, but the project-level setting is misleading.
- **Risk:** Confusion about the actual minimum deployment target. If an app runs on iOS 13-14, pods may crash at runtime.
- **Severity:** Minor
- **Likelihood:** Low — iOS 15+ adoption is very high
- **User impact:** Low
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Align `IPHONEOS_DEPLOYMENT_TARGET` to `15.0` in the Xcode project to match the Podfile.
- **Verification:** Open project in Xcode, verify deployment target matches across all configurations.
- **Dependencies:** None

## ISSUE — No iOS audio background mode

- **ID:** PRA-022
- **Area:** iOS
- **Evidence:** `ios/App/App/Info.plist` — no `UIBackgroundModes` key. `NativePlugins.swift` L920-977: `BackgroundExecutionPlugin` uses `UIApplication.beginBackgroundTask` (30-second limit).
- **Problem:** SID playback will stop when the app is backgrounded on iOS. The `BackgroundExecutionPlugin` is effectively a stub — limited to ~30 seconds of background time. Android has a full foreground service with media session.
- **Risk:** Feature parity gap between Android and iOS. Users expect continuous playback.
- **Severity:** Major
- **Likelihood:** High — backgrounding the app is a common user action
- **User impact:** High — playback stops when switching apps
- **Operational impact:** Low
- **Effort:** M
- **Fix outline:** Add `UIBackgroundModes: audio` to Info.plist. Implement `AVAudioSession` configuration in the iOS BackgroundExecution plugin. This is documented in `doc/internals/ios-parity-matrix.md`.
- **Verification:** Start SID playback, background the app, verify audio continues for >30 seconds.
- **Dependencies:** None

## ISSUE — iOS version not CI-managed

- **ID:** PRA-023
- **Area:** iOS, CI/CD
- **Evidence:** `ios/App/App.xcodeproj/project.pbxproj` L379, L399: `MARKETING_VERSION = 1.0`, `CURRENT_PROJECT_VERSION = 1`. No `agvtool` or CI-driven version injection.
- **Problem:** iOS version and build number are hardcoded at 1.0 (1). Android derives version from git tags and CI run numbers. iOS builds will all show the same version.
- **Risk:** Cannot distinguish iOS builds or enforce upgrade paths. Store submissions require incrementing build numbers.
- **Severity:** Minor
- **Likelihood:** High — every iOS build affected
- **User impact:** Low — cosmetic
- **Operational impact:** Medium — store submission requires manual version bumps
- **Effort:** S
- **Fix outline:** Add version injection in the `ios-prepare` CI job using `agvtool new-marketing-version` and `agvtool new-version` from git tags and run numbers.
- **Verification:** Check IPA's Info.plist for correct version after CI build.
- **Dependencies:** None

## ISSUE — NativePlugins.swift exceeds file size guidelines

- **ID:** PRA-024
- **Area:** iOS
- **Evidence:** `ios/App/App/NativePlugins.swift` — 1017 lines. Project guideline in AGENTS.md: "Split files at ~600 lines."
- **Problem:** Contains 6 Capacitor plugins, diagnostics classes, and debug utilities in a single file. This impairs readability and maintainability.
- **Risk:** Higher merge conflict probability. Harder to navigate and review.
- **Severity:** Trivial
- **Likelihood:** High — the file will grow further
- **User impact:** Low
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Split into individual files per plugin (matching the Android pattern where each plugin is a separate .kt file).
- **Verification:** Build succeeds. All 7 plugins still register in AppDelegate.
- **Dependencies:** None

## ISSUE — No iOS entitlements file

- **ID:** PRA-025
- **Area:** iOS
- **Evidence:** No `.entitlements` file exists under `ios/`.
- **Problem:** If capabilities like Push Notifications, App Groups, or Keychain Sharing are needed in the future, an entitlements file must be created. Current Keychain usage via `SecureStoragePlugin` works without explicit entitlements but limits sharing between app extensions.
- **Risk:** Low current risk. Future capability additions will require creating this file.
- **Severity:** Trivial
- **Likelihood:** Low
- **User impact:** Low
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Create `ios/App/App/App.entitlements` with current capabilities. Reference in Xcode project.
- **Verification:** Xcode build succeeds with entitlements file.
- **Dependencies:** None

---

# 14. Platform Specific - Web

## Hosting Model

Docker-based deployment. Multi-stage build: `node:24-trixie-slim` for build → slim runtime. Published to GHCR (`ghcr.io/chrisgleissner/c64commander`). The Node.js server is required (not optional) because it proxies REST/FTP to the C64U device and manages auth.

## Auth Flow

Server-side password gate: password stored in `web-config.json` on the server. Login via timing-safe comparison. `c64_session` cookie (HttpOnly, SameSite=Lax, 24h TTL). Rate limiting (5 failed attempts → 5-min block per IP). Server injects `X-Password` header when proxying to the device.

## PWA Support

A `manifest.webmanifest` exists with basic fields but only a single 512x512 icon (missing 192x192 and maskable variants). No service worker exists. The app is **not installable as a PWA** in Chrome (requires SW + manifest with icons).

## Layout

No CSS orientation media queries. No `screen.orientation` API usage. No manifest `orientation` field. `viewport-fit=cover` for safe-area handling. `user-scalable=no` disabled zoom.

## ISSUE — No service worker for PWA installability

- **ID:** PRA-026
- **Area:** Web
- **Evidence:** No `sw.js`, no Workbox config, no `navigator.serviceWorker.register()` in the codebase.
- **Problem:** Without a service worker, the web app cannot be installed as a PWA and has no offline caching capability.
- **Risk:** Users cannot add the app to their home screen. Every page load requires a full network fetch.
- **Severity:** Minor
- **Likelihood:** High — affects all web users
- **User impact:** Medium — no "Add to Home Screen" prompt
- **Operational impact:** Low
- **Effort:** M
- **Fix outline:** Add a Workbox-generated service worker with a cache-first strategy for static assets and network-first for API calls. Register in `main.tsx`.
- **Verification:** Chrome DevTools Application tab shows installed service worker. "Add to Home Screen" prompt appears.
- **Dependencies:** PRA-008 (cache headers should be fixed first)

## ISSUE — Incomplete PWA manifest

- **ID:** PRA-027
- **Area:** Web
- **Evidence:** `public/manifest.webmanifest` — single 512x512 icon. Missing 192x192 icon, maskable icon, `description`, `orientation`, and `scope` fields.
- **Problem:** PWA manifest does not meet Chrome's installability criteria (requires 192x192 icon minimum).
- **Risk:** Even with a service worker, the app may not be installable without the correct icon sizes.
- **Severity:** Trivial
- **Likelihood:** High — affects all web users
- **User impact:** Low
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Add 192x192 and maskable icon variants. Add `description`, `scope: "/"`, and `orientation: "any"` fields.
- **Verification:** Run Lighthouse PWA audit; verify all installability criteria pass.
- **Dependencies:** PRA-026

## ISSUE — Web server is a single 843-line file

- **ID:** PRA-028
- **Area:** Web
- **Evidence:** `web/server/src/index.ts` — 843 lines handling static serving, REST proxy, FTP proxy, auth, rate limiting, health checks, config management, and diagnostics.
- **Problem:** Exceeds the project's ~600-line guideline. Mixes multiple concerns in one file.
- **Risk:** Maintainability. Harder to test individual handlers in isolation.
- **Severity:** Trivial
- **Likelihood:** High — the file will grow
- **User impact:** Low
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Split into modules: `staticServer.ts`, `restProxy.ts`, `ftpProxy.ts`, `auth.ts`, `diagnostics.ts`.
- **Verification:** `npm run build:web-server` succeeds. `npm run test:web-server` passes.
- **Dependencies:** None

---

# 15. Testing and Quality Gates

## Unit Tests

- **Framework:** Vitest
- **Files:** 232 test files
- **Tests:** 2204 (all passing)
- **Coverage:** 91.6% statements, 84.32% branches, 88.17% functions
- **Threshold:** 80% enforced via Codecov (project and patch)
- **Skipped tests:** None (0 disabled/skipped tests found)

## E2E Tests

- **Framework:** Playwright
- **Files:** ~35 spec files
- **CI sharding:** 12 shards for parallel execution
- **Evidence:** Per-test folders with screenshots, video, trace ZIP, error context
- **Golden traces:** Curated subset for regression detection
- **Mock layer:** In-app mock C64U server (not real device)

## Android Tests

- **Framework:** JUnit 4 + Robolectric 4.11.1
- **Tests:** 113 (27 pass in CI; 86 fail locally on Java 25)
- **Coverage:** Jacoco with 75% instruction coverage threshold
- **Maestro:** Smoke flows (`smoke-launch`, `smoke-hvsc`) on Android emulator

## iOS Tests

- **No native unit tests** (0 XCTest classes)
- **Maestro:** 9 flows in 4 groups (launch, playback, diagnostics, FTP, local import, secure storage, HVSC, config persistence)
- **CI stage:** Informative (Stage A), non-blocking

## Fuzz Testing

- Daily automated fuzz runs (2-hour budget)
- Weighted random actions on Playwright
- Deterministic seed variant for reproducibility
- Fail-fast on any issue

## Coverage Blind Spots

Per `doc/ux-interactions.md` Section 9.4:
- **CRITICAL gap:** Add disks to library E2E flow
- **HIGH gaps:** Shuffle mode, Home quick actions (Reset/Menu/Pause/Resume/Power Off), drive status navigation, Android folder picker, disk browser source selection

## ISSUE — README license badge says GPL v2, LICENSE file is GPL v3

- **ID:** PRA-029
- **Area:** Legal/Licensing
- **Evidence:** `README.md` L5: badge links to `https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html` and reads "License: GPL v2". `LICENSE` file contains the full text of GPL v3. `README.md` L384 text says "GPL v3".
- **Problem:** The badge and body text disagree on the license version. This creates legal ambiguity about the project's actual license.
- **Risk:** Contributors and users may be confused about their rights and obligations. GPL v2 and v3 have different provisions (e.g., v3 has patent provisions and anti-tivoization clauses).
- **Severity:** Major
- **Likelihood:** High — visible on every README view
- **User impact:** Medium — legal clarity
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Update the README badge to reference GPL v3: `https://www.gnu.org/licenses/gpl-3.0.en.html` and change badge text to "GPL v3".
- **Verification:** Visual inspection of README badge. `diff LICENSE <(curl -sL gpl-3.0.txt)` to confirm.
- **Dependencies:** None

## ISSUE — No SPDX license identifier in package.json

- **ID:** PRA-030
- **Area:** Legal/Licensing
- **Evidence:** `package.json` — no `"license"` field present.
- **Problem:** npm expects a `license` field with an SPDX identifier. Tools that inspect package metadata may report the project as unlicensed.
- **Risk:** Automated compliance scanning tools may flag this.
- **Severity:** Trivial
- **Likelihood:** Medium
- **User impact:** Low
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Add `"license": "GPL-3.0-only"` to `package.json`.
- **Verification:** `npm pack --dry-run` shows `license: GPL-3.0-only` in output.
- **Dependencies:** None

## ISSUE — No Commodore trademark disclaimer

- **ID:** PRA-031
- **Area:** Legal/Licensing
- **Evidence:** README.md, THIRD_PARTY_NOTICES.md, docs/privacy-policy.md — no trademark disclaimer for "C64" or "Commodore 64" anywhere.
- **Problem:** "C64" is/was a Commodore trademark. The app name "C64 Commander" uses it without a nominative fair use disclaimer.
- **Risk:** Trademark holder could object. Low probability given the community context, but a disclaimer costs nothing.
- **Severity:** Trivial
- **Likelihood:** Low
- **User impact:** Low
- **Operational impact:** Low
- **Effort:** S
- **Fix outline:** Add a trademark disclaimer to README.md and/or THIRD_PARTY_NOTICES.md: "Commodore 64 and C64 are trademarks of [current holder]. This project is not affiliated with or endorsed by the trademark holder."
- **Verification:** Visual inspection.
- **Dependencies:** None

## ISSUE — No iOS native unit tests

- **ID:** PRA-032
- **Area:** iOS, Testing
- **Evidence:** `doc/internals/ios-parity-matrix.md`: "0 XCTest classes vs 82 JVM tests." No test files found under `ios/App/`.
- **Problem:** 7 Swift native plugins with ~3,139 lines of code have no unit tests. Android has 113 JVM tests for equivalent functionality.
- **Risk:** Regressions in iOS native code (FTP client, secure storage, background execution) go undetected until Maestro smoke tests or manual testing.
- **Severity:** Major
- **Likelihood:** Medium — native code changes can regress
- **User impact:** Medium — iOS users affected by native bugs
- **Operational impact:** Medium — testing gap
- **Effort:** L
- **Fix outline:** Add XCTest targets for each Swift plugin. Start with SecureStorage, FtpClient, and BackgroundExecution (highest-risk plugins).
- **Verification:** `xcodebuild test` passes with >50% coverage on plugin code.
- **Dependencies:** None

## ISSUE — E2E tests run against Vite preview, not native runtime

- **ID:** PRA-033
- **Area:** Testing
- **Evidence:** `doc/testing/testing-infrastructure-review.md` L3-8: "Playwright E2E currently exercises the web build via Vite preview, not a Capacitor WebView or native Android runtime."
- **Problem:** E2E tests do not exercise the actual native runtime. Real-device bugs (CapacitorHttp differences, WebView quirks, native bridge timing) are not caught.
- **Risk:** Test suite provides false confidence for native platform behavior.
- **Severity:** Minor
- **Likelihood:** Medium — Vite preview differs from Capacitor WebView
- **User impact:** Medium — native bugs escape to production
- **Operational impact:** Low
- **Effort:** L
- **Fix outline:** Documented in the testing infrastructure review. Phase 2 proposes a targeted emulator suite for critical paths. Maestro already covers some native paths.
- **Verification:** Run a subset of E2E tests against the Android emulator; compare results.
- **Dependencies:** None

---

# 16. Legal, Licensing, and Attribution

## Project License

GPL v3 (full standard text in `LICENSE`). Badge mismatch documented in PRA-029.

## Third-Party Notices

`THIRD_PARTY_NOTICES.md` (251 lines) covers all major dependency categories with project URL and license type. All listed licenses (MIT, ISC, Apache-2.0, Public Domain/BSD) are compatible with GPL v3.

## Privacy Policy

`docs/privacy-policy.md` — effective 19 January 2026. Accurately reflects no data collection, local-only storage, HVSC download only external network access. Contact: `apps@gleissner.uk`.

## Store Listing

Play Store assets exist in `docs/play-store/` (feature graphics and icons). No text metadata files. Store listing presumably managed in Play Console.

## Known Gaps

- No `"license"` field in `package.json` (PRA-030)
- No NOTICE files for Apache-2.0 dependencies that may provide them
- No Commodore trademark disclaimer (PRA-031)
- Source file copyright headers not systematic

---

# 17. Risk Register and Prioritized Recommendations

## Full Issue Register (sorted by severity, then impact, then effort)

| ID | Title | Severity | Likelihood | User Impact | Op Impact | Effort | Area |
|----|-------|----------|------------|-------------|-----------|--------|------|
| PRA-009 | Critical basic-ftp CVE | Critical | Low | High | High | S | SupplyChain |
| PRA-006 | No web security headers | Critical | Medium | High | Medium | S | Web/Security |
| PRA-017 | Android release minification off | Major | High | Medium | Low | S | Android |
| PRA-029 | README license badge mismatch | Major | High | Medium | Low | S | Legal |
| PRA-004 | No dependency update automation | Major | High | Medium | Medium | S | SupplyChain |
| PRA-022 | No iOS audio background mode | Major | High | High | Low | M | iOS |
| PRA-012 | No incremental data migration | Major | Medium | High | Low | M | Data |
| PRA-032 | No iOS native unit tests | Major | Medium | Medium | Medium | L | iOS/Testing |
| PRA-001 | Google Play upload not SHA-pinned | Major | Low | High | High | S | CI/CD |
| PRA-002 | Maestro CLI curl pipe install | Major | Low | Medium | High | S | CI/CD |
| PRA-014 | No automated a11y testing | Minor | Medium | Medium | Low | S | Accessibility |
| PRA-016 | Touch targets below 44px | Minor | Medium | Medium | Low | S | UX |
| PRA-023 | iOS version not CI-managed | Minor | High | Low | Medium | S | iOS/CI |
| PRA-033 | E2E tests skip native runtime | Minor | Medium | Medium | Low | L | Testing |
| PRA-015 | No localization infrastructure | Minor | Medium | Medium | Low | L | UX |
| PRA-003 | Workflow perms too broad on PRs | Minor | Low | Low | Medium | S | CI/CD |
| PRA-007 | Android cleartext globally enabled | Minor | Low | Low | Low | S | Android |
| PRA-008 | Web Cache-Control no-store on all | Minor | High | Medium | Low | S | Web |
| PRA-019 | Android tests fail on Java 25 | Minor | Medium | Low | Medium | S | Android |
| PRA-021 | iOS deployment target mismatch | Minor | Low | Low | Low | S | iOS |
| PRA-011 | Gradle/AGP significantly outdated | Minor | Medium | Low | Medium | M | Android |
| PRA-010 | Rollup CVE (dev dependency) | Minor | Low | Low | Low | S | SupplyChain |
| PRA-026 | No service worker for PWA | Minor | High | Medium | Low | M | Web |
| PRA-013 | No remote crash reporting | Minor | High | Low | Medium | M | Observability |
| PRA-018 | No Android backup rules | Minor | Medium | Low | Low | S | Android |
| PRA-020 | Deprecated MediaSession APIs | Trivial | Low | Low | Low | S | Android |
| PRA-024 | NativePlugins.swift >1000 lines | Trivial | High | Low | Low | S | iOS |
| PRA-025 | No iOS entitlements file | Trivial | Low | Low | Low | S | iOS |
| PRA-027 | Incomplete PWA manifest | Trivial | High | Low | Low | S | Web |
| PRA-028 | Web server single 843-line file | Trivial | High | Low | Low | S | Web |
| PRA-030 | No SPDX in package.json | Trivial | Medium | Low | Low | S | Legal |
| PRA-031 | No Commodore trademark disclaimer | Trivial | Low | Low | Low | S | Legal |

## Top 10 Low Effort / High Impact

These issues can each be resolved in ≤0.5 day and have significant impact:

| Priority | ID | Title | Effort | Why High Impact |
|----------|-----|-------|--------|-----------------|
| 1 | PRA-009 | Critical basic-ftp CVE | S | Critical CVE, `npm audit fix` resolves it |
| 2 | PRA-006 | No web security headers | S | Eliminates clickjacking and XSS vectors |
| 3 | PRA-017 | Android release minification off | S | Reduces APK size, adds obfuscation |
| 4 | PRA-029 | README license badge mismatch | S | Legal clarity, one-line fix |
| 5 | PRA-004 | No dependency update automation | S | Prevents future CVE accumulation |
| 6 | PRA-001 | Google Play upload SHA pin | S | Closes supply-chain attack vector |
| 7 | PRA-002 | Maestro CLI SHA pin | S | Closes CI supply-chain vector |
| 8 | PRA-003 | PR workflow permissions | S | Least-privilege on PRs |
| 9 | PRA-008 | Cache-Control for static assets | S | Faster page loads for web users |
| 10 | PRA-023 | iOS version from CI | S | Enables iOS build tracking |

---

# 18. Effort vs Impact Matrix

## Classification Rules

- **Impact**: Composite of severity, user impact, and operational impact. High = any Critical/Blocker severity OR High user+op impact. Medium = Major severity OR Medium user/op impact. Low = Minor/Trivial severity AND Low user/op impact.
- **Effort**: S (≤0.5 day), M (0.5-2 days), L (2-5 days), XL (>5 days).

## Matrix

```
                    LOW EFFORT (S)              HIGH EFFORT (M/L/XL)
                ┌───────────────────────────┬───────────────────────────┐
                │  ★ QUICK WINS             │  ★ STRATEGIC              │
                │                           │                           │
  HIGH          │  PRA-009  basic-ftp CVE   │  PRA-022  iOS background  │
  IMPACT        │  PRA-006  Security hdrs   │  PRA-012  Data migration  │
                │  PRA-017  Release minify  │  PRA-032  iOS unit tests  │
                │  PRA-029  License badge   │                           │
                │  PRA-004  Dependabot      │                           │
                │  PRA-001  SHA pin upload  │                           │
                │  PRA-002  Maestro SHA     │                           │
                │  PRA-008  Cache headers   │                           │
                ├───────────────────────────┼───────────────────────────┤
                │  ★ FILL-IN                │  ★ LONG-TERM              │
                │                           │                           │
  LOW           │  PRA-003  PR permissions  │  PRA-033  E2E on native   │
  IMPACT        │  PRA-007  Android netsec  │  PRA-015  Localization    │
                │  PRA-014  A11y testing    │  PRA-013  Crash reporting │
                │  PRA-016  Touch targets   │  PRA-026  Service worker  │
                │  PRA-023  iOS version CI  │  PRA-011  Gradle upgrade  │
                │  PRA-019  Android Java25  │                           │
                │  PRA-021  iOS deploy tgt  │                           │
                │  PRA-018  Backup rules    │                           │
                │  PRA-010  Rollup CVE      │                           │
                │  PRA-020  Deprecated APIs │                           │
                │  PRA-024  Split Swift     │                           │
                │  PRA-025  Entitlements    │                           │
                │  PRA-027  PWA manifest    │                           │
                │  PRA-028  Split web srv   │                           │
                │  PRA-030  SPDX field      │                           │
                │  PRA-031  Trademark note  │                           │
                └───────────────────────────┴───────────────────────────┘
```

**Recommended execution order:** Quick Wins (left-to-right by priority) → Strategic (22 → 12 → 32) → Fill-in (opportunistic) → Long-term (roadmap).

---

# 19. Shipping Recommendation

## Verdict: Ship with mitigations

## Justification

**The application is ready for release** with the following mandatory mitigations before shipping:

### Must-fix before release (1-2 days total)

1. **PRA-009** — Update `basic-ftp` to ≥5.2.0 (`npm audit fix`). Critical CVE.
2. **PRA-006** — Add security headers to the web server. Prevents clickjacking and XSS.
3. **PRA-029** — Fix the README license badge to say GPL v3.

### Should-fix for the first post-release patch

4. **PRA-017** — Enable R8 minification for Android release builds.
5. **PRA-004** — Add Dependabot configuration.
6. **PRA-001** — SHA-pin the Google Play upload action.
7. **PRA-002** — SHA-pin or checksum-verify the Maestro CLI install.

### Rationale

The application has strong fundamentals:
- 91.6% statement coverage with 2204 passing unit tests
- Comprehensive error handling with global boundaries and unhandled rejection capture
- Structured tracing with PII redaction
- Device safety controls (circuit breaker, backoff, concurrency limits)
- Clean lint pass and successful builds on all platforms

The two Critical issues (PRA-009, PRA-006) are straightforward fixes. The remaining issues are improvements, not blockers. The iOS background audio gap (PRA-022) is a feature limitation, not a safety issue — it should be communicated in release notes.

No Blocker-severity issues were identified. The application does not handle financial transactions, health data, or other high-stakes data — it controls a hobbyist hardware device on a local network.
