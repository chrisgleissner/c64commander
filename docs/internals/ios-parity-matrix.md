# iOS Portability Parity Matrix

## Plugin Parity

| Feature                   | Android                                              | iOS                                                                                                                                                                                                                     | Status                |
| ------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| FolderPickerPlugin        | SAF-based                                            | UIDocumentPicker + security-scoped bookmarks; both read paths bounded at 32 MiB with Android's message (HARD27-012). `releasePersistedUris` is absent because a bookmark is released when it goes out of scope. `canPickDocuments` answers true on both counts: UIDocumentPickerViewController is part of UIKit, whereas Android resolves the intent because a device built without Google Mobile Services can have no picker at all           | **Parity**            |
| FtpClientPlugin           | Apache FTPClient                                     | CFStream/socket FTP. `listDirectoryRecursive` walks one connection with Android's depth and entry caps and the same early exit on a data-channel timeout; `cancelRead` uses a cancellation registry the read loop polls (HARD27-003); reads apply Android's idle timeout and 32 MiB cap (HARD27-012) | **Parity**            |
| SecureStoragePlugin       | EncryptedSharedPreferences                           | Keychain                                                                                                                                                                                                                | **Parity**            |
| FeatureFlagsPlugin        | SharedPreferences                                    | UserDefaults                                                                                                                                                                                                            | **Parity**            |
| BackgroundExecutionPlugin | Full foreground service + WakeLock + auto-skip alarm | `AVAudioSession` category set + `beginBackgroundTask` + main-queue due timer (fires `onBackgroundAutoSkipDue` when elapsed) — partial implementation: timer may expire before song end under iOS background-task limits | **Partial**           |
| DeviceDiscoveryPlugin     | Subnet sweep plus `getNetworkStatus`                 | `getNetworkStatus` answers from a long-lived `NWPathMonitor` (HARD27-003); `discover` still resolves `unsupported`, so the app falls back to its saved host rather than scanning                                          | **Partial**           |
| DiagnosticsBridgePlugin   | BroadcastReceiver → JS                               | NotificationCenter → JS + debug HTTP server                                                                                                                                                                             | **Parity**            |
| TelnetSocketPlugin        | Socket + `Connection closed` on EOF (HARD20-006)     | CFStream sockets; EOF now closes the streams and reports `Connection closed`, which the TypeScript client maps to `CONNECTION_CLOSED` so the session reconnects (HARD27-013)                                             | **Parity**            |
| MockC64UPlugin            | Mock HTTP + FTP servers                              | NWListener + Darwin sockets                                                                                                                                                                                             | **Parity**            |
| AppLogger                 | Broadcast-based structured logger                    | IOSDiagnostics with os_log + NotificationCenter                                                                                                                                                                         | **Functional parity** |
| StreamUdpPlugin           | UDP multicast socket + native VIC frame assembly + native AudioTrack sink | Not registered (`AppDelegate.swift`) — `Capacitor.isPluginAvailable("StreamUdp")` is false, so Live View and Game Mode streams degrade to the unsupported receiver | **Android only** |
| DeviceRotationPlugin      | Locks/unlocks the activity orientation                                    | Not registered — orientation stays under iOS control                                                                                                            | **Android only** |
| SafeAreaPlugin            | Reports display cutout and system bar insets                              | Not registered — the web `env(safe-area-inset-*)` values are used instead                                                                                       | **Android only** |
| LibraryInstallPlugin      | Foreground service keeping an HVSC install alive across a leave            | Not registered — the install runs in the foreground only, and is abandoned if iOS suspends the app                                                              | **Android only** |

> **Method-level parity is enforced by a test.** `tests/unit/ci/iosPluginMethodParity.test.ts`
> reads each Swift plugin's `pluginMethods` array and each TypeScript `registerPlugin` contract in
> `src/lib/native`, and fails when a declared method has no Swift implementation and no recorded
> reason. The recorded gaps live in `KNOWN_IOS_METHOD_GAPS` in that file, with one reason each, and
> the list may only shrink. It is a source comparison, so it runs in the normal unit suite rather
> than on a macOS runner.

## Infrastructure Parity

| Area                | Android                             | iOS                              | Status      |
| ------------------- | ----------------------------------- | -------------------------------- | ----------- |
| Native unit tests   | 33 JVM test classes (480 tests)     | 10 XCTest classes (86 tests)     | **Partial** |
| CI gating           | Required check (android.yaml)       | Stage A / informative (ios.yaml) | **Gap**     |
| Signed distribution | Debug APK + conditional release APK | Unsigned AltStore IPA only       | **Gap**     |
| Maestro E2E flows   | 6 ci-critical flows                 | 6 ci-critical-ios flows          | **Parity**  |
| HVSC module         | Android native plugin + TS runtime  | iOS native plugin + TS runtime   | **Partial** |

## Accepted Gaps

### 1. Background Execution (no-op on iOS)

iOS `BackgroundExecutionPlugin` is a stub. SID playback is interrupted when backgrounded.

**Impact**: No auto-advance when screen locks on iOS.

**Mitigation path**: Implement `AVAudioSession` background mode with `BGTaskScheduler` for dueAt alarm scheduling. Requires `UIBackgroundModes: audio` entitlement.

**Accepted for MVP**: Yes — Android is the primary platform. iOS background audio is a post-MVP feature.

### 2. iOS Native Unit Tests Cover Logic, Not the Plugin Classes

`ios/native-tests` is a SwiftPM package with 10 XCTest classes (86 tests). It cannot import the app
target, so each case either runs against a mirror of the logic in `Sources/NativeValidation` or
asserts on the text of the app source file, and the two are paired so the mirror cannot pass while
the app has drifted away from it. Nothing instantiates a `CAPPlugin`, so a `CAPPluginCall` is never
exercised.

**Mitigation path**: An XCTest target inside the Xcode project, which needs a macOS runner to run at
all and so cannot fail on the machine that made the change.

**Accepted for MVP**: Yes — iOS Maestro flows provide integration-level coverage above the mirrors.

### 3. iOS CI Non-Blocking

iOS CI runs on `macos-15` but defaults to Stage A (informative, non-blocking).

**Mitigation path**: Promote to Stage B (required check) once iOS stability matures.

**Accepted for MVP**: Yes — prevents iOS failures from blocking Android releases.

### 4. `NativePlugins.swift` Size

At 455 lines, within the 1000-line limit. FTP, Telnet and HVSC ingestion have since moved into
`IOSFtp.swift`, `TelnetSocketPlugin.swift` and `HvscIngestionPlugin.swift`.

**Mitigation path**: Split into per-plugin files (matching Android structure).

**Status**: Track in Step 11 if file exceeds 1000 lines.

## CI Assertions

The following iOS CI assertions exist:

- `ios-build-simulator` verifies Xcode build succeeds for simulator target
- `ios-maestro-tests` runs 6 Maestro flows in a matrix build (1 flow per job)
- `ios-screenshots` captures 3 scenario screenshots with debug payloads
