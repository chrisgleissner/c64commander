# Native Platform Risk Notes

## Android
- Background execution path uses a foreground service + partial wake lock:
  - `android/.../BackgroundExecutionService.kt`
  - Wake lock timeout: 10 minutes, idle timeout: 60 seconds.
- HVSC ingestion path streams archive entries and batches metadata writes in SQLite:
  - `android/.../HvscIngestionPlugin.kt`
- Current blocker in local JVM test layer:
  - `Unsupported class file major version 69` under JDK 25 + JaCoCo path.
  - Large set of Robolectric plugin tests fail secondarily with `NoClassDefFoundError`.

## iOS
- Background execution plugin methods are explicit no-ops:
  - `ios/App/App/NativePlugins.swift` (`BackgroundExecutionPlugin.start/stop/setDueAtMs`).
- App lifecycle hooks for background/foreground are present but mostly default/comment-only logic:
  - `ios/App/App/AppDelegate.swift`.
- Implication:
  - Cross-platform behavior parity risk for long-running/background-sensitive flows.
  - Additional WKWebView memory/lifecycle validation is needed on low-memory profiles.
