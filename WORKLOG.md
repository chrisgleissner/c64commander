# Production Hardening 2 — Research Worklog

> Research-only task. Evidence log for `docs/research/stabilization/prod-hardening-2/research.md`.
> The prior device-safety *implementation* worklog is preserved in git history
> (commits `733adf2d`, `f7cd0d4d`, `9963d3e6`, `fa6e711e`). This file logs the
> *research* investigation that follows it.

## Entry 1 — Orientation

- Read root `PLANS.md`/`WORKLOG.md` (prior implementation task). They document the
  device-safety scheduler, config write throttle, slider intent, and the fixes that
  landed in recent commits. Used as a starting evidence map, re-verified below.
- Inspected repo layout: `src/lib/deviceInteraction/`, `src/lib/config/`,
  `src/lib/ftp/`, `src/lib/telnet/`, `src/lib/diagnostics/`, `src/hooks/`, `src/pages/`.
- Recent commits confirm active hardening: `733adf2d Prevent bypass of backoff`,
  `f7cd0d4d Maintain device safety backoff`, `fa6e711e Mute volume on pause`.

## Entry 2 — Core safety layer (Objective 1) — VERIFIED

Files read in full:

- `deviceInteractionManager.ts` — central gateway. Exposes `withRestInteraction`,
  `withFtpInteraction`, `withTelnetInteraction`. Per-transport `InteractionScheduler`
  with intent priority queues (`user` > `system` > `background`), concurrency limits
  (REST=1, Telnet=1, FTP=`config.ftpMaxConcurrency`), cooldown maps, error-streak
  backoff (`computeBackoff`), circuit breaker, cache+inflight coalescing for reads,
  `getReadyAtMs` deferred drain for read cooldown/backoff. `resetInteractionState`
  cancels queued tasks on device switch (`InteractionCancelledError`).
  - `isTestEnv()` short-circuits ALL gating in tests → scheduling only exercised in
    prod/forced mode. Evidence-relevant for test strategy.
  - `shouldBlockForState`: user intent can proceed during DISCOVERING; ERROR blocks
    background, allows user if `allowUserOverrideCircuit`.
  - Read-priority yielding: non-user read-only REST waits on
    `waitForBackgroundReadsToResume()` while write bursts active; system reads log
    "yielding to user device activity".
- `deviceSafetySettings.ts` — 4 concrete presets + AUTO. AUTO→CONSERVATIVE for `C64U`,
  AUTO→BALANCED for U64 family / unverified. CONSERVATIVE: configsCooldown 1200ms,
  ftpListCooldown 800ms, ftpMaxConcurrency 1, circuit threshold 2, no user override.
  Overrides via localStorage; broadcast triggers scheduler `updateConfig` (clears all
  state). `discoveryProbeIntervalMs` present.
- `configWriteThrottle.ts` — serialized FIFO queue; `waitForInterval` uses
  `max(appIntervalMs, safety.configsCooldownMs)`. So config writes are double-gated
  (this queue + REST scheduler config-mutation cooldown).
- `latestIntentWriteLane.ts` — latest-value-wins lane: only most recent scheduled
  value runs; superseded values are skipped, waiters resolved up to settled version.
- `deviceActivityGate.ts` — counts machine-transition + playback/interactive write
  bursts; `areBackgroundReadsSuspended()` gates background/system reads.
  `beginInteractiveWriteBurst = beginPlaybackWriteBurst`.

Conclusion: a genuine unified-per-protocol gateway exists with priority, coalescing,
backoff, circuit breaking. Approved boundaries = the three `with*Interaction` wrappers
+ `scheduleConfigWrite` for config writes.

## Entry 3 — Transport layer (Objective 2) — VERIFIED

- `c64api.ts` (2407 lines). `request<T>()` (l.792) routes every call through
  `withRestInteraction` (l.858) inside `runWithImplicitAction`; intent defaults
  to `"user"` (l.803). C64API-layer budget-replay cache + in-flight dedupe sit on
  top of the scheduler's cache. The raw `fetch` at l.945 is INSIDE the gateway.
- `fetchWithTimeout()` (l.1198) ALSO routes through `withRestInteraction` BUT
  hardcodes `intent: "user"` (l.1216) and threads no cooldown intent. Callers:
  `readMemory` (l.1673), `writeMemoryBlock` (l.1717), uploads (l.1820/1930/2007/
  2059/2111/2164). => memory reads/writes + uploads are always `user` priority and
  the readmem/writemem paths resolve to NO cooldown key in `resolveRestPolicy`.
- Config writes: `setConfigValue` (l.1519), `updateConfigBatch` (l.1563),
  save/load/reset (l.1551-1561) all wrap `scheduleConfigWrite(...)` => double-gated
  (config queue + REST config-mutation cooldown). `updateConfigBatch`'s `immediate`
  option (l.1595) now ONLY logs — it no longer bypasses the queue (prior fix holds).
- Machine control (`machineReset/reboot/pause/resume/poweroff/menu_button`,
  l.1611-1657) route through `request` with MACHINE_CONTROL_COOLDOWN_MS=250.

## Entry 4 — Bypass search (Objective 2)

- `rg fetch(` => non-gateway device calls:
  - `connectionManager.ts` l.194/322/426: raw `fetch(${baseUrl}/v1/info)` in
    `probeWithFetch`/`probeInfoOnce`/`probeInfoWithConnectionConfig`. Used in test
    env AND as a PRODUCTION fallback when `api.getInfo` throws a non-HTTP error
    (network/timeout) => fires OUTSIDE the scheduler precisely when the device is
    struggling. CONFIRMED BYPASS.
  - `GlobalDiagnosticsOverlay.tsx` l.59 `validateTarget`: raw `fetch(/v1/info)`,
    user-triggered diagnostics. CONFIRMED BYPASS (diagnostics-scoped).
  - `ftpClient.web.ts` l.61: bridge HTTP call — this is the FTP transport invoked
    INSIDE `withFtpInteraction`; not a bypass.
  - hvsc/licenses/mockConfig/webServerLogs/secureStorage.web fetches => NOT device
    traffic (CDN/asset/local bridge).
- `rg immediate: true` => `useLightingStudio` l.561, `applyConfigFileReference`
  l.257, `useVolumeOverride` l.298/338. All go through `updateConfigBatch` =>
  `scheduleConfigWrite` => safe (immediate is a no-op for bypass).
- `configDrift.ts`: `getCategories/getConfigItem` with `__c64uIntent:"system"`,
  `__c64uBypassCache:true` => through gateway. Safe (system reads, cache bypass only).

## Entry 5 — Health-check load (Objective 4) — VERIFIED

- Two health systems:
  1. Active-device singleton `runHealthCheck()` (healthCheckEngine l.1655). Manual
     only, triggered by GlobalDiagnosticsOverlay "Run health check" (l.365). 6 probes
     sequential: REST→FTP→TELNET→CONFIG→RASTER→JIFFY. REST failure short-circuits the
     rest. Global 12s deadline.
  2. Saved-device `useSavedDeviceHealthChecks` (mounted in `UnifiedHealthBadge`
     l.339). Probes ALL saved devices in PARALLEL (`Promise.allSettled(devices.map)`).
     Cadence: picker open => `switchDeviceDialog` ctx, 10s, CONFIG-pulse ALLOWED;
     picker closed => `backgroundMaintenance` ctx, 60s, CONFIG read-only/skipped.
- Per-device cost per cycle (visible-config-pulse-allowed): REST getInfo +
  FTP list + TELNET connect/auth/banner + CONFIG roundtrip (up to 2 writes + 3 reads
  per target, iterates up to 4 targets until one succeeds) + RASTER readMemory(+retry)
  + JIFFY readMemory(+retry). ~9-13 device ops. Background (read-only) drops CONFIG.
- Probe intents/bypasses:
  - REST probe: `__c64uIntent:"system"`, `__c64uBypassCache:true`,
    `__c64uBypassCircuit:true`, `__c64uAllowDuringError:true` => bypasses circuit/cache.
  - CONFIG-pulse `setConfigValue`: NO `__c64uIntent` => defaults `"user"` => runs at
    USER priority through `scheduleConfigWrite`, competing with real user writes.
  - JIFFY/RASTER `readMemory`: intent dropped by `fetchWithTimeout` => forced `"user"`.
  - FTP probe: intent `"system"` via `withFtpInteraction`. TELNET probe: `"system"`
    via `withTelnetInteraction`.
- All per-device `new C64API(...)` instances share the SAME module-singleton
  schedulers (REST/Telnet concurrency 1, FTP=ftpMaxConcurrency). REST/FTP cooldown
  keys are host/baseUrl-scoped, so cross-device probes don't share cooldown but DO
  serialize through one concurrency slot.
- Pause guards (backgroundMaintenance only): `shouldPauseForForegroundSwitch`,
  `shouldPauseForDiagnosticsSuppression`, `shouldPauseForPollingPause`. NOT applied to
  `switchDeviceDialog` (10s, picker open). AbortController cancellation per device.

## Entry 6 — Polling / lifecycle / sliders (Objective 3)

- `useC64Connection`: info query intent `"background"`, gated by `screenActive`,
  `diagnosticsSuppression`, `pollingPaused`; refetchInterval `HEALTH_CHECK_INTERVAL_MS`
  (60s) and only when `shouldRunScheduledHealthCheck()`. Drives poll 30s/60s idle.
  getCategory/getConfigItem staleTime 30-60s. Config write mutation =>
  `api.setConfigValue` => scheduleConfigWrite.
- `c64PollingGovernance.pollingPauseRegistry`: ref-counted pause acquired by sliders
  (`useDeviceBoundSlider.acquirePollingPauseIfNeeded`) and observed by info/drives
  polling AND background health maintenance.
- `useDeviceBoundSlider`: local-only draft state; throttled preview (latest-wins via
  timer + pending ref), single commit on release; pending-intent latches visible value
  and ignores stale device echoes; watchdog releases pause; clears on device switch /
  visibility hidden. Preview/commit both route to caller's `preview`/`commit` which go
  through `useInteractiveConfigWrite` lane (lighting) or `setConfigValue` (ConfigItemRow).
- `useInteractiveConfigWrite`: `createLatestIntentWriteLane` + 400ms quiet window +
  `waitForMachineTransitionsToSettle` + `beginInteractiveWriteBurst(configsCooldownMs)`;
  always `immediate:false, skipInvalidation:true`; debounced reconciliation invalidate.
- `useVolumeOverride`: own latest-intent lane + `beginPlaybackWriteBurst`; uses
  `immediate:true` (no-op) through `updateConfigBatch`. Safe.
- Sliders are well-coalesced. Residual risk: ConfigItemRow preview throttle still emits
  one preview write per throttle window during a long drag (bounded by throttle, not 1),
  and the commit always fires; acceptable but worth a documented bound.

## Entry 7 — Working-tree note

- At research time the tree also showed pre-existing edits NOT made by this task:
  `.github/workflows/android.yaml`, `playwright/playback.part2.spec.ts`,
  `tests/unit/ci/telemetryGateWorkflow.test.ts`. Left untouched per concurrent-change
  policy. This research task changed only `PLANS.md`, `WORKLOG.md`, and the new
  `docs/research/stabilization/prod-hardening-2/research.md`.

## Entry 8 — Product-direction clarification (amendment)

User clarified after the initial research draft:
1. The **picker-open 10 s full health cycle is WANTED and kept** (not a risk). The
   real problem is **excessive BACKGROUND health checks** (the 60 s parallel fan-out
   across all saved devices with REST+FTP+Telnet+memory).
2. The `connectionManager` raw-fetch fallback is **nonsense — delete it.** Remove all
   strange quirks from REST/Telnet/FTP and keep the calls simple.
3. **Do not chase the C64U lock-up root cause** (rabbit hole). Assume any fast sequence
   of REST/Telnet/FTP calls can wedge the listener and harden against that class.

Actions: amended `research.md` (exec summary, health section, risk register, inventory
rows 15/24, CTA table, roadmap P1/P2, acceptance criteria, target policy, open
questions). Authored `docs/research/stabilization/prod-hardening-2/plans.md`
(implementation plan to fix every finding) and `prompt.md` (executable handoff prompt).
Best-practice background-health design = traffic-derived health + selected-device-only
+ freshness gate + single lightweight `/v1/info` probe + adaptive cadence + circuit
respect; picker-open path untouched.
