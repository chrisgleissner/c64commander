# iOS Portability Parity Matrix

## Plugin Parity

| Feature | Android | iOS | Status |
|---------|---------|-----|--------|
| FolderPickerPlugin | SAF-based | UIDocumentPicker + security-scoped bookmarks | **Parity** |
| FtpClientPlugin | Apache FTPClient | CFStream/socket FTP | **Parity** |
| SecureStoragePlugin | EncryptedSharedPreferences | Keychain | **Parity** |
| FeatureFlagsPlugin | SharedPreferences | UserDefaults | **Parity** |
| BackgroundExecutionPlugin | Full foreground service + WakeLock + auto-skip alarm | **No-op stub** — start/stop/setDueAtMs log and resolve immediately | **Gap** |
| DiagnosticsBridgePlugin | BroadcastReceiver → JS | NotificationCenter → JS + debug HTTP server | **Parity** |
| MockC64UPlugin | Mock HTTP + FTP servers | NWListener + Darwin sockets | **Parity** |
| AppLogger | Broadcast-based structured logger | IOSDiagnostics with os_log + NotificationCenter | **Functional parity** |

## Infrastructure Parity

| Area | Android | iOS | Status |
|------|---------|-----|--------|
| Native unit tests | 13 JVM test classes (82 tests) | 0 XCTest classes | **Gap** |
| CI gating | Required check (android-apk.yaml) | Stage A / informative (ios-ci.yaml) | **Gap** |
| Signed distribution | Debug APK + conditional release APK | Unsigned AltStore IPA only | **Gap** |
| Maestro E2E flows | 6 ci-critical flows | 6 ci-critical-ios flows | **Parity** |
| HVSC module | Shared TypeScript (no native code) | Same shared TypeScript | **Parity** |

## Accepted Gaps

### 1. Background Execution (no-op on iOS)

iOS `BackgroundExecutionPlugin` is a stub. SID playback is interrupted when backgrounded.

**Impact**: No auto-advance when screen locks on iOS.

**Mitigation path**: Implement `AVAudioSession` background mode with `BGTaskScheduler` for dueAt alarm scheduling. Requires `UIBackgroundModes: audio` entitlement.

**Accepted for MVP**: Yes — Android is the primary platform. iOS background audio is a post-MVP feature.

### 2. No iOS Native Unit Tests

All iOS plugin implementations live in `NativePlugins.swift` (907 lines). No XCTest coverage exists.

**Mitigation path**: Extract individual plugin classes into separate files, add XCTest targets.

**Accepted for MVP**: Yes — iOS Maestro flows provide integration-level coverage. Native unit tests are post-MVP.

### 3. iOS CI Non-Blocking

iOS CI runs on `macos-15` but defaults to Stage A (informative, non-blocking).

**Mitigation path**: Promote to Stage B (required check) once iOS stability matures.

**Accepted for MVP**: Yes — prevents iOS failures from blocking Android releases.

### 4. `NativePlugins.swift` Size

At 907 lines, approaching the 1000-line limit. Contains 6 plugin implementations + shared infra.

**Mitigation path**: Split into per-plugin files (matching Android structure).

**Status**: Track in Step 11 if file exceeds 1000 lines.

## CI Assertions

The following iOS CI assertions exist:

- `ios-build-simulator` verifies Xcode build succeeds for simulator target
- `ios-maestro-critical` runs 6 ci-critical-ios Maestro flows
- `ios-screenshots` captures 3 scenario screenshots with debug payloads
