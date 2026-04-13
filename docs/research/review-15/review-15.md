# Review 15 Production Readiness Audit

Date: 2026-04-11

Classification: `DOC_ONLY`

## Executive Summary

Overall verdict: **No-go overall.**

- **Android:** Closest to production-ready. Current code, coverage, web build, and Android JVM evidence are strong, and no new Android-native release blocker was found in this audit. I am not calling Android fully signed off from this workstation because the current branch is not lint-clean and I did not complete an end-to-end Android-app-to-real-target pass.
- **iOS:** **Partially ready / structurally present but still risky.** The iOS native layer now includes real HVSC, secure storage, FTP, background execution, and diagnostics plugins, but Telnet-backed controls are still exposed through shared UI/runtime logic without any iOS `TelnetSocket` plugin implementation.
- **Web:** **No-go for the advertised password-protected LAN deployment path.** Follow-up real-target checks showed that the Docker/web route can reach `c64u` and `192.168.1.167` when the frontend is built in actual web-platform mode, so the current web blocker is not generic LAN connectivity. The blocker is that the default Docker production path serves over plain HTTP per `README.md`, while production mode also enables `Secure` session cookies by default. Browsers will not send those cookies back over HTTP, so authenticated web sessions do not persist.

Top release blockers:

1. Default Docker web auth is broken for password-protected HTTP LAN deployments.
2. iOS still exposes Telnet-dependent controls without a native Telnet transport.

## Scope and Method

This audit was run against the current repository state. No application code was changed.

Primary guidance reviewed:

- `AGENTS.md`
- `.github/copilot-instructions.md`
- `README.md`
- `docs/ux-guidelines.md`
- `docs/testing/maestro.md`
- `package.json`
- `docs/c64/c64u-openapi.yaml`
- prior review lineage under `docs/research/review-10/` through `review-14/`
- HVSC and Android readiness docs under `docs/research/hvsc/` and `docs/research/android/`

Major product surfaces inspected:

- app shell and navigation: `src/App.tsx`, `src/components/TabBar.tsx`, `src/components/UnifiedHealthBadge.tsx`
- connectivity, diagnostics, and tracing: `src/hooks/useC64Connection.ts`, `src/hooks/useHealthState.ts`, `src/hooks/useTelnetActions.ts`, `src/lib/connection/*`, `src/lib/deviceInteraction/*`, `src/lib/diagnostics/*`, `src/lib/tracing/*`
- playback and source flows: `src/pages/HomePage.tsx`, `src/pages/PlayFilesPage.tsx`, `src/pages/playFiles/hooks/useHvscLibrary.ts`, `src/lib/hvsc/*`, `src/lib/sources/*`, `src/lib/playlistRepository/*`
- persistence and native bridges: `src/lib/secureStorage.ts`, `src/lib/native/*`, `src/lib/savedDevices/*`
- Android: `android/app/build.gradle`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/java/uk/gleissner/c64commander/*`
- iOS: `ios/App/App/*`, `ios/native-tests/*`
- web runtime: `web/server/src/*`, `web/Dockerfile`
- test and release infrastructure: `.github/workflows/*.yaml`, `tests/unit/*`, `tests/android-emulator/*`, `playwright/*`, `.maestro/*`

Commands run:

- `npm run lint`
  Result: failed. Prettier drift reported in `tests/unit/scripts/androidUpstream7zipPackaging.test.ts`.
- `npm run test:coverage`
  Result: passed. Coverage summary:
  - Statements `94.18%`
  - Branches `92.24%`
  - Functions `90.02%`
  - Lines `94.18%`
- `npm run build`
  Result: passed.
- `VITE_WEB_PLATFORM=1 npm run build`
  Result: passed. This matches the frontend mode used by `web/Dockerfile`.
- `npm run build:web-server`
  Result: passed.
- `cd android && ./gradlew test`
  Result: passed.
- `adb devices -l`
  Result: attached Pixel 4 detected.
- `curl http://u64/v1/info`
  Result: unreachable from this workstation during the audit.
- `getent hosts c64u`
  Result: `c64u` resolved to `192.168.1.167`.
- `curl http://c64u/v1/info`
  Result: later follow-up probe returned `HTTP 200` with live device metadata.
- `curl http://192.168.1.167/v1/info`
  Result: returned `HTTP 200` with the same live device metadata.
- `curl -H 'X-C64U-Host: c64u' http://127.0.0.1:18065/api/rest/v1/info`
  Result: returned `HTTP 200` through the production web proxy.
- `curl -H 'X-C64U-Host: 192.168.1.167' http://127.0.0.1:18065/api/rest/v1/info`
  Result: returned `HTTP 200` through the production web proxy.

Targeted runtime verification performed:

- Started the built web server manually in production mode with `NODE_ENV=production`.
- Rebuilt the frontend in actual web-platform mode with `VITE_WEB_PLATFORM=1`, matching the Docker image contract in `web/Dockerfile:24-25`.
- Set a web password through `/api/secure-storage/password`.
- Verified that the server returned `Set-Cookie: c64_session=...; Secure`.
- Verified that a subsequent plain-HTTP request to `/auth/status` remained unauthenticated, which matches browser behavior for `Secure` cookies on HTTP.
- Verified that the same production server could proxy live C64U REST traffic for both `c64u` and `192.168.1.167`.
- Ran a headless browser check against the production web build with `c64u` stored as the selected host. The health badge reached `REAL_CONNECTED` / `Online` / `C64U`, which showed that the basic web connectivity path works when exercised with the correct web-platform build.
- Discarded one earlier browser result from a plain `npm run build` bundle because it did not include `VITE_WEB_PLATFORM=1` and therefore was not representative of the shipped Docker/web product mode.

Runtime environments used:

- local Linux workstation
- attached Android Pixel 4 over `adb`
- live C64U reachable from the workstation as `c64u` / `192.168.1.167`; U64 remained unreachable
- no local macOS/iOS runtime available

Screenshot impact:

- none

## What Is Better Than Expected

- The diagnostics and health model are materially stronger than the older review lineage suggests. `TELNET` is now a first-class contributor in the health model and trace-derived badge state, not an afterthought: see `src/lib/diagnostics/healthModel.ts:20-22` and `src/hooks/useHealthState.ts:70-170`.
- REST traces now preserve concrete request identity instead of collapsing everything into opaque verbs. `recordRestRequest` and `recordRestResponse` persist protocol, hostname, port, path, and query: `src/lib/tracing/traceSession.ts:381-456`.
- The web server has a much better trust boundary than a typical ad hoc LAN proxy. It applies CSP and related headers in `web/server/src/securityHeaders.ts:11-25`, sanitizes host overrides in `web/server/src/hostValidation.ts:52-108`, and rate-limits repeated login failures in `web/server/src/authState.ts:48-78`.
- The core Docker/web connectivity path held up better than the current automated evidence implied. `web/Dockerfile:24-25` builds the frontend with `VITE_WEB_PLATFORM=1`; when I matched that build mode locally, both proxied `/api/rest/v1/info` requests and a headless browser run reached the live `c64u` target successfully. That means the current web no-go verdict is about auth/deployment correctness, not generic inability to reach a LAN C64U.
- Several old HVSC issues are genuinely gone. The codebase now contains a real iOS HVSC native plugin in `ios/App/App/HvscIngestionPlugin.swift:16-40`, and non-native full-archive HVSC ingestion is explicitly blocked with a clear error contract in `src/lib/hvsc/hvscIngestionRuntime.ts:115-136` plus the 5 MiB guard in `src/lib/hvsc/hvscFilesystem.ts:104-107`.
- Android size discipline is stronger than the earlier lineage implied. Release ABIs are narrowed to `armeabi-v7a` and `arm64-v8a` in `android/app/build.gradle:20-26` and `android/app/build.gradle:236-244`, and there is a dedicated regression test at `tests/unit/scripts/androidUpstream7zipPackaging.test.ts:9-34`.

## Prior Review Reconciliation

| Prior claim | Current status | Current evidence |
| --- | --- | --- |
| Review 11: Android HVSC extraction fails with `offsetBytes must be >= 0` | `Fixed` | Current HVSC archive extraction tests pass under `npm run test:coverage`, and Android JVM tests passed in `./gradlew test`. The Android path also now ships a dedicated HVSC plugin/test surface under `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt` and `android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt`. |
| Review 11: iOS has no native HVSC plugin | `Fixed` | `ios/App/App/HvscIngestionPlugin.swift:16-40` implements the plugin, and `ios/App/App/AppDelegate.swift:552-560` registers it. |
| Review 11: REST diagnostics are too generic to be useful | `Fixed` | `src/lib/tracing/traceSession.ts:381-456` now records URL structure, host, path, query, and latency. |
| Review 11: health badge starts misleadingly unhealthy before first real success | `Fixed` | `src/hooks/useHealthState.ts:116-143` now gates trace-derived health on first successful REST response, keeping the badge idle instead of falsely unhealthy. |
| Review 11: web HVSC is silently unusable | `Fixed` | Non-native ingestion now fails with an explicit unsupported-platform message in `src/lib/hvsc/hvscIngestionRuntime.ts:115-136`, and large non-native reads are hard-blocked in `src/lib/hvsc/hvscFilesystem.ts:104-107`. |
| HVSC follow-up: Android plugin/JDK instability remains open | `Fixed` | `cd android && ./gradlew test` passed in this audit. |
| APK size regression concerns | `Partially Converged` | ABI narrowing and packaging tests are present, but this audit did not build and inspect a signed release artifact. See `android/app/build.gradle:20-26`, `android/app/build.gradle:223-244`, and `tests/unit/scripts/androidUpstream7zipPackaging.test.ts:9-34`. |
| Review 10 large-file modularity concerns | `Still Open` | Large hotspot files still exist, including `src/pages/SettingsPage.tsx`, `src/pages/HomePage.tsx`, `src/pages/PlayFilesPage.tsx`, and `src/lib/c64api.ts`. This remains an engineering risk map item, but not a new production blocker by itself. |

## Findings

### F1 · Critical · Web blocker

**Default Docker web auth is incompatible with the documented HTTP LAN deployment path.**

Impacted platforms:

- Web

Why this is still current:

- The README explicitly documents the web product as a plain-HTTP LAN deployment and tells users to open `http://<host-ip>:8064`: `README.md:38-55`.
- The production Docker image sets `NODE_ENV=production`: `web/Dockerfile:27-33`.
- In production mode, the server enables secure cookies by default unless overridden: `web/server/src/index.ts:58-63`.
- The auth layer appends `; Secure` to the session cookie whenever that flag is enabled: `web/server/src/authState.ts:92-115`.
- Password setup and login both rely on that session cookie for authenticated state: `web/server/src/index.ts:470-535`.

Current runtime evidence:

- In a manual production-mode run of the built server, setting a password returned `Set-Cookie: c64_session=...; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400; Secure`.
- A follow-up HTTP request to `/auth/status` remained `authenticated: false`.
- In that same production-mode run, `/api/rest/v1/info` successfully proxied to the real device for both `X-C64U-Host: c64u` and `X-C64U-Host: 192.168.1.167`, and a browser run against the proper web build reached `REAL_CONNECTED`.
- This is expected browser behavior: `Secure` cookies are not sent over plain HTTP.

Why this matters for production:

- The repository currently advertises the web runtime as a supported self-hosted LAN product mode.
- In that advertised mode, password-protected sessions do not persist under the default Docker configuration.
- This is not a hardening nit. It breaks the basic authenticated-user path for the documented deployment contract.

Why CI did not catch it:

- The unit web-server tests start the server without forcing production mode: `tests/unit/web/webServer.test.ts:25-29`, `85-90`, `114-119`, `205-218`.
- The passing web-server logs from this audit showed `secureCookies:false` during automated tests, while the manual production run showed `secureCookies:true`.

Required convergence:

- Either ship honest HTTPS-first deployment with docs and tests to match, or disable secure cookies by default for the documented plain-HTTP LAN mode.
- Add automated coverage for the actual Docker production path, not just the development/test cookie branch.

### F2 · High · iOS parity blocker

**iOS exposes Telnet-backed actions through shared native-platform logic, but there is no iOS `TelnetSocket` plugin implementation.**

Impacted platforms:

- iOS

Why this is still current:

- Telnet availability is decided generically for any native platform when the device is connected and product-capable: `src/hooks/useTelnetActions.ts:38-68`, `103-108`.
- The Home page uses that availability to expose Telnet-dependent controls including power cycle, drive/printer Telnet actions, and clear-flash actions: `src/pages/HomePage.tsx:966-970`, `1375-1394`, `1410-1427`, `1530-1539`, `1661-1669`.
- The shared plugin registration only provides a web fallback for `TelnetSocket`: `src/lib/native/telnetSocket.ts:39-40`.
- iOS plugin registration includes folder picker, FTP, secure storage, feature flags, background execution, diagnostics, mock server, and HVSC, but no Telnet plugin: `ios/App/App/AppDelegate.swift:541-560`.
- Android does have a concrete Telnet plugin and test coverage, which makes the iOS omission unambiguous rather than merely hard to find: `android/app/src/main/java/uk/gleissner/c64commander/MainActivity.kt:64-74`, `android/app/src/main/java/uk/gleissner/c64commander/TelnetSocketPlugin.kt:24-25`, `android/app/src/test/java/uk/gleissner/c64commander/TelnetSocketPluginTest.kt`.

Why this matters for production:

- This is a capability-honesty issue, not just an implementation gap.
- The current iOS build can present Telnet-backed affordances as available because it is a native platform, but the required native transport layer is absent.
- That undermines the app’s cross-platform support claim and leaves a class of advanced machine/device actions structurally unavailable on iOS.

Required convergence:

- Either implement and register an iOS `TelnetSocket` plugin with validation coverage, or gate Telnet-backed controls out of iOS and document the limitation explicitly.

### F3 · Medium · Release-gate integrity

**The current branch is not lint-clean, so the repository is not in a clean release-validation state even though build, coverage, and Android JVM tests pass.**

Impacted platforms:

- All

Current evidence:

- `npm run lint` failed in this audit.
- The reported issue was Prettier drift in `tests/unit/scripts/androidUpstream7zipPackaging.test.ts`.

Why this matters for production:

- This is not a shipped-runtime defect, but it is still a release-readiness defect.
- A production-readiness sign-off should not rely on “everything important passed except lint.”
- Because the failure is in an existing repository test file, this is a current-state hygiene problem, not an artifact of the audit.

Required convergence:

- Restore a clean lint baseline before treating the branch as fully release-ready.

## Areas Not Fully Verified

- **Android real-target proof remains incomplete.** A Pixel 4 was attached over `adb`. `u64` stayed unreachable, but follow-up workstation probes did reach `c64u` / `192.168.1.167`. I still did not complete an end-to-end Android app validation pass against that live target.
- **iOS runtime proof remains limited.** No local macOS/iOS runtime was available. I relied on source inspection plus CI workflow review. The native Swift test target currently covers host/path/FTP normalization utilities, not Telnet, HVSC ingestion, secure storage, or background execution end-to-end.
- **The retained iOS CI lane is intentionally narrow.** The workflow’s grouped Maestro coverage is currently `ios-ci-smoke`, `ios-secure-storage-persist`, and `ios-config-persistence`: `.github/workflows/ios.yaml:136-139`. That is useful evidence, but not broad enough to prove full parity across FTP, Telnet, HVSC, diagnostics, and long-running lifecycle behavior.
- **Web regression coverage is still shallower than the production risk warrants.** I added a backlog item in `PLANS.md` to deepen Docker/web production coverage against realistic LAN targets, because current automated coverage still underrepresents the real self-hosted web path even though the follow-up live-target checks succeeded.
- **I did not rerun the full Playwright or Maestro matrices in this audit.** The required baseline validations, targeted production web verification, and environment constraints were sufficient to prove the current blockers without claiming broader runtime coverage than I actually ran.

## Release Readiness Verdict

Overall:

- **No-go.** The app is not honestly production-ready across its advertised Android, iOS, and self-hosted web surfaces because the supported-platform contract still exceeds the verified current behavior.

Android:

- **Near-ready, but not signed off in this audit.**
- Evidence is strong: `npm run test:coverage` passed at `92.24%` branch coverage, `npm run build` passed, and `cd android && ./gradlew test` passed.
- I did not find a new Android-native blocker in current code.
- I am not calling Android a full go from this workstation because the branch is not lint-clean and I did not complete the final Android-app-to-live-target proof on the attached Pixel 4.

iOS:

- **No-go for an honest “production-ready parity” claim.**
- The platform is no longer a placeholder. It has substantial real native surface area.
- It is still not release-ready as a parity platform while Telnet-backed controls remain exposed without an iOS Telnet transport.
- Even after that is fixed, iOS still needs broader runtime proof than this environment could provide.

Web:

- **No-go.**
- Follow-up real-target checks showed that the correct Docker/web build can connect to `c64u` / `192.168.1.167`, so the current web verdict is not based on a reproduced generic connectivity failure.
- The documented Docker/LAN deployment contract is still internally inconsistent with the current auth cookie policy.
- Web can only be called production-ready after the deployment contract and the actual auth/session behavior match.

What must be fixed before calling the app production-ready overall:

1. Resolve the web auth/session contract for the documented LAN deployment path.
2. Resolve the iOS Telnet capability gap, either by implementation or by honest gating/removal.
3. Restore a clean lint baseline.

What can reasonably be deferred after those blockers:

- further large-file modularization
- broader iOS native/HVSC/background stress coverage
- deeper Docker/web regression coverage against realistic LAN targets
- renewed Android real-device HIL proof against the reachable `c64u` target and, separately, a reachable U64 when available

## Recommended Implementation Order

1. **Fix the web auth contract first.**
   This is the clearest production blocker because it breaks the documented password-protected LAN mode today. Change either the cookie policy or the deployment contract, then add an automated production-mode test that exercises the Docker path.
2. **Make iOS Telnet support honest.**
   Implement an iOS `TelnetSocket` plugin if parity is required. If not, gate those controls off on iOS and update platform-support docs accordingly.
3. **Restore release-gate cleanliness.**
   Fix the current lint failure so the branch is back in a clean, repeatable validation state.
4. **Re-run platform proof at the edge where current evidence is weakest.**
   After the blockers above are fixed, repeat:
   - production-mode web auth verification
   - deeper Docker/web regression coverage against real-LAN target forms including `c64u` and direct IPs
   - Android Pixel 4 to reachable C64U/U64 validation
   - expanded iOS runtime checks for Telnet/HVSC/FTP/lifecycle behavior
