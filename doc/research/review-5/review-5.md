# Consolidated Production Readiness Assessment — C64 Commander

Date: 2026-02-28
Commit: cf7d0826a429802524b6ee86beb73e81449f4e04
Sources: review-5a.md, review-5b.md

## Consolidation Method
All PRA issues from both source reviews were extracted end-to-end and reconciled by root cause and scope overlap. Exact duplicates were merged. Partial overlaps were merged where one scope was a subset, otherwise linked through reconciliation notes. Severity/effort/likelihood conflicts were normalized using conservative (higher) values unless explicitly narrowed by source evidence. No source code was modified in this phase.

## Executive Summary
Unified recommendation: do not ship broadly until consolidated Blocker/Critical issues are remediated or explicitly risk-accepted with compensating controls. Controlled internal or trusted-LAN release is conditionally acceptable if transport and CI supply-chain risks are documented and bounded.

## Priority Table
| Rank | ISSUE-ID | Title | Category | Severity | Impact | Likelihood | Effort | Priority Score | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ISSUE-001 | Repository-local signing secret pattern | Security | Blocker | High | High | S | 7.50 | review-5a |
| 2 | ISSUE-002 | Critical runtime dependency vulnerability in basic-ftp | Supply Chain | Critical | High | High | S | 6.00 | both |
| 3 | ISSUE-003 | No web server security headers | Security | Critical | High | Medium | S | 6.00 | review-5b |
| 4 | ISSUE-004 | iOS workflow installs Maestro via unpinned remote script | Supply Chain | Critical | High | Medium | S | 6.00 | both |
| 5 | ISSUE-005 | Browser zoom is disabled, reducing accessibility | UX & Accessibility | Major | High | High | S | 4.50 | review-5a |
| 6 | ISSUE-006 | CI token permissions are broader than necessary | CI/CD | Major | High | Medium | S | 4.50 | both |
| 7 | ISSUE-007 | Android cleartext traffic globally enabled without domain restriction | Security | Critical | High | High | M | 4.00 | both |
| 8 | ISSUE-008 | Password propagation over HTTP via X-Password header | Security | Critical | High | High | M | 4.00 | review-5a |
| 9 | ISSUE-009 | Plain FTP transport across all platform backends | Security | Critical | High | High | L | 3.00 | review-5a |
| 10 | ISSUE-010 | Android backups enabled without explicit backup exclusion rules | Android | Major | Medium | Medium | S | 3.00 | both |
| 11 | ISSUE-011 | No dependency update automation | Supply Chain | Major | Medium | High | S | 3.00 | both |
| 12 | ISSUE-012 | README license badge says GPL v2, LICENSE file is GPL v3 | Legal & Licensing | Major | Medium | High | S | 3.00 | both |
| 13 | ISSUE-013 | GitHub Actions are pinned to mutable tags, not immutable SHAs | Supply Chain | Major | High | Medium | M | 3.00 | both |
| 14 | ISSUE-014 | No iOS audio background mode | iOS | Major | High | High | M | 3.00 | review-5b |
| 15 | ISSUE-015 | iOS deployment and version metadata are inconsistent | iOS | Major | High | High | M | 3.00 | both |
| 16 | ISSUE-016 | Current persistence adapters can silently reset state on parse/version mismatch | Data Integrity | Major | High | Medium | L | 2.25 | both |
| 17 | ISSUE-017 | Android ABI policy includes emulator ABIs in default packaging path | Android | Major | Medium | Medium | M | 2.00 | review-5a |
| 18 | ISSUE-018 | Android diagnostics broadcast is globally observable | Security | Major | Medium | Medium | M | 2.00 | review-5a |
| 19 | ISSUE-019 | Android release build keeps minification disabled | Android | Major | Medium | High | M | 2.00 | both |
| 20 | ISSUE-020 | Web runtime disables asset caching and has no service worker fallback | Web | Major | Medium | High | M | 2.00 | both |
| 21 | ISSUE-021 | Android JVM tests fail on Java 25 | Testing | Minor | Medium | Medium | S | 2.00 | review-5b |
| 22 | ISSUE-022 | Android build verification could not complete in this assessment environment | Testing | Minor | Medium | Medium | S | 2.00 | review-5a |
| 23 | ISSUE-023 | Coverage quality bar mismatch between CI gate and repository guidance | Testing | Minor | Medium | High | S | 2.00 | review-5a |
| 24 | ISSUE-024 | No automated accessibility testing | UX & Accessibility | Minor | Medium | Medium | S | 2.00 | review-5b |
| 25 | ISSUE-025 | Touch targets below 44px on default buttons | UX & Accessibility | Minor | Medium | Medium | S | 2.00 | review-5b |
| 26 | ISSUE-026 | iOS local build command is not executable on Linux assessment host | iOS | Minor | Medium | High | S | 2.00 | review-5a |
| 27 | ISSUE-027 | No iOS native unit tests | Testing | Major | Medium | Medium | L | 1.50 | review-5b |
| 28 | ISSUE-028 | No localization infrastructure | UX & Accessibility | Major | Medium | High | L | 1.50 | both |
| 29 | ISSUE-029 | Web bundle size profile is high for first load | Performance | Major | Medium | High | L | 1.50 | review-5a |
| 30 | ISSUE-030 | Gradle and AGP significantly outdated | Android | Minor | Medium | Medium | M | 1.33 | review-5b |
| 31 | ISSUE-031 | No remote crash reporting | Observability | Minor | Medium | High | M | 1.33 | review-5b |
| 32 | ISSUE-032 | No CODEOWNERS file | CI/CD | Minor | Low | Medium | S | 1.00 | review-5b |
| 33 | ISSUE-033 | Rollup path traversal vulnerability (dev dependency) | Supply Chain | Minor | Low | Low | S | 1.00 | review-5b |
| 34 | ISSUE-034 | E2E tests run against Vite preview, not native runtime | Testing | Minor | Medium | Medium | L | 1.00 | review-5b |
| 35 | ISSUE-035 | Deprecated MediaSession APIs in BackgroundExecutionService | Android | Trivial | Low | Low | S | 0.50 | review-5b |
| 36 | ISSUE-036 | Incomplete PWA manifest | Web | Trivial | Low | High | S | 0.50 | review-5b |
| 37 | ISSUE-037 | NativePlugins.swift exceeds file size guidelines | Architecture & Maintainability | Trivial | Low | High | S | 0.50 | review-5b |
| 38 | ISSUE-038 | No Commodore trademark disclaimer | Legal & Licensing | Trivial | Low | Low | S | 0.50 | review-5b |
| 39 | ISSUE-039 | No SPDX license identifier in package.json | Legal & Licensing | Trivial | Low | Medium | S | 0.50 | review-5b |
| 40 | ISSUE-040 | No iOS entitlements file | iOS | Trivial | Low | Low | S | 0.50 | review-5b |
| 41 | ISSUE-041 | Web server is a single 843-line file | Architecture & Maintainability | Trivial | Low | High | S | 0.50 | review-5b |

## Top 10 Highest Priority Issues
- **ISSUE-001** (Repository-local signing secret pattern) ranks in the top set due to Blocker severity, High impact, and S effort, yielding a priority score of 7.50.
- **ISSUE-002** (Critical runtime dependency vulnerability in basic-ftp) ranks in the top set due to Critical severity, High impact, and S effort, yielding a priority score of 6.00.
- **ISSUE-003** (No web server security headers) ranks in the top set due to Critical severity, High impact, and S effort, yielding a priority score of 6.00.
- **ISSUE-004** (iOS workflow installs Maestro via unpinned remote script) ranks in the top set due to Critical severity, High impact, and S effort, yielding a priority score of 6.00.
- **ISSUE-005** (Browser zoom is disabled, reducing accessibility) ranks in the top set due to Major severity, High impact, and S effort, yielding a priority score of 4.50.
- **ISSUE-006** (CI token permissions are broader than necessary) ranks in the top set due to Major severity, High impact, and S effort, yielding a priority score of 4.50.
- **ISSUE-007** (Android cleartext traffic globally enabled without domain restriction) ranks in the top set due to Critical severity, High impact, and M effort, yielding a priority score of 4.00.
- **ISSUE-008** (Password propagation over HTTP via X-Password header) ranks in the top set due to Critical severity, High impact, and M effort, yielding a priority score of 4.00.
- **ISSUE-009** (Plain FTP transport across all platform backends) ranks in the top set due to Critical severity, High impact, and L effort, yielding a priority score of 3.00.
- **ISSUE-010** (Android backups enabled without explicit backup exclusion rules) ranks in the top set due to Major severity, Medium impact, and S effort, yielding a priority score of 3.00.

## Low-Effort / High-Impact Subset
| ISSUE-ID | Title | Severity | Impact | Likelihood | Effort | Priority Score |
| --- | --- | --- | --- | --- | --- | --- |
| ISSUE-001 | Repository-local signing secret pattern | Blocker | High | High | S | 7.50 |
| ISSUE-002 | Critical runtime dependency vulnerability in basic-ftp | Critical | High | High | S | 6.00 |
| ISSUE-003 | No web server security headers | Critical | High | Medium | S | 6.00 |
| ISSUE-004 | iOS workflow installs Maestro via unpinned remote script | Critical | High | Medium | S | 6.00 |
| ISSUE-005 | Browser zoom is disabled, reducing accessibility | Major | High | High | S | 4.50 |
| ISSUE-006 | CI token permissions are broader than necessary | Major | High | Medium | S | 4.50 |

## Issue Register

### 1. Security

#### ISSUE-001: Repository-local signing secret pattern

- **Original IDs:** PRA-001 (review-5a)
- **Source:** review-5a
- **Category:** Security
- **Description:** Android signing credentials are loaded from a repository-local `.env` pattern and wired directly into release signing logic.
- **Root Cause:** Credential leakage can enable unauthorized release signing, compromised update trust, and permanent key revocation work.
- **Impact:** High
- **Likelihood:** High
- **Severity:** Blocker
- **Effort:** S
- **Priority Score:** 7.50
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `.env` via `command:cmd-env-keystore-vars-mask`; `android/app/build.gradle:8-15`; `android/app/build.gradle:90-93`
- **Recommended Resolution:** - Remove signing secrets from `.env` usage for local and CI release paths.
- **Verification:** `git grep -n "KEYSTORE_STORE_PASSWORD\|KEYSTORE_KEY_PASSWORD"`; `./gradlew :app:assembleRelease` with secrets injected only via environment/CI secret store.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-003: No web server security headers

- **Original IDs:** PRA-006 (review-5b)
- **Source:** review-5b
- **Category:** Security
- **Description:** The custom Node.js web server sends no security headers. This exposes the web platform to clickjacking, MIME sniffing, and XSS vectors.
- **Root Cause:** An attacker on the same network could iframe the app or exploit a future XSS to access the C64U device password.
- **Impact:** High
- **Likelihood:** Medium
- **Severity:** Critical
- **Effort:** S
- **Priority Score:** 6.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `web/server/src/index.ts` — complete absence of security headers. No CSP, HSTS, X-Frame-Options, X-Content-Type-Options, or Referrer-Policy.
- **Recommended Resolution:** Add response headers in the server's request handler: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security` (when behind TLS).
- **Verification:** `curl -I http://localhost:8064/` and verify all headers present.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-007: Android cleartext traffic globally enabled without domain restriction

- **Original IDs:** PRA-002 (review-5a) | PRA-007 (review-5b)
- **Source:** both
- **Category:** Security
- **Description:** The Android app enables cleartext traffic globally and no network security config file was found to constrain destinations. All HTTP traffic is permitted to any host. The app only needs cleartext to the C64U device on the local network.
- **Root Cause:** If the WebView loads third-party content or a future feature adds external API calls, those would also use cleartext.
- **Impact:** High
- **Likelihood:** High
- **Severity:** Critical
- **Effort:** M
- **Priority Score:** 4.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `android/app/src/main/AndroidManifest.xml:11`; `command:cmd-android-network-config-check-2026-02-28T19:56:14Z`; `src/lib/c64api.ts:28-31`; `src/lib/c64api.ts:313-315`; `android/app/src/main/AndroidManifest.xml` L10: `android:usesCleartextTraffic="true"`. No `network_security_config.xml` exists.
- **Recommended Resolution:** - Add `network_security_config.xml` restricting cleartext to explicitly approved local hosts/subnets.; Add `android/app/src/main/res/xml/network_security_config.xml` with `<domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">*</domain></domain-config>` scoped to local addresses. Reference it via `android:networkSecurityConfig` in the manifest.
- **Verification:** `aapt dump xmltree app-release.apk AndroidManifest.xml | rg usesCleartextTraffic`; integration test with local host allowed and non-local host blocked.; Verify HVSC download still works (HTTPS) and C64U device communication works (HTTP).
- **Notes on Reconciliation:** Severity conflict resolved using higher severity. Effort conflict resolved using higher effort. Likelihood conflict resolved using higher likelihood.

#### ISSUE-008: Password propagation over HTTP via X-Password header

- **Original IDs:** PRA-004 (review-5a)
- **Source:** review-5a
- **Category:** Security
- **Description:** REST requests default to HTTP endpoints and include network password in custom header.
- **Root Cause:** Header-level credentials are exposed on plaintext channels and can be replayed.
- **Impact:** High
- **Likelihood:** High
- **Severity:** Critical
- **Effort:** M
- **Priority Score:** 4.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `src/lib/c64api.ts:28-31`; `src/lib/c64api.ts:557-561`; `web/server/src/index.ts:485`; `web/server/src/index.ts:496-497`
- **Recommended Resolution:** - Prefer HTTPS/TLS endpoints where available and gate plaintext behind explicit advanced mode.
- **Verification:** integration tests for HTTPS path; capture headers on plaintext-disabled path to ensure no secret over cleartext.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-009: Plain FTP transport across all platform backends

- **Original IDs:** PRA-003 (review-5a)
- **Source:** review-5a
- **Category:** Security
- **Description:** FTP operations are implemented with plaintext transport and no TLS upgrade path.
- **Root Cause:** Directory/file operations and credentials can be observed or tampered with on network path.
- **Impact:** High
- **Likelihood:** High
- **Severity:** Critical
- **Effort:** L
- **Priority Score:** 3.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `android/.../FtpClientPlugin.kt:60-69`; `android/.../FtpClientPlugin.kt:131-145`; `ios/App/App/IOSFtp.swift:27`; `ios/App/App/IOSFtp.swift:121`; `web/server/src/index.ts:547-553`; `web/server/src/index.ts:592-598`
- **Recommended Resolution:** - Evaluate secure transport options supported by device ecosystem.
- **Verification:** platform integration tests asserting TLS negotiation where supported; packet capture confirms encrypted transport.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-018: Android diagnostics broadcast is globally observable

- **Original IDs:** PRA-006 (review-5a)
- **Source:** review-5a
- **Category:** Security
- **Description:** Native diagnostics are emitted via unscoped `sendBroadcast`, including stack traces and contextual fields.
- **Root Cause:** Other apps on device can subscribe to action and receive internal error/trace information.
- **Impact:** Medium
- **Likelihood:** Medium
- **Severity:** Major
- **Effort:** M
- **Priority Score:** 2.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `android/.../AppLogger.kt:56-73`; `android/.../AppLogger.kt:67-71`
- **Recommended Resolution:** - Replace global broadcast with local in-process channel.
- **Verification:** instrumentation test ensuring third-party receiver cannot capture diagnostics events.
- **Notes on Reconciliation:** No conflicts

### 2. Supply Chain

#### ISSUE-002: Critical runtime dependency vulnerability in basic-ftp

- **Original IDs:** PRA-011 (review-5a) | PRA-009 (review-5b)
- **Source:** both
- **Category:** Supply Chain
- **Description:** `npm audit` reports a critical advisory for `basic-ftp <5.2.0`, and runtime dependency currently uses `^5.0.3`. `basic-ftp` has a path traversal vulnerability in its `downloadToDir()` method. This dependency is used in the web server's FTP proxy (`web/server/src/index.ts`).
- **Root Cause:** A malicious FTP server (or compromised C64U device) could write files outside the intended directory via crafted filenames during FTP operations.
- **Impact:** High
- **Likelihood:** High
- **Severity:** Critical
- **Effort:** S
- **Priority Score:** 6.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `command:cmd-npm-audit-runtime-2026-02-28T19:57:50Z`; `package.json:100`; `npm audit --omit dev` output: `basic-ftp <5.2.0 — GHSA-5rq4-664w-9x2c (critical)`
- **Recommended Resolution:** - Upgrade `basic-ftp` to a fixed version.; Run `npm audit fix` to update `basic-ftp` to ≥5.2.0. Verify FTP proxy functionality with updated version.
- **Verification:** `npm audit --omit=dev --audit-level=critical` exits 0.; `npm audit --omit dev` reports 0 vulnerabilities.
- **Notes on Reconciliation:** Likelihood conflict resolved using higher likelihood.

#### ISSUE-004: iOS workflow installs Maestro via unpinned remote script

- **Original IDs:** PRA-009 (review-5a) | PRA-002 (review-5b)
- **Source:** both
- **Category:** Supply Chain
- **Description:** CI executes `curl -Ls ... | bash` to install tooling directly from remote script. Maestro CLI is installed by piping a remote script into bash without checksum verification.
- **Root Cause:** A compromised CDN or DNS hijack could execute arbitrary code on CI runners.
- **Impact:** High
- **Likelihood:** Medium
- **Severity:** Critical
- **Effort:** S
- **Priority Score:** 6.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `.github/workflows/ios.yaml:200`; `.github/workflows/android.yaml` L648, `.github/workflows/ios.yaml` L179-184: `curl -Ls "https://get.maestro.mobile.dev" | bash`
- **Recommended Resolution:** - Download versioned artifact with checksum/signature verification.; Pin Maestro to a specific version and verify a SHA-256 checksum after download.
- **Verification:** workflow logs show fixed version and checksum validation step.; Compare installed binary checksum against a known-good value.
- **Notes on Reconciliation:** Severity conflict resolved using higher severity. Likelihood conflict resolved using higher likelihood.

#### ISSUE-011: No dependency update automation

- **Original IDs:** PRA-010 (review-5a) | PRA-004 (review-5b)
- **Source:** both
- **Category:** Supply Chain
- **Description:** No automated dependency update PR mechanism was found in `.github/dependabot.yml`. npm dependencies and GitHub Actions versions are not automatically tracked for security updates.
- **Root Cause:** Known vulnerabilities in dependencies accumulate without notification. The current `basic-ftp` CVE (PRA-009) is an example.
- **Impact:** Medium
- **Likelihood:** High
- **Severity:** Major
- **Effort:** S
- **Priority Score:** 3.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `command:cmd-missing-dependabot-2026-02-28T19:56:14Z`; No `.github/dependabot.yml` or `.github/renovate.json` exists.
- **Recommended Resolution:** - Add Dependabot for npm, GitHub Actions, and Gradle/CocoaPods where applicable.; Add `.github/dependabot.yml` with `npm` and `github-actions` ecosystems. Configure weekly schedule.
- **Verification:** Dependabot PRs appear after schedule run.; Verify Dependabot opens PRs within one week of the configuration commit.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-013: GitHub Actions are pinned to mutable tags, not immutable SHAs

- **Original IDs:** PRA-008 (review-5a) | PRA-001 (review-5b)
- **Source:** both
- **Category:** Supply Chain
- **Description:** CI uses action version tags (`@v3`, `@v4`, `@v5`, `@v6`) instead of commit SHAs. The Google Play upload action uses a mutable tag (`@v1`) instead of a SHA pin. Tag mutation is a known supply-chain attack vector.
- **Root Cause:** A compromised tag could inject malicious code into the release pipeline, potentially exfiltrating the Play service account JSON secret.
- **Impact:** High
- **Likelihood:** Medium
- **Severity:** Major
- **Effort:** M
- **Priority Score:** 3.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `.github/workflows/android.yaml:29`; `.github/workflows/android.yaml:34`; `.github/workflows/web.yaml:312`; `.github/workflows/ios.yaml:47`; `.github/workflows/android.yaml` L1322: `r0adkll/upload-google-play@v1`
- **Recommended Resolution:** - Replace tag refs with full commit SHAs for all third-party actions.; Pin to a specific commit SHA: `r0adkll/upload-google-play@<sha>`.
- **Verification:** `rg -n "uses: .*@v[0-9]" .github/workflows` should return none.; Verify the SHA matches the expected release tag.
- **Notes on Reconciliation:** Effort conflict resolved using higher effort. Likelihood conflict resolved using higher likelihood.

#### ISSUE-033: Rollup path traversal vulnerability (dev dependency)

- **Original IDs:** PRA-010 (review-5b)
- **Source:** review-5b
- **Category:** Supply Chain
- **Description:** Vite's bundler (rollup) has a path traversal vulnerability for arbitrary file write. This is a build-time risk only.
- **Root Cause:** A malicious npm package with crafted imports could write files during the build process.
- **Impact:** Low
- **Likelihood:** Low
- **Severity:** Minor
- **Effort:** S
- **Priority Score:** 1.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `npm audit` output: `rollup 4.0.0-4.58.0 — GHSA-mw96-cpmx-2vgc (high)`
- **Recommended Resolution:** Run `npm audit fix` or pin rollup ≥4.58.1 in overrides.
- **Verification:** `npm audit` shows no rollup vulnerability.
- **Notes on Reconciliation:** No conflicts

### 3. CI/CD

#### ISSUE-006: CI token permissions are broader than necessary

- **Original IDs:** PRA-007 (review-5a) | PRA-003 (review-5b)
- **Source:** both
- **Category:** CI/CD
- **Description:** Core workflows request `contents: write` at workflow level, including non-release jobs. `contents: write` is granted at workflow level, applying to all jobs including PR builds that only need read access. Write permissions should be scoped to release jobs only.
- **Root Cause:** Compromised job context has elevated repository mutation capability.
- **Impact:** High
- **Likelihood:** Medium
- **Severity:** Major
- **Effort:** S
- **Priority Score:** 4.50
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `.github/workflows/android.yaml:14-16`; `.github/workflows/ios.yaml:14-16`; `.github/workflows/android.yaml` L13-14: `contents: write`, `.github/workflows/ios.yaml` L13-14: `contents: write`
- **Recommended Resolution:** - Set default workflow permissions to read-only.; Move `contents: write` to per-job `permissions` blocks on `release-artifacts` and `ios-package-altstore` only. Set workflow-level to `contents: read`.
- **Verification:** run workflow dry-runs and confirm non-release jobs pass with read-only token.; Run a PR build and confirm all jobs succeed with read-only permissions.
- **Notes on Reconciliation:** Severity conflict resolved using higher severity. Likelihood conflict resolved using higher likelihood.

#### ISSUE-032: No CODEOWNERS file

- **Original IDs:** PRA-005 (review-5b)
- **Source:** review-5b
- **Category:** CI/CD
- **Description:** No mandatory code review is enforced for security-sensitive paths (workflow files, signing config, native bridges).
- **Root Cause:** Changes to CI workflows or signing configuration could be merged without specialized review.
- **Impact:** Low
- **Likelihood:** Medium
- **Severity:** Minor
- **Effort:** S
- **Priority Score:** 1.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** No `.github/CODEOWNERS` file exists.
- **Recommended Resolution:** Create `.github/CODEOWNERS` mapping `.github/workflows/`, `android/keystore/`, and `scripts/print_keystore_secrets.sh` to repository owners.
- **Verification:** Verify PR to a protected path requires owner approval.
- **Notes on Reconciliation:** No conflicts

### 4. Android

#### ISSUE-010: Android backups enabled without explicit backup exclusion rules

- **Original IDs:** PRA-005 (review-5a) | PRA-018 (review-5b)
- **Source:** both
- **Category:** Android
- **Description:** `allowBackup=true` is enabled without explicit backup policy files to exclude sensitive state. Android 12+ auto-backup scope is undefined. All app data including potentially sensitive EncryptedSharedPreferences and WebView storage could be backed up to Google Drive.
- **Root Cause:** Encrypted storage credentials may be backed up in a way that causes failures on restore (different device key). User data could leak via cloud backup.
- **Impact:** Medium
- **Likelihood:** Medium
- **Severity:** Major
- **Effort:** S
- **Priority Score:** 3.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `android/app/src/main/AndroidManifest.xml:5`; `find android/app/src/main/res -maxdepth 3 -type f` (no backup rules file shown); `android/app/src/main/AndroidManifest.xml` L9: `android:allowBackup="true"`. No `backup_rules.xml` or `data_extraction_rules.xml` exists under `android/app/src/main/res/xml/`.
- **Recommended Resolution:** - Decide backup policy for diagnostics/config/credentials.; Create `android/app/src/main/res/xml/data_extraction_rules.xml` excluding `EncryptedSharedPreferences`. Reference via `android:dataExtractionRules` in manifest.
- **Verification:** `aapt dump xmltree app-release.apk AndroidManifest.xml`; restore test on emulator with backup enabled.; Verify `adb backup` excludes sensitive data.
- **Notes on Reconciliation:** Severity conflict resolved using higher severity.

#### ISSUE-017: Android ABI policy includes emulator ABIs in default packaging path

- **Original IDs:** PRA-014 (review-5a)
- **Source:** review-5a
- **Category:** Android
- **Description:** ABI filters include `x86` and `x86_64` alongside device ABIs without split delivery strategy.
- **Root Cause:** Universal artifacts can become unnecessarily large for end users.
- **Impact:** Medium
- **Likelihood:** Medium
- **Severity:** Major
- **Effort:** M
- **Priority Score:** 2.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `android/app/build.gradle:76-78`
- **Recommended Resolution:** - Keep emulator ABIs for debug builds only.
- **Verification:** inspect release AAB/APK ABI contents and compare artifact sizes.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-019: Android release build keeps minification disabled

- **Original IDs:** PRA-013 (review-5a) | PRA-017 (review-5b)
- **Source:** both
- **Category:** Android
- **Description:** Release build type explicitly disables minification/obfuscation. Release APKs ship unminified, unobfuscated code. The APK is larger than necessary, and reverse engineering is trivial.
- **Root Cause:** Larger download size. Code inspection reveals internal implementation details. ProGuard/R8 rules are configured but not applied.
- **Impact:** Medium
- **Likelihood:** High
- **Severity:** Major
- **Effort:** M
- **Priority Score:** 2.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `android/app/build.gradle:131-135`; `android/app/proguard-rules.pro:1-24`; `android/app/build.gradle` L126-137: `release { minifyEnabled false }`. The `minifiedDebug` build type has `minifyEnabled true`, but the actual release build type does not.
- **Recommended Resolution:** - Enable `minifyEnabled true` and `shrinkResources true` for release.; Set `minifyEnabled true` and `shrinkResources true` in the `release` block. Test that all kept classes (xz, commons-compress) survive R8 with existing ProGuard rules.
- **Verification:** compare release APK size and run smoke tests on minified release.; Build release APK, verify it's smaller, run basic functionality test.
- **Notes on Reconciliation:** Effort conflict resolved using higher effort.

#### ISSUE-030: Gradle and AGP significantly outdated

- **Original IDs:** PRA-011 (review-5b)
- **Source:** review-5b
- **Category:** Android
- **Description:** Gradle 8.2.1 is ~2 years behind the current 8.12.x. AGP 8.2.1 uses `suppressUnsupportedCompileSdk=35` to silence compatibility warnings with compileSdk 35.
- **Root Cause:** Missing security patches, performance improvements, and Android 15 compatibility fixes. Warning suppression hides potential build issues.
- **Impact:** Medium
- **Likelihood:** Medium
- **Severity:** Minor
- **Effort:** M
- **Priority Score:** 1.33
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `android/gradle/wrapper/gradle-wrapper.properties`: Gradle 8.2.1. `android/build.gradle` L7: AGP 8.2.1. `org.gradle.warning.mode=none` in `gradle.properties` suppresses warnings.
- **Recommended Resolution:** Upgrade Gradle to latest 8.x, AGP to latest 8.x compatible version. Remove `suppressUnsupportedCompileSdk` and `warning.mode=none`. Fix any surfaced warnings.
- **Verification:** `./gradlew assembleDebug` and `./gradlew test` both pass without suppressions.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-035: Deprecated MediaSession APIs in BackgroundExecutionService

- **Original IDs:** PRA-020 (review-5b)
- **Source:** review-5b
- **Category:** Android
- **Description:** The background service uses deprecated MediaSession and AudioManager APIs. These work on current Android versions but may be removed in future API levels.
- **Root Cause:** Build warnings. Potential breakage on future Android versions.
- **Impact:** Low
- **Likelihood:** Low
- **Severity:** Trivial
- **Effort:** S
- **Priority Score:** 0.50
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `./gradlew assembleDebug` warnings: `BackgroundExecutionService.kt:203` — `FLAG_HANDLES_MEDIA_BUTTONS` and `FLAG_HANDLES_TRANSPORT_CONTROLS` deprecated. `BackgroundExecutionService.kt:259` — `requestAudioFocus` deprecated. `BackgroundExecutionService.kt:282` — `abandonAudioFocus` deprecated.
- **Recommended Resolution:** Migrate to `MediaSessionCompat` and `AudioFocusRequest` APIs from AndroidX.
- **Verification:** `./gradlew assembleDebug` produces zero deprecation warnings.
- **Notes on Reconciliation:** No conflicts

### 5. iOS

#### ISSUE-014: No iOS audio background mode

- **Original IDs:** PRA-022 (review-5b)
- **Source:** review-5b
- **Category:** iOS
- **Description:** SID playback will stop when the app is backgrounded on iOS. The `BackgroundExecutionPlugin` is effectively a stub — limited to ~30 seconds of background time. Android has a full foreground service with media session.
- **Root Cause:** Feature parity gap between Android and iOS. Users expect continuous playback.
- **Impact:** High
- **Likelihood:** High
- **Severity:** Major
- **Effort:** M
- **Priority Score:** 3.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `ios/App/App/Info.plist` — no `UIBackgroundModes` key. `NativePlugins.swift` L920-977: `BackgroundExecutionPlugin` uses `UIApplication.beginBackgroundTask` (30-second limit).
- **Recommended Resolution:** Add `UIBackgroundModes: audio` to Info.plist. Implement `AVAudioSession` configuration in the iOS BackgroundExecution plugin. This is documented in `doc/internals/ios-parity-matrix.md`.
- **Verification:** Start SID playback, background the app, verify audio continues for >30 seconds.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-015: iOS deployment and version metadata are inconsistent

- **Original IDs:** PRA-012 (review-5a) | PRA-021 (review-5b) | PRA-023 (review-5b)
- **Source:** both
- **Category:** iOS
- **Description:** Podfile declares iOS 15.0 while project build settings remain at 13.0 and app version/build are fixed values. The Xcode project targets iOS 13.0, but CocoaPods specifies iOS 15.0. Pods will only build for iOS 15+, making the effective minimum iOS 15.0, but the project-level setting is misleading. iOS version and build number are hardcoded at 1.0 (1). Android derives version from git tags and CI run numbers. iOS builds will all show the same version.
- **Root Cause:** Confusion about the actual minimum deployment target. If an app runs on iOS 13-14, pods may crash at runtime.
- **Impact:** High
- **Likelihood:** High
- **Severity:** Major
- **Effort:** M
- **Priority Score:** 3.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `ios/App/Podfile:3`; `ios/App/App.xcodeproj/project.pbxproj:310`; `ios/App/App.xcodeproj/project.pbxproj:377`; `ios/App/App.xcodeproj/project.pbxproj:379`; `ios/App/App.xcodeproj/project.pbxproj:395`; `ios/App/App.xcodeproj/project.pbxproj` L310: `IPHONEOS_DEPLOYMENT_TARGET = 13.0`. `ios/App/Podfile` L3: `platform :ios, '15.0'`.; `ios/App/App.xcodeproj/project.pbxproj` L379, L399: `MARKETING_VERSION = 1.0`, `CURRENT_PROJECT_VERSION = 1`. No `agvtool` or CI-driven version injection.
- **Recommended Resolution:** - Align deployment target in project and pods helper output.; Align `IPHONEOS_DEPLOYMENT_TARGET` to `15.0` in the Xcode project to match the Podfile.; Add version injection in the `ios-prepare` CI job using `agvtool new-marketing-version` and `agvtool new-version` from git tags and run numbers.
- **Verification:** `xcodebuild -showBuildSettings` target values match expected release config.; Open project in Xcode, verify deployment target matches across all configurations.; Check IPA's Info.plist for correct version after CI build.
- **Notes on Reconciliation:** Severity conflict resolved using higher severity. Effort conflict resolved using higher effort. Likelihood conflict resolved using higher likelihood.

#### ISSUE-026: iOS local build command is not executable on Linux assessment host

- **Original IDs:** PRA-023 (review-5a)
- **Source:** review-5a
- **Category:** iOS
- **Description:** `npm run ios:build:sim` failed because `xcodebuild` is unavailable on Linux host.
- **Root Cause:** Local cross-platform validation cannot include iOS build on non-macOS machines.
- **Impact:** Medium
- **Likelihood:** High
- **Severity:** Minor
- **Effort:** S
- **Priority Score:** 2.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `command:cmd-ios-build-sim-2026-02-28T19:54:46Z`; `AGENTS.md:123-124`
- **Recommended Resolution:** - Keep iOS build validation mandatory in macOS CI lanes.
- **Verification:** successful iOS simulator build artifact in macOS workflow.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-040: No iOS entitlements file

- **Original IDs:** PRA-025 (review-5b)
- **Source:** review-5b
- **Category:** iOS
- **Description:** If capabilities like Push Notifications, App Groups, or Keychain Sharing are needed in the future, an entitlements file must be created. Current Keychain usage via `SecureStoragePlugin` works without explicit entitlements but limits sharing between app extensions.
- **Root Cause:** Low current risk. Future capability additions will require creating this file.
- **Impact:** Low
- **Likelihood:** Low
- **Severity:** Trivial
- **Effort:** S
- **Priority Score:** 0.50
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** No `.entitlements` file exists under `ios/`.
- **Recommended Resolution:** Create `ios/App/App/App.entitlements` with current capabilities. Reference in Xcode project.
- **Verification:** Xcode build succeeds with entitlements file.
- **Notes on Reconciliation:** No conflicts

### 6. Web

#### ISSUE-020: Web runtime disables asset caching and has no service worker fallback

- **Original IDs:** PRA-015 (review-5a) | PRA-008 (review-5b) | PRA-026 (review-5b)
- **Source:** both
- **Category:** Web
- **Description:** Static assets are always served with `Cache-Control: no-store`, and no service worker path was found. Vite-built assets have content hashes in filenames and are immutable. Serving them with `no-store` forces browsers to re-download on every page load. Without a service worker, the web app cannot be installed as a PWA and has no offline caching capability.
- **Root Cause:** Increased bandwidth usage and slower page loads, especially on mobile or constrained networks.
- **Impact:** Medium
- **Likelihood:** High
- **Severity:** Major
- **Effort:** M
- **Priority Score:** 2.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `web/server/src/index.ts:273-279`; `command:cmd-service-worker-check`; `web/server/src/index.ts` — static file serving uses `Cache-Control: no-store` on all responses including immutable hashed assets.; No `sw.js`, no Workbox config, no `navigator.serviceWorker.register()` in the codebase.
- **Recommended Resolution:** - Keep `no-store` for auth/config endpoints only.; For files matching `/assets/*` with hash in filename, set `Cache-Control: public, max-age=31536000, immutable`. Keep `no-store` for `index.html` and API responses.; Add a Workbox-generated service worker with a cache-first strategy for static assets and network-first for API calls. Register in `main.tsx`.
- **Verification:** `curl -I` on static assets shows cacheable headers; Lighthouse repeat-load metrics improve.; Load the web app, check DevTools Network tab for cache headers on JS/CSS assets.; Chrome DevTools Application tab shows installed service worker. "Add to Home Screen" prompt appears.
- **Notes on Reconciliation:** Severity conflict resolved using higher severity. Effort conflict resolved using higher effort.

#### ISSUE-036: Incomplete PWA manifest

- **Original IDs:** PRA-027 (review-5b)
- **Source:** review-5b
- **Category:** Web
- **Description:** PWA manifest does not meet Chrome's installability criteria (requires 192x192 icon minimum).
- **Root Cause:** Even with a service worker, the app may not be installable without the correct icon sizes.
- **Impact:** Low
- **Likelihood:** High
- **Severity:** Trivial
- **Effort:** S
- **Priority Score:** 0.50
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `public/manifest.webmanifest` — single 512x512 icon. Missing 192x192 icon, maskable icon, `description`, `orientation`, and `scope` fields.
- **Recommended Resolution:** Add 192x192 and maskable icon variants. Add `description`, `scope: "/"`, and `orientation: "any"` fields.
- **Verification:** Run Lighthouse PWA audit; verify all installability criteria pass.
- **Notes on Reconciliation:** No conflicts

### 7. Data Integrity

#### ISSUE-016: Current persistence adapters can silently reset state on parse/version mismatch

- **Original IDs:** PRA-019 (review-5a) | PRA-012 (review-5b)
- **Source:** both
- **Category:** Data Integrity
- **Description:** On corrupt or version-mismatched persisted state, repository adapters return default empty state rather than migration/recovery path. Any schema version bump silently discards all user data for that store. Playlists, HVSC index, and app settings would be lost without warning.
- **Root Cause:** A future update that changes data format will cause silent data loss. Users have no backup/export mechanism for playlists.
- **Impact:** High
- **Likelihood:** Medium
- **Severity:** Major
- **Effort:** L
- **Priority Score:** 2.25
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `src/lib/playlistRepository/indexedDbRepository.ts:97-109`; `src/lib/playlistRepository/localStorageRepository.ts:74-88`; `doc/db.md:11-15`; `src/lib/hvsc/hvscBrowseIndexStore.ts` L19: `SCHEMA_VERSION = 1`, `src/lib/playlistRepository/indexedDbRepository.ts` L26: `DB_VERSION = 1` — both discard data on version mismatch.
- **Recommended Resolution:** - Introduce explicit schema migration path for current adapters.; Implement incremental migration functions indexed by version number. On version mismatch, run the chain of migrations from current → target. Add a playlist export feature as a safety net.
- **Verification:** migration tests across version bumps and corrupted-state fixtures preserve recoverable data.; Bump test schema version, verify data survives migration. Test rollback by loading old-version data.
- **Notes on Reconciliation:** Effort conflict resolved using higher effort.

### 8. Performance

#### ISSUE-029: Web bundle size profile is high for first load

- **Original IDs:** PRA-016 (review-5a)
- **Source:** review-5a
- **Category:** Performance
- **Description:** Build output includes large main bundle and large WASM payload, increasing first-load cost.
- **Root Cause:** Slower startup on low-power/mobile browsers and constrained links.
- **Impact:** Medium
- **Likelihood:** High
- **Severity:** Major
- **Effort:** L
- **Priority Score:** 1.50
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `command:cmd-web-build-2026-02-28T19:54:34Z`
- **Recommended Resolution:** - Defer WASM-heavy paths until feature use.
- **Verification:** `npm run build` size report shows reduced main chunk and delayed WASM fetch on non-HVSC routes.
- **Notes on Reconciliation:** No conflicts

### 9. Observability

#### ISSUE-031: No remote crash reporting

- **Original IDs:** PRA-013 (review-5b)
- **Source:** review-5b
- **Category:** Observability
- **Description:** Errors only persist locally (localStorage logs + trace buffer). If the app crashes hard, in-memory traces are lost. There is no aggregated error visibility for the developer.
- **Root Cause:** Field crashes go undetected unless users manually export and share diagnostics.
- **Impact:** Medium
- **Likelihood:** High
- **Severity:** Minor
- **Effort:** M
- **Priority Score:** 1.33
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** No references to Sentry, Bugsnag, Crashlytics, or any crash reporting SDK in `package.json` or native code. Confirmed in `doc/architecture.md` L140-141: crash reporting relies on Google Play Console Android Vitals only.
- **Recommended Resolution:** Integrate a lightweight crash reporting service (Sentry, Bugsnag) with source maps for web and native crash capture. Gate behind a privacy consent toggle if needed.
- **Verification:** Trigger a test crash, verify it appears in the crash reporting dashboard.
- **Notes on Reconciliation:** No conflicts

### 10. UX & Accessibility

#### ISSUE-005: Browser zoom is disabled, reducing accessibility

- **Original IDs:** PRA-017 (review-5a)
- **Source:** review-5a
- **Category:** UX & Accessibility
- **Description:** Viewport meta includes `user-scalable=no`, which blocks pinch zoom in browser contexts.
- **Root Cause:** Low-vision users lose a critical readability control.
- **Impact:** High
- **Likelihood:** High
- **Severity:** Major
- **Effort:** S
- **Priority Score:** 4.50
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `index.html:5`
- **Recommended Resolution:** - Remove `user-scalable=no` from viewport metadata.
- **Verification:** manual browser zoom test and automated accessibility check for reflow.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-024: No automated accessibility testing

- **Original IDs:** PRA-014 (review-5b)
- **Source:** review-5b
- **Category:** UX & Accessibility
- **Description:** Accessibility regressions can be introduced without detection. Manual testing is insufficient for catching WCAG violations at scale.
- **Root Cause:** Users with screen readers or other assistive technologies may encounter broken interactions.
- **Impact:** Medium
- **Likelihood:** Medium
- **Severity:** Minor
- **Effort:** S
- **Priority Score:** 2.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** No `axe-core`, `jest-axe`, or `@axe-core/playwright` in `package.json`. No a11y test files.
- **Recommended Resolution:** Add `@axe-core/playwright` and include `checkA11y()` in existing Playwright tests for key pages. Add `jest-axe` to component tests.
- **Verification:** Run Playwright tests with a11y checks enabled; verify 0 violations on core pages.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-025: Touch targets below 44px on default buttons

- **Original IDs:** PRA-016 (review-5b)
- **Source:** review-5b
- **Category:** UX & Accessibility
- **Description:** Default and small buttons fall below the WCAG 2.1 Level AAA 44×44px touch target recommendation. This affects users with motor impairments.
- **Root Cause:** Increased miss-tap rate, especially on small-screen devices.
- **Impact:** Medium
- **Likelihood:** Medium
- **Severity:** Minor
- **Effort:** S
- **Priority Score:** 2.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `src/components/ui/button.tsx` L30-37: default `h-10` (40px), sm `h-9` (36px). The 44px minimum is only enforced via `min-h-[44px]` on specific list action buttons.
- **Recommended Resolution:** Increase default button height to `h-11` (44px) or add consistent `min-h-[44px]` across interactive components.
- **Verification:** Visual inspection and automated touch-target audit on key pages.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-028: No localization infrastructure

- **Original IDs:** PRA-018 (review-5a) | PRA-015 (review-5b)
- **Source:** both
- **Category:** UX & Accessibility
- **Description:** No i18n framework was found and large user-visible surfaces use hard-coded English strings. The app cannot be translated without significant refactoring. Growing international user base (C64 community is global) would benefit from localization.
- **Root Cause:** Adding localization later will require broad refactor and increases translation defects.
- **Impact:** Medium
- **Likelihood:** High
- **Severity:** Major
- **Effort:** L
- **Priority Score:** 1.50
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `command:cmd-localization-libs-check`; `src/pages/SettingsPage.tsx:703-813`; `src/pages/SettingsPage.tsx:1555-1753`; Grep for `i18n`, `i18next`, `intl`, `locale`, `translate` returned zero framework results. All strings are hardcoded English in JSX.
- **Recommended Resolution:** - Introduce localization framework and message catalogs.; Integrate `react-i18next`. Extract all user-facing strings to translation files. Start with English as the default locale.
- **Verification:** run app with second locale and validate key screens render localized content.; Switch locale to a test language; verify all visible strings are translated.
- **Notes on Reconciliation:** Severity conflict resolved using higher severity. Likelihood conflict resolved using higher likelihood.

### 11. Testing

#### ISSUE-021: Android JVM tests fail on Java 25

- **Original IDs:** PRA-019 (review-5b)
- **Source:** review-5b
- **Category:** Testing
- **Description:** Robolectric 4.11.1 is incompatible with Java 25. The ASM bytecode library used by Robolectric cannot read Java 25 class files. CI uses a different Java version (likely 17), so this only affects local development.
- **Root Cause:** Developers on Java 25 cannot run Android unit tests locally. This creates a feedback gap between local development and CI.
- **Impact:** Medium
- **Likelihood:** Medium
- **Severity:** Minor
- **Effort:** S
- **Priority Score:** 2.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `./gradlew test` output: 86/113 tests failed with `NoClassDefFoundError` at `Shadows.java:2748` and `IllegalArgumentException` at `ClassReader.java:200`. Java version: OpenJDK Corretto 25.0.1.
- **Recommended Resolution:** Upgrade Robolectric to a version supporting Java 25 bytecode, or document JDK 17 as the required version for Android tests. Consider pinning via `JAVA_HOME` in the `build` script.
- **Verification:** `./gradlew test` passes on the required JDK version.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-022: Android build verification could not complete in this assessment environment

- **Original IDs:** PRA-022 (review-5a)
- **Source:** review-5a
- **Category:** Testing
- **Description:** Android dry-run assemble command failed because Gradle wrapper distribution download was blocked by sandbox network policy.
- **Root Cause:** Release readiness confidence is reduced because local Android build path was not fully executed in this run.
- **Impact:** Medium
- **Likelihood:** Medium
- **Severity:** Minor
- **Effort:** S
- **Priority Score:** 2.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `command:cmd-android-assemble-dryrun-2026-02-28T19:54:43Z`; `android/gradle/wrapper/gradle-wrapper.properties:3`
- **Recommended Resolution:** - Re-run `./gradlew -m assembleDebug` in network-enabled CI or local environment.
- **Verification:** successful dry-run and full assemble logs collected in unrestricted environment.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-023: Coverage quality bar mismatch between CI gate and repository guidance

- **Original IDs:** PRA-020 (review-5a)
- **Source:** review-5a
- **Category:** Testing
- **Description:** CI enforces `COVERAGE_MIN=80` while repository guidance states 82% branch safety margin for code-change tasks.
- **Root Cause:** Regression risk rises when gate is weaker than declared quality policy.
- **Impact:** Medium
- **Likelihood:** High
- **Severity:** Minor
- **Effort:** S
- **Priority Score:** 2.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `.github/workflows/android.yaml:372-376`; `AGENTS.md:95-99`
- **Recommended Resolution:** - Align CI threshold with documented target.
- **Verification:** CI run fails when branch coverage < target; docs and workflow values match.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-027: No iOS native unit tests

- **Original IDs:** PRA-032 (review-5b)
- **Source:** review-5b
- **Category:** Testing
- **Description:** 7 Swift native plugins with ~3,139 lines of code have no unit tests. Android has 113 JVM tests for equivalent functionality.
- **Root Cause:** Regressions in iOS native code (FTP client, secure storage, background execution) go undetected until Maestro smoke tests or manual testing.
- **Impact:** Medium
- **Likelihood:** Medium
- **Severity:** Major
- **Effort:** L
- **Priority Score:** 1.50
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `doc/internals/ios-parity-matrix.md`: "0 XCTest classes vs 82 JVM tests." No test files found under `ios/App/`.
- **Recommended Resolution:** Add XCTest targets for each Swift plugin. Start with SecureStorage, FtpClient, and BackgroundExecution (highest-risk plugins).
- **Verification:** `xcodebuild test` passes with >50% coverage on plugin code.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-034: E2E tests run against Vite preview, not native runtime

- **Original IDs:** PRA-033 (review-5b)
- **Source:** review-5b
- **Category:** Testing
- **Description:** E2E tests do not exercise the actual native runtime. Real-device bugs (CapacitorHttp differences, WebView quirks, native bridge timing) are not caught.
- **Root Cause:** Test suite provides false confidence for native platform behavior.
- **Impact:** Medium
- **Likelihood:** Medium
- **Severity:** Minor
- **Effort:** L
- **Priority Score:** 1.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `doc/testing/testing-infrastructure-review.md` L3-8: "Playwright E2E currently exercises the web build via Vite preview, not a Capacitor WebView or native Android runtime."
- **Recommended Resolution:** Documented in the testing infrastructure review. Phase 2 proposes a targeted emulator suite for critical paths. Maestro already covers some native paths.
- **Verification:** Run a subset of E2E tests against the Android emulator; compare results.
- **Notes on Reconciliation:** No conflicts

### 12. Legal & Licensing

#### ISSUE-012: README license badge says GPL v2, LICENSE file is GPL v3

- **Original IDs:** PRA-021 (review-5a) | PRA-029 (review-5b)
- **Source:** both
- **Category:** Legal & Licensing
- **Description:** README badge indicates GPL v2 while repository license text is GPL v3. The badge and body text disagree on the license version. This creates legal ambiguity about the project's actual license.
- **Root Cause:** Contributors and users may be confused about their rights and obligations. GPL v2 and v3 have different provisions (e.g., v3 has patent provisions and anti-tivoization clauses).
- **Impact:** Medium
- **Likelihood:** High
- **Severity:** Major
- **Effort:** S
- **Priority Score:** 3.00
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `README.md:5`; `README.md:384`; `LICENSE:1-3`; `README.md` L5: badge links to `https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html` and reads "License: GPL v2". `LICENSE` file contains the full text of GPL v3. `README.md` L384 text says "GPL v3".
- **Recommended Resolution:** - Update README badge text/link to GPL v3.; Update the README badge to reference GPL v3: `https://www.gnu.org/licenses/gpl-3.0.en.html` and change badge text to "GPL v3".
- **Verification:** `rg -n "GPL v2|GPL v3" README.md docs` reflects single intended license.; Visual inspection of README badge. `diff LICENSE <(curl -sL gpl-3.0.txt)` to confirm.
- **Notes on Reconciliation:** Severity conflict resolved using higher severity.

#### ISSUE-038: No Commodore trademark disclaimer

- **Original IDs:** PRA-031 (review-5b)
- **Source:** review-5b
- **Category:** Legal & Licensing
- **Description:** "C64" is/was a Commodore trademark. The app name "C64 Commander" uses it without a nominative fair use disclaimer.
- **Root Cause:** Trademark holder could object. Low probability given the community context, but a disclaimer costs nothing.
- **Impact:** Low
- **Likelihood:** Low
- **Severity:** Trivial
- **Effort:** S
- **Priority Score:** 0.50
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** README.md, THIRD_PARTY_NOTICES.md, docs/privacy-policy.md — no trademark disclaimer for "C64" or "Commodore 64" anywhere.
- **Recommended Resolution:** Add a trademark disclaimer to README.md and/or THIRD_PARTY_NOTICES.md: "Commodore 64 and C64 are trademarks of [current holder]. This project is not affiliated with or endorsed by the trademark holder."
- **Verification:** Visual inspection.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-039: No SPDX license identifier in package.json

- **Original IDs:** PRA-030 (review-5b)
- **Source:** review-5b
- **Category:** Legal & Licensing
- **Description:** npm expects a `license` field with an SPDX identifier. Tools that inspect package metadata may report the project as unlicensed.
- **Root Cause:** Automated compliance scanning tools may flag this.
- **Impact:** Low
- **Likelihood:** Medium
- **Severity:** Trivial
- **Effort:** S
- **Priority Score:** 0.50
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `package.json` — no `"license"` field present.
- **Recommended Resolution:** Add `"license": "GPL-3.0-only"` to `package.json`.
- **Verification:** `npm pack --dry-run` shows `license: GPL-3.0-only` in output.
- **Notes on Reconciliation:** No conflicts

### 13. Architecture & Maintainability

#### ISSUE-037: NativePlugins.swift exceeds file size guidelines

- **Original IDs:** PRA-024 (review-5b)
- **Source:** review-5b
- **Category:** Architecture & Maintainability
- **Description:** Contains 6 Capacitor plugins, diagnostics classes, and debug utilities in a single file. This impairs readability and maintainability.
- **Root Cause:** Higher merge conflict probability. Harder to navigate and review.
- **Impact:** Low
- **Likelihood:** High
- **Severity:** Trivial
- **Effort:** S
- **Priority Score:** 0.50
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `ios/App/App/NativePlugins.swift` — 1017 lines. Project guideline in AGENTS.md: "Split files at ~600 lines."
- **Recommended Resolution:** Split into individual files per plugin (matching the Android pattern where each plugin is a separate .kt file).
- **Verification:** Build succeeds. All 7 plugins still register in AppDelegate.
- **Notes on Reconciliation:** No conflicts

#### ISSUE-041: Web server is a single 843-line file

- **Original IDs:** PRA-028 (review-5b)
- **Source:** review-5b
- **Category:** Architecture & Maintainability
- **Description:** Exceeds the project's ~600-line guideline. Mixes multiple concerns in one file.
- **Root Cause:** Maintainability. Harder to test individual handlers in isolation.
- **Impact:** Low
- **Likelihood:** High
- **Severity:** Trivial
- **Effort:** S
- **Priority Score:** 0.50
- **Risk of Change:** Hardening changes can introduce compatibility or release regressions without staged validation.
- **Dependencies:** None
- **Evidence:** `web/server/src/index.ts` — 843 lines handling static serving, REST proxy, FTP proxy, auth, rate limiting, health checks, config management, and diagnostics.
- **Recommended Resolution:** Split into modules: `staticServer.ts`, `restProxy.ts`, `ftpProxy.ts`, `auth.ts`, `diagnostics.ts`.
- **Verification:** `npm run build:web-server` succeeds. `npm run test:web-server` passes.
- **Notes on Reconciliation:** No conflicts

## Reconciliation Log
| ISSUE-ID | Conflict Type | Review A Position | Review B Position | Resolution | Rationale |
| --- | --- | --- | --- | --- | --- |
| ISSUE-001 | Severity | Critical | Minor | Critical | Higher severity rule |
| ISSUE-002 | Effort | M | S | M | Higher effort rule |
| ISSUE-003 | Likelihood | High | Low | High | Higher likelihood rule |
| ISSUE-004 | Severity | Major | Minor | Major | Higher severity rule |
| ISSUE-005 | Severity | Major | Minor | Major | Higher severity rule |
| ISSUE-006 | Likelihood | Medium | Low | Medium | Higher likelihood rule |
| ISSUE-007 | Effort | M | S | M | Higher effort rule |
| ISSUE-008 | Likelihood | Medium | Low | Medium | Higher likelihood rule |
| ISSUE-009 | Severity | Critical | Major | Critical | Higher severity rule |
| ISSUE-010 | Likelihood | Medium | Low | Medium | Higher likelihood rule |
| ISSUE-011 | Likelihood | High | Low | High | Higher likelihood rule |
| ISSUE-012 | Severity | Major | Minor | Major | Higher severity rule |
| ISSUE-013 | Effort | M | S | M | Higher effort rule |
| ISSUE-014 | Likelihood | Medium | High,Low | High | Higher likelihood rule |
| ISSUE-015 | Effort | M | S | M | Higher effort rule |
| ISSUE-016 | Severity | Major | Minor | Major | Higher severity rule |
| ISSUE-017 | Effort | M | M,S | M | Higher effort rule |
| ISSUE-018 | Severity | Major | Minor | Major | Higher severity rule |
| ISSUE-019 | Likelihood | High | Medium | High | Higher likelihood rule |
| ISSUE-020 | Effort | L | M | L | Higher effort rule |
| ISSUE-021 | Severity | Minor | Major | Major | Higher severity rule |

## Effort-Impact Matrix
| Quadrant | ISSUE-IDs |
| --- | --- |
| Low Effort / High Impact | ISSUE-001, ISSUE-002, ISSUE-003, ISSUE-004, ISSUE-005, ISSUE-006 |
| High Effort / High Impact | ISSUE-007, ISSUE-008, ISSUE-009, ISSUE-013, ISSUE-014, ISSUE-015, ISSUE-016 |
| Low Effort / Low Impact | ISSUE-010, ISSUE-011, ISSUE-012, ISSUE-021, ISSUE-022, ISSUE-023, ISSUE-024, ISSUE-025, ISSUE-026, ISSUE-032, ISSUE-033, ISSUE-035, ISSUE-036, ISSUE-037, ISSUE-038, ISSUE-039, ISSUE-040, ISSUE-041 |
| High Effort / Low Impact | ISSUE-017, ISSUE-018, ISSUE-019, ISSUE-020, ISSUE-027, ISSUE-028, ISSUE-029, ISSUE-030, ISSUE-031, ISSUE-034 |

## Coverage Checklist

A. Repository and architecture: Covered.
- Evidence: `README.md`, `doc/architecture.md`, `doc/diagnostics/*.md`, module inspections.

B. CI/CD and release readiness: Covered.
- Evidence: `.github/workflows/*.yaml`, command failures/successes.

C. Security and privacy: Covered.
- Evidence: network/storage/logging/native/plugin/workflow inspections and audits.

D. Data integrity and lifecycle: Covered.
- Evidence: config and playlist repository adapters + `doc/db.md` target state.

E. Stability and error handling: Covered.
- Evidence: global error handlers, boundary, native logging and retries.

F. Performance and resource usage: Covered.
- Evidence: web build artifact sizes, caching policy, background service behavior.

G. Observability: Covered.
- Evidence: tracing/action summary specs and runtime logging code.

H. UX/accessibility/localization: Covered.
- Evidence: `index.html` viewport and Settings string surfaces.

I. Platform specifics: Covered.
- Android covered.
- iOS covered.
- Web covered.

J. Testing and quality gates: Covered.
- Evidence: test/lint runs + CI thresholds and testing docs.

K. Legal/licensing/attribution: Covered.
- Evidence: `LICENSE`, `README.md`, `THIRD_PARTY_NOTICES.md`, privacy docs.
