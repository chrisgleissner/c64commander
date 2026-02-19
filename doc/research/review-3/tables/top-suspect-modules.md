# Top Suspect Modules by Risk

| Module | Risk theme | Evidence | Why high-risk |
| --- | --- | --- | --- |
| `src/lib/c64api.ts` | Network retries, timeout/cancellation, large payload handling | 1620 LOC; dense timeout/retry logic; idle-aware retries; upload retry path | Central transport path for all runtime actions; subtle regressions can affect whole app. |
| `src/lib/hvsc/hvscIngestionRuntime.ts` | Long-running ingest state machine | 977 LOC; install/update/cached paths + cancel/error transitions | Multi-phase flow with persistence/state transitions and error cleanup complexity. |
| `src/lib/hvsc/hvscDownload.ts` | Memory pressure | In-memory buffers + stream concat + guarded read size checks | Archive handling can spike memory on low-RAM devices if native path unavailable. |
| `src/lib/hvsc/hvscArchiveExtraction.ts` | CPU + memory hot path | zip accumulation and 7z wasm extraction; memory profiling logs | Large archive extraction cost is concentrated here. |
| `web/server/src/index.ts` | Auth/proxy/session correctness | 843 LOC; branch coverage 58.10% | Web production surface has low branch coverage in high-complexity file. |
| `src/lib/connection/connectionManager.ts` | Discovery lifecycle/timers | startup/manual/background probe loops with interval/timeouts | Incorrect transitions can create retry storms or stale state. |
| `src/lib/deviceInteraction/deviceInteractionManager.ts` | Concurrency and circuit logic | Scheduler + cache + cooldown + backoff + circuit breaker | Coordination bugs can produce perceived hangs or request starvation. |
| `src/pages/SettingsPage.tsx` | UI complexity + config reliability | 1899 LOC; branch coverage ~69.84%; funcs ~38.54% | Large surface mixes UX, persistence, diagnostics flows. |
| `src/pages/HomePage.tsx` | Dense home UI and controls | 1052 LOC; branch coverage ~69.3%; funcs ~32.35% | High-interaction page on constrained screens/CPU. |
| `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt` | Native ingest correctness | 765 LOC; streaming + DB batching + cancellation | Android-native ingest is critical for low-memory stability and update integrity. |
