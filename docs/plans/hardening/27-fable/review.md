# Hardening 27 — Fable static production-readiness review

## 1. Baseline

- **Date:** 2026-09-02
- **Review branch:** `review/hardening-27-fable` (worktree `.claude/worktrees/review-27-fable`)
- **Base commit:** `3ba8db051adfe563e63a854692774db5b50f6985` — `Close the outstanding tooling, documentation and Android defects (#403)`, local `main` at the time the worktree was created.
- **Working tree:** clean at creation; this document is the only file created.
- **Requested location and identifiers:** the task asked for `docs/plans/hardening/15-fable/review.md` with `HARD15-NNN` identifiers. That directory already exists in the primary checkout and holds the July 2026 Hardening 15 review, whose 28 `HARD15-NNN` identifiers are referenced from production comments (for example `HARD15-004` in `useRemoteInputSession.ts`). Overwriting it or reusing its identifier range would have violated the instruction to preserve existing hardening documents, so this review lives at `docs/plans/hardening/27-fable/review.md` and uses `HARD27-NNN`, the next free number after the untracked local `26/` review. Note that `docs/plans/hardening/` is ignored by `.gitignore` (line 178), so `git status` does not list this file; `git status --ignored` does.
- **Mode:** static source review only. No build, test, lint, coverage, benchmark, application launch, browser, emulator, phone, C64 device, mock server, REST, FTP, Telnet or UDP access. No subagents. No production code, tests, configuration or generated assets were changed.
- **Inputs read first:** `REVIEW.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `README.md`, `docs/architecture.md`, `docs/cta-inventory.md` (census sections 3, 5, 6, 7), `docs/internals/ios-parity-matrix.md`, `docs/advanced.md` (web deployment), and the local hardening reviews 25 and 26 (used only as a negative cache; every finding below was verified against the pinned commit, and none is carried forward).
- **Delta since the last review:** `e06c03dce..3ba8db051` (Hardening 26 to the base) was diffed by file and the new subsystems in it were read in full: app-wide search (`src/lib/search/`), the first-run tour (`src/lib/tour/`, `src/components/tour/`), the shared collapsible-section store, the latched command buses, native media buttons, the offline Home arrangement, `offlineStartup.ts`, the Lock-on subject tracker and follow camera, `AvMirrorImmersive`, the appearance styles, and the Android changes to `StreamUdpPlugin`, `BackgroundExecutionPlugin`/`Service` and `DeviceDiscoveryPlugin`.
- **Revision note:** the first issue of this document reported ten findings. The second revision added HARD27-011 to HARD27-020 from a pass over playback-time config writes, the request gateway's abort handling, the iOS plugin bodies, the web server, discovery, and the Live View foreign-sender guard, and rewrote the security stance for a device without TLS (section 2.1). The third revision adds HARD27-021 to HARD27-040 from the Live View lifecycle, navigation guards, the web login and proxy host policies, persistence stores, startup, the test-environment bypass of the device-safety gateway, and a maintainability census, and re-weights the security items for the stated usage model (a single user on their own home network).

### Severity and confidence definitions

Severity follows the calibration in `REVIEW.md`:

- **P1 (Critical class):** can take the device offline or corrupt its config; data loss; secret exposure beyond what the device's own protocol already exposes; a lock-out; or a shipped platform feature that cannot work as documented.
- **P2 (Warning class):** a user-visible failure or incorrect behaviour on a real flow; a missing native/web/iOS fallback that produces an error where a sibling platform works; a control or state that cannot recover without a restart; a request pattern that can breach the single-connection model the firmware needs.
- **P3 (Nit-plus):** bounded impact on diagnosability, resilience or hardening; worth fixing before the platform is called production-ready but not release-blocking on its own.

Confidence:

- **High:** the failure follows from the code as written; no runtime precondition beyond ordinary use.
- **Medium:** the code path is certain, but how often the precondition occurs in the field could not be settled statically and needs device or platform validation.
- **Low:** plausible, not demonstrated; recorded as a hypothesis rather than a finding.

## 2. Verdict

**Android is close to production-ready; the web platform and iOS are not, for reasons that follow from the code rather than from missing validation.**

The Android application, which is the release target, has been through 26 hardening rounds and the core paths (connection lifecycle, config writes over `PUT`, the native A/V pipeline, remote input, background playback, HVSC ingestion) are defensively written and consistent with the hazards in `REVIEW.md`. This review found no Android defect that takes the device offline on its own. The Android items that matter most are one path that can persist transient playback state into the device's flash configuration when an opt-in setting is on (HARD27-011), one path that can open a second concurrent connection to the wedge-prone firmware after an aborted request (HARD27-014), a Live View that has no lifecycle policy at all — it keeps the phone receiving and the Ultimate multicasting after the app is hidden or killed (HARD27-021) — a destructive recovery policy in the password store (HARD27-004), an invisible failure mode in the Live View sender filter (HARD27-005), and the media-session, audio-focus and notification gaps (HARD27-006, HARD27-007, HARD27-019, HARD27-040).

The most important risks, in order:

1. **HARD27-001 (P1, web):** entering a device password in the self-hosted web app, which the README and manual instruct the user to do, stores the app's per-device JSON envelope as the web server's network password. From then on the server sends that JSON string to the C64U as `X-Password` and as the FTP password (every proxied call is rejected), and the login page requires the JSON string. After the 24-hour session expires or the container restarts the user is locked out until they edit `/config/web-config.json` by hand. This is a functional defect in how the password is stored, not a transport-security issue.
2. **HARD27-029 / HARD27-030 / HARD27-027 (P2–P3, web):** the web platform's login flow, proxy host policy and Demo Mode each fail in ways that end in the device password dialog or a raw JSON page, for ordinary configurations (a device named `u64`, a second Ultimate, a tab left open overnight, Demo Mode on).
3. **HARD27-011 (P2, all platforms):** the playback-time mixer writes (volume override, pause mute, restore) are transient by design but are indistinguishable from user configuration to the "Keep device settings after a restart" mechanism, so with that setting on they are written to the device's flash 1.5 s after each write, and a process kill mid-playback leaves the override as the device's persisted configuration.
4. **HARD27-021 (P2, Android):** Live View keeps running after the app is hidden and leaves the Ultimate streaming after the app is killed; nothing keeps the screen on while it is watched.
5. **HARD27-002 / HARD27-003 / HARD27-012 / HARD27-013 / HARD27-018 (P2–P3, iOS):** Live View, folder import, large FTP reads, Telnet reconnection and HVSC ingestion on iOS each diverge from Android in a way that produces an error or a resource exhaustion rather than a deliberate degradation, while the parity matrix and architecture document record parity.
6. **HARD27-036 (P3, test confidence):** the device-safety gateway — the code that protects the repository's first-ranked hazard — is disabled in every automated environment, including the APKs the hardware merge gate runs.
7. **HARD27-004 (P2, Android, medium confidence):** the Android secure-storage plugin answers any read exception by deleting the encrypted preferences file and the Keystore master key, and the TypeScript layer then persists the now-empty password set durably. Whether transient Keystore read failures occur on the shipped device population is the most important unresolved static uncertainty in this review.

### 2.1 Security stance under a device that cannot speak TLS

The C64 Ultimate family exposes HTTP, FTP and Telnet only; there is no TLS on the device and no way to add one. Every finding and recommendation in this document is calibrated against that fact, so that the stance is neither pretend-strict nor needlessly lax:

- **Accepted, by necessity:** the device password crosses the LAN in the clear on every REST call (`X-Password`), FTP login and Telnet login; the LAN is therefore the trust boundary, and anyone who can sniff it can read the password. Nothing in the app can change that, and no finding treats it as a defect. The Docker web server likewise proxies to the device in the clear.
- **Still required, and enforceable in the app:** the password must not travel further than the device and the user's own trusted web server. Three findings are about exactly that widening: the REST proxy attaching the device password to any private-range host a client names (HARD27-016), the plaintext config file being world-readable on the Docker host (HARD27-015), and the web login limiter being defeatable by a spoofed header (HARD27-008). None of them would be worth raising if the wire were encrypted; all of them matter more because it is not.
- **At rest:** Android Keystore and iOS Keychain remain the right stores; the finding against the Android plugin (HARD27-004) is about a destructive recovery policy, not about the choice of store.
- **Logs and exports:** verified clean. Secrets are redacted at trace-record time (`traceSession.ts:183-201`), never logged (grep of every `addLog`/`addErrorLog` site), and the diagnostics export ships hosts, addresses and paths but no credentials. Capacitor's native logger is disabled (`capacitor.config.ts`, `loggingBehavior: "none"`) so the `X-Password` header does not reach logcat.
- **The web app's own front door can be encrypted even though the device cannot:** `docs/advanced.md:12` already recommends an HTTPS reverse proxy. The server derives HSTS from `X-Forwarded-Proto` but not the cookie `Secure` flag (`WEB_COOKIE_SECURE`, manual), and trusts `X-Forwarded-For` unconditionally. A single `WEB_TRUST_PROXY` switch that governs both would make the proxied and unproxied deployments each correct by default; this is recorded under HARD27-008 rather than as a separate finding.
- **Usage model, as stated by the maintainer:** a single user, on their own home network, with a device that only they use. Under that model the three server-hardening items (HARD27-008, HARD27-015, HARD27-016) are retained because each is a small, fixable widening and none costs the user anything, but they are ranked last in the plan and none of them blocks a release; HARD27-009 and HARD27-017 stay because they are robustness defects (a hung device or a large file takes the server down) rather than security ones. Nothing in this document asks for a measure the device's lack of TLS would make pointless.
- **Not recommended:** any measure that would degrade the LAN experience without a security gain, such as refusing plain-HTTP device hosts, forcing web login when no password is configured, or expiring sessions aggressively. The device is reachable in the clear regardless.

## 3. Coverage map

| Surface | Files read (representative) | Depth | Limitation |
| --- | --- | --- | --- |
| App shell, routing, navigation | `src/App.tsx`, `src/main.tsx`, `SwipeNavigationLayer.tsx`, `TabBar.tsx`, `src/lib/navigation/*` | Full | — |
| Connection lifecycle | `ConnectionController.tsx`, `connectionManager.ts`, `offlineStartup.ts`, `deviceRetarget.ts`, `useSavedDeviceSwitching.ts`, `useC64Connection.ts`, `c64PollingGovernance.ts` | Full | — |
| REST client and gateway | `c64api.ts` (request gateway, transport, abort handling, config writes, streams, memory, machine input), `c64api/requestRuntime.ts`, `deviceInteractionManager.ts` (REST/FTP gates), `deviceSafetySettings.ts`, `configFlashPersistence.ts` | Full for the request path; per-endpoint helpers skimmed | Trace recorders read for redaction only |
| Secure storage and auth | `secureStorage.ts`, `native/secureStorage*.ts`, `SecureStoragePlugin.kt`, iOS `SecureStoragePlugin`, `auth/*`, `DeviceAuthChallengeDialog.tsx` | Full | — |
| Saved devices and discovery | `savedDevices/store.ts` (first 420 lines), `resolvedTarget.ts`, `discoveryManager.ts`, `DeviceDiscoveryInterstitial.tsx` (hooks), `DeviceDiscoveryPlugin.kt` | Full for the paths cited | Store mutation helpers after line 420 skimmed |
| Streams / Live View | `streamReceiver.ts`, `avMirrorSession.ts`, `audioMirrorController.ts`, `videoMirrorController.ts`, `streamArrivalWatchdog.ts`, `foreignSenderGuard.ts`, `audioNativeSink.ts`, `useMirrorViewport.ts`, `AvMirrorImmersive.tsx` (effects), `StreamUdpPlugin.kt`, `AudioPipeline.kt`, `streamBridge.ts` | Full | `subjectTracker.ts` read for call shape and loop bounds only |
| Playback | `playbackRouter.ts`, `localSidNativeSink.ts` (open, pump, reopen), `activePlaybackSession.ts`, `playbackSessionPersistence.ts`, `backgroundExecutionPolicy.ts`, `useVolumeOverride.ts` (write lanes), `pauseMuteCapture.ts`, `usePlayDeepLinks.ts`, `PlayFilesPage.tsx` (background-execution and auto-skip effects), `usePlaybackController.ts` (effects, auto-advance guard, skip coalescing) | Targeted | The 2,500-line controller was read at its effects and guards, not line by line |
| Background execution | `backgroundExecution*.ts`, `notificationPermission.ts`, `BackgroundExecutionPlugin.kt`, `BackgroundExecutionService.kt`, `MainActivity.kt`, `AndroidManifest.xml` | Full | — |
| Remote input | `useRemoteInputSession.ts`, `kernalFallbackInjector.ts`, `machineInputThrottle.ts`, `activeInputRelease.ts`, `gameModeLaunch.ts`, `latchedCommandBus.ts`, `nativeMediaButtons.ts` | Full | Keyboard layout tables not re-audited |
| FTP | `ftp/ftpClient.ts`, `native/ftpClient*.ts`, `ftpSourceAdapter.ts` (recursive path), `addFileSelections.ts` (songlengths read), `FtpClientPlugin.kt`, `IOSFtp.swift` (method surface, `readFile`, `readAllBytes`, timeout resolution) | Full | — |
| Telnet | `telnetClient.ts`, `telnetSession.ts`, `telnetConfig.ts`, `useTelnetActions.ts` (session release), `TelnetSocketPlugin.kt`, `TelnetSocketPlugin.swift` (`readAvailableBytes`, `isConnected`), health-check telnet policy | Full | Screen parser and menu navigator not re-audited |
| HVSC | `hvscIngestionRuntime.ts` (install, cancel, finally), `hvscReleaseService.ts` (URL), `HvscIngestionPlugin.kt` (ingest, promotion, 7-Zip resolution), `HvscArchiveExtractor.kt` (path guards), `HvscIngestionPlugin.swift` (`ingestHvsc`) | Targeted | Browse index and hydration not re-audited |
| Config UI | `useInteractiveConfigWrite.ts`, `useDeviceBoundSlider.ts` (first 330 lines), `useLightingStudio.tsx` (write path), `useAppConfigState.ts` (keying), `appConfigStore.ts`, `ConfigBrowserPage.tsx` (effects) | Targeted | — |
| Search, tour, sections | `search/navigate.ts`, `configDeepLink.ts`, `handlers.ts`, `tour/tourState.ts`, `collapsibleSectionStore.ts`, `offlineArrangement.ts`, `useOfflineArrangement.ts` | Full | `SearchOverlay.tsx` and `TourDriver.tsx` not read line by line |
| Diagnostics and logging | `logging.ts`, `exportRedaction.ts`, `diagnosticsExport.ts`, `tracing/traceSession.ts` (redaction), `native/diagnosticsBridge.ts`, `DiagnosticsBridgePlugin.kt`, `AppLogger.kt` (broadcast scoping) | Targeted | Health-check engine read for context policies only |
| Web server | `web/server/src/*` (all), `web/Dockerfile`, `proxy/server.mjs` (size only) | Full | — |
| iOS | `NativePlugins.swift`, `AppDelegate.swift`, `IOSFtp.swift`, `TelnetSocketPlugin.swift`, `HvscIngestionPlugin.swift` (`ingestHvsc`) | Plugin registration, method surface, the bodies named | Remaining Swift bodies not audited |
| Feature flags and variants | `featureFlags.ts`, `variants/variants.yaml`, `variants/feature-flags/*.yaml`, `capacitor.config.ts`, `android/variables.gradle`, `android/app/build.gradle` (7-Zip packaging), `network_security_config.xml`, backup rules, `scripts/validate-release-artifact.mjs` (16 KB check) | Full | Generated registry not re-derived |
| Tests | Read where needed to confirm intent or absence of coverage: `secureStorage.test.ts`, `secureStorage.web.test.ts`, `webServer.test.ts`, `webPlatformAuth.spec.ts` | Targeted | Test suites were not run |

CTA census: `docs/cta-inventory.md` section 3 counts 117 (+4) Home, 87 (+12) Settings, 31 (+38 conditional) Play, 30 Config, 28 (+1) Disks, 18 Docs, plus the search, tour and Key Explorer overlays added since. The routes were confirmed against `src/lib/navigation/tabRoutes.ts` (six tabs, `/settings/open-source-licenses`, `/diagnostics/*` folded into Settings) and `src/App.tsx` (probe routes bundled only outside production or under `VITE_ENABLE_TEST_PROBES`). Flows sharing an implementation were reviewed as a group: every config-backed control goes through `useInteractiveConfigWrite`/`useDeviceBoundSlider` and `updateConfigBatch`; every FTP consumer goes through `ftp/ftpClient.ts` and `withFtpInteraction`; the two device-switch paths (`executeSavedDeviceSwitch`, `prepareForDeviceRetarget`) were compared explicitly because they are not the same implementation (HARD27-010).

## 4. Findings index

| ID | Severity | Confidence | Platform | Summary |
| --- | --- | --- | --- | --- |
| HARD27-001 | P1 | High | Web | The per-device password envelope is stored verbatim as the web server's network password, breaking device auth and locking the user out of the web login |
| HARD27-002 | P2 | High | iOS | Live View builds the Android-only `StreamUdp` receiver on iOS: unhandled promise rejection, then a generic error state |
| HARD27-003 | P2 | High | iOS | Three TypeScript bridge methods have no iOS implementation (`FtpClient.listDirectoryRecursive`, `FtpClient.cancelRead`, `DeviceDiscovery.getNetworkStatus`); the parity matrix says Parity |
| HARD27-004 | P2 | Medium | Android | `SecureStoragePlugin` deletes the encrypted preferences and the Keystore master key on any read exception, and the TypeScript layer then persists the emptied password set |
| HARD27-005 | P2 | Medium | Android | The Live View sender filter is keyed to the REST host and its rejections are invisible to the app, so a mismatch reads as "stream stopped arriving" |
| HARD27-006 | P3 | High | Android | Neither native audio sink handles audio focus; the one focus request the app makes has a no-op loss listener |
| HARD27-007 | P3 | High | Android | Pausing playback stops the foreground service and releases the `MediaSession`, so headset and lock-screen Play cannot resume |
| HARD27-008 | P3 | High | Web | The login rate limiter is keyed on the client-controlled `X-Forwarded-For` header; proxy trust is not a single switch |
| HARD27-009 | P3 | High | Web | Request bodies and FTP read responses are buffered without a size limit, including before authentication |
| HARD27-010 | P3 | High | All | The automatic reachable-saved-device fallback switch does not stop the A/V mirror, unlike the canonical switch, so Live View stays bound to the old device |
| HARD27-011 | P2 | High | All | Playback-time mixer writes are treated as user configuration by the flash-persist mechanism, so an opt-in setting flashes transient volume state and a kill mid-playback persists it |
| HARD27-012 | P2 | High | iOS | iOS FTP reads apply a whole-transfer deadline of 1–60 s and treat the "no idle timeout" value as 1 s, so multi-MB reads (songlengths import) fail; iOS FTP and folder reads have no size bound |
| HARD27-013 | P3 | High | iOS | The iOS Telnet plugin returns an empty read at EOF instead of signalling closure, so the HARD20-006 reconnect path never triggers on iOS |
| HARD27-014 | P2 | Medium | Android | An aborted request frees the native single-connection lane while the native HTTP call is still open, so the next request runs concurrently against the wedge-prone firmware |
| HARD27-015 | P3 | High | Web | `web-config.json`, which holds the device password in plaintext, is written with default permissions on the Docker volume |
| HARD27-016 | P3 | High | Web | The REST proxy attaches the device password to any private-range host named in `X-C64U-Host`, while the FTP handlers restrict to the configured device |
| HARD27-017 | P3 | High | Web | The REST proxy's upstream `fetch` has no timeout or abort, so a hung device holds server resources indefinitely |
| HARD27-018 | P2 | Medium | iOS | iOS HVSC ingestion loads and extracts the whole archive in memory and clears the existing library before extracting; the architecture document records it as streaming and staged |
| HARD27-019 | P3 | High | Android | The foreign-sender eviction sends an unauthenticated stop to the other Ultimate; a password-protected one answers 403, which raises the app's password dialog for a device the user did not select |
| HARD27-020 | P3 | High | Android | Device discovery probes port 80 only, so a saved device on a custom HTTP port is never found by the hostname or LAN-scan fallback |
| HARD27-021 | P2 | High/Medium | Android | Live View has no lifecycle policy: it keeps receiving and playing after the app is hidden, leaves the Ultimate streaming after a kill, and never keeps the screen on |
| HARD27-022 | P3 | High | All | The navigation guard is inert under React Router 6.30's `BrowserRouter`; the "leaving stops the import" prompt never appears for tab, swipe or keypad navigation |
| HARD27-023 | P3 | High | All | Reference documents drift: the CTA inventory misses controls added in the last two rounds; the architecture stack line names Capacitor 6 and Vite 5 |
| HARD27-024 | P3 | High | All | Three copies of the discovery probe in `connectionManager.ts` with diverging failure classification |
| HARD27-025 | P3 | High | All | The saved-devices envelope is re-parsed by hand in the FTP and Telnet port resolvers; the private-LAN host rules exist three times with different answers |
| HARD27-026 | P3 | High | All | Twenty-seven source files exceed the size `REVIEW.md` §9 sets, with no documented reason |
| HARD27-027 | P3 | High | Web | Demo Mode is offered on web but has no simulated device; enabling it targets the unreachable real host while the badge says Demo |
| HARD27-028 | P3 | Medium | Android, iOS | HVSC install holds no wake lock, cannot resume a download, and checks memory but not disk space |
| HARD27-029 | P2 | High | Web | An unauthenticated visit to the root returns raw JSON instead of the login page; an expired session is presented as the device's password prompt |
| HARD27-030 | P2 | High | Web | The proxy refuses legitimate LAN host names (`u64`, `*.lan`) and limits FTP to the default device, so a second Ultimate fails with a password prompt |
| HARD27-031 | P3 | High | Web | The static server has no MIME type for `.wasm`, so the SID engine falls back from streaming compilation with a console error |
| HARD27-032 | P3 | High | Android, iOS | The playback session behind the "Last" tile and "Resume session" lives in `sessionStorage` and does not survive process death |
| HARD27-033 | P3 | High | Web | The app injects a Google Fonts stylesheet that the server's own CSP blocks; fonts never load and every page load logs a violation |
| HARD27-034 | P3 | High | All | Dead or inert code paths kept green by tests: a second toast system mounted, an unused export-redaction path, an uncalled `setExpectedSource`, a blocked iOS chunk reader |
| HARD27-035 | P3 | High | All | Six silent `catch` sites contravene `REVIEW.md` §7 |
| HARD27-036 | P3 | High | All | The device-safety gateway is switched off in every automated environment, including the test-probe APKs the hardware merge gate runs |
| HARD27-037 | P3 | High | All | A saved device cannot be renamed or have its ports edited while it is unreachable; the save waits out a probe and a LAN scan and then refuses |
| HARD27-038 | P3 | High/Medium | All | Every tab transition mounts the departing and arriving pages in full (open since Hardening 12) |
| HARD27-039 | P3 | Medium | All | The keypad focus engine scans the DOM on every mutation for touch users who never use keys |
| HARD27-040 | P3 | High | Android | The background-playback notification is static and the media session carries no metadata, so the lock screen offers no title or transport |

Totals: 1 × P1, 11 × P2, 28 × P3.

## 5. Detailed findings

### HARD27-001 — Web: the per-device password envelope becomes the server's network password

**Severity:** P1. **Confidence:** High. **Platform:** self-hosted web (Docker image). Android and iOS are unaffected because their `SecureStorage` plugins treat the value as an opaque string.

**Locations**

- `src/lib/secureStorage.ts:65` — `serializePasswordState` is `JSON.stringify(state)`.
- `src/lib/secureStorage.ts:98-107` — `persistPasswordState` calls `SecureStorage.setPassword({ value: serializePasswordState(state) })` (line 106). The same envelope is written at lines 172 (`clearPasswordForDevice`) and 189 (`setPassword` with no selected device).
- `src/lib/secureStorage.ts:141-152` — `setPasswordForDevice`, the function every UI password entry reaches (`SettingsPage.tsx:816`, `SettingsPage.tsx:980`, `DeviceAuthChallengeDialog` via `authChallengeController.ts`, `DeviceDiscoveryInterstitial.tsx:147/189/278/297`, and `updateC64APIConfig` at `c64api.ts:3214` via `storePassword`).
- `src/lib/native/secureStorage.web.ts:16`, `47-56` — in web platform server mode (`VITE_WEB_PLATFORM=1`, set by `web/Dockerfile:30`) `setPassword` PUTs `{ value }` to `/api/secure-storage/password` unchanged.
- `web/server/src/index.ts:575-590` — the PUT handler stores `normalizePassword(payload.value)` as `config.networkPassword` (line 583) and writes it to `/config/web-config.json`.
- `web/server/src/index.ts:268` — the REST proxy sends `config.networkPassword` as `X-Password` on every proxied device call.
- `web/server/src/index.ts:329, 384, 431, 481` — the four FTP handlers use `config.networkPassword` as the FTP password.
- `web/server/src/index.ts:542-549` — `/auth/login` compares the typed password with `config.networkPassword` using `safeCompare`.
- `README.md:61` and `docs/advanced.md:21` — document that the user configures the network password under **Settings > Device > Network password** and that the server injects it into proxied requests.

**Trigger and observable failure**

1. A user runs the Docker image, opens the web app and, following the README, enters the C64U network password under Settings > Device. `performSaveDevice` calls `setPasswordForDevice(selectedSavedDevice.id, effectivePassword)` (`SettingsPage.tsx:816`).
2. `persistPasswordState` serialises `{"version":1,"legacyDefaultPassword":null,"passwordsByDeviceId":{"<id>":"<password>"}}` and `SecureStorageWeb.setPassword` PUTs that string to the server.
3. The server stores the JSON string as `networkPassword`. Because the browser was unauthenticated, the PUT also issues a session cookie (`index.ts:586`), so the current tab keeps working for up to 24 hours (`SESSION_TTL_MS`).
4. Every subsequent proxied REST call carries `X-Password: {"version":1,...}`. A password-protected C64U answers 403; the app raises the auth-challenge dialog; submitting the correct password repeats steps 1–3 with the same result. FTP browsing and playback uploads fail the same way.
5. After the session expires, the container restarts (sessions are in memory, `authState.ts:45`), or another browser is used, `/auth/status` reports `requiresLogin: true` and the login page accepts only the JSON string, which the user has never seen. Recovery requires editing `/config/web-config.json` or setting `C64U_NETWORK_PASSWORD` and deleting the file.

The same outcome is reached from the auth-challenge dialog, from the discovery interstitial's password field, and from `migrateLegacyDefaultPassword` (`secureStorage.ts:239-263`) if the browser's `c64u_has_password` flag is set while the server still holds a plain password: the migration rewrites the plain value as an envelope on the next launch.

**Why existing guards and tests do not prevent it**

- The plugin contract in `src/lib/native/secureStorage.ts` is "opaque string"; both native plugins honour that, and the web adapter forwards it. Nothing in the TypeScript layer knows that the web server needs one plaintext password.
- `tests/unit/lib/native/secureStorage.web.test.ts` asserts the adapter PUTs whatever string it was given (`"server-secret"`), and `tests/unit/secureStorage.test.ts:143` asserts that the TypeScript layer writes the JSON envelope. Each test is correct in isolation; nothing composes them.
- `tests/unit/web/webServer.test.ts:267-272` and `playwright/webPlatformAuth.spec.ts:206-208` set the password by calling the server API with a plain string, bypassing the app's password path entirely, so the web E2E stays green.
- `git log -S passwordsByDeviceId` shows the envelope arrived with the device switcher (#206) and was hardened in #267 and #299; the server's secure-storage endpoint predates it and was never adapted.

**Root cause:** two sources of truth for "the password" on the web platform. The app stores a multi-device envelope; the server stores exactly one plaintext password that it uses for three purposes (device `X-Password`, FTP login, web login). The adapter between them does no translation.

**Implementation direction (alternatives are real):**

- **A (recommended):** keep the server contract as "one plaintext password". In `secureStorage.ts`, branch on web server mode: `persistPasswordState` sends `resolvePasswordForDevice(state, selectedDeviceId)` (or `null` → DELETE) and keeps the envelope in `localStorage` for multi-device bookkeeping. On read, the server value is treated as the selected device's password. This preserves the documented server semantics and the login flow. Cost: on web, only the selected device's password lives on the server; a switch to another saved device with a different password must re-send.
- **B:** teach the server the envelope: parse it, pick the selected device (which the server does not know) — rejected as the worse design because it couples the server to the app's storage schema and still leaves the login password ambiguous.
- **C:** disable per-device passwords on web and store a single plaintext password. Simplest, but the device switcher exists on web too.
- In all cases the server should refuse a value that parses as the envelope (`normalizePassword` rejecting `{"version":1,...}`) so a regression fails loudly instead of locking the user out.

**Regression evidence to add**

- Unit (fails today): with `VITE_WEB_PLATFORM=1` stubbed, `setPasswordForDevice("dev-1", "secret")` must result in `fetch("/api/secure-storage/password", PUT, body.value === "secret")`. Today the body value is the JSON envelope.
- Server (fails today): `PUT /api/secure-storage/password` with a value that parses as the envelope returns 400.
- E2E (`playwright/webPlatformAuth.spec.ts`): set the password through the Settings UI, log out, log in with the plaintext password, and assert the proxied `/api/rest/v1/version` carries `X-Password: <plaintext>` (mock upstream records headers). Today the login fails.

**Runtime validation after the fix:** a Docker deployment against a password-protected C64U: save the password in Settings, restart the container, log in, confirm REST and FTP browsing work.

### HARD27-002 — iOS: Live View constructs the Android-only StreamUdp receiver

**Severity:** P2. **Confidence:** High. **Platform:** iOS.

**Locations**

- `src/lib/streams/streamReceiver.ts:384-386` — `createStreamReceiver` returns `new NativeUdpStreamReceiver(options)` whenever `isNativePlatform()` is true.
- `src/lib/streams/streamReceiver.ts:232, 241` — the constructor pushes `StreamUdp.addListener(...)` promises into `this.listeners` without a rejection handler; `:256-261` calls `StreamUdp.bind`.
- `src/lib/native/streamUdp.ts` — `registerPlugin("StreamUdp")` has no web implementation and iOS registers no such plugin (`ios/App/App/AppDelegate.swift:583-592` registers ten plugins; `StreamUdp`, `DeviceRotation` and `SafeArea` are absent).
- `src/lib/streams/silenceLeftoverNativeAudio.ts:41` and `src/lib/streams/avMirrorSession.ts:365` already gate on `Capacitor.isPluginAvailable("StreamUdp")`, so the codebase knows the correct guard; the receiver factory does not use it.
- `src/pages/HomePage.tsx:1363` — the Live View card mounts when the flags are on and `deviceCapabilities.supportsStreaming` is true, with no platform gate; `LiveViewCard.tsx` and `AvMirrorControls` have none either.
- `src/App.tsx:449-470` — the global `unhandledrejection` handler records each rejection as an error-level diagnostics entry.

**Trigger and observable failure:** an iOS user connected to a U64-family device (which advertises streaming) taps the Live View Audio or Video toggle. Capacitor's `registerPlugin` proxy resolves the implementation asynchronously and, for a plugin that is neither native nor web-implemented, rejects with `"StreamUdp" plugin is not implemented on ios`. The two `addListener` promises reject with no handler attached (the only `.catch` is added later in `close()`), so the app logs "Unhandled promise rejection" as an error; `bind` rejects, `ready()` throws, and the controller reports "Could not tell the device to start streaming video/audio." The audio path first tries `NativeAudioSink.open()` (also `StreamUdp`), logs a warning, and falls back to WebAudio before hitting the same receiver failure. The toggles remain enabled and every retry repeats the sequence.

**Why existing guards do not prevent it:** `isNativePlatform()` is true on iOS; the guard that would work (`isPluginAvailable`) is applied to two neighbouring call sites but not to the factory. `docs/internals/ios-parity-matrix.md` does not list `StreamUdp` at all, so nothing records the gap.

**Root cause:** platform capability inferred from "native" rather than from plugin availability.

**Implementation direction:** in `createStreamReceiver`, choose the native receiver only when `Capacitor.isPluginAvailable("StreamUdp")`; otherwise return `UnsupportedStreamReceiver` with a reason. Attach `.catch` to the listener promises in the constructor so a late failure is logged, not unhandled. Hide or disable the Live View toggles (and the Game Mode stream starts in `gameModeLaunch.ts`) on platforms without a transport, with helper text; alternatively route iOS through the WebSocket bridge when a web server is configured, which is a product decision. Add `StreamUdp`, `DeviceRotation` and `SafeArea` rows to the parity matrix.

**Regression evidence:** a unit test with `isNativePlatform() === true` and `Capacitor.isPluginAvailable` returning false must get an `UnsupportedStreamReceiver` from `createStreamReceiver` (today it gets a `NativeUdpStreamReceiver`), and a test that the `NativeUdpStreamReceiver` constructor does not leave an unhandled rejection when `addListener` rejects (today it does).

**Runtime validation:** iOS simulator or device with a U64-family target; toggle Live View and confirm the disabled state or the bridge path, and that the diagnostics log shows no unhandled rejection.

### HARD27-003 — iOS: three bridge methods have no implementation, and the parity matrix says Parity

**Severity:** P2. **Confidence:** High. **Platform:** iOS.

**Locations**

- `ios/App/App/IOSFtp.swift:49-55` — `pluginMethods` lists `listDirectory`, `readFile`, `writeFile`, `makeDirectory`, `pingFtp`. The TypeScript contract in `src/lib/native/ftpClient.ts` also requires `listDirectoryRecursive` and `cancelRead`.
- `ios/App/App/AppDelegate.swift:370-380` — `DeviceDiscoveryPlugin` implements `discover` only. `src/lib/native/deviceDiscovery.ts` also requires `getNetworkStatus`; Android implements it at `DeviceDiscoveryPlugin.kt:96`.
- `src/lib/sourceNavigation/ftpSourceAdapter.ts:161-165` — on every native platform the recursive listing calls `listFtpDirectoryRecursive`; the JS walker on the following lines is only used on web.
- Callers: `src/pages/playFiles/handlers/addFileSelections.ts:794` (Play → Add items → folder), `src/components/disks/HomeDiskManager.tsx:1432` (Disks import from a folder), `src/lib/sourceNavigation/deepScanSearch.ts:105` (search inside a source).
- `src/lib/ftp/ftpClient.ts:318-327` — every aborted FTP read calls `FtpClient.cancelRead` and logs a rejection as an error ("FTP cancelRead failed").
- `src/lib/connection/offlineStartup.ts:52-68` — `readNativeNetworkStatus` logs "Native network status unavailable; treating connectivity as unknown" at `info` on every rejection; it is called on every foreground discovery (`connectionManager.ts:154`) and on every background probe (`connectionManager.ts:1236`), whose default cadence is 5 s (`appSettings.ts:70`).
- `docs/internals/ios-parity-matrix.md:8` — `FtpClientPlugin` is recorded as **Parity**.

**Trigger and observable failure:** on iOS, (a) selecting a folder from the Ultimate source in Play or Disks rejects with Capacitor's `"FtpClient.listDirectoryRecursive()" is not implemented on ios`, surfaced as a raw error toast rather than the web platform's JS walk or a deliberate "not available here"; (b) leaving a page while a large FTP read is in flight logs an error-level diagnostics entry every time; (c) while the app is offline or in Demo Mode, the background probe writes one info entry every 5 s (backing off to 60 s after failures), the pattern `AGENTS.md` records as having previously crowded out a 500-entry log.

**Why existing guards do not prevent it:** the TypeScript side assumes the native plugin surface is uniform; there is no contract test between the TypeScript plugin interfaces and the Swift `pluginMethods` arrays, while such contract tests do exist for CI workflow shapes (`tests/unit/ci/iosMaestroWorkflowContracts.test.ts`). The Maestro iOS flows do not exercise folder import or an offline session long enough to notice the log churn.

**Root cause:** the iOS plugin surface was frozen when the TypeScript contract was smaller; the parity matrix was not updated when methods were added.

**Implementation direction:** implement the three methods in Swift (`listDirectoryRecursive` with the same depth/entry caps and `timedOut` field as Android; `cancelRead` as a bounded no-op that closes the active stream; `getNetworkStatus` via `NWPathMonitor`), or make the callers degrade: `ftpSourceAdapter` uses the JS walker when the method is unavailable, `executeFtpRead` skips `cancelRead` when unavailable, and `readNativeNetworkStatus` logs the unavailability once per session (edge-triggered) and remembers it. Update the parity matrix rows.

**Regression evidence:** a contract test that reads each Swift plugin's `pluginMethods` array and asserts it covers every method of the corresponding TypeScript interface (fails today for `FtpClient` and `DeviceDiscovery`); a unit test that `readNativeNetworkStatus` logs its unavailability at most once across repeated calls (fails today).

**Runtime validation:** iOS device or simulator against the mock server: add a folder from the Ultimate source; inspect the diagnostics log after two minutes offline.

### HARD27-004 — Android: the secure-storage plugin destroys every stored password on any read exception

**Severity:** P2 (data loss class in `REVIEW.md`; downgraded from P1 because the trigger frequency is unknown). **Confidence:** Medium. **Platform:** Android.

**Locations**

- `android/app/src/main/java/uk/gleissner/c64commander/SecureStoragePlugin.kt:133-150` — `getPassword` catches every `Exception`, calls `recoverEncryptedPrefs`, and resolves `{ value: null }` (line 142) instead of rejecting.
- `SecureStoragePlugin.kt:55-65` — `recoverEncryptedPrefs` clears the cached preferences, deletes the preferences file (`clearPrefsFile`, 67-86) and deletes the Keystore master key (`deleteMasterKey`, 88-105) for any exception, including one thrown while `EncryptedSharedPreferences.create` builds the master key.
- `src/lib/secureStorage.ts:83-96` — `loadPasswordState` treats the resolved `null` as "no passwords" and caches it with `passwordLoaded = true`.
- `src/lib/secureStorage.ts:98-107` — the next `persistPasswordState` (any password edit, `clearPasswordForDevice`, or `migrateLegacyDefaultPassword`) writes the empty set durably. `getPasswordForDevice` (`:124-136`) also clears each saved device's `hasPassword` flag as it is asked.

**Trigger and observable failure:** any exception from `EncryptedSharedPreferences.create` or `getString` on a read. The androidx security-crypto library is known to throw `KeyStoreException`/`GeneralSecurityException` transiently on some devices (Keystore daemon restarts, OEM Keystore bugs after OS updates) as well as permanently on genuine corruption. Today both cases are treated as corruption: the passwords for every saved device are deleted, the master key is destroyed, and the app silently reports "no password" for each device. The user sees 403 auth challenges on the next device call and must re-enter every password. Nothing tells them the store was wiped; the plugin logs a warning only.

**Why existing guards do not prevent it:** the recovery was designed for a corrupted preferences file, where wiping is the only way forward, but it is applied to reads as well as writes and to every exception class. The TypeScript layer cannot distinguish "the plugin recovered from corruption" from "the user has no passwords" because the plugin resolves rather than rejects.

**Root cause:** a recover-by-wipe policy applied on the read path, with no exception classification and no signal to the caller.

**Implementation direction:** on read, reject with the error (the TypeScript layer already handles rejections: `getC64API` logs "Failed to hydrate stored device password" and the sweep probes without auth); keep wipe-recovery for the write path and restrict it to corruption signatures (`AEADBadTagException`, `InvalidProtocolBufferException`, `GeneralSecurityException` from `create` on a second attempt after a short retry). Before deleting, rename the preferences file to a `.corrupt-<timestamp>` sibling rather than unlinking it. Consider an explicit user-facing notice when recovery does run. Two smaller points to fold in: `setPassword` (`:108-131`) commits with `apply()`, so a process death within the flush window loses a password the user just typed while the app already reported success; `commit()` is the right call for a value this small. An alternative is to migrate off the deprecated `androidx.security.crypto` library to a Keystore-backed AES-GCM wrapper stored in plain `SharedPreferences`, which removes the library's known transient failure modes; that is an invasive change and should be scheduled separately.

**Regression evidence:** an Android JVM test with `encryptedPrefsFactory` throwing `KeyStoreException` once: `getPassword` must reject (today it resolves `null`) and must not call `clearPrefsFile`/`deleteMasterKey`; a second test with a corruption exception on `setPassword` may still recover. A TypeScript test that a rejected `SecureStorage.getPassword` leaves `passwordLoaded` false so a later `persistPasswordState` does not write an empty envelope (today `loadPasswordState` rethrows, which is correct; the test guards it).

**Runtime validation:** cannot be induced on the bench without root; rely on the unit tests and on field diagnostics (the recovery warning is already logged).

### HARD27-005 — Android: the Live View sender filter is keyed to the REST host and hides its rejections

**Severity:** P2. **Confidence:** Medium (the code path is certain; the precondition needs a dual-homed device to confirm). **Platform:** Android.

**Locations**

- `src/lib/streams/avMirrorSession.ts:252, 292` — both receivers are created with `expectedSource: getC64API().getDeviceHost()`, the REST host.
- `src/lib/streams/streamReceiver.ts:261` — passed to `bind` as `source`.
- `android/.../StreamUdpPlugin.kt:214-233` — `applyExpectedSource` resolves the host with `InetAddress.getByName` (line 222) and stores one `InetAddress`.
- `StreamUdpPlugin.kt:239-248` — `isForeign` drops any packet whose source differs, logging to logcat only (first packet, then every 5,000).
- `StreamUdpPlugin.kt:103` — `rejectedPackets` is counted but never included in `audioStatsPayload` (414-452) or the `videoframe` events; `StreamUdp.setExpectedSource` (line 204) has no JavaScript caller.
- `src/lib/streams/streamArrivalWatchdog.ts:10` — after 8 s without an accepted packet the controllers report "The video/audio stream stopped arriving."

**Trigger and observable failure:** the Ultimate's multicast stream leaves the interface the firmware routes it through (the wired port, per the firmware note in `StreamUdpPlugin.kt:49-52`). If the app's saved host resolves to a different address of the same machine — a C64 Ultimate with both Wi-Fi and Ethernet connected where the router's DNS answers the Wi-Fi lease for `c64u`, or a user who typed the Wi-Fi IP — every packet is foreign. The device is told to start streaming, the socket receives at full rate, the plugin drops everything, and 8 s later the card shows "The video stream stopped arriving." with no hint that packets are arriving from another address. The user is sent to check the C64 and the cable. Toggling repeats the outcome.

**Why existing guards do not prevent it:** the filter fails open only when the name does not resolve. `foreignSenderGuard.ts` handles the opposite case (a second Ultimate) by asking it to stop, using the `senders` list, but the eviction logic runs only when two senders are seen; a single foreign sender that is actually the selected device is never reported. The feature was verified on a bench where the REST host and the stream source were the same address.

**Root cause:** the filter identity ("who should I hear from") is derived from the control-plane host instead of being learned from the stream, and the plugin does not report what it rejects.

**Implementation direction:** export `rejectedPackets` and the last rejected source address in `audioStatsPayload` and in a periodic `videoframe`/stats field; in the controllers, when accepted packets are zero but rejected packets are climbing, report "Packets are arriving from <ip>; the app expected <host>" and offer to accept that sender (or auto-adopt it when exactly one sender is seen and the REST host is unreachable on that address). Alternatively resolve the expected source from the device's own report of its stream interface if the firmware exposes one. Keep the filter; do not remove it, because the two-sender case it fixes is real.

**Regression evidence:** an Android JVM test for `StreamUdpPlugin` (the plugin already has test seams `emitDatagram`, `clockNanos`) that binds with an expected source, feeds packets from another address, and asserts the stats payload reports the rejection count and source (today it reports nothing); a controller test that a non-zero rejected count with zero accepted packets produces the specific error rather than "stopped arriving".

**Runtime validation:** on the bench, connect the Ultimate over both interfaces, save the Wi-Fi address as the host, start Live View; confirm the diagnosis and the recovery path.

### HARD27-006 — Android: no audio-focus handling on the native audio path

**Severity:** P3. **Confidence:** High. **Platform:** Android.

**Locations**

- `android/.../BackgroundExecutionService.kt:147-155` — the only `OnAudioFocusChangeListener` in the app logs the change and does nothing.
- `BackgroundExecutionService.kt:403-470` — focus is requested only when the foreground service starts (playback on the Play page), not when the A/V mirror's audio starts, and it is abandoned in `onDestroy`.
- `android/.../AudioPipeline.kt:1037` and `StreamUdpPlugin.kt:323` — the `AudioTrack` for both the mirror and on-device playback is built and started with no focus request.
- `src/lib/audio/phoneAudioOwnership.ts` (`claimPhoneAudio`) — arbitrates only between the app's own two sources.

**Trigger and observable failure:** with Live View audio playing, or an on-device tune playing, the user starts another media app or receives a navigation prompt. Because the app never requested focus for the mirror and ignores focus loss for playback, both sources play at once; the other app is not told to duck either. Conversely, starting Live View audio does not pause the other app's music. On an incoming call the platform's own call-time policy applies, but the app does not pause and does not resume afterwards.

**Why existing guards do not prevent it:** the focus request was added for the wake-lock service and treated as a formality; the audio was moved into Kotlin later without revisiting it.

**Root cause:** audio focus is owned by the service lifecycle rather than by the audio pipeline that actually plays.

**Implementation direction:** request focus (`AUDIOFOCUS_GAIN` for playback) from `StreamUdpPlugin.openAudioTrack`, forward focus loss to JavaScript as a plugin event, and have the local engine pause and the mirror stop or mute on `AUDIOFOCUS_LOSS`, duck on `LOSS_TRANSIENT_CAN_DUCK` (the pipeline already has `setGain`), and resume on `GAIN`. Move the request out of the service, or keep the service's request and add the event.

**Regression evidence:** an Android JVM test that `openAudioTrack` requests focus and that a delivered `AUDIOFOCUS_LOSS` emits the plugin event; a TypeScript test that the event pauses the local playback controller.

**Runtime validation:** HIL with a second media app; the bench volume ceiling (10 of 25) applies.

### HARD27-007 — Android: pausing playback releases the MediaSession, so headset Play cannot resume

**Severity:** P3. **Confidence:** High. **Platform:** Android.

**Locations**

- `src/pages/playFiles/backgroundExecutionPolicy.ts:29-36` — `shouldStopBackgroundExecution` is true whenever `isPaused`.
- `src/pages/PlayFilesPage.tsx:771-800` — on pause the page stops background execution.
- `android/.../BackgroundExecutionService.kt:235, 384-399` — `onDestroy` releases the `MediaSession`, and `stop()` stops the service.
- `BackgroundExecutionService.kt:164-168` — `onPlay`/`onPause`/`onStop` are the only way a headset or lock-screen button reaches the web layer.

**Trigger and observable failure:** the user pauses a tune from the headset (works: the session is live, `playPause` is relayed), the screen locks, and they press Play on the headset. The service was stopped on pause, the session is gone, so the press reaches nothing. The same applies to the lock-screen media controls, which disappear on pause. The user must unlock the phone and press Play in the app.

**Why existing guards do not prevent it:** stopping the service on pause is deliberate (release the wake lock while nothing plays) and the media session was added later as a property of the service rather than of the playback session.

**Root cause:** the `MediaSession` lifecycle is coupled to the wake-lock lifecycle.

**Implementation direction:** keep the service alive in a paused state (foreground notification showing "Paused", wake lock released, session state `STATE_PAUSED`) for a bounded period (for example 10 minutes) before stopping, or move the `MediaSession` into a separate long-lived component held by the plugin. This is partly a product decision; the plan lists it as such.

**Regression evidence:** an Android JVM test that a pause followed by an `onPlay` callback within the grace period still broadcasts `TRANSPORT_COMMAND_PLAY`; a TypeScript test that `shouldStopBackgroundExecution` no longer returns true for a plain pause once the policy changes.

**Runtime validation:** HIL with a wired or Bluetooth headset.

### HARD27-008 — Web server: the login rate limiter is keyed on `X-Forwarded-For`, and proxy trust is not a single switch

**Severity:** P3. **Confidence:** High. **Platform:** web.

**Locations**

- `web/server/src/securityHeaders.ts:3-9` — `getClientIp` returns the first `X-Forwarded-For` value whenever the header is present, otherwise the socket address.
- `web/server/src/index.ts:535-549` — `/auth/login` uses it for `isLoginBlocked`/`recordFailedLogin` (5 failures per 10 minutes, 5-minute block).
- `web/server/src/securityHeaders.ts:20-25` — HSTS is derived from `X-Forwarded-Proto` automatically, while the cookie `Secure` flag (`authState.ts:101, 113`) depends on the manual `WEB_COOKIE_SECURE` (`index.ts:60-66`, `docs/advanced.md:27`).
- `web/Dockerfile:33-55` — the shipped image binds `0.0.0.0:8064` directly with no reverse proxy in front.

**Trigger and observable failure:** any client on the LAN sends login attempts with a fresh `X-Forwarded-For` value per request. Each attempt is counted against a different key and the block never triggers; the network password can be brute-forced at the speed of the HTTP loop. The same header would also let an attacker block a legitimate user by spoofing their address. Separately, a deployment behind the HTTPS proxy the documentation recommends gets HSTS for free but not a `Secure` cookie unless the operator also sets the env variable, so the session cookie can be replayed over the plain-HTTP port if the proxy exposes one.

**Why existing guards do not prevent it:** `safeCompare` prevents timing leaks but not enumeration. The limiter and HSTS assume a trusted reverse proxy; nothing configures that assumption, and the two proxy-dependent behaviours are switched differently.

**Implementation direction:** introduce `WEB_TRUST_PROXY=1` (documented in `docs/advanced.md`) that governs all three: trust `X-Forwarded-For`, trust `X-Forwarded-Proto` for HSTS, and set `Secure` on the cookie. Without it, key the limiter on `req.socket.remoteAddress` and emit neither HSTS nor `Secure`. Keep a global attempt budget so a spoofed key cannot escape it.

**Regression evidence:** `webServer.test.ts`: six failed logins with six different `X-Forwarded-For` values must yield 429 on the sixth (today all six return 401); with `WEB_TRUST_PROXY=1` and `X-Forwarded-Proto: https`, the login response sets a `Secure` cookie (today it does not unless `WEB_COOKIE_SECURE` is set).

### HARD27-009 — Web server: request bodies and FTP read responses are buffered without a size limit, including before authentication

**Severity:** P3. **Confidence:** High. **Platform:** web.

**Locations**

- `web/server/src/httpIO.ts:3-9` — `readBody` concatenates every chunk with no cap; `readJsonBody` (11-17) parses the result.
- `web/server/src/index.ts:542` — `/auth/login` reads the body before any authentication.
- `web/server/src/index.ts:255` (`handleRestProxy`) and the FTP write handler (`:451-467`) read bodies after authentication with the same helper.
- `web/server/src/index.ts:297-305` (`collectStream`) and the FTP read handler (`:358-403`) — the whole remote file is collected in memory and then base64-encoded into one JSON response; the Android plugin caps the same operation at 32 MiB (`FtpClientPlugin.kt:43`).

**Trigger and observable failure:** an unauthenticated LAN client streams a multi-gigabyte body to `/auth/login`; the process buffers it into memory until the container is killed. Authenticated clients can do the same through the proxy and FTP write endpoints, or request a multi-hundred-megabyte file (a disk pack or firmware image on the Ultimate's SD card) through the FTP read endpoint and hold roughly three times its size in the server's heap.

**Implementation direction:** cap `readBody` (for example 64 KiB for JSON endpoints, a separate 32 MiB limit for FTP write and REST proxy bodies to match the Android `maxReadFileBytes`), answer 413 and destroy the socket when exceeded; cap `collectStream` at the same 32 MiB and abort the FTP transfer when exceeded.

**Regression evidence:** `httpIO.test.ts`: a body one byte over the limit rejects with 413 without buffering the remainder (today it is accepted); `webServer.test.ts`: an FTP read of a mock file over the cap returns an error rather than the payload.

### HARD27-010 — The automatic reachable-saved-device fallback switch leaves the A/V mirror bound to the old device

**Severity:** P3. **Confidence:** High. **Platform:** all (Live View is Android-only in practice).

**Locations**

- `src/hooks/useSavedDeviceSwitching.ts:98` and `:110` — the canonical switch stops active playback and `avMirrorSession.stopAll()` (bounded to 1.5 s) before retargeting, and restarts the mirror on the new device after verification (`:225-238`).
- `src/lib/connection/deviceRetarget.ts:43-103` — `prepareForDeviceRetarget`, used by `tryReachableSavedDeviceFallback` (`connectionManager.ts:891`), performs the remote-input release, toast clearing, health reset, machine-execution reset, background-execution stop and query invalidation, but neither stops the mirror nor stops active playback.

**Trigger and observable failure:** Live View is running against device A. The app is backgrounded for more than 30 s or a background probe streak fails while A is briefly unreachable (Wi-Fi roam, A rebooting). The resume/manual/startup path sweeps the other saved devices, finds B reachable, and switches to B through `prepareForDeviceRetarget`. The mirror session still reads `audioLive`/`videoLive`, the receiver stays bound with A's expected source, B is never asked to stream, and after 8 s the card shows "The video stream stopped arriving." The speaker claim (`claimPhoneAudio`) remains held by the mirror until the user toggles it off. If A comes back and is still streaming to the multicast group, its frames are the ones accepted, so the picture shows A while the app says it is connected to B.

**Why existing guards do not prevent it:** `HARD19-012` introduced `prepareForDeviceRetarget` as "the same cross-device hygiene the canonical switch does" before the Live View stop/restart was added to the canonical path in the Live View device-switch work; the second path was not updated.

**Root cause:** two device-switch implementations with hand-maintained parity.

**Implementation direction:** move the mirror stop (and the `stopActivePlaybackBeforeDeviceSwitch` call) into `prepareForDeviceRetarget` and have `executeSavedDeviceSwitch` call it, so there is one pre-retarget sequence; restart the mirror after `verifyCurrentConnectionTarget` succeeds in the fallback path as the canonical path does. Alternatively, have `avMirrorSession` subscribe to the saved-device selection and stop itself when the selected device changes.

**Regression evidence:** a unit test for `tryReachableSavedDeviceFallback` with a live mirror stub asserting `stopAll` is called before `selectSavedDevice` and `startVideo`/`startAudio` after verification (today neither happens).

**Runtime validation:** on the bench with two saved devices, start Live View on one, power it off, background and resume the app, and confirm the mirror follows to the other device.

### HARD27-011 — Playback-time mixer writes are flashed as user configuration when "Keep device settings after a restart" is on

**Severity:** P2 (config-corruption class in `REVIEW.md`; the setting is opt-in and off by default). **Confidence:** High. **Platform:** all.

**Locations**

- `src/lib/c64api.ts:2405` — `updateConfigBatch(payload)` takes no options, so no caller can mark a batch as transient; `:2476` arms the flash save for every batch it sends.
- `src/lib/c64api.ts:2370` — `setConfigValue` honours `__c64uTransientConfigWrite`; the transient concept exists and is used by `launchSafety.ts:112, 129` and `healthCheckEngine.ts:773, 805, 846`.
- `src/lib/config/configFlashPersistence.ts:116-125` — `noteConfigWritten` arms a `save_to_flash` 1.5 s after the last write (`CONFIG_FLASH_SAVE_QUIET_MS`, line 41) whenever `loadPersistConfigToFlash()` is true; `appSettings.ts:923` defaults it to false; `SettingsPage.tsx:2802-2812` exposes it as "Keep device settings after a restart".
- `src/pages/playFiles/hooks/useVolumeOverride.ts:489-495, 538-545` — the playback volume override and its updates are written through `updateConfigBatch.mutateAsync` on the "Audio Mixer" category; `:769` restores the captured snapshot the same way when playback stops.
- `src/lib/deviceInteraction/pauseMuteCapture.ts:66-67` — pause mutes the SID volumes through `updateConfigBatch` (the comment requires it to stay one POST).
- `src/lib/playback/playbackSessionPersistence.ts:12` — the restore snapshot lives in `sessionStorage`, which does not survive process death on Android.

**Trigger and observable failure:** the user has turned on "Keep device settings after a restart" (a setting whose purpose is to make their mixer, LED and video tuning survive a power cycle). They start a tune with a playback volume override or pause it: the override or the mute is written to the mixer, and 1.5 s later the firmware writes it to flash. If the app is then killed by the OS, crashes, or the phone dies before playback stops, the restore write never happens and the device's persisted configuration is the override (or all SID volumes at zero after a pause mute). On the next power-up the Ultimate boots with those values, and the user's actual mixer settings are gone. Even without a kill, every pause/resume and every track with an override costs two flash writes; a long playlist session writes the config flash tens of times.

**Why existing guards do not prevent it:** the flash-persist mechanism cannot tell a user's Config-page edit from a playback-time write because both reach the device through the same batch method, and that method has no transient flag. The volume override's own restore is correct in the happy path; the persistence mechanism is what makes the unhappy path durable.

**Root cause:** a cross-cutting "persist writes to flash" policy applied at the transport layer, below the level where intent is known.

**Implementation direction:** add an options parameter to `updateConfigBatch` carrying `__c64uTransientConfigWrite`, thread it through `useC64UpdateConfigBatch`, and set it for the volume override, pause mute, and restore writes (the restore should also clear a pending transient state). Additionally, on a fresh launch, if a persisted restore snapshot exists (`hydratePlaybackSnapshot`) or a transient write is known to have been the last write, offer to restore before any flash save. Consider moving the snapshot from `sessionStorage` to `localStorage` keyed by device so a restore can run after process death.

**Regression evidence:** a unit test that `updateConfigBatch` with the transient option does not call `noteConfigWritten` (fails today: no option exists); a test on `useVolumeOverride` that its writes pass the transient option; a test that with persist-to-flash on, applying a volume override does not schedule a flash save within the quiet window.

**Runtime validation:** on the bench with persist on, start a tune with an override, force-stop the app, power-cycle the Ultimate, and read the mixer values.

### HARD27-012 — iOS: FTP reads apply a 1–60 s whole-transfer deadline, treat "no idle timeout" as 1 s, and have no size bound

**Severity:** P2. **Confidence:** High. **Platform:** iOS.

**Locations**

- `ios/App/App/IOSFtp.swift:241-244` — `resolveTimeout` clamps `timeoutMs` into `[1000, 60000]`, so `0` becomes 1 s.
- `IOSFtp.swift:596-620` — `readAllBytes` sets one `deadline = now + timeout` for the entire transfer and returns whatever arrived by then; there is no per-chunk idle timeout and no size cap.
- `IOSFtp.swift:93-132` — `readFile` uses that session timeout for the data read.
- `android/.../FtpClientPlugin.kt:97-103` — on Android `timeoutMs == 0` means "no idle timeout" and any positive value is an idle timeout, not a whole-transfer deadline; `:43` caps the read at 32 MiB.
- `src/pages/playFiles/handlers/addFileSelections.ts:170-175` — the songlengths read from the Ultimate passes `timeoutMs: 0` with a comment explaining that a truncating timeout can wedge the firmware's FTP data channel.
- `ios/App/App/NativePlugins.swift:189, 216` — the folder picker's `readFile`/`readFileFromTree` use `Data(contentsOf:)` with no bound, where Android caps at 32 MiB (`FolderPickerPlugin.kt:37`).

**Trigger and observable failure:** on iOS, adding tunes from the Ultimate with a songlengths database present reads a multi-megabyte file with `timeoutMs: 0`, which the plugin turns into a 1 s deadline; the read returns a truncated buffer or fails, and the flow reports the songlengths import as failed. Any FTP read on iOS is capped at 60 s wall time regardless of progress, so a large disk image over the c64u's slow FTP fails where Android succeeds. Selecting a very large local file through the picker loads it entirely into memory.

**Why existing guards do not prevent it:** the TypeScript contract documents `timeoutMs` semantics only in the Android plugin's comments; the Swift implementation was written to a simpler model, and no test exercises the iOS plugin.

**Root cause:** timeout semantics defined by one native implementation and not carried into the other.

**Implementation direction:** in `IOSFtp.swift`, treat `timeoutMs == 0` as no idle timeout, reset the deadline on every received chunk (idle timeout, as on Android), and add the 32 MiB cap with the same error text; apply the same cap in the folder picker reads. Document the semantics on the TypeScript interface (`src/lib/native/ftpClient.ts`) so both plugins are held to it.

**Regression evidence:** an iOS native test (the `ios/native-tests` package exists) for `resolveTimeout(0)` returning "no timeout"; a TypeScript contract note is not testable, so the Swift test is the load-bearing one.

**Runtime validation:** iOS device against a c64u with an HVSC songlengths file on its SD card: add a folder and confirm the songlengths import completes.

### HARD27-013 — iOS: the Telnet plugin returns an empty read at EOF instead of signalling closure

**Severity:** P3. **Confidence:** High. **Platform:** iOS.

**Locations**

- `ios/App/App/TelnetSocketPlugin.swift:204-241` — `readAvailableBytes` breaks out of its loop when `streamStatus == .atEnd` and returns the (empty) buffer; nothing closes the streams or reports the closure.
- `TelnetSocketPlugin.swift:116-121, 124` — `isConnected` reports `isConnectionOpen`, which does not change on EOF.
- `android/.../TelnetSocketPlugin.kt:213-215, 238` — the Android plugin closes the socket and throws "Connection closed" on EOF (HARD20-006).
- `src/lib/telnet/telnetClient.ts:129` — the TypeScript client maps that message to `CONNECTION_CLOSED`; `telnetSession.ts:252` uses the code to invalidate authentication and reconnect.

**Trigger and observable failure:** on iOS, the Ultimate drops the Telnet session (its idle reaping, a reboot, or the four-session cap being hit by another client). The next `readScreen` receives empty reads, counts three of them, and returns an empty screen; the session still believes it is connected and authenticated, so every subsequent menu action is sent into a closed socket and reports a parse failure instead of reconnecting. The Android fix for exactly this (HARD20-006) never reached iOS.

**Root cause:** a behavioural fix applied to one native implementation without a shared contract.

**Implementation direction:** on `.atEnd`, close the streams, mark the connection closed, and throw an error whose message contains "Connection closed"; alternatively return a structured `{ data, closed: true }` result that `telnetClient.ts` maps to `CONNECTION_CLOSED` on both platforms.

**Regression evidence:** an `ios/native-tests` case that a closed input stream makes `read` reject with the closure message; a TypeScript test already exists for the Android message path and can be reused.

### HARD27-014 — Android: an aborted request frees the native single-connection lane while the native call is still open

**Severity:** P2. **Confidence:** Medium (the lane release is certain; whether a second overlapping connection wedges a given firmware is the HARD-documented firmware defect and needs the bench). **Platform:** Android.

**Locations**

- `src/lib/c64api.ts:1598-1602` — `runNativeSerialized` wraps the handler in `serializeNativeDeviceRequest(handler, restMaxConcurrency)`; on CONSERVATIVE (`deviceSafetySettings.ts:136-138`, the profile for c64u 1.1.0) the limit is one in-flight connection.
- `src/lib/c64api.ts:577-590` — the lane is released in `finally` as soon as the handler promise settles.
- `src/lib/c64api.ts:1700-1706` — inside the handler, the native call is `awaitPromiseWithAbortSignal(capacitorHttpDeviceFetch(...), timedSignal.signal)`; `capacitorHttpDeviceFetch` (`:419-440`) has no abort parameter, and `awaitPromiseWithAbortSignal` (`c64api/requestRuntime.ts:90-115`) rejects on abort while the wrapped promise keeps running.
- Abort sources: React Query cancellation when the app is hidden (`useC64Connection.ts:254-270`), on a saved-device switch (`useSavedDeviceSwitching.ts:194`), on drives polling pause (`useC64Connection.ts:639`); discovery cancellation (`connectionManager.ts:412, 799, 970, 989, 1075, 1155, 1293, 1406`), whose probes carry the same abort signal.

**Trigger and observable failure:** a probe or read is in flight to the c64u (native read timeout 2.5–3 s). The user taps the health badge (manual discovery cancels the active one) or a settings change restarts discovery. The abort rejects the JavaScript promise, the lane is freed, and the new probe opens a second TCP connection while the first is still open natively for up to its timeout. On firmware without the lwIP fixes this is the concurrency pattern `docs/c64/c64u-firmware-tcp-wedge-report.md` and the comment at `c64api.ts:547-556` identify as capable of wedging the network stack until a power cycle. The app's own single-connection guarantee, which exists for this firmware, is therefore only as strong as the absence of aborts.

**Why existing guards do not prevent it:** the serialisation was designed around the JavaScript promise lifetime; the native transport was later switched to `CapacitorHttp.request` (BUG-066) to get real timeouts, and that call cannot be cancelled.

**Root cause:** lane ownership tied to a promise that can end before the underlying socket does.

**Implementation direction:** hold the lane until the native call settles regardless of the abort: run `capacitorHttpDeviceFetch` to completion in the background (`.finally(release)`) and only detach the caller's promise; or pass the timed signal into a native cancellation (Capacitor's `CapacitorHttp` has none, but a small addition to the app's own plugin, or an `OkHttp` call with `cancel()`, would). At minimum, on CONSERVATIVE, do not start the next request until the aborted native call has timed out.

**Regression evidence:** a unit test with a mocked `CapacitorHttp.request` that resolves after 200 ms: abort the first request at 50 ms and start a second; assert the second's native call does not begin before the first resolves (today it begins immediately).

**Runtime validation:** the bench c64u on firmware 1.1.0: alternate badge taps during startup discovery and watch for the wedge signature (TCP dead, ICMP alive) described in the firmware report.

### HARD27-015 — Web server: the plaintext config file is written with default permissions

**Severity:** P3. **Confidence:** High. **Platform:** web.

**Locations**

- `web/server/src/index.ts:234-241` — `saveConfig` writes `web-config.json` (which holds `networkPassword` in plaintext) with `fs.writeFile(configPath, payload, "utf8")`, the default mode 0644 under the container's umask.
- `web/Dockerfile:51, 55` — the process runs as `node` and `/config` is a volume, so the file lands on the host's bind mount readable by every local user.

**Trigger and observable failure:** any other user or container with read access to the host directory backing `/config` reads the device password. The password already crosses the LAN in the clear (section 2.1), but at rest it need not be readable by everyone on the host.

**Implementation direction:** write with `mode: 0o600` and `chmod` an existing file on load; document the volume's expected ownership in `docs/advanced.md`.

**Regression evidence:** `webServer.test.ts`: after `PUT /api/secure-storage/password`, `stat(configPath).mode & 0o777 === 0o600` (today 0o644).

### HARD27-016 — Web server: the REST proxy attaches the device password to any private-range host a client names

**Severity:** P3. **Confidence:** High. **Platform:** web.

**Locations**

- `web/server/src/index.ts:248-270` — `handleRestProxy` takes the target from `X-C64U-Host`, accepts it when `isTrustedInsecureHost` (`hostValidation.ts:32-50`: any RFC 1918, link-local, loopback, `localhost`, `c64u`, `*.local`), forwards the request to `http://<host><path>`, and sets `X-Password: config.networkPassword` (line 268).
- `web/server/src/index.ts:317, 371` — the FTP handlers only allow the configured device unless `WEB_ALLOW_REMOTE_FTP_HOSTS` is set; the REST proxy has the looser default unless `WEB_ALLOW_REMOTE_REST_HOSTS` widens it further.

**Trigger and observable failure:** an authenticated browser session (or any LAN client when no password is configured, since then no login is required) can make the server send the device password, as an `X-Password` header, to any address in the private ranges including the Docker host's loopback services. With TLS unavailable on the device the password is already exposed on the wire to a sniffer; this finding is about the server actively delivering it to hosts the operator never configured, which is the widening section 2.1 says the stance must prevent.

**Implementation direction:** apply the FTP handlers' policy: default to the configured device only (plus the saved devices the app knows, if the server is told them), and require `WEB_ALLOW_REMOTE_REST_HOSTS` to widen; never attach the password when the target is not a configured device.

**Regression evidence:** `webServer.test.ts`: a proxied request with `X-C64U-Host: 10.0.0.9` returns 403 by default (today it is forwarded with the password).

### HARD27-017 — Web server: the REST proxy's upstream fetch has no timeout or abort

**Severity:** P3. **Confidence:** High. **Platform:** web.

**Locations**

- `web/server/src/index.ts:273-277` — `fetch(target, { method, headers, body })` with no `signal`; the browser side times out and retries (`c64api.ts` request timeouts), but the server keeps the upstream socket open until the device answers or the OS tears it down.
- `web/server/src/index.ts:255` — the client's body is fully buffered before the fetch, so the request also holds that memory for the duration.

**Trigger and observable failure:** the device wedges or reboots mid-request (the half-open condition BUG-066 documents on the phone). Each browser retry opens a new upstream connection while the previous ones stay open; against the c64u this reproduces the multi-connection pattern from the server side, and the Node process accumulates sockets and buffers until the device recovers.

**Implementation direction:** pass an `AbortSignal.timeout()` sized to the app's own request timeout (the client already sends none, so a fixed 15 s bound is reasonable), and answer 504 on expiry. Consider serialising proxied requests per target host the way the app's native lane does, since the proxy is now the single connection source for the device.

**Regression evidence:** `webServer.test.ts`: a mock upstream that never responds makes the proxy answer 504 within the bound (today the request hangs until the test times out).

### HARD27-018 — iOS: HVSC ingestion loads and extracts the whole archive in memory and clears the library before extracting

**Severity:** P2. **Confidence:** Medium (memory exhaustion depends on device class; the destructive ordering is certain). **Platform:** iOS.

**Locations**

- `ios/App/App/HvscIngestionPlugin.swift:164-165` — `Data(contentsOf: archiveUrl)` reads the full `.7z` into memory and `SevenZipContainer.open(container:)` (SWCompression) decompresses every entry into memory before any file is written.
- `HvscIngestionPlugin.swift:156-158` — with `resetLibrary` (the baseline install) `clearLibrary` deletes the existing library and index before extraction starts.
- `android/.../HvscIngestionPlugin.kt` (ingest at 456 onwards) — Android streams the archive through the bundled 7-Zip executable into a staging directory and promotes it atomically (`promoteBaselineLibrary`), keeping the old library until the new one is complete.
- `docs/architecture.md:302-304` — records iOS large-archive ingest as "Native (streaming)" and baseline recovery as "Staged (planned)".

**Trigger and observable failure:** an iOS user installs HVSC. The baseline archive is tens of megabytes compressed and several hundred megabytes uncompressed across roughly sixty thousand entries; SWCompression materialises all of it as `Data` objects, so the peak footprint is the archive plus every extracted file plus the LZMA dictionary. On devices with tighter jetsam limits the process is killed during `open`, and because the previous library was already cleared the user is left with no HVSC library at all. Even when it succeeds, an interrupted install (backgrounding, a call) loses the library the same way.

**Why existing guards do not prevent it:** the Android extractor's memory budget (`enforceMemoryBudget`) and staged promotion have no iOS counterpart; the architecture table describes the intended design, not the shipped one.

**Root cause:** the iOS plugin implements the API surface but not the streaming and staging semantics that make the Android path safe.

**Implementation direction:** extract entry by entry with a streaming 7-Zip reader (SWCompression can enumerate entries without holding all data if driven that way, or use a bundled `7zz` as Android does), write into a staging directory, and promote by directory rename after the row-count check, mirroring `promoteBaselineLibrary`; until then, gate the iOS install behind a size check and keep the old library until the new one is verified. Correct the architecture table.

**Regression evidence:** an iOS native test that `ingestHvsc` with `resetLibrary` does not delete the existing library before the new one is verified (today it does).

**Runtime validation:** iOS device with the real baseline archive; observe memory and the outcome of a cancellation mid-install.

### HARD27-019 — Android: foreign-sender eviction sends an unauthenticated stop and raises the password dialog for the other Ultimate

**Severity:** P3. **Confidence:** High. **Platform:** Android (the only platform with the native sender list).

**Locations**

- `src/lib/streams/audioMirrorController.ts:127-133` — `getSignals`, polled about four times a second by the session tick, calls `evictForeignSenders` (`:309-322`), which asks each newly seen foreign sender to stop once per session.
- `src/lib/streams/avMirrorSession.ts:266` — `stopStreamAt` builds `new C64API(undefined, undefined, host)` with no password and calls `stopStream`.
- `src/lib/c64api.ts:2573-2581` — `stopStream` is a user-intent request with no `__c64uSuppressAuthChallenge`; `:1547` suppresses the challenge only for system intent; `:1079-1082` raises `notifyAuthRequired({ host })` on 401/403.
- `src/lib/auth/authChallenge.ts` (`resolveIdentity`) — an unknown host is labelled by its address, so the dialog reads "<ip> refused the request because it needs its network password."

**Trigger and observable failure:** two Ultimates share the LAN (the situation the guard exists for), and the other one is password-protected, which is the normal state for a device that has a network password at all. The eviction request is rejected with 403; the app opens "Network password required" for the other machine in the middle of Live View. Cancelling closes it, but the other machine keeps streaming; the native filter keeps the picture right, so the eviction's purpose (stop the uninvited stream and its bandwidth) is not achieved, and the dialog is the only visible outcome. If the user types that machine's password, it is saved for that machine (or as the legacy default if it is not a saved device) and the selected device's connection is re-verified (`authChallengeController.ts`), a full DISCOVERING transition for an unrelated request.

**Why existing guards do not prevent it:** the auth-challenge suppression is keyed on intent, and the eviction is dispatched as a user request from a fresh client with no credentials; the saved-device password for that host, if it exists, is not looked up.

**Implementation direction:** mark the eviction request `__c64uSuppressAuthChallenge`; when the foreign host matches a saved device, use `getPasswordForDevice` for it; on 403, log once and surface a non-modal hint in the Live View card ("Another Ultimate at <ip> is also streaming; stop it on that machine") instead of the dialog.

**Regression evidence:** a unit test for `stopForeignSenders`/`avMirrorSession` with a 403 from the foreign host asserting no `notifyAuthRequired` call (today it is called).

### HARD27-020 — Android: device discovery probes port 80 only, so a saved device on a custom HTTP port is never rediscovered

**Severity:** P3. **Confidence:** High. **Platform:** Android (the only platform with discovery).

**Locations**

- `src/lib/deviceDiscovery/discoveryManager.ts:191-200` — `buildKnownHosts` passes each saved device's bare `host`; the `httpPort` field (`savedDevices/store.ts:36`, exposed in the Settings device editor and used by the runtime target at `resolvedTarget.ts:12-13`) is not sent.
- `android/.../DeviceDiscoveryPlugin.kt:40-44` — `DiscoveryTarget.port` defaults to 80; `buildTargets` (`:165-178`) and `probeTarget` (`:280`) build `http://<host>:80/v1/info` for every known host and LAN address.
- `src/lib/deviceDiscovery/discoveryManager.ts:159` — a candidate's port is `candidate.httpPort || 80`, so even a found device is recorded on 80.
- `src/lib/connection/connectionManager.ts:858` — the saved-device sweep does use `buildDeviceHostWithHttpPort`, so only the discovery fallback (HARD18-007's DHCP recovery, the startup and settings scans) is affected.

**Trigger and observable failure:** a user has saved an Ultimate reachable on a non-default HTTP port (a port-forward or a second device behind the same address). Its address changes, or the user taps the badge to recover: the sweep fails (the stored address is stale), the hostname probe and the LAN scan both hit port 80 and miss it, and the app reports "no devices found" although the device is on the LAN. The feature that exists to recover from an address change cannot recover this device.

**Implementation direction:** pass `host:port` pairs (or a parallel `knownPorts` list) to the plugin and let `DiscoveryTarget` carry the saved port; probe the LAN on 80 and additionally on each distinct saved port; preserve the port in the candidate.

**Regression evidence:** an Android JVM test (`DeviceDiscoveryPluginTest.kt` exists) that a known host `"c64u:8080"` produces a target with port 8080 (today the host string is used verbatim and the port stays 80).

### HARD27-021 — Android: Live View has no lifecycle policy — it keeps the device streaming and the phone receiving after the app is hidden or killed, and never keeps the screen on

**Severity:** P2. **Confidence:** High for the missing handling; Medium for the exact background behaviour of the paused WebView. **Platform:** Android (the only platform with the native receiver).

**Locations**

- `src/lib/streams/avMirrorSession.ts:601-680` — `startAudio`/`startVideo`/`stopAll` are the only lifecycle entry points; the session, `audioMirrorController.ts` and `videoMirrorController.ts` subscribe to no `visibilitychange`, App-state or route event. `src/hooks/useAvMirror.ts` and `src/components/streams/AvMirrorGovernorDriver.tsx` add none either.
- `android/.../StreamUdpPlugin.kt:965` — the plugin overrides `handleOnDestroy` only; there is no `handleOnPause`/`handleOnStop`, so the receive threads, the `AudioPipeline` player thread, the `MulticastLock` and the `WIFI_MODE_FULL_LOW_LATENCY` lock all stay active while the activity is in the background.
- `android/.../MainActivity.kt:222-256` — WebView timers are kept alive in the background only while `BackgroundExecutionService.isRunning`, which Live View never starts.
- `src/lib/streams/silenceLeftoverNativeAudio.ts:38-50` — on the next launch the app closes its own sockets and audio track but never tells the device to stop streaming.
- `package.json` — no keep-awake plugin; `StreamUdpPlugin.kt`, `AvMirrorImmersive.tsx` and `RemoteInputSheet.tsx` request no `FLAG_KEEP_SCREEN_ON`.

**Trigger and observable failure:** the user starts Live View (or Game Mode, which starts it) and then presses Home, takes a call, or lets the screen time out — which happens within the system timeout while watching, because nothing keeps the screen on. The native audio keeps playing from the phone speaker with no notification and no control; the video assembler keeps encoding ~50 frames/s of Base64 into a WebView whose timers are paused; the Wi-Fi low-latency and multicast locks stay held, so the phone's Wi-Fi power-save is defeated for as long as the app process lives. If the OS then kills the process, the Ultimate is never told to stop and keeps multicasting 2.6 MB/s of video and 190 KB/s of audio onto the household Wi-Fi until a later Live View session or a device reboot; the next launch of the app silences its own side only.

**Why existing guards do not prevent it:** the playback path has a full lifecycle model (foreground service, wake lock, auto-skip watchdog, `keepWebViewPlaybackAliveDuringBackgroundExecution`); the mirror was built as a foreground-only feature and received none of it, and the arrival watchdog cannot help because JavaScript timers are paused in the background.

**Root cause:** the mirror is a native pipeline without a native lifecycle owner.

**Implementation direction:** decide the product behaviour (recommended: stop both streams on `pause`/hidden and restore them on resume if they were live, like the canonical device switch does; or run them under the existing foreground service with a "Live View" notification and keep the screen on while the immersive view is shown). On the next launch, if the device advertises an active stream target for this phone, send `streams:stop` before anything else. Add `handleOnPause`/`handleOnResume` to `StreamUdpPlugin` that pause the player and release the Wi-Fi locks.

**Regression evidence:** a session test that `document.visibilityState === "hidden"` stops both controllers and `visible` restarts the ones that were live (today nothing happens); a plugin JVM test that `handleOnPause` releases the Wi-Fi lock (today no such method exists).

**Runtime validation:** on the bench, start Live View, lock the phone, and observe the Ultimate's stream target and the phone's audio; then force-stop the app and confirm the device stops streaming on the next launch.

### HARD27-022 — The navigation guard is inert under React Router 6.30's `BrowserRouter`, so "leaving stops the import" never prompts

**Severity:** P3. **Confidence:** High. **Platform:** all.

**Locations**

- `src/lib/navigation/navigationGuards.ts:37` — `installNavigationBlocker` returns a no-op when `navigator.block` is not a function; `:70` (`useNavigationGuardBlocker`) installs nothing else.
- `package.json:210` — `react-router-dom ^6.30.6`. Since 6.4 the `BrowserRouter` navigator comes from `@remix-run/router`'s history, which has no `block` method; blocking exists only for data routers (`useBlocker`), which the app does not use.
- `src/pages/playFiles/hooks/useImportNavigationGuards.ts:10-18` — registers the guard with the text "Importing items will stop if you leave this page. Leave anyway?".
- Navigation paths that never consult the guard: `src/components/TabBar.tsx:75` (`navigate(tab.path)`), `src/components/SwipeNavigationLayer.tsx:376` (swipe commit), `src/App.tsx:270` (keypad tab jump). Only `src/lib/search/navigate.ts:100` calls `confirmNavigation()` explicitly.
- `tests/unit/navigation/navigationGuardsHook.test.tsx:28-46` — the only test of the hook injects a `navigator` with a mocked `block`, so it passes against an environment production never provides.

**Trigger and observable failure:** the user adds a large folder from the Ultimate or a local source (a walk of minutes over the c64u's FTP), taps another tab or swipes: the Play slot is replaced by a placeholder, the page unmounts, the import's abort signal fires, and the partial import is discarded with no prompt. The `beforeunload` half of the hook still works for a browser tab close on web, which is the only case where the user is warned.

**Why existing guards do not prevent it:** the hook's test exercises a model of the router that no longer exists, so the guard has been silently dead since the router upgrade and nothing failed.

**Root cause:** reliance on a removed router API, verified only through a mock.

**Implementation direction:** either route every in-app navigation through a single `navigateGuarded()` helper that calls `confirmNavigation()` (TabBar, swipe commit, keypad jump, search) or move the import to a module-level runner that survives the page (as HVSC ingestion already does) and drop the guard. Update the test to assert the production router path: render with the real `BrowserRouter` and assert the guard fires on a `TabBar` click (today it cannot).

### HARD27-023 — The reference documents drift from the code: the CTA inventory misses controls added in the last two rounds and the architecture stack line is two major versions stale

**Severity:** P3 (maintainability and the accessibility contract in `REVIEW.md` §5). **Confidence:** High. **Platform:** all.

**Locations**

- `docs/cta-inventory.md` — controls present in source but absent from the inventory, sampled from files changed since Hardening 26: `live-view-stop` (`LiveViewCard.tsx`), `hvsc-stop`, `connection-actions-toggle`, `connection-edit-save`, `diagnostics-connection-details-action`, `diagnostics-manage-devices-action`, `open-config-drift-screen`, `key-explorer-action`, the Soft-IEC drive controls (`drive-mount-toggle-soft-iec`, `drive-power-toggle-soft-iec`, `drive-reset-soft-iec`, `drive-status-toggle-soft-iec`), and the Lighting Studio dialog's controls (`lighting-profile-save`, `lighting-profile-apply`, `lighting-profile-delete`, `lighting-apply-city`, `lighting-apply-manual-coordinates`, `lighting-circadian-toggle`, `lighting-quiet-launch-toggle`, and others). A mechanical comparison found 456 of 690 `data-testid` values in `src/pages` and `src/components` unmentioned; many are non-interactive, but the ones listed are buttons and toggles.
- `docs/cta-inventory.md:887-913` (section 6, "Known findings") — still lists a Diagnostics device-line long-press with no keypad equivalent; no long-press handler exists in `src/components/diagnostics/` any more (the only long-press left is the badge's device switcher, which has a keypad `#`).
- `docs/architecture.md:13` — "React Router 6, Vite 5, Capacitor 6"; `package.json:223, 261` ship Capacitor 8.5 and Vite 6.4. The same document's HVSC table is addressed in HARD27-018 and the iOS parity matrix in HARD27-002/003.

**Trigger and observable failure:** a keypad-only user on the small handset relies on the inventory as the statement of what is reachable; a control missing from it is, per `REVIEW.md` §5, "treated as unverified". A maintainer reading `architecture.md` plans against the wrong Capacitor major (the 6→8 migration changed plugin registration and the HTTP plugin behaviour this app depends on).

**Implementation direction:** regenerate section 4 of the inventory from the source (the harness described in section 7 of the inventory exists) and add a CI check that every `data-testid` on a `button`, `input`, `select` or `[role]` element appears in the inventory or in an explicit exclusion list; correct the stack line and remove the stale section-6 item.

**Regression evidence:** the CI check above fails today on the ids listed.

### HARD27-024 — Three copies of the discovery probe in `connectionManager.ts`

**Severity:** P3 (maintainability). **Confidence:** High.

**Locations:** `src/lib/connection/connectionManager.ts:210-249` (`probeInfoWithConnectionConfig`), `:286-336` (`probeOnce`), `:358-395` (`probeInfoOnce`). Each builds a `C64API`, calls `getInfo` with the same seven option flags and the same eleven-line comment, and classifies the failure with slightly different rules: `probeOnce` raises the password challenge and writes `lastProbeError` itself, the other two return `authRequired` for the caller; `probeInfoOnce` computes `isProbePayloadHealthy` twice; `probeInfoWithConnectionConfig` logs DNS failures at `info` and the rest at `warn`, `probeOnce` at `debug`.

**Trigger and observable failure:** a change to the probe (a new bypass flag, a different timeout, a firmware quirk) has to be made three times; the recovery-probe bypass added for the circuit breaker was, and the three now log the same failure at three different levels, so the diagnostics view shows a startup probe failure differently from a manual one. The file is 1,457 lines, half of which is this and the four transition functions.

**Implementation direction:** one `probeInfo(config, options)` returning `ProbeInfoResult` and one `classifyProbeFailure`; the three callers keep their side effects. The existing connection-manager tests cover all three paths and will hold the behaviour.

### HARD27-025 — The saved-devices envelope is re-parsed by hand in two other modules, and the private-LAN host rules exist three times with different answers

**Severity:** P3 (maintainability; one divergence is user-visible via HARD27-030). **Confidence:** High.

**Locations**

- `src/lib/ftp/ftpConfig.ts:15-75` and `src/lib/telnet/telnetConfig.ts:13-60` — both define their own `SAVED_DEVICES_STORAGE_KEY = "c64u_saved_devices:v1"`, `JSON.parse` the raw envelope, pick the selected device, and in the write path rewrite the envelope themselves as a fallback, bypassing `src/lib/savedDevices/store.ts:99` and its `parseEnvelope`/normalisation.
- Private-LAN host matching: `web/server/src/hostValidation.ts:32-50` (server; accepts `c64u`, `localhost`, `*.local`, RFC 1918), `android/.../C64LanCookieBypassHandler.kt:33-55` (accepts `u64`, `c64u`, `*.local`, RFC 1918, link-local), `src/lib/network/trustedLanHost.ts:71` (app). `src/lib/deviceDiscovery/discoveryManager.ts:34-44` carries a fourth list of product host names (`c64u`, `u64`, `Ultimate-64-Elite`, …) that the server does not accept.

**Trigger and observable failure:** a schema change to the saved-devices envelope (a `version: 2`, a renamed port field) is handled by the store and silently mis-read by the two port resolvers, which would then fall back to default ports for every device. The host-rule divergence is what makes a U64 saved as `u64` work on Android and fail on web (HARD27-030).

**Implementation direction:** expose `getSelectedSavedDevicePorts()` from the store and delete the two parsers; keep one host-classification module in TypeScript shared by app and server (the server already imports a generated variant module, so sharing a source file is established) and mirror it in Kotlin with a contract test over a fixture list.

### HARD27-026 — Twenty-seven source files exceed the size the repository's own modularity rule sets

**Severity:** P3 (maintainability). **Confidence:** High.

**Locations:** `REVIEW.md` §9 says a file "approaching ~1000 lines is expected to be refactored unless there is a documented reason not to". At the base commit the following exceed 900 lines with no such note: `SettingsPage.tsx` 3,443; `c64api.ts` 3,342; `PlayFilesPage.tsx` 3,119; `HomeDiskManager.tsx` 2,772; `localSidEngine.ts` 2,509; `usePlaybackController.ts` 2,496; `HomePage.tsx` 2,189; `healthCheckEngine.ts` 2,151; `DiagnosticsDialog.tsx` 1,965; `LightingStudioDialog.tsx` 1,627; `useHvscLibrary.ts` 1,487; `connectionManager.ts` 1,457; `hvscIngestionRuntime.ts` 1,395; `useVolumeOverride.ts` 1,377; `localSidNativeSink.ts` 1,307; `hvscBrowseIndexStore.ts` 1,274; `addFileSelections.ts` 1,238; `savedDevices/store.ts` 1,191; `ConfigBrowserPage.tsx` 1,153; `deviceInteractionManager.ts` 1,152; `subjectTracker.ts` 1,149; `AudioPipeline.kt` 1,061; `diskMount.ts` 1,030; `StreamUdpPlugin.kt` 1,030; `FtpClientPlugin.kt` 955; `HvscIngestionPlugin.kt` 933; `appSettings.ts` 925.

**Trigger and observable failure:** the three largest pages carry dozens of effects each (`PlayFilesPage.tsx` has 45 `useEffect` sites); several findings in this document (HARD27-010, HARD27-011, HARD27-024) are the direct product of behaviour that has to be kept in sync by hand across files this size. `c64api.ts` alone strips fifteen `__c64u*` option flags one by one in `request()` (`:1560-1578`), a list every new flag must be added to in three places.

**Implementation direction:** not a single refactor. Split along the seams the findings already expose: the request gateway out of `c64api.ts` (options object instead of flag deletion), the connection transitions out of `connectionManager.ts`, the device editor out of `SettingsPage.tsx`, the background-execution and auto-advance effects out of `PlayFilesPage.tsx`. Add the size check to `npm run lint` with the current files grandfathered so the number only goes down.

### HARD27-027 — Web: Demo Mode is offered but has no simulated device, so enabling it produces a "demo" that targets the unreachable real host

**Severity:** P3. **Confidence:** High. **Platform:** web.

**Locations**

- `src/lib/config/featureFlagsRegistry.generated.ts:92-94` — `demo_mode_enabled` is `visible_to_user: true` on the C64 Commander variant, so `SettingsPage.tsx:1753-1760` shows the "Demo mode" toggle on web.
- `src/lib/native/mockC64u.web.ts:8-27` — the web mock server exists only under the E2E override and otherwise throws "Mock C64U server is only available on native platforms."
- `src/lib/connection/connectionManager.ts:1027-1070` — `transitionToDemoActive` catches that, logs "Demo mode mock server unavailable", and then routes the API at the stored real host ("Demo mode using stored device host") before transitioning to `DEMO_ACTIVE`.

**Trigger and observable failure:** a web user whose Ultimate is off turns on Demo Mode expecting the simulated machine the setting describes. The badge reads Demo, the interstitial appears, every query is enabled (`DEMO_ACTIVE` counts as connected), and every card shows a connection error because the requests go to the powered-off device through the proxy. Telnet uses its mock (`shouldUseMockTelnetTransport` keys on `DEMO_ACTIVE`), so the Home config-file actions appear to work while nothing else does.

**Implementation direction:** either hide the setting and the fallback on web (the variant registry supports per-platform visibility; `transitionToDemoActive` should fall through to `OFFLINE_NO_DEMO` when no mock server exists) or serve the mock from the web server (the Android mock is a plain HTTP server and the server already runs Node).

**Regression evidence:** a unit test that on web with no mock server `discoverConnection` never reaches `DEMO_ACTIVE` (today it does).

### HARD27-028 — HVSC install holds no wake lock, cannot resume a download, and checks memory but not disk space

**Severity:** P3. **Confidence:** Medium (the outcome depends on the OEM's background policy and the phone's free space; the absence of the three safeguards is certain). **Platform:** Android and iOS.

**Locations**

- `src/pages/playFiles/hooks/useHvscLibrary.ts` — the install flow never calls `startBackgroundExecution` (grep: no reference); the foreground service exists only for playback.
- `src/lib/hvsc/hvscDownload.ts` — the archive download has no `Range` handling (grep: none); an interrupted download restarts from zero and the partial file is deleted on failure (`hvscIngestionRuntime.ts:1093-1096`).
- `android/.../HvscIngestionPlugin.kt:132-146` — `buildMemoryBudget` bounds RAM; no code path checks free storage before a ~60 MB download and a several-hundred-megabyte extraction into `filesDir` (grep for `StatFs`/`usableSpace`: none).

**Trigger and observable failure:** the baseline install is the app's longest operation (the repository's own notes put a cold install near half an hour on a Pixel 4). A user starts it, puts the phone down, and the screen locks: without a wake lock the CPU dozes and the download stalls or the OS restricts network; when the user returns the install has failed and starts again from the first byte. On a phone with little free space the failure arrives after the download, as a raw `ENOSPC` message from the extractor, with the partial staging tree left to be cleaned on the next attempt.

**Implementation direction:** hold the existing foreground service (with a distinct "Installing HVSC" notification) for the duration of an install; check `StatFs.availableBytes` against the archive's `uncompressedSizeBytes` × 2 before downloading and say how much is needed; support `Range` resume of the cached partial archive.

**Regression evidence:** a runtime test that `installOrUpdateHvsc` starts and stops background execution around the install (today never); a plugin test that `probe` rejects with a clear message when free space is below the estimate.

### HARD27-029 — Web: an unauthenticated visit to the app root returns raw JSON instead of the login page, and an expired session is presented as the device's password prompt

**Severity:** P2. **Confidence:** High. **Platform:** web.

**Locations**

- `web/server/src/index.ts:560-571` — when a password is configured and the request is unauthenticated, only `/login` serves the login page; every other path, including `/`, answers `401 {"error":"Authentication required"}`.
- `playwright/webPlatformAuth.spec.ts:237-238` asserts exactly that (`page.goto("/")` → 401), so the behaviour is locked in by a test rather than caught by one.
- `README.md:61` — "Open `http://<host-ip>:8064` in a browser. If you configure a network password… use it to sign in": the documented entry point is the root.
- The SPA never redirects to `/login` (grep for `/login` in `src`: none; only `webServerLogs.ts:59` looks at a 401).
- `src/lib/c64api/transportErrors.ts:101` — `isAuthRequiredHttpStatus` treats 401 as the device demanding a password; `c64api.ts:1079-1082` raises the device password dialog on it.
- `web/server/src/authState.ts:45` — sessions are in memory with a 24-hour TTL.

**Trigger and observable failure:** (a) a user who set a password opens the app the next day, or from a second browser, and sees a JSON error page; nothing tells them to type `/login`. (b) A user who left the tab open for more than 24 hours, or whose container restarted, keeps using the app: the first proxied call gets 401 from the server, the app opens "Network password required — <device> refused the request…", the user types the device password, `setPasswordForDevice` PUTs it (also rejected with 401 because the PUT is behind the same gate), and the dialog reports a wrong password. A reload lands on the JSON page from (a).

**Why existing guards do not prevent it:** the auth-challenge mapping was written for the device's own 401/403; the proxy re-uses the same status for its login gate and the client cannot tell the two apart.

**Implementation direction:** serve the login page for navigations (`Accept: text/html`) to any path when unauthenticated, or redirect to `/login?next=`; have the proxy answer its own gate with a distinct signal (a `WWW-Authenticate: c64commander-session` header or a 440-style status) and have the client redirect to login on it instead of raising the device dialog; note the server restart lock-out in `docs/advanced.md` until sessions are persisted.

**Regression evidence:** `webServer.test.ts`: unauthenticated `GET /` with `Accept: text/html` returns the login page (today 401 JSON — the Playwright assertion at `:237-238` must be inverted); a client test that a proxy-originated 401 does not call `notifyAuthRequired`.

### HARD27-030 — Web: the proxy refuses legitimate LAN host names and limits FTP to the server's default device, so a saved `u64` or a second Ultimate fails with a password prompt

**Severity:** P2. **Confidence:** High. **Platform:** web.

**Locations**

- `src/lib/c64api.ts:1103` — on the web platform every request carries `X-C64U-Host: <saved device host>`.
- `web/server/src/hostValidation.ts:32-50` — `isTrustedInsecureHost` accepts only `c64u`, `localhost`, `127.0.0.1`, `*.local` and private IP literals. A host named `u64` (the second entry in the app's own `PRODUCT_HOST_CANDIDATES`, `discoveryManager.ts:34-44`), `ultimate64`, or any router-assigned name such as `c64u.lan` or `c64u.home` is rejected.
- `web/server/src/index.ts:250-254` — the rejection is a 403; `transportErrors.ts:101` maps 403 to "password required", so the app opens the device password dialog.
- `web/server/src/index.ts:317, 371` — the FTP handlers accept only `config.defaultDeviceHost` unless `WEB_ALLOW_REMOTE_FTP_HOSTS` is set, so a second saved device gets REST (if its address is a private IP) but no file browsing, disk import, or Ultimate-hosted SID playback.

**Trigger and observable failure:** a web user saves their U64 as `u64` (the name the app itself probes for) or as the name their router advertises. Every call answers 403, the app asks for the network password, and no password satisfies it. A user with two Ultimates switches to the second one: Home works, the Play page's Ultimate source and the Disks import fail with "FTP host override is disabled" errors. The Android app handles both cases.

**Why existing guards do not prevent it:** the server's allow-list was written for the single-device Docker flow and never reconciled with the app's multi-device model or its own discovery names (HARD27-025).

**Implementation direction:** resolve the requested host on the server and accept it when the resolved address is private-range (this covers every LAN name), and apply the same rule to REST and FTP; let the app register its saved devices with the server so the allow-list is "configured devices" on both paths, which is also the tightening HARD27-016 asks for. Answer a policy rejection with a status the client does not confuse with device auth (see HARD27-029).

**Regression evidence:** `webServer.test.ts`: `X-C64U-Host: u64` resolving to a private address is proxied (today 403); an FTP list for a second private-range host succeeds under the default policy (today 403).

### HARD27-031 — Web: the static server has no MIME type for `.wasm`, so the SID engine cannot be compiled by streaming

**Severity:** P3. **Confidence:** High. **Platform:** web.

**Locations:** `web/server/src/staticAssets.ts:64-78` — `getContentType` knows `.html/.js/.css/.json/.svg/.png/.jpg/.webm/.woff2` and answers `application/octet-stream` for everything else, including `.wasm`, `.webmanifest` and `.ico`. `src/lib/playback/localSid.worker.ts:30` loads the libsidplayfp engine from `/wasm/libsidplayfp/dist/index.js`, whose glue fetches the 391 KiB `.wasm` beside it.

**Trigger and observable failure:** `WebAssembly.instantiateStreaming` rejects a response whose type is not `application/wasm`; the Emscripten glue falls back to `arrayBuffer()` compilation after logging "wasm streaming compile failed", so on-device playback still works but starts later and the console carries a warning on every engine start. The manifest served as `application/octet-stream` is accepted by current Chrome but is outside what the PWA specification requires.

**Implementation direction:** add `wasm`, `webmanifest`, `ico`, `txt`, `map` to `getContentType`; a table lookup by extension keeps it short.

**Regression evidence:** `staticAssets.test.ts`: a `.wasm` file is served as `application/wasm` (today `application/octet-stream`).

### HARD27-032 — The playback session that the "Last" tile and "Resume session" restore lives in `sessionStorage`, so it does not survive process death

**Severity:** P3. **Confidence:** High. **Platform:** Android and iOS (web tabs keep `sessionStorage`).

**Locations**

- `src/pages/playFiles/hooks/usePlaybackPersistence.ts:585-615` — the session (playlist key, current item, position, shuffle/repeat) is written with `sessionStorage.setItem(PLAYBACK_SESSION_KEY, …)` (line 612) and read back from `sessionStorage` (`:294-297`).
- `src/pages/home/components/useListenActions.ts:64-77` — the Home "Last" tile reads the same key from `sessionStorage`; `src/lib/search/handlers.ts:47` — the search action "Resume session" navigates to `/play?resume=1`, which restores from the same key.
- By contrast, the playlist itself is in IndexedDB/localStorage and survives.

**Trigger and observable failure:** on a phone the OS routinely ends the process while the app is in the background (Hardening 26 reproduced the route reset with `am kill`). After that, the "Last" tile shows no tune, "Resume session" does nothing, and the position in the playlist is lost, although the playlist is intact. Since the tile and the search action are promoted first-run affordances, the feature is absent on most mornings.

**Implementation direction:** persist the session in `localStorage` (or the IndexedDB repository) keyed by device, with the timestamp already in the payload used to decide staleness; keep `sessionStorage` semantics only for the "cleared on stop" case by writing an explicit empty marker.

**Regression evidence:** a test that a session written by `usePlaybackPersistence` is readable after `sessionStorage.clear()` (today it is not).

### HARD27-033 — Web: the app injects a Google Fonts stylesheet that the server's own Content Security Policy blocks, so the fonts never load and every page load logs a CSP violation

**Severity:** P3. **Confidence:** High. **Platform:** web.

**Locations**

- `src/lib/startup/fontLoading.ts:1-16` — on non-native platforms `loadRemoteFonts` appends a `<link>` to `https://fonts.googleapis.com/css2?family=JetBrains+Mono…&family=Inter…`; `src/main.tsx:70` calls it at startup.
- `web/server/src/securityHeaders.ts:16-19` — the CSP is `style-src 'self' 'unsafe-inline'; font-src 'self' data:`, which forbids both the stylesheet host and the font files at `fonts.gstatic.com`.
- The repository note that Inter is not bundled (glyph sizes vary by platform) shows the intent was to load it remotely.

**Trigger and observable failure:** on the Docker web app the browser refuses the stylesheet, logs a CSP violation in the console on every load, and renders with the system fallback fonts. The intended typography never appears on the one platform that asked for it, and the same request would be a third-party fetch on every load for a LAN-only app if the CSP did allow it.

**Implementation direction:** bundle the two font families with the app (they are open-licensed) and serve them from `'self'`, which also makes the web app fully offline; delete `loadRemoteFonts`. If remote loading is kept, the CSP has to name the two Google hosts and `docs/advanced.md` has to say the web app calls them.

**Regression evidence:** `securityHeaders.server.test.ts` or a Playwright check that no CSP violation is reported on load (today one is).

### HARD27-034 — Dead or inert code paths that tests keep green

**Severity:** P3 (maintainability). **Confidence:** High.

**Locations**

- `src/App.tsx:371` mounts `<Sonner />` from `src/components/ui/sonner.tsx`, a second toast system; every production toast goes through `@/hooks/use-toast` (30 import sites, zero sonner `toast()` calls). The unused library ships in the bundle and adds a second fixed-position region to every page.
- `src/lib/logging.ts:247` — `formatLogsForShare` and its `redacted` option have no caller; the diagnostics export (`diagnosticsExport.ts`) builds its own payload. The redaction module it exercises is therefore covered by tests but not by the product.
- `src/lib/native/streamUdp.ts:139` and `StreamUdpPlugin.kt:204` — `setExpectedSource`, documented as "called again on a device switch", has no JavaScript caller (the switch rebuilds the receiver instead).
- `src/lib/navigation/navigationGuards.ts` — see HARD27-022.
- `ios/App/App/HvscIngestionPlugin.swift` `readArchiveChunk` — serves the non-native ingestion path that `resolveHvscIngestionMode` blocks in production.

**Trigger and observable failure:** none directly; the cost is that each of these is covered by a passing test that documents a capability the product does not have, which is the failure mode `AGENTS.md` names ("a test that reimplements the logic it is meant to guard"). The sonner mount is the one with a runtime footprint.

**Implementation direction:** remove `<Sonner />` and the component; delete `formatLogsForShare` or wire the export through it; delete `setExpectedSource` or use it in the switch; remove `readArchiveChunk` with the blocked path. Keep the deletions in one commit so the coverage gate reflects the real surface.

### HARD27-035 — Six silent `catch` sites contravene the repository's own exception rule

**Severity:** P3 (policy compliance; `REVIEW.md` §7 calls a silent catch a release blocker). **Confidence:** High.

**Locations:** bare `catch {` blocks that neither log nor rethrow, each returning a fallback value: `src/lib/c64api.ts:657` (URL parse in `noteRestReachable`), `src/lib/secureStorage.ts:51` (envelope parse → treat the raw value as a legacy password; this is also the path that makes HARD27-001's plain-string read "work"), `src/lib/archive/client.ts:41`, `src/lib/savedDevices/host.ts:11`, `src/lib/connection/connectionManager.ts:585` (`normalizeReachabilityHost`), `src/lib/diagnostics/networkSnapshot.ts:42`.

**Trigger and observable failure:** each is a deliberate parse fallback, and none is wrong on its own; the cost is that a malformed persisted value (a corrupted saved-devices host, an envelope that is not JSON) is normalised away without a diagnostics entry, so the first symptom is downstream (a device that fails to connect, a password that "does not exist") with nothing in the log to explain it. The rule exists because that is how the repository has lost time before.

**Implementation direction:** add a `warn`-level `addLog` with the offending value's shape (not its content, for the password case) to each; an ESLint `no-empty` plus a custom rule for `catch {` without a call would keep the count at zero.

### HARD27-036 — The device-safety gateway is switched off in every automated environment, including the test-probe APKs used on the hardware rig

**Severity:** P3 (test confidence for the repository's highest-priority hazard). **Confidence:** High.

**Locations**

- `src/lib/deviceInteraction/deviceInteractionManager.ts:130-150` — `isTestEnv()` is true under Vitest, under `NODE_ENV=test`, under `PLAYWRIGHT=1`, whenever `VITE_ENABLE_TEST_PROBES=1`, and whenever `window.__c64uTestProbeEnabled` is set; `withRestInteraction` (`:633-645`) and `withFtpInteraction` then skip the scheduler, cooldowns, caches and the circuit breaker entirely unless `globalThis.__c64uForceInteractionScheduling` is set.
- `build:1788, 2027` and `.github/workflows/android.yaml:310, 502, 1272` — the APKs built for E2E, screenshots and the HIL merge gate set `VITE_ENABLE_TEST_PROBES=1`.
- Only five test files set the force flag (`tests/unit/lib/deviceInteraction/*`); the nine tests of `useInteractiveConfigWrite`/`useDeviceBoundSlider` and every page test run ungoverned.

**Trigger and observable failure:** `REVIEW.md` ranks "never wedge the device" first and names the request pattern as the hazard. The golden traces, the Playwright suites, the screenshot runs and the hardware merge gate all record the app's request pattern with the governor removed: no coalescing, no cooldown, no circuit, no lane. A regression that doubles the request rate on a slider drag, or that lets the input lane and a config write overlap, is invisible to every gate except a manual bench session, and a HIL run that passes says nothing about the production request pattern on the c64u.

**Why existing guards do not prevent it:** the bypass was introduced to make deterministic tests possible and was extended to the probe builds so E2E timing stays stable; the gateway's own unit tests are the only place it runs.

**Implementation direction:** separate "deterministic time" from "no governor": keep the governor on in probe builds and make its delays injectable (a virtual clock) so E2E timing stays stable; at minimum run the HIL gate's APK with the governor on (a `VITE_DEVICE_SAFETY_GOVERNOR=1` override read before `isTestEnv`), and add a Playwright golden trace that asserts the coalesced request pattern for one slider drag.

**Regression evidence:** a golden trace for the LED slider drag recorded with the governor on would differ from today's trace (which records every intermediate write).

### HARD27-037 — A saved device cannot be renamed or have its ports changed while it is unreachable

**Severity:** P3. **Confidence:** High. **Platform:** all.

**Locations:** `src/pages/SettingsPage.tsx:786-806` — `performSaveDevice` runs `evaluateNewDeviceReachability` unconditionally before any change is saved and returns with "We couldn't reach "<host>"…" on `unreachable`; `src/lib/connection/addDeviceReachability.ts:71-100` — that probe takes the discovery timeout and, for a host name, a silent LAN scan of up to 8 s.

**Trigger and observable failure:** the user opens Settings to rename a device that is switched off, or to correct its FTP port, waits ~12 s, and is told the device is unreachable; the rename is refused. The gate exists to stop an unreachable *host* from being saved (HARD9-004), but it is applied to edits that do not touch the host.

**Implementation direction:** run the reachability gate only when the host or HTTP port changed (or a password is being set); allow name, type and FTP/Telnet port edits without a probe.

**Regression evidence:** a Settings test that renaming a device whose probe fails still calls `updateSavedDevice` (today it does not).

### HARD27-038 — Every tab transition mounts the departing and arriving pages in full, including the 3,000-line Play and Settings pages

**Severity:** P3 (performance on the low-end target). **Confidence:** High for the behaviour; Medium for the cost, which the repository deferred rather than measured. **Platform:** all; matters most on the small keypad-only handset.

**Locations:** `src/components/SwipeNavigationLayer.tsx:456-483` — inactive slots render placeholders only while idle; during a transition the adjacent page components are mounted with their full hook trees (the comment at `:472-483`, tagged HARD12-022, records this as deliberate and "deferred as a separate, measured perf/UX task"). `HomePage.tsx`, `PlayFilesPage.tsx` and `SettingsPage.tsx` each mount dozens of hooks, queries and subscriptions on mount, several of which start work immediately (`useC64Connection`'s info refetch, the HVSC status read, the saved-device health cycle).

**Trigger and observable failure:** every swipe or tab tap mounts and then unmounts a page the user did not open. On the small keypad-only handset (a 2018-class SoC) the mount of `PlayFilesPage` is the single largest JavaScript task in the app, and it runs during the transition animation, which is the moment jank is most visible. Open since Hardening 12; still present.

**Implementation direction:** render a static snapshot (a canvas capture or the last painted frame via `html-to-image` is too heavy; a lightweight skeleton with the page's chrome is enough) for the adjacent slot during a transition, and mount the real page only when it becomes active. Measure on that handset before and after with the existing responsiveness script.

**Regression evidence:** the existing `SwipeNavigationLayer.test.tsx` mount/unmount test inverted: adjacent slots must not mount the page component during a transition.

### HARD27-039 — The keypad focus engine scans the DOM on every mutation for touch users who never use keys

**Severity:** P3 (performance). **Confidence:** Medium (the work is certain; its cost on the shipped devices is not measured after the Hardening 26 containment). **Platform:** all; matters most on the small keypad-only handset and the Pixel 4.

**Locations:** `src/hooks/useFocusNavigation.tsx:386-390` — the discovery engine starts whenever `keypad_input_enabled` is on, which is the default for the C64 Commander variant, regardless of input modality; `src/lib/input/focusDiscovery.ts:160-175` — a `MutationObserver` over `document.body` (childList, subtree, attributes) schedules a refresh on most mutations; `:195` records that a full pass cost "over 100 ms on a Pixel 4" before containment; `src/lib/input/discovery.ts:261, 309, 184` — a refresh queries every interactive element in scope and reads `getBoundingClientRect` for ordering.

**Trigger and observable failure:** a touch user scrolls a virtualised playlist or watches Live View's stats panel update four times a second: every row swap or counter change is a mutation, and the ring is rebuilt on the main thread for a modality they never enter. The Prime Directive in `architecture.md` promises "with the flag off the engine never runs"; with the flag on (the default) it runs for everyone.

**Implementation direction:** start the engine lazily on the first key-navigation modality flip (the modality store already exists and flips on the first D-pad/keyboard event), and stop it after a period of pointer-only use; keep the attribute writes exactly as they are. Measure with the responsiveness script on both devices.

**Regression evidence:** a hook test that with the flag on and modality `pointer`, no `MutationObserver` is attached until a key event arrives (today one is attached on mount).

### HARD27-040 — Android: the background-playback notification is static and the media session carries no metadata

**Severity:** P3. **Confidence:** High. **Platform:** Android.

**Locations:** `android/.../BackgroundExecutionService.kt:292-315` — `buildNotification` shows the app name, the fixed text "Playback active" (line 304), a stock media icon, no actions and no `MediaStyle`; `:337-370` — `initializeMediaSession` sets a playback state and callback but never `setMetadata`, and `updateDueAt` never updates the state.

**Trigger and observable failure:** while a playlist plays with the screen off, the lock screen and the notification shade show a notification that names neither the tune nor the C64 and offers no Pause, Next or Stop; the lock-screen media control that Android builds from the session has no title, artist or artwork. The only way to stop playback is to unlock the phone and open the app. Every other music app on the device offers this, and the app already has the data (title, author, duration) in `nowPlayingMetadata.ts`.

**Implementation direction:** add a `setNowPlaying({title, artist, durationMs})` plugin method that updates `MediaMetadata` and the notification (`MediaStyle` with Pause/Next actions wired to the existing transport broadcast), called from the playback controller on every track change and pause/resume.

**Regression evidence:** `BackgroundExecutionServiceTest.kt`: after `setNowPlaying`, the session metadata title equals the tune title (today no metadata exists).

## 6. Hypotheses investigated and rejected

Recorded so the next session does not repeat the work.

- **Password or token leakage into traces, logs or exports.** `traceSession.ts:183-201` redacts sensitive keys on record; `recordFtpOperation` (`:541-561`) redacts `requestPayload` (which does carry the FTP password) before appending; the diagnostics export (`diagnosticsExport.ts:130-150`) ships hosts, addresses and paths but nothing that was redacted at record time; a grep of every `addLog`/`addErrorLog` call site with "password" found only messages, never values. `formatLogsForShare`'s `redacted` option has no caller, so that path is dead code rather than a defect. No finding.
- **Config writes taking the body-buffering `POST /v1/configs` path.** `setConfigValue` and single-entry batches use `PUT` (`c64api.ts:2337-2372`, `2453-2466`); only merged multi-item interactive batches (SID mixer, Lighting Studio surfaces) use `POST`, which Hardening 18 (HARD18-013) accepted after stress testing. No finding.
- **Android foreground-service start from the background (Android 12+ restriction).** `startBackgroundExecution` is only reached from a playback start in the foreground; the auto-skip and transport paths run while the service is already alive. Not reachable; no finding.
- **Bundled 7-Zip executable and 16 KB page alignment.** The executable ships as `lib7zz.so` in the native library directory (`HvscIngestionPlugin.kt:114-126`, `build.gradle:193-225`) and `scripts/validate-release-artifact.mjs:289` checks 16 KB compatibility of the release artifact. No finding.
- **Multicast join on a VPN or cellular interface.** `siteLocalInterface()` requires `supportsMulticast()` and a site-local IPv4; `tun`/`rmnet` interfaces normally lack the multicast flag. Low confidence; device validation only.
- **Static (non-server) web build keeping passwords in memory only.** `SecureStorageWeb` outside server mode is in-memory, but the only shipped web build is the Docker image with `VITE_WEB_PLATFORM=1`. Not a production configuration.
- **Config snapshot and unsaved-changes keys colliding across devices on web.** `getActiveBaseUrl()` (`appConfigStore.ts:46-49`) keys by the stored device host, not the proxy URL, so the keys stay per device. The placeholder lookup in `useC64ConfigItems` uses the proxy URL on web and therefore never hits, which is harmless. No finding.
- **First-run tour suppressed by `detectPriorAppState()` running at module import.** The check runs before any render; no module-scope `c64u_*` write was found ahead of it. Low risk; not a finding.
- **Telnet authentication heuristic (`Password:`/`incorrect`/`denied` substrings).** Weak, but no reachable misclassification was found; `HARD20-006` handles EOF on Android (see HARD27-013 for iOS). Not a finding.
- **Telnet session slot leak on a failed workflow.** `useTelnetActions.ts:255-258, 422-424` disconnect in `finally`; the session's own 5-minute idle timer is the backstop. No finding.
- **Mobile-data-only phone not entering Demo Mode automatically.** `shouldStartDemoModeForOfflineDevice` (`offlineStartup.ts:29`) requires a positive "no network" answer; a cellular interface counts as a network by design, and the LAN scan skips non-site-local addresses. Product decision, not a defect.
- **Device discovery concurrency against the wedge-prone c64u.** Up to 24 probe workers, but at most a handful can target one device (its LAN address plus the hostname aliases that resolve to it). Bounded; no finding.
- **`useSavedDeviceHealthChecks` telnet churn while the switcher is open.** The picker and background contexts skip the telnet probe (`healthCheckEngine.ts:175-191`); only the manual diagnostics run probes it. Already handled.
- **Kernal-fallback keyboard injections landing on the wrong device.** Guarded by host capture and an epoch (`kernalFallbackInjector.ts`). Already handled.
- **Mock servers exposed on the LAN in Demo Mode.** Both bind `127.0.0.1` (`MockC64UServer.kt:101-103`, `MockFtpServer.kt:69-71`) and are token-gated. No finding.
- **Static asset path traversal on the web server.** `staticAssets.ts:84-103` normalises, rejects `..` and absolute paths, and re-checks the resolved path against `distDir`. No finding.
- **Play deep links re-triggering on refresh or back navigation.** `usePlayDeepLinks` consumes the parameters and replaces the URL. No finding.
- **`ensureOpen` adoption of a running `AudioTrack` across tunes.** The claim ordering and the `primeMs` exclusion are correct as written; the HARD26-009 deadline is present (`withOpenDeadline`).

## 7. Implementation plan

Every confirmed finding appears exactly once. Ordered by risk, then by independence so that small fixes ship first and the invasive changes are isolated.

### Phase A — small, independently shippable fixes (ship first)

**A1. HARD27-001 (web password envelope).**
- Production: `src/lib/secureStorage.ts` (platform branch in `persistPasswordState`/`loadPasswordState`), `src/lib/native/secureStorage.web.ts` (unchanged contract or a new `setSelectedPassword`), `web/server/src/index.ts` (reject envelope-shaped values; document the single-password semantics), `docs/advanced.md`.
- Tests: `tests/unit/secureStorage.test.ts` (web-mode plaintext PUT), `tests/unit/web/webServer.test.ts` (envelope rejected), `playwright/webPlatformAuth.spec.ts` (UI-driven password save then login).
- Acceptance: saving a password in Settings on the web platform makes `/auth/login` accept that password and the proxy send it as `X-Password`; the server never persists a JSON envelope.

**A2. HARD27-008, HARD27-009, HARD27-015, HARD27-016, HARD27-017 (web server hardening).** Grouped because they touch the same two files and one test file, and together they implement the stance in section 2.1.
- Production: `web/server/src/securityHeaders.ts` and `authState.ts` (`WEB_TRUST_PROXY` governing XFF, HSTS and `Secure`), `web/server/src/httpIO.ts` (body caps), `web/server/src/index.ts` (413 handling, FTP read cap, config file mode, REST host policy matching FTP, upstream fetch timeout and 504), `docs/advanced.md` (`WEB_TRUST_PROXY`, `WEB_ALLOW_REMOTE_REST_HOSTS` semantics, volume ownership).
- Tests: `tests/unit/web/webServer.test.ts`, `tests/unit/web/httpIO.test.ts`, `tests/unit/web/authState.test.ts`.
- Acceptance: spoofed `X-Forwarded-For` does not reset the lockout unless proxy trust is on; a body or FTP read over the cap is rejected; `web-config.json` is 0600; the proxy refuses non-configured hosts by default; a silent upstream yields 504 within the bound.

**A3. HARD27-002 (iOS Live View gating).**
- Production: `src/lib/streams/streamReceiver.ts` (`isPluginAvailable` gate, listener rejection handlers), `src/components/streams/LiveViewCard.tsx` or `AvMirrorControls.tsx` (disabled state with helper text), `src/lib/remoteInput/gameModeLaunch.ts` (skip stream starts when no transport), `docs/internals/ios-parity-matrix.md`.
- Tests: `tests/unit/lib/streams/streamReceiver*.test.ts` (factory returns Unsupported when the plugin is unavailable; no unhandled rejection).
- Acceptance: on a platform without `StreamUdp` the toggles are disabled with an explanation and the diagnostics log contains no unhandled rejection.
- Decision to record: whether iOS should use the WebSocket bridge when a web server is reachable (product).

**A4. HARD27-003, HARD27-012, HARD27-013 (iOS bridge parity).** Grouped as one Swift change set with one contract test.
- Production: `ios/App/App/IOSFtp.swift` (`listDirectoryRecursive`, `cancelRead`, idle-timeout semantics, `timeoutMs == 0`, 32 MiB cap), `ios/App/App/NativePlugins.swift` (folder-picker read cap), `ios/App/App/TelnetSocketPlugin.swift` (closure on EOF), `ios/App/App/AppDelegate.swift` (`DeviceDiscovery.getNetworkStatus`), or the TypeScript degradations in `ftpSourceAdapter.ts`, `ftp/ftpClient.ts`, `offlineStartup.ts` (edge-triggered log); `src/lib/native/ftpClient.ts` (documented timeout semantics); `docs/internals/ios-parity-matrix.md`.
- Tests: a new contract test comparing TypeScript plugin interfaces with Swift `pluginMethods` arrays (pattern: `tests/unit/ci/*Contracts.test.ts`); `ios/native-tests` cases for `resolveTimeout(0)`, the read cap, and EOF closure; `tests/unit/lib/connection/offlineStartup.test.ts` (log once).
- Acceptance: folder import and songlengths import from the Ultimate work on iOS; a dropped Telnet session reconnects; no error-level entry on an aborted read; at most one network-status log line per session.

**A5. HARD27-010 (single pre-retarget sequence).**
- Production: `src/lib/connection/deviceRetarget.ts` (add mirror stop and playback stop), `src/hooks/useSavedDeviceSwitching.ts` (delegate to it), `src/lib/connection/connectionManager.ts` (`tryReachableSavedDeviceFallback` restarts the mirror after verification).
- Tests: `tests/unit/lib/connection/connectionManagerSavedDeviceSweep.test.ts` (mirror stopped before select, restarted after verify), `tests/unit/lib/connection/deviceRetarget.test.ts`.
- Acceptance: after an automatic fallback switch Live View either follows to the new device or reads "off", never "Watching" on the old one.

**A6. HARD27-019 (foreign-sender eviction credentials and challenge suppression).**
- Production: `src/lib/streams/avMirrorSession.ts` (`stopStreamAt` uses the saved-device password when the host is known and passes `__c64uSuppressAuthChallenge`), `src/lib/c64api.ts` (`stopStream` accepts request options), `src/lib/streams/audioMirrorController.ts` (non-modal hint on 403).
- Tests: `tests/unit/lib/streams/foreignSenderGuard*.test.ts` / session tests (no `notifyAuthRequired` on 403).
- Acceptance: a password-protected second Ultimate never raises the password dialog; the card names it instead.

**A7. HARD27-020 (discovery ports).**
- Production: `src/lib/deviceDiscovery/discoveryManager.ts` (`buildKnownHosts` sends ports; candidate keeps its port), `android/.../DeviceDiscoveryPlugin.kt` (`DiscoveryTarget` port from input; LAN scan on saved ports), `src/lib/native/deviceDiscovery.ts` (type).
- Tests: `DeviceDiscoveryPluginTest.kt` (port parsing), `tests/unit/lib/deviceDiscovery/discoveryManager*.test.ts`.
- Acceptance: a saved device on port 8080 is found by the badge-tap recovery after its address changes.


**A8. HARD27-029, HARD27-030, HARD27-027, HARD27-031, HARD27-033 (web platform usability).** Grouped: five small server/client changes that together make the documented Docker flow work for a user with a named device, a second device, an overnight tab, or Demo Mode on.
- Production: `web/server/src/index.ts` (login page for HTML navigations, distinct status for the session gate, resolve-then-check host policy for REST and FTP), `web/server/src/hostValidation.ts`, `web/server/src/staticAssets.ts` (MIME table), `web/server/src/securityHeaders.ts` (CSP) with the fonts bundled under `public/` and `src/lib/startup/fontLoading.ts` removed, `src/lib/c64api/transportErrors.ts` (do not treat the proxy's gate as device auth), `src/lib/connection/connectionManager.ts` (no `DEMO_ACTIVE` without a mock server) or the variant registry (hide Demo Mode on web).
- Tests: `tests/unit/web/webServer.test.ts` (login page at `/`, `u64` proxied, second-host FTP, `.wasm` MIME), `playwright/webPlatformAuth.spec.ts` (inverted root assertion), a connection-manager test for the web demo path.
- Acceptance: on the Docker image a user can open the root URL and log in, save a device named `u64`, browse files on a second device, leave a tab open overnight and be sent to login rather than to the device password dialog, and see the app's own fonts.

**A9. HARD27-037 (offline device edits).**
- Production: `src/pages/SettingsPage.tsx` (`performSaveDevice` gates on host/HTTP-port/password change only).
- Tests: the Settings device-editor tests.
- Acceptance: renaming a powered-off device saves immediately.

**A10. HARD27-032 (playback session persistence).**
- Production: `src/pages/playFiles/hooks/usePlaybackPersistence.ts`, `src/pages/home/components/useListenActions.ts` (read the same store).
- Tests: persistence tests across a cleared `sessionStorage`.
- Acceptance: after a force-stop, the "Last" tile names the tune and "Resume session" restores the position.

**A11. HARD27-035, HARD27-034, HARD27-024, HARD27-025 (maintainability quick wins).** Each is a deletion or a consolidation with existing tests holding behaviour.
- Production: the six `catch` sites; `src/App.tsx`/`src/components/ui/sonner.tsx`; `src/lib/logging.ts`; `src/lib/native/streamUdp.ts`/`StreamUdpPlugin.kt`; `src/lib/connection/connectionManager.ts` (one probe); `src/lib/ftp/ftpConfig.ts`/`src/lib/telnet/telnetConfig.ts` (read ports from the store); one shared host-classification module.
- Acceptance: `grep -rn "catch {" src` matches only sites that log; the connection-manager tests pass against a single probe implementation.

### Phase B — bounded changes needing a policy decision

**B1. HARD27-011 (transient config writes and flash persistence).** Decide first whether playback-time writes should ever be flashed (recommended: never) and whether the restore snapshot should survive process death.
- Production: `src/lib/c64api.ts` (`updateConfigBatch` options), `src/hooks/useC64Connection.ts` (`useC64UpdateConfigBatch` passes options), `src/pages/playFiles/hooks/useVolumeOverride.ts`, `src/lib/deviceInteraction/pauseMuteCapture.ts`, `src/lib/config/configFlashPersistence.ts` (a transient write must not arm the save, and a pending save must not fire while a transient state is live), optionally `playbackSessionPersistence.ts` (localStorage keyed by device).
- Tests: `tests/unit/c64api.test.ts` (transient batch does not arm the save), `tests/unit/pages/playFiles/hooks/useVolumeOverride*.test.ts`, `tests/unit/lib/config/configFlashPersistence.test.ts`.
- Acceptance: with persist-to-flash on, starting, pausing and stopping a tune performs no `save_to_flash`; a Config-page edit still does.

**B2. HARD27-004 (secure-storage recovery policy).**
- Production: `SecureStoragePlugin.kt` (reject on read; classify exceptions; rename instead of delete; `commit()` for writes), `src/lib/secureStorage.ts` (no change expected; verify rejection handling), optional user notice.
- Tests: `android/app/src/test/.../SecureStoragePluginTest.kt` (transient read exception rejects without wiping; corruption on write still recovers), `tests/unit/secureStorage.test.ts` (rejected read does not persist an empty envelope).
- Acceptance: a single transient Keystore failure never deletes stored passwords.
- Alternative to record: replacing `androidx.security.crypto` with a direct Keystore-wrapped store; larger, schedule separately if chosen.

**B3. HARD27-014 (lane ownership across aborts).** Decide between "hold the lane until the native call settles" (simple, costs latency after an abort) and "add native cancellation" (an app-plugin change).
- Production: `src/lib/c64api.ts` (`runNativeSerialized` release tied to the native promise), possibly a small `CapacitorHttp` replacement in the app's own plugin with `cancel()`.
- Tests: `tests/unit/c64api.test.ts` (second request waits for the aborted native call).
- Acceptance: on CONSERVATIVE, at most one native device connection exists at any instant, aborts included.

**B4. HARD27-007 (media-session lifecycle on pause).** Product decision first: how long a paused session keeps the notification and session alive.
- Production: `backgroundExecutionPolicy.ts`, `PlayFilesPage.tsx` (pause path), `BackgroundExecutionService.kt` (paused state, `STATE_PAUSED`, release wake lock without stopping).
- Tests: `tests/unit/pages/playFiles/backgroundExecutionPolicy.test.ts`, `BackgroundExecutionServiceTest.kt`.
- Acceptance: headset Play resumes a tune paused within the grace period.


**B5. HARD27-021 (Live View lifecycle).** Product decision first: stop-and-restore on hide, or run the mirror under the foreground service with a notification and keep-screen-on.
- Production: `src/lib/streams/avMirrorSession.ts` (visibility subscription), `android/.../StreamUdpPlugin.kt` (`handleOnPause`/`handleOnResume`, lock release), `src/main.tsx`/`silenceLeftoverNativeAudio.ts` (device `streams:stop` on launch when a leftover is detected), optionally `BackgroundExecutionService.kt` (a Live View notification) and a keep-screen-on flag while `AvMirrorImmersive` is mounted.
- Tests: session visibility tests; `StreamUdpPluginTest.kt` lock release.
- Acceptance: hiding the app stops or backgrounds the mirror deliberately; a killed app leaves no stream running on the Ultimate after the next launch; the screen stays on while Live View is on screen.

**B6. HARD27-022 (navigation guard).** Decide between guarding every navigation path and moving the import off the page.
- Production: `src/lib/navigation/navigationGuards.ts`, `TabBar.tsx`, `SwipeNavigationLayer.tsx`, `App.tsx` (keypad jump), or `src/pages/playFiles/handlers/addFileSelections.ts` (module-level runner).
- Tests: replace the mocked-`block` test with one that renders the real router.
- Acceptance: leaving Play during an import either prompts or does not lose the import.

**B7. HARD27-036 (governor in test builds).** Decide the mechanism: injectable clock with the governor on, or a probe-build override for the HIL APK only.
- Production: `src/lib/deviceInteraction/deviceInteractionManager.ts` (`isTestEnv` split into "deterministic" and "ungoverned"), `build`, `.github/workflows/android.yaml`, `tools/hil/merge_gate.mjs`.
- Tests: a golden trace for one slider drag recorded with the governor on.
- Acceptance: the hardware merge gate runs the production request pattern; a doubled request rate on a slider drag fails a CI trace.

**B8. HARD27-028 (HVSC install robustness).**
- Production: `src/pages/playFiles/hooks/useHvscLibrary.ts` (hold the foreground service for the install), `src/lib/hvsc/hvscDownload.ts` (`Range` resume), `android/.../HvscIngestionPlugin.kt` and the iOS plugin (free-space check before download).
- Tests: runtime test for service start/stop around an install; plugin test for the space check.
- Acceptance: an install survives the screen locking; a second attempt resumes the download; a full phone is told how much space is needed before anything is downloaded.

**B9. HARD27-040 (now-playing metadata and notification actions).**
- Production: `android/.../BackgroundExecutionPlugin.kt`/`Service.kt` (`setNowPlaying`, `MediaStyle` notification with Pause/Next), `src/lib/native/backgroundExecution.ts`, `usePlaybackController.ts` (call on track change and pause/resume).
- Tests: `BackgroundExecutionServiceTest.kt` metadata; a TypeScript test that the controller publishes metadata.
- Acceptance: the lock screen shows the tune title and offers Pause and Next.

### Phase C — changes that need hardware or platform validation before they can be judged

**C1. HARD27-005 (sender-filter diagnostics).**
- Production: `StreamUdpPlugin.kt` (export rejected count and last source), `src/lib/native/streamUdp.ts` (types), `audioMirrorController.ts`/`videoMirrorController.ts` (specific error and adopt/accept path), `StreamStatsPanel.tsx` (show rejected packets).
- Tests: `StreamUdpPluginTest.kt` (rejection stats), controller tests (specific error text).
- Acceptance: a stream from an unexpected address is diagnosed by name in the card and in Stats, with a one-tap recovery.
- Validation: dual-homed Ultimate on the bench (see section 8).

**C2. HARD27-006 (audio focus).**
- Production: `StreamUdpPlugin.kt` (focus request on `openAudioTrack`, focus-change event), `AudioPipeline.kt` (duck via `setGain`), `src/lib/native/streamUdp.ts` (event type), `localSidPlaybackController.ts` and `avMirrorSession.ts` (pause/stop on loss, resume on gain), `BackgroundExecutionService.kt` (remove or keep the duplicate request).
- Tests: `StreamUdpPluginTest.kt`, TypeScript controller tests for the event.
- Acceptance: starting another media app pauses on-device playback and stops or ducks the mirror; the app does not play over a call.
- Validation: HIL with a second media app and a phone call, at the bench volume ceiling.

**C3. HARD27-018 (iOS HVSC streaming and staged promotion).** The invasive iOS change; isolate it from A4.
- Production: `ios/App/App/HvscIngestionPlugin.swift` (streaming extraction into staging, promotion by rename, size guard), `docs/architecture.md` (correct the table until it is true).
- Tests: `ios/native-tests` (old library survives a failed or cancelled install).
- Acceptance: a cancelled or failed iOS install leaves the previous library intact; a baseline install completes on the smallest supported device.
- Validation: iOS device with the real archive.


**C4. HARD27-038 and HARD27-039 (transition mounts and the focus engine).** Both are main-thread costs that need the small keypad-only handset to be judged; measure first with the existing responsiveness script, then fix the larger.
- Production: `src/components/SwipeNavigationLayer.tsx` (skeleton for adjacent slots during a transition), `src/hooks/useFocusNavigation.tsx` (start the engine on the first key event).
- Tests: the inverted mount/unmount test; a hook test that no observer is attached in pointer modality.
- Acceptance: measured transition and scroll jank on the small keypad-only handset below the budget the team sets; no functional change for keypad users.

**C5. HARD27-023 and HARD27-026 (documentation and modularity).** Not validation-dependent, but continuous: land the CI checks (inventory coverage, file-size ceiling) first, then work the lists down in the PRs that touch each file.
- Production: `docs/cta-inventory.md`, `docs/architecture.md`, a new `scripts/check-cta-inventory.mjs` and a size check in `npm run lint`; the splits listed under HARD27-026.
- Acceptance: the inventory check passes; no file grows past the ceiling; the grandfathered list shrinks each round.

Dependencies: A1 and A2 are independent of everything else. A8 depends on A1 (the password path) and on the host policy chosen for HARD27-016 in A2, so A2 and A8 should be designed together even if they land separately. B5 should land before C1 because both touch the mirror controllers, and before any Live View HIL round. B7 should precede the next hardware merge-gate run so the gate exercises the governor. A3 and A4 share the parity-matrix edit and should land together or in sequence; C3 builds on A4's Swift test harness. A5 must land before C1 so the mirror restart path exists on both switches; A6 touches the same controller as C1 and should land first. B1 is independent but should precede any HIL round that uses the persist-to-flash setting. B3 should land before further c64u bench work that exercises manual discovery. B4 and C2 both touch `BackgroundExecutionService.kt`; land B4 first because it changes the service lifecycle C2's focus handling depends on.

## 8. Residual risks and validation after implementation

- **Most important unresolved static uncertainty:** whether transient Keystore exceptions reach `SecureStoragePlugin.getPassword` on the shipped device population (HARD27-004). The destructive path is certain; its frequency is not. Field diagnostics should count the existing "Recovering encrypted preferences" warning before and after the fix. Close behind it: whether the post-abort overlapping connection (HARD27-014) actually wedges firmware 1.1.0 on the bench, which decides whether B3 is a hardening item or a release blocker for c64u owners.
- **Dual-homed Ultimate (HARD27-005):** needs a bench run with the C64 Ultimate on both Wi-Fi and Ethernet and the app pointed at each address in turn. Until then the finding's precondition is unconfirmed.
- **iOS:** none of the iOS findings can be verified without a simulator or device; the Maestro iOS flows do not cover folder import, Live View, Telnet reconnection, large FTP reads or an HVSC install. Add a Maestro flow for each after A3/A4/C3.
- **Web:** validate A1/A2 in the Docker image against a password-protected C64U (or the mock server with a password) including a container restart, re-login, a proxied request to a non-configured host, and a hung upstream.
- **Flash persistence (HARD27-011):** the bench run described in the finding (force-stop mid-tune with persist on, power-cycle, read the mixer) both confirms the defect and validates B1; it should be done before any further HIL round enables that setting.
- **Audio focus and media session (HARD27-006/007):** HIL with a headset and a second media app; keep the bench volume at or below 10 of 25.
- **Not reviewed line by line:** `usePlaybackController.ts` beyond its effects and guards, `SearchOverlay.tsx`, `TourDriver.tsx`, `DiagnosticsDialog.tsx`, `HomeDiskManager.tsx` beyond the recursive-import path, the HVSC browse index and hydration, the SID Radio engine, and the Swift bodies of the iOS FTP session and HVSC extraction beyond the entry points named. These are candidates for the next round.
- **Live View lifecycle (HARD27-021):** the exact behaviour of the paused WebView while the native receive threads keep pushing frames (memory growth versus dropped bridge calls) needs a measurement on the bench with the app hidden for ten minutes.
- **Governor-off test builds (HARD27-036):** until B7 lands, every automated request-pattern result, including golden traces and the hardware gate, describes an ungoverned app; treat them as functional evidence only.
- **Web server sessions are in memory** (`authState.ts:45`): every restart logs every browser out. Acceptable for a LAN tool, but it turns HARD27-001 from an inconvenience into a lock-out; worth a persisted session secret if the web platform is promoted.

## 9. Method note

All statements about behaviour in this document follow from reading the pinned sources; line numbers refer to commit `3ba8db051`. Where a claim depends on platform behaviour outside the repository (Capacitor's unimplemented-plugin rejection, androidx security-crypto exception classes, Android audio-focus policy during calls, SWCompression's in-memory extraction, the firmware's response to concurrent connections), the dependency is named in the finding and the confidence is set accordingly. Nothing here was executed.
