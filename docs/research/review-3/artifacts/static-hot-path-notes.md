# Static Hot-Path Mapping

## 1) Startup to first interactive
- Entry: `src/main.tsx` initializes tracing, diagnostics, password priming, and font loading before root render.
- App shell: `src/App.tsx` mounts global listeners/bridges and `ConnectionController`.
- Startup discovery: `src/components/ConnectionController.tsx` -> `discoverConnection('startup')` in `src/lib/connection/connectionManager.ts`.
- Potential bottlenecks:
  - Startup probe loop and state transitions (`setTimeout` + `setInterval`) while app shell mounts.
  - Additional JS work at boot (trace bridges, diagnostics, font stylesheet insertion).

## 2) Navigation between main pages
- Router + tab nav: `src/App.tsx`, `src/components/TabBar.tsx`.
- Route refresh invalidates all `c64*` queries on pathname/visibility changes.
- Potential bottlenecks:
  - Broad query invalidation on every route transition can re-trigger expensive fetches on low CPU.

## 3) Discovery and connection lifecycle
- Core state machine: `src/lib/connection/connectionManager.ts`.
- Background rediscovery: `src/components/ConnectionController.tsx` periodic timer in demo/offline states.
- Potential bottlenecks:
  - Probe cadence under degraded networks.
  - Repeated transitions causing churn in query invalidation and device guard state.

## 4) REST and FTP interaction patterns
- REST client: `src/lib/c64api.ts` with timeout + idle-aware retry + request tracing.
- Interaction guard/scheduler: `src/lib/deviceInteraction/deviceInteractionManager.ts` with coalescing, cache, cooldown, and circuit-breaker logic.
- FTP bridge: `src/lib/native/ftpClient.web.ts` and native plugins.
- Potential bottlenecks:
  - Large response JSON parsing on single JS thread.
  - Accumulated retry/backoff windows causing perceived latency spikes.

## 5) Large ingest and parsing (HVSC)
- Orchestration: `src/lib/hvsc/hvscIngestionRuntime.ts`.
- Download/read paths: `src/lib/hvsc/hvscDownload.ts`.
- Archive extraction: `src/lib/hvsc/hvscArchiveExtraction.ts` (zip and 7z wasm fallback).
- Android native ingestion: `android/.../HvscIngestionPlugin.kt` streams entries and batches SQLite writes.
- Potential bottlenecks:
  - Non-native path can keep full archive buffers and many extracted entries in JS memory.
  - 7z wasm payload and extraction work add startup/interaction pressure if loaded on constrained devices.

## 6) Dense UI rendering surfaces
- Home/UI-heavy pages: `src/pages/HomePage.tsx`, `src/pages/SettingsPage.tsx`, `src/components/disks/HomeDiskManager.tsx`, `src/components/lists/SelectableActionList.tsx`.
- Potential bottlenecks:
  - Large component trees and frequent state updates.
  - Small-screen touch target density and overflow pressure around bottom tab and action-heavy sections.
