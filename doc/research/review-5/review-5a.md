# Production Readiness Assessment - C64 Commander

Date (UTC): 2026-02-28
Repository: `/home/chris/dev/c64/c64commander`
Commit: `cf7d0826a429802524b6ee86beb73e81449f4e04`
Assessment type: Research-only, no code changes

## 00. Executive Summary

Shipping recommendation: **Do not ship**.

Rationale:
- Blocker-level secret handling risk exists in repository-local signing credential storage.
- Multiple production-plausible security issues exist (global cleartext allowance, plaintext FTP/HTTP credential paths, CI supply-chain hardening gaps).
- A critical runtime dependency vulnerability is currently reported by `npm audit`.

Top 10 issues by severity:
1. PRA-001 - Signing credentials present in local `.env` pattern and loaded by release build.
2. PRA-002 - Android global cleartext traffic enabled and no network security config.
3. PRA-003 - FTP transport is plaintext across Android, iOS, and web server.
4. PRA-004 - REST password propagation over HTTP via `X-Password`.
5. PRA-011 - Critical `basic-ftp` vulnerability reported by audit.
6. PRA-006 - Android diagnostics broadcast is globally visible.
7. PRA-007 - CI workflows request broad write permissions.
8. PRA-008 - CI actions pinned by mutable tags, not immutable SHAs.
9. PRA-012 - iOS deployment/versioning mismatch in build metadata.
10. PRA-019 - Current persistence fallback path can silently reset data on parse/version mismatch.

Top 10 low-effort, high-impact items:
1. PRA-001 (S) - remove plaintext signing secrets from local file path and rotate credentials.
2. PRA-005 (S) - disable backup or define explicit backup exclusion rules.
3. PRA-007 (S) - reduce workflow token permissions to least privilege.
4. PRA-009 (S) - remove `curl | bash` installer pattern from CI.
5. PRA-010 (S) - add Dependabot config.
6. PRA-011 (S) - upgrade `basic-ftp` to fixed version.
7. PRA-017 (S) - restore browser zoom support.
8. PRA-020 (S) - align CI coverage threshold with documented quality bar.
9. PRA-021 (S) - align license badge text with repository license.
10. PRA-013 (M) - enable release minification/obfuscation.

Risk narrative:
- The product has strong diagnostics and test execution coverage for web and Android flows, and CI is comprehensive.
- The highest readiness gap is security hardening, not feature completeness.
- Current implementation assumes trusted LAN operation, but several defaults and pipeline choices make accidental expansion of attack surface likely.
- Production readiness should proceed only after credential hygiene, transport hardening, and supply-chain controls are addressed.

## 01. Scope and Method

Scope:
- Platforms: Android, iOS, Web (Capacitor-based app + web server runtime).
- Areas: architecture, CI/CD, security/privacy, data integrity, stability, performance, observability, UX/accessibility/localization, testing, legal/licensing.
- Evidence model: file references with line ranges, command outputs captured in this run, and explicit N/A markers with evidence.

Method:
- Static inspection of repository code and docs.
- Execution of baseline, install, lint, test, build, and audit commands.
- No application code modifications.

Command evidence log (captured this run):
- `command:cmd-node-version-2026-02-28T19:53:28Z`
```text
2026-02-28T19:53:28Z
v24.11.0
```
- `command:cmd-npm-version-2026-02-28T19:53:28Z`
```text
2026-02-28T19:53:28Z
11.6.1
```
- `command:cmd-git-head-2026-02-28T19:53:28Z`
```text
2026-02-28T19:53:28Z
cf7d0826a429802524b6ee86beb73e81449f4e04
```
- `command:cmd-git-status-initial-2026-02-28T19:53:28Z`
```text
2026-02-28T19:53:28Z
 M PLANS.md
?? doc/research/production-readiness-assessment-2026-02-28/
?? doc/research/review-5/
```
- `command:cmd-npm-ci-dryrun-2026-02-28T19:53:30Z` (passed)
- `command:cmd-lint-2026-02-28T19:53:34Z` (passed)
- `command:cmd-test-unit-2026-02-28T19:53:45Z` (passed: 232 files, 2204 tests)
- `command:cmd-web-build-2026-02-28T19:54:34Z` (passed; main JS chunk 642.03 kB gzip 207.91 kB; WASM 1,651.93 kB)
- `command:cmd-android-assemble-dryrun-2026-02-28T19:54:43Z` (failed: Gradle wrapper download blocked in sandbox)
- `command:cmd-ios-build-sim-2026-02-28T19:54:46Z` (failed: `xcodebuild: not found`)
- `command:cmd-java-version-2026-02-28T19:54:50Z`
- `command:cmd-npm-ci-2026-02-28T19:57:34Z` (passed; 6 vulnerabilities summary)
- `command:cmd-git-status-post-ci-2026-02-28T19:57:46Z` (no source-code changes)
- `command:cmd-npm-audit-runtime-2026-02-28T19:57:50Z` (critical `basic-ftp` advisory)
- `command:cmd-npm-audit-all-2026-02-28T19:57:54Z` (1 critical, 4 high, 1 moderate)
- `command:cmd-missing-dependabot-2026-02-28T19:56:14Z` (`DEPENDABOT_MISSING`)
- `command:cmd-android-network-config-check-2026-02-28T19:56:14Z` (`ANDROID_NETWORK_SECURITY_CONFIG_MISSING`)
- `command:cmd-ios-privacy-entitlements-check` (`IOS_ENTITLEMENTS_AND_PRIVACY_MANIFEST_MISSING`)
- `command:cmd-web-security-headers-check` (`WEB_SECURITY_HEADERS_NOT_CONFIGURED`)
- `command:cmd-service-worker-check` (`SERVICE_WORKER_NOT_FOUND`)
- `command:cmd-localization-libs-check` (`LOCALIZATION_LIBS_NOT_FOUND`)
- `command:cmd-env-keystore-vars-mask`
```text
1:KEYSTORE_STORE_PASSWORD=<redacted>
2:KEYSTORE_KEY_PASSWORD=<redacted>
3:KEYSTORE_KEY_ALIAS=<redacted>
4:KEYSTORE_STORE_FILE=<redacted>
```

Limitations:
- Android local build validation could not complete in this sandbox because Gradle wrapper download requires outbound network access.
- iOS local build validation is not feasible in Linux environment (`xcodebuild` unavailable), and repo guidance already expects iOS validation on CI/macOS.

## 02. System Inventory

Major module and integration inventory:

| Component | Evidence | Purpose | Platform coverage | Risk notes |
| --- | --- | --- | --- | --- |
| React UI pages/components | `doc/architecture.md:7-11`, `src/pages/*`, `src/components/*` | User workflows (connection, playback, config, diagnostics) | Android/iOS/Web | Large Settings surface has extensive hard-coded strings. |
| REST client (`c64api`) | `src/lib/c64api.ts:28-33`, `src/lib/c64api.ts:557-567` | C64U REST calls, retries, host/password routing | Android/iOS/Web | Defaults to HTTP and header password transport. |
| Secure storage abstraction | `src/lib/secureStorage.ts:34-71`, `src/lib/native/secureStorage.web.ts:44-82` | Persist network password locally | Android/iOS/Web | Web server mode proxy endpoint stores password in server config file. |
| Playlist repository (IndexedDB/localStorage) | `src/lib/playlistRepository/indexedDbRepository.ts:24-35`, `src/lib/playlistRepository/localStorageRepository.ts:21-29` | Track/session persistence | Android/iOS/Web | Parse/version mismatch paths reset state to defaults. |
| Diagnostics and tracing | `doc/diagnostics/tracing-spec.md:22-49`, `src/lib/logging.ts:52-66`, `src/App.tsx:181-186` | Always-on local observability | Android/iOS/Web | No built-in remote crash reporting channel. |
| Capacitor config | `capacitor.config.ts:11-20` | App identity + plugin config | Android/iOS | `CapacitorHttp` disabled; browser fetch path retained. |
| Android native plugins | `android/.../MainActivity.kt:60-67` | Folder picker, FTP, secure storage, diagnostics, HVSC, background service | Android | FTP and cleartext defaults are high risk outside trusted LAN. |
| iOS native plugins | `ios/App/App/AppDelegate.swift:47-53` | Folder picker, FTP, secure storage, diagnostics, background service | iOS | FTP implementation uses raw socket streams without TLS. |
| Web server runtime | `web/server/src/index.ts:38-49`, `web/server/src/index.ts:482-523` | Auth, REST proxy, FTP read/list, static host | Web | HTTP upstream + no CSP/security headers + no cache strategy. |
| Build/test workflows | `.github/workflows/android.yaml`, `.github/workflows/ios.yaml`, `.github/workflows/web.yaml`, `.github/workflows/fuzz.yaml` | CI testing, packaging, telemetry, release | Android/iOS/Web | Mutable action pinning + broad permissions + missing Dependabot. |

Capacitor plugin and native integration list:
- Android registered plugins: `BackgroundExecutionPlugin`, `DiagnosticsBridgePlugin`, `FolderPickerPlugin`, `MockC64UPlugin`, `FeatureFlagsPlugin`, `FtpClientPlugin`, `HvscIngestionPlugin`, `SecureStoragePlugin` (`android/app/src/main/java/uk/gleissner/c64commander/MainActivity.kt:60-67`).
- iOS registered plugin instances: `FolderPickerPlugin`, `FtpClientPlugin`, `SecureStoragePlugin`, `FeatureFlagsPlugin`, `BackgroundExecutionPlugin`, `DiagnosticsBridgePlugin`, `MockC64UPlugin` (`ios/App/App/AppDelegate.swift:47-53`).

## 03. Build and Release Pipelines

Workflow summary:

| Workflow | Triggers | Permissions | Secrets used | Artifacts | Failure hotspots |
| --- | --- | --- | --- | --- | --- |
| `android` | push main/tags, PR, manual (`.github/workflows/android.yaml:3-9`) | `contents: write` (`:14-16`) | keystore secrets, Codecov token, Play service account (`:479-492`, `:1326`) | APK/AAB, coverage, Playwright evidence, release assets (`:1218-1224`, `:1298-1321`) | Broad token scope, mutable action refs, optional signing path, complex emulator setup |
| `ios` | push main/tags, PR, manual (`.github/workflows/ios.yaml:3-9`) | `contents: write` (`:14-16`) | GH token; optional paid signing secrets (`:867-906`) | simulator app, diagnostics logs, IPA (`:149-154`, `:850-856`) | `curl | bash` tool install, runtime selection complexity, dual packaging lanes |
| `web` | push main/tags, PR, manual (`.github/workflows/web.yaml:3-9`) | `contents: read`, `packages: write` (`:14-17`) | `GITHUB_TOKEN` for GHCR login (`:304-310`) | docker telemetry, test outputs (`:207-218`) | multi-arch build complexity, telemetry wrapper correctness |
| `fuzz` | scheduled daily + manual (`.github/workflows/fuzz.yaml:3-6`) | default token scope | none explicit | fuzz telemetry and artifacts (`:158-173`, `:350-364`) | long runtime, telemetry process supervision |

Determinism and reproducibility notes:
- Positive: lockfile-based install (`npm ci`) is used in workflows (`android.yaml:42`, `ios.yaml:58`, `web.yaml:51`).
- Gap: third-party actions are pinned by major tags, not immutable SHAs (`actions/checkout@v4`, `actions/setup-node@v4`, `docker/build-push-action@v6` in workflow files).

Signing and release channels:
- Android release signing is conditional on secrets, then upload to internal Play track as `draft` (`android.yaml:1322-1331`).
- iOS package lane defaults to unsigned IPA for sideloading (`ios.yaml:822-848`), with optional paid-signing lane behind repo variable (`ios.yaml:894-905`).

## 04. Security and Privacy

Security model summary:
- Mobile app directly talks to configured device host over REST/FTP.
- Web mode adds local authentication and proxies requests to C64U.
- Stored credential model relies on local storage mechanisms and optional server-side config file (`/config/web-config.json`).

Threat model (realistic attacker goals):
- Capture network password or session token on shared/untrusted LAN.
- Abuse CI pipeline trust to execute attacker-controlled supply-chain components.
- Exfiltrate sensitive diagnostics from local device logs.
- Trigger configuration drift or data reset through malformed persisted state.

Privacy model consistency:
- Privacy policy claims local-only data handling (`docs/privacy-policy.md:7-27`).
- Code shows local diagnostics and local storage usage (`src/lib/logging.ts:47-66`, `src/lib/config/appConfigStore.ts:46-70`).
- No built-in third-party analytics/crash SDK found in inspected code paths.

## 05. Dependency and Supply Chain Risk

Current status:
- Runtime and dev dependency vulnerabilities are present (`command:cmd-npm-audit-all-2026-02-28T19:57:54Z`).
- Critical runtime issue currently reported for `basic-ftp` (`command:cmd-npm-audit-runtime-2026-02-28T19:57:50Z`).
- No Dependabot configuration file found (`command:cmd-missing-dependabot-2026-02-28T19:56:14Z`).

## 06. Data Storage and Migrations

Storage map:
- App config snapshots and flags in `localStorage` (`src/lib/config/appConfigStore.ts:24-70`).
- Playlist/session state in IndexedDB with localStorage fallback (`src/lib/playlistRepository/indexedDbRepository.ts:24-127`, `src/lib/playlistRepository/localStorageRepository.ts:21-101`).
- Password secure storage via native bridge (`src/lib/secureStorage.ts:34-71`, Android encrypted prefs in `SecureStoragePlugin.kt:28-36`).

Migration posture:
- Current repository adapters are version-1 object stores with fallback reset behavior on mismatch (`indexedDbRepository.ts:97-109`, `localStorageRepository.ts:74-88`).
- `doc/db.md` defines target relational schema as planned target state, not current runtime (`doc/db.md:11-15`).

## 07. Runtime Stability and Crash Risk

Positive controls:
- Global error and unhandled rejection listeners are installed (`src/App.tsx:181-186`).
- React error boundary with fallback UI is implemented (`src/App.tsx:248-280`).
- Network calls include timeout/retry logic in API client (`src/lib/c64api.ts:815-849`, `:915-947`).

Open risk areas:
- Native bridge transports rely on network paths without transport security.
- Local build verification gaps reduce confidence in cross-platform release behavior in this environment.

## 08. Performance and Resource Usage

Observed build characteristics:
- Main JS chunk `642.03 kB` (gzip `207.91 kB`), plus `7zz` WASM `1,651.93 kB` (`command:cmd-web-build-2026-02-28T19:54:34Z`).
- Web server sends `Cache-Control: no-store` for all static responses (`web/server/src/index.ts:273-279`).
- No service worker registration found (`command:cmd-service-worker-check`).

Mobile runtime notes:
- Android background execution service acquires a partial WakeLock with 30-minute timeout (`BackgroundExecutionService.kt:46-47`, `:183-185`).
- Memory class logging present at startup (`MainActivity.kt:70-78`).

## 09. Observability, Logging, and Telemetry

Current implementation:
- Rich local diagnostics pipeline with logs, traces, and action summaries (`doc/diagnostics/tracing-spec.md`, `doc/diagnostics/action-summary-spec.md`).
- CI telemetry gates exist for docker and fuzz workflows (`web.yaml:195-220`, `fuzz.yaml:174-201`, `:366-393`).

Gap:
- No integrated remote crash reporting pipeline for field failures; support relies on manual export/share.

## 10. UX, Accessibility, and Localization

Findings:
- Accessibility regression risk from disabling browser zoom (`index.html:5`).
- No localization framework detected (`command:cmd-localization-libs-check`) and core UI strings are hard-coded in pages/components (`src/pages/SettingsPage.tsx:703-813`, `:1555-1753`).

## 11. Platform Specific - Android

Key platform settings:
- `minSdk=22`, `targetSdk=35`, `compileSdk=35` (`android/variables.gradle:2-4`).
- Global cleartext enabled (`AndroidManifest.xml:11`).
- Backup enabled (`AndroidManifest.xml:5`).
- Release minification disabled (`android/app/build.gradle:132-135`).
- ABI filters include emulator ABIs in build config (`android/app/build.gradle:76-78`).
- No network security config file found (`command:cmd-android-network-config-check-2026-02-28T19:56:14Z`).

N/A checks:
- App Links/deep links: no URL intent filters found; only launcher filter present (`AndroidManifest.xml:21-24`, `command:deep-link-scan`).

## 12. Platform Specific - iOS

Key platform settings:
- Podfile declares iOS 15.0 (`ios/App/Podfile:3`).
- Xcode project build settings still use deployment target 13.0 (`project.pbxproj:310`, `:361`, `:377`, `:397`).
- Version fields fixed at `MARKETING_VERSION=1.0`, `CURRENT_PROJECT_VERSION=1` (`project.pbxproj:375`, `:379`, `:395`, `:399`).
- ATS allows local networking (`Info.plist:25-29`).
- FTP implemented via raw socket stream pairs (`IOSFtp.swift:27`, `:121`).
- No entitlements/privacy manifest files found (`command:cmd-ios-privacy-entitlements-check`).

N/A checks:
- Background modes key not present in Info.plist (`Info.plist:1-57`).

## 13. Platform Specific - Web

Key platform settings:
- Web server cookie auth uses `HttpOnly`, `SameSite=Lax`, optional `Secure` (`web/server/src/index.ts:460-471`).
- REST proxy target uses HTTP and injects password header (`web/server/src/index.ts:485-497`).
- FTP backend explicitly sets `secure: false` (`web/server/src/index.ts:547-553`, `:592-598`).
- No CSP/HSTS/X-Frame headers configured (`command:cmd-web-security-headers-check`).
- Static assets served with `Cache-Control: no-store` (`web/server/src/index.ts:273-279`).

N/A checks:
- Service worker behavior: no service worker registration found (`command:cmd-service-worker-check`).

## 14. Testing and Quality Gates

Observed quality gates:
- Local lint and unit tests pass in this run (`command:cmd-lint-2026-02-28T19:53:34Z`, `command:cmd-test-unit-2026-02-28T19:53:45Z`).
- CI enforces coverage threshold at 80 (`android.yaml:372-376`).
- Repository guidance states 82% branch safety margin for code-change tasks (`AGENTS.md:95-99`).
- E2E and Maestro workflows exist across Android/iOS/Web (`android.yaml`, `ios.yaml`, `doc/testing/maestro.md:18-23`).

## 15. Compliance, Licenses, Attribution

Observed compliance state:
- License file is GPLv3 (`LICENSE:1-3`).
- README badge still states GPLv2 while later section states GPLv3 (`README.md:5`, `README.md:384`).
- Third-party notices exist and cover many major dependencies (`THIRD_PARTY_NOTICES.md:1-250`).
- Privacy policy exists and is linked from docs index (`docs/privacy-policy.md:1-69`, `docs/index.md:18-20`).

## 16. Risk Register and Recommendations

### ISSUE - Repository-local signing secret pattern
- **ID:** PRA-001
- **Area:** Security
- **Evidence:** `.env` via `command:cmd-env-keystore-vars-mask`; `android/app/build.gradle:8-15`; `android/app/build.gradle:90-93`
- **Problem:** Android signing credentials are loaded from a repository-local `.env` pattern and wired directly into release signing logic.
- **Risk:** Credential leakage can enable unauthorized release signing, compromised update trust, and permanent key revocation work.
- **Severity:** Blocker
- **Likelihood:** High - the pattern exists now and is easy to misuse across developer machines.
- **User impact:** High - compromised signing keys break user trust in updates.
- **Operational impact:** High - emergency key rotation and store incident response are expensive.
- **Effort:** S - migration to secret manager + `.env` sanitization is straightforward.
- **Fix outline:**
  - Remove signing secrets from `.env` usage for local and CI release paths.
  - Keep only non-secret file path hints in local config; read passwords from secure secret stores.
  - Rotate current keystore credentials and revoke exposed material.
  - Add pre-commit/CI secret scanning for `KEYSTORE_*` patterns.
- **Verification:** `git grep -n "KEYSTORE_STORE_PASSWORD\|KEYSTORE_KEY_PASSWORD"`; `./gradlew :app:assembleRelease` with secrets injected only via environment/CI secret store.
- **Notes:** Evidence does not include secret values in this report.

### ISSUE - Android cleartext allowed globally without network security scoping
- **ID:** PRA-002
- **Area:** Android
- **Evidence:** `android/app/src/main/AndroidManifest.xml:11`; `command:cmd-android-network-config-check-2026-02-28T19:56:14Z`; `src/lib/c64api.ts:28-31`; `src/lib/c64api.ts:313-315`
- **Problem:** The Android app enables cleartext traffic globally and no network security config file was found to constrain destinations.
- **Risk:** Any accidental non-LAN endpoint usage can expose credentials/config traffic to interception.
- **Severity:** Critical
- **Likelihood:** High - cleartext allowance is explicit and active by default.
- **User impact:** High - credentials and control traffic can be exposed on untrusted networks.
- **Operational impact:** High - security incident handling and support burden increase.
- **Effort:** M - requires Android network policy file + endpoint policy updates.
- **Fix outline:**
  - Add `network_security_config.xml` restricting cleartext to explicitly approved local hosts/subnets.
  - Set `usesCleartextTraffic` to false by default and permit exceptions via config only.
  - Add runtime warning/guardrails when non-local hosts are configured.
- **Verification:** `aapt dump xmltree app-release.apk AndroidManifest.xml | rg usesCleartextTraffic`; integration test with local host allowed and non-local host blocked.

### ISSUE - Plain FTP transport across all platform backends
- **ID:** PRA-003
- **Area:** Security
- **Evidence:** `android/.../FtpClientPlugin.kt:60-69`; `android/.../FtpClientPlugin.kt:131-145`; `ios/App/App/IOSFtp.swift:27`; `ios/App/App/IOSFtp.swift:121`; `web/server/src/index.ts:547-553`; `web/server/src/index.ts:592-598`
- **Problem:** FTP operations are implemented with plaintext transport and no TLS upgrade path.
- **Risk:** Directory/file operations and credentials can be observed or tampered with on network path.
- **Severity:** Critical
- **Likelihood:** High - this is the default code path for FTP operations.
- **User impact:** High - file metadata/content and authentication material are exposed.
- **Operational impact:** High - exploitability grows with any non-isolated LAN or routed setup.
- **Effort:** L - requires protocol strategy change (FTPS/SFTP/tunnel), compatibility testing with C64U constraints.
- **Fix outline:**
  - Evaluate secure transport options supported by device ecosystem.
  - Introduce optional secure mode and strongly discourage plaintext mode in UI.
  - Add explicit risk warnings and host restrictions when plaintext mode is used.
- **Verification:** platform integration tests asserting TLS negotiation where supported; packet capture confirms encrypted transport.

### ISSUE - Password propagation over HTTP via X-Password header
- **ID:** PRA-004
- **Area:** Backend/API
- **Evidence:** `src/lib/c64api.ts:28-31`; `src/lib/c64api.ts:557-561`; `web/server/src/index.ts:485`; `web/server/src/index.ts:496-497`
- **Problem:** REST requests default to HTTP endpoints and include network password in custom header.
- **Risk:** Header-level credentials are exposed on plaintext channels and can be replayed.
- **Severity:** Critical
- **Likelihood:** High - default base URLs and proxy target both use `http://`.
- **User impact:** High - unauthorized device control can follow credential capture.
- **Operational impact:** High - incident triage is difficult without transport guarantees.
- **Effort:** M - endpoint configuration hardening + credential handling changes.
- **Fix outline:**
  - Prefer HTTPS/TLS endpoints where available and gate plaintext behind explicit advanced mode.
  - Avoid long-lived static password headers when session/token alternative exists.
  - Add strict local-network validation for host targets.
- **Verification:** integration tests for HTTPS path; capture headers on plaintext-disabled path to ensure no secret over cleartext.

### ISSUE - Android backups enabled without explicit backup exclusion rules
- **ID:** PRA-005
- **Area:** Privacy
- **Evidence:** `android/app/src/main/AndroidManifest.xml:5`; `find android/app/src/main/res -maxdepth 3 -type f` (no backup rules file shown)
- **Problem:** `allowBackup=true` is enabled without explicit backup policy files to exclude sensitive state.
- **Risk:** Device backups may include diagnostics or configuration data not intended for backup restore channels.
- **Severity:** Major
- **Likelihood:** Medium - depends on user backup settings and platform behavior.
- **User impact:** Medium - sensitive local state can persist beyond expected lifecycle.
- **Operational impact:** Medium - privacy inquiries and restore-state bugs increase.
- **Effort:** S - add backup rules or disable backup explicitly.
- **Fix outline:**
  - Decide backup policy for diagnostics/config/credentials.
  - Add `fullBackupContent`/`dataExtractionRules` with explicit include/exclude paths, or disable backup.
  - Document backup behavior in privacy docs.
- **Verification:** `aapt dump xmltree app-release.apk AndroidManifest.xml`; restore test on emulator with backup enabled.

### ISSUE - Android diagnostics broadcast is globally observable
- **ID:** PRA-006
- **Area:** Privacy
- **Evidence:** `android/.../AppLogger.kt:56-73`; `android/.../AppLogger.kt:67-71`
- **Problem:** Native diagnostics are emitted via unscoped `sendBroadcast`, including stack traces and contextual fields.
- **Risk:** Other apps on device can subscribe to action and receive internal error/trace information.
- **Severity:** Major
- **Likelihood:** Medium - requires local app with broadcast receiver, but no extra permission needed.
- **User impact:** Medium - local metadata leakage possible.
- **Operational impact:** Medium - sensitive operational details can leak from production devices.
- **Effort:** M - switch to in-app scoped channel or permission-guarded broadcast.
- **Fix outline:**
  - Replace global broadcast with local in-process channel.
  - If broadcast is required, set package and signature-level permission.
  - Remove stack traces from release payloads.
- **Verification:** instrumentation test ensuring third-party receiver cannot capture diagnostics events.

### ISSUE - CI token permissions are broader than necessary
- **ID:** PRA-007
- **Area:** CI/CD
- **Evidence:** `.github/workflows/android.yaml:14-16`; `.github/workflows/ios.yaml:14-16`
- **Problem:** Core workflows request `contents: write` at workflow level, including non-release jobs.
- **Risk:** Compromised job context has elevated repository mutation capability.
- **Severity:** Major
- **Likelihood:** Medium - exploit requires pipeline compromise but blast radius is larger than needed.
- **User impact:** Medium - supply-chain trust can be impacted by unauthorized repo/release changes.
- **Operational impact:** High - incident impact escalates with write permissions.
- **Effort:** S - narrow permissions by job and use write only where required.
- **Fix outline:**
  - Set default workflow permissions to read-only.
  - Grant `contents: write` only in explicit release jobs.
  - Add explicit `permissions` blocks per job.
- **Verification:** run workflow dry-runs and confirm non-release jobs pass with read-only token.

### ISSUE - GitHub Actions are pinned to mutable tags, not immutable SHAs
- **ID:** PRA-008
- **Area:** SupplyChain
- **Evidence:** `.github/workflows/android.yaml:29`; `.github/workflows/android.yaml:34`; `.github/workflows/web.yaml:312`; `.github/workflows/ios.yaml:47`
- **Problem:** CI uses action version tags (`@v3`, `@v4`, `@v5`, `@v6`) instead of commit SHAs.
- **Risk:** Upstream tag retargeting or compromised action release can alter CI behavior unexpectedly.
- **Severity:** Major
- **Likelihood:** Medium - uncommon, but high-consequence when it occurs.
- **User impact:** Medium - compromised artifacts can reach users.
- **Operational impact:** High - difficult forensic attribution and rollback complexity.
- **Effort:** M - mechanical update to SHA pinning with periodic refresh process.
- **Fix outline:**
  - Replace tag refs with full commit SHAs for all third-party actions.
  - Add scheduled dependency update process for action SHAs.
  - Document update cadence and validation.
- **Verification:** `rg -n "uses: .*@v[0-9]" .github/workflows` should return none.

### ISSUE - iOS workflow installs Maestro via unpinned remote script
- **ID:** PRA-009
- **Area:** SupplyChain
- **Evidence:** `.github/workflows/ios.yaml:200`
- **Problem:** CI executes `curl -Ls ... | bash` to install tooling directly from remote script.
- **Risk:** Remote script compromise gives direct code execution in CI.
- **Severity:** Critical
- **Likelihood:** Medium - depends on external channel integrity.
- **User impact:** Medium - compromised CI outputs can affect shipped artifacts.
- **Operational impact:** High - supply-chain compromise path is direct.
- **Effort:** S - switch to pinned binary/checksum install path.
- **Fix outline:**
  - Download versioned artifact with checksum/signature verification.
  - Pin exact Maestro version in workflow config.
  - Fail build on checksum mismatch.
- **Verification:** workflow logs show fixed version and checksum validation step.

### ISSUE - Dependabot is not configured
- **ID:** PRA-010
- **Area:** SupplyChain
- **Evidence:** `command:cmd-missing-dependabot-2026-02-28T19:56:14Z`
- **Problem:** No automated dependency update PR mechanism was found in `.github/dependabot.yml`.
- **Risk:** Vulnerability exposure windows increase because update detection is manual.
- **Severity:** Major
- **Likelihood:** High - dependency drift is continuous.
- **User impact:** Medium - users remain exposed longer to known CVEs.
- **Operational impact:** Medium - larger, riskier update batches accumulate.
- **Effort:** S - add and tune Dependabot configuration.
- **Fix outline:**
  - Add Dependabot for npm, GitHub Actions, and Gradle/CocoaPods where applicable.
  - Configure weekly cadence and grouped updates.
  - Add labels/owners and CI policy checks for dependency PRs.
- **Verification:** Dependabot PRs appear after schedule run.

### ISSUE - Critical runtime dependency vulnerability in basic-ftp
- **ID:** PRA-011
- **Area:** SupplyChain
- **Evidence:** `command:cmd-npm-audit-runtime-2026-02-28T19:57:50Z`; `package.json:100`
- **Problem:** `npm audit` reports a critical advisory for `basic-ftp <5.2.0`, and runtime dependency currently uses `^5.0.3`.
- **Risk:** Known vulnerability can be exploited in FTP file handling paths.
- **Severity:** Critical
- **Likelihood:** High - vulnerable range is actively resolved in current dependency graph.
- **User impact:** High - remote file handling attack surface is directly user-facing.
- **Operational impact:** High - shipping known critical CVE is a release blocker for many policies.
- **Effort:** S - upgrade dependency and run regression tests.
- **Fix outline:**
  - Upgrade `basic-ftp` to a fixed version.
  - Re-run FTP browse/read tests on web and native bridges.
  - Add audit gate in CI for runtime criticals.
- **Verification:** `npm audit --omit=dev --audit-level=critical` exits 0.

### ISSUE - iOS deployment and version metadata are inconsistent
- **ID:** PRA-012
- **Area:** iOS
- **Evidence:** `ios/App/Podfile:3`; `ios/App/App.xcodeproj/project.pbxproj:310`; `ios/App/App.xcodeproj/project.pbxproj:377`; `ios/App/App.xcodeproj/project.pbxproj:379`; `ios/App/App.xcodeproj/project.pbxproj:395`
- **Problem:** Podfile declares iOS 15.0 while project build settings remain at 13.0 and app version/build are fixed values.
- **Risk:** Build/release metadata drift can create CI/device inconsistencies and store submission/versioning failures.
- **Severity:** Major
- **Likelihood:** Medium - mismatch is static and present today.
- **User impact:** Medium - users can receive confusing upgrade/version behavior.
- **Operational impact:** High - release automation and compliance checks can fail.
- **Effort:** M - align targets/versioning variables across Podfile, project, and CI.
- **Fix outline:**
  - Align deployment target in project and pods helper output.
  - Wire `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` to release metadata source.
  - Add CI assertion that project and Podfile targets match.
- **Verification:** `xcodebuild -showBuildSettings` target values match expected release config.

### ISSUE - Android release build keeps minification disabled
- **ID:** PRA-013
- **Area:** Android
- **Evidence:** `android/app/build.gradle:131-135`; `android/app/proguard-rules.pro:1-24`
- **Problem:** Release build type explicitly disables minification/obfuscation.
- **Risk:** Larger binaries and easier reverse engineering of release logic.
- **Severity:** Major
- **Likelihood:** High - release config is explicit.
- **User impact:** Medium - install size and startup/runtime overhead may be worse on low-end devices.
- **Operational impact:** Medium - IP exposure and harder exploit resistance.
- **Effort:** M - enable minify/shrink with rule tuning.
- **Fix outline:**
  - Enable `minifyEnabled true` and `shrinkResources true` for release.
  - Add keep rules for reflection/Capacitor plugin entry points.
  - Validate crash-free startup and plugin operations.
- **Verification:** compare release APK size and run smoke tests on minified release.

### ISSUE - Android ABI policy includes emulator ABIs in default packaging path
- **ID:** PRA-014
- **Area:** Performance
- **Evidence:** `android/app/build.gradle:76-78`
- **Problem:** ABI filters include `x86` and `x86_64` alongside device ABIs without split delivery strategy.
- **Risk:** Universal artifacts can become unnecessarily large for end users.
- **Severity:** Major
- **Likelihood:** Medium - impact depends on packaging lane and Play split config.
- **User impact:** Medium - larger downloads and install footprint.
- **Operational impact:** Medium - slower distribution and higher artifact storage costs.
- **Effort:** M - configure ABI splits for release while keeping emulator compatibility in debug.
- **Fix outline:**
  - Keep emulator ABIs for debug builds only.
  - Enable ABI splits or Play App Bundle optimization for release.
  - Verify release artifact naming and CI upload expectations.
- **Verification:** inspect release AAB/APK ABI contents and compare artifact sizes.

### ISSUE - Web runtime disables asset caching and has no service worker fallback
- **ID:** PRA-015
- **Area:** Web
- **Evidence:** `web/server/src/index.ts:273-279`; `command:cmd-service-worker-check`
- **Problem:** Static assets are always served with `Cache-Control: no-store`, and no service worker path was found.
- **Risk:** Repeat visits re-download full assets, increasing latency and bandwidth costs.
- **Severity:** Major
- **Likelihood:** High - default behavior applies to all clients.
- **User impact:** Medium - slower page loads, especially on constrained devices.
- **Operational impact:** Medium - avoidable network load on host environment.
- **Effort:** M - add cache policy/versioned assets and optional service worker strategy.
- **Fix outline:**
  - Keep `no-store` for auth/config endpoints only.
  - Serve hashed static assets with long-lived immutable cache headers.
  - Introduce optional service worker for offline shell/cache.
- **Verification:** `curl -I` on static assets shows cacheable headers; Lighthouse repeat-load metrics improve.

### ISSUE - Web bundle size profile is high for first load
- **ID:** PRA-016
- **Area:** Performance
- **Evidence:** `command:cmd-web-build-2026-02-28T19:54:34Z`
- **Problem:** Build output includes large main bundle and large WASM payload, increasing first-load cost.
- **Risk:** Slower startup on low-power/mobile browsers and constrained links.
- **Severity:** Major
- **Likelihood:** High - build artifact sizes are current output.
- **User impact:** Medium - first interaction latency increases.
- **Operational impact:** Medium - higher bandwidth and cold-start variance.
- **Effort:** L - requires code-splitting and deferred artifact loading strategy.
- **Fix outline:**
  - Defer WASM-heavy paths until feature use.
  - Split main route chunk further by feature boundary.
  - Track startup budgets in CI with size thresholds.
- **Verification:** `npm run build` size report shows reduced main chunk and delayed WASM fetch on non-HVSC routes.

### ISSUE - Browser zoom is disabled, reducing accessibility
- **ID:** PRA-017
- **Area:** Accessibility
- **Evidence:** `index.html:5`
- **Problem:** Viewport meta includes `user-scalable=no`, which blocks pinch zoom in browser contexts.
- **Risk:** Low-vision users lose a critical readability control.
- **Severity:** Major
- **Likelihood:** High - applies on every web load.
- **User impact:** High - direct accessibility regression for affected users.
- **Operational impact:** Medium - increased support load and accessibility compliance risk.
- **Effort:** S - remove restrictive viewport parameter and test layouts.
- **Fix outline:**
  - Remove `user-scalable=no` from viewport metadata.
  - Validate layout behavior at high zoom/text scale.
  - Add accessibility smoke check in web CI.
- **Verification:** manual browser zoom test and automated accessibility check for reflow.

### ISSUE - Localization readiness is low
- **ID:** PRA-018
- **Area:** UX
- **Evidence:** `command:cmd-localization-libs-check`; `src/pages/SettingsPage.tsx:703-813`; `src/pages/SettingsPage.tsx:1555-1753`
- **Problem:** No i18n framework was found and large user-visible surfaces use hard-coded English strings.
- **Risk:** Adding localization later will require broad refactor and increases translation defects.
- **Severity:** Major
- **Likelihood:** High - current code is not localization-ready.
- **User impact:** Medium - non-English accessibility/readability is limited.
- **Operational impact:** Medium - future release effort and regression risk increase.
- **Effort:** L - requires string extraction, key management, and formatting support.
- **Fix outline:**
  - Introduce localization framework and message catalogs.
  - Externalize page/component strings incrementally.
  - Add locale smoke tests including RTL and plural cases.
- **Verification:** run app with second locale and validate key screens render localized content.

### ISSUE - Current persistence adapters can silently reset state on parse/version mismatch
- **ID:** PRA-019
- **Area:** Data
- **Evidence:** `src/lib/playlistRepository/indexedDbRepository.ts:97-109`; `src/lib/playlistRepository/localStorageRepository.ts:74-88`; `doc/db.md:11-15`
- **Problem:** On corrupt or version-mismatched persisted state, repository adapters return default empty state rather than migration/recovery path.
- **Risk:** User playlists/sessions can appear lost after incompatible or corrupt state events.
- **Severity:** Major
- **Likelihood:** Medium - triggered by corruption or schema evolution paths.
- **User impact:** High - apparent data loss for playlist/session features.
- **Operational impact:** Medium - support burden for recovery incidents.
- **Effort:** L - requires migration framework and backup/recovery handling.
- **Fix outline:**
  - Introduce explicit schema migration path for current adapters.
  - Add backup snapshot before destructive fallback.
  - Surface recovery UX when state fails validation.
- **Verification:** migration tests across version bumps and corrupted-state fixtures preserve recoverable data.

### ISSUE - Coverage quality bar mismatch between CI gate and repository guidance
- **ID:** PRA-020
- **Area:** Testing
- **Evidence:** `.github/workflows/android.yaml:372-376`; `AGENTS.md:95-99`
- **Problem:** CI enforces `COVERAGE_MIN=90` while repository guidance states 90% branch safety margin for code-change tasks.
- **Risk:** Regression risk rises when gate is weaker than declared quality policy.
- **Severity:** Minor
- **Likelihood:** High - mismatch is explicit and persistent.
- **User impact:** Medium - lower guardrails can allow avoidable defects.
- **Operational impact:** Medium - inconsistency causes policy drift and review friction.
- **Effort:** S - update threshold/config and adjust failing tests if needed.
- **Fix outline:**
  - Align CI threshold with documented target.
  - Report branch coverage explicitly in CI summary.
  - Fail PR gate when below policy floor.
- **Verification:** CI run fails when branch coverage < target; docs and workflow values match.

### ISSUE - License metadata inconsistency in repository docs
- **ID:** PRA-021
- **Area:** Legal/Licensing
- **Evidence:** `README.md:5`; `README.md:384`; `LICENSE:1-3`
- **Problem:** README badge indicates GPL v2 while repository license text is GPL v3.
- **Risk:** Legal ambiguity for downstream users/distributors and compliance tooling confusion.
- **Severity:** Minor
- **Likelihood:** High - inconsistency is visible on repository front page.
- **User impact:** Low - mostly legal metadata, not runtime behavior.
- **Operational impact:** Medium - legal clarification requests and packaging friction.
- **Effort:** S - align badge and references.
- **Fix outline:**
  - Update README badge text/link to GPL v3.
  - Re-check all docs/store metadata for consistent license statement.
- **Verification:** `rg -n "GPL v2|GPL v3" README.md docs` reflects single intended license.

### ISSUE - Android build verification could not complete in this assessment environment
- **ID:** PRA-022
- **Area:** Stability
- **Evidence:** `command:cmd-android-assemble-dryrun-2026-02-28T19:54:43Z`; `android/gradle/wrapper/gradle-wrapper.properties:3`
- **Problem:** Android dry-run assemble command failed because Gradle wrapper distribution download was blocked by sandbox network policy.
- **Risk:** Release readiness confidence is reduced because local Android build path was not fully executed in this run.
- **Severity:** Minor
- **Likelihood:** Medium - environment-specific, not necessarily repository defect.
- **User impact:** Low - no direct runtime defect proven.
- **Operational impact:** Medium - assessment confidence gap remains.
- **Effort:** S - rerun in unrestricted environment with cached wrapper.
- **Fix outline:**
  - Re-run `./gradlew -m assembleDebug` in network-enabled CI or local environment.
  - Cache Gradle distribution in controlled build runners.
- **Verification:** successful dry-run and full assemble logs collected in unrestricted environment.

### ISSUE - iOS local build command is not executable on Linux assessment host
- **ID:** PRA-023
- **Area:** CI/CD
- **Evidence:** `command:cmd-ios-build-sim-2026-02-28T19:54:46Z`; `AGENTS.md:123-124`
- **Problem:** `npm run ios:build:sim` failed because `xcodebuild` is unavailable on Linux host.
- **Risk:** Local cross-platform validation cannot include iOS build on non-macOS machines.
- **Severity:** Minor
- **Likelihood:** High - deterministic on Linux hosts.
- **User impact:** Low - CI/macOS path exists.
- **Operational impact:** Medium - local contributor validation is asymmetric.
- **Effort:** S - document and enforce macOS CI as authoritative iOS build gate.
- **Fix outline:**
  - Keep iOS build validation mandatory in macOS CI lanes.
  - Document local limitation and expected CI fallback in release checklist.
- **Verification:** successful iOS simulator build artifact in macOS workflow.

## 17. Ranked Backlog, Dependencies, and Sequence

Ranked backlog table:

| Rank | PRA-ID | Title | Severity | Effort | Impact | Rationale |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | PRA-001 | Repository-local signing secret pattern | Blocker | S | High | Immediate credential trust risk for release supply chain. |
| 2 | PRA-011 | Critical runtime vulnerability in `basic-ftp` | Critical | S | High | Known exploitable dependency issue in active runtime path. |
| 3 | PRA-002 | Android global cleartext traffic | Critical | M | High | Broad network exposure beyond intended trusted LAN assumptions. |
| 4 | PRA-004 | HTTP `X-Password` credential path | Critical | M | High | Credential replay/interception risk across REST control channel. |
| 5 | PRA-003 | Plain FTP transport across platforms | Critical | L | High | Core file-transfer path lacks confidentiality/integrity protections. |
| 6 | PRA-007 | Over-broad CI token permissions | Major | S | High | Limits blast radius reduction in pipeline compromise scenarios. |
| 7 | PRA-009 | `curl|bash` tool install in CI | Critical | S | High | Direct remote script execution in CI is avoidable. |
| 8 | PRA-008 | Actions not SHA-pinned | Major | M | High | Improves deterministic and tamper-resistant CI chain. |
| 9 | PRA-005 | Android backup policy gap | Major | S | Medium | Prevents unintended data persistence/exposure in backups. |
| 10 | PRA-012 | iOS deployment/version mismatch | Major | M | Medium | Removes release metadata drift and build inconsistency. |
| 11 | PRA-019 | Data reset fallback without migration | Major | L | High | Protects user playlists/session continuity. |
| 12 | PRA-015 | Web no-store caching everywhere | Major | M | Medium | Improves repeat-load performance and bandwidth efficiency. |
| 13 | PRA-016 | Large first-load web bundle | Major | L | Medium | Startup performance on constrained devices. |
| 14 | PRA-006 | Android diagnostics broadcast leakage | Major | M | Medium | Reduces local inter-app data leakage risk. |
| 15 | PRA-014 | Android ABI packaging efficiency gap | Major | M | Medium | Lowers artifact size for release users. |
| 16 | PRA-013 | Android release minification disabled | Major | M | Medium | Improves release hardening and size. |
| 17 | PRA-017 | Browser zoom disabled | Major | S | High | Immediate accessibility improvement. |
| 18 | PRA-018 | Localization readiness gap | Major | L | Medium | Reduces future release risk for multi-locale support. |
| 19 | PRA-010 | Missing Dependabot | Major | S | Medium | Shrinks vulnerability detection latency. |
| 20 | PRA-020 | Coverage policy mismatch | Minor | S | Medium | Aligns practice with documented quality bar. |
| 21 | PRA-021 | License metadata mismatch | Minor | S | Medium | Removes legal ambiguity. |
| 22 | PRA-022 | Android build verification limitation | Minor | S | Low | Closes assessment confidence gap. |
| 23 | PRA-023 | iOS local build limitation on Linux | Minor | S | Low | Clarifies CI-only iOS validation expectations. |

Dependency ordering:
- Security release baseline: PRA-001 -> PRA-011 -> PRA-002 -> PRA-004 -> PRA-003.
- CI supply-chain hardening: PRA-007 -> PRA-009 -> PRA-008 -> PRA-010.
- Platform release consistency: PRA-012 before next iOS release packaging cycle.
- Data resilience workstream: PRA-019 should precede large storage/schema changes.
- Performance tuning: PRA-015 before PRA-016 to avoid optimizing uncached path only.

Recommended sequence:

First 1 day:
- PRA-001
- PRA-011
- PRA-007
- PRA-009
- PRA-005
- PRA-017
- PRA-020
- PRA-021

First week:
- PRA-002
- PRA-004
- PRA-008
- PRA-010
- PRA-012
- PRA-013
- PRA-014
- PRA-022
- PRA-023

First month:
- PRA-003
- PRA-006
- PRA-015
- PRA-016
- PRA-018
- PRA-019

### Effort-Impact Matrix

Ranking rules:
- Impact is derived from combined user and operational impact in issue entries.
- Effort uses S/M as low effort, L/XL as high effort.

| Quadrant | PRA IDs |
| --- | --- |
| Low effort / High impact | PRA-001, PRA-005, PRA-007, PRA-009, PRA-010, PRA-011, PRA-017, PRA-020, PRA-021 |
| Low effort / Low impact | PRA-022, PRA-023 |
| High effort / High impact | PRA-002, PRA-003, PRA-004, PRA-008, PRA-019 |
| High effort / Low impact | PRA-006, PRA-012, PRA-013, PRA-014, PRA-015, PRA-016, PRA-018 |

## 18. Coverage Checklist (A-K)

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

N/A markers with evidence:
- Android App Links/deep links not in scope currently: only launcher intent filter found (`AndroidManifest.xml:21-24`, deep-link scan output).
- iOS background modes key not present (`Info.plist:1-57`).

## 19. Self-Check

Self-check results:
- Required deliverables for updated request exist: `doc/research/review-5/production-readiness-assessment-2026-02-28.md` and `doc/research/review-5/issues.csv`.
- PRA IDs are unique and sequential (PRA-001 through PRA-023).
- `issues.csv` contains every issue exactly once.
- Executive summary severity ordering is aligned with risk register priorities.
- No application code, tests, CI config, manifests, lockfiles, or build scripts were modified in this assessment run.

Git state evidence:
- `command:cmd-git-status-post-ci-2026-02-28T19:57:46Z` shows only documentation/planning paths changed.
