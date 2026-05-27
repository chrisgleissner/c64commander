# Production Hardening 2 Research: Device Call Safety and Health-Check Load

> **Status:** Research only. No production behaviour, tests, or formatting were
> changed. This document is an evidence-backed specification for future
> implementation work; it does not claim any implementation is complete.
>
> **Repo:** C64 Commander (React + Vite + Capacitor). Target devices:
> Commodore 64 Ultimate (`C64U`) and Ultimate 64 family (`U64`/`U64E`/`U64E2`)
> over REST, FTP, and Telnet.
>
> **Date of investigation:** 2026-05-26. **Branch:** `fix/playback-volume-control`.

---

## Executive Summary

C64 Commander already has a real, well-structured device-protection layer. All
three protocols funnel through a single module
(`src/lib/deviceInteraction/deviceInteractionManager.ts`) that exposes
`withRestInteraction`, `withFtpInteraction`, and `withTelnetInteraction`. These
provide priority queues (`user` > `system` > `background`), per-transport
concurrency limits (REST=1, Telnet=1, FTP=configurable), per-resource cooldowns,
exponential backoff on error streaks, a circuit breaker, read caching/coalescing,
and queue cancellation on device switch. Device-safety presets
(`deviceSafetySettings.ts`) auto-select **CONSERVATIVE** for `C64U`. Config writes
are additionally serialized through `scheduleConfigWrite`. Sliders are coalesced
through `useDeviceBoundSlider` + `useInteractiveConfigWrite` (latest-intent lane +
quiet window). The recent commits (`733adf2d`, `f7cd0d4d`) closed the largest
historical bypass: `updateConfigBatch({ immediate: true })` no longer skips the
config queue.

**The remaining risk is not the happy path — it is the edges that talk to the
device precisely when it is already fragile, and the health-check subsystem.**

Highest-risk findings (full evidence in the tables below):

1. **Confirmed REST bypasses via raw `fetch`** that fire exactly when the device
   is in trouble:
   - `connectionManager.ts` (`probeWithFetch` / `probeInfoOnce` /
     `probeInfoWithConnectionConfig`) calls `fetch(${baseUrl}/v1/info)` directly as
     a **production fallback** whenever the scheduled `getInfo` throws a non-HTTP
     (network/timeout) error. The fallback is unthrottled and uncircuited.
   - `GlobalDiagnosticsOverlay.validateTarget` calls `fetch(.../v1/info)` directly
     for the user-triggered "validate target" diagnostic.
2. **Health-check probes are mis-prioritised.** The saved-device health system
   probes **every saved device in parallel**, and several of its probes do not
   carry a low priority:
   - The CONFIG round-trip pulse issues **device config writes** (`setConfigValue`)
     with no `__c64uIntent`, so they default to **`user`** priority and contend with
     real user writes on the same config queue.
   - JIFFY/RASTER memory probes call `readMemory`, which loses intent inside
     `fetchWithTimeout` and is forced to **`user`** priority.
   - The REST probe sets `__c64uBypassCircuit` + `__c64uBypassCache`, so it keeps
     hitting a device whose circuit breaker has already tripped.
3. **Background health checks are structurally heavy (the picker-open cycle is NOT
   the problem).** The 10 s, full multi-protocol cycle that runs **while the device
   picker is open** is an explicit, wanted product behaviour and is kept unchanged.
   The problem is the **`backgroundMaintenance` context**: every 60 s it probes
   **all saved devices in parallel** with the full battery minus CONFIG
   (REST + FTP + Telnet + RASTER + JIFFY memory reads). For a fragile `C64U` sitting
   in the saved list, that is recurring multi-protocol traffic the idle app does not
   need. Best practice is to derive idle health from the traffic the app already
   makes and probe only as a last resort.
4. **`readMemory` / `writeMemory*` resolve to no cooldown key** in
   `resolveRestPolicy`, so rapid memory traffic serialises (concurrency 1) but has
   no inter-request spacing.

Target direction: keep the existing gateway as the single source of truth, **remove
the confirmed bypasses outright** (no "wrapped fallback" — delete the raw-fetch
fallback and the strange quirks that crept into the REST/Telnet/FTP paths; keep it
simple), thread **intent** through every probe and through `readMemory`/uploads,
**keep the device-picker 10 s cycle exactly as-is**, and **redesign only the
background-maintenance health path** so a healthy idle device incurs near-zero
health-check overhead while an unreachable/unhealthy selected device is still
surfaced immediately. Add a lint-style guard so new direct `fetch`/socket calls
cannot reappear. UI responsiveness stays where it already is — local draft state,
coalescing, latest-intent lanes — never by bypassing the gateway.

Recommended phases: **(1)** safety enforcement, bypass removal & quirk cleanup;
**(2)** background-health redesign (traffic-derived health + selected-device-only +
freshness gate + single lightweight probe; picker-open cycle untouched);
**(3)** verification & regression prevention (routing tests, slider stress tests,
background-health-load tests, guard rule).

> **Lock-up root cause — deliberately not pursued.** Per product direction we do not
> chase the exact firmware trigger. We assume **any fast sequence of REST/Telnet (or
> FTP) calls** can wedge the `C64U` listener surface, and we harden against that class
> of behaviour rather than a single cause.

---

## Scope and Non-Scope

**This is a research-only task.** No source, test, config, or formatting files were
modified. The only files created/updated are `PLANS.md`, `WORKLOG.md`, and this
document.

**Investigated:**

- The outbound device-call gateway and all safety primitives (scheduler, cooldown,
  backoff, circuit breaker, activity gate, latest-intent lane, config write throttle,
  polling-pause registry, device-safety presets).
- The REST/FTP/Telnet transport layers in `c64api.ts`, `ftp/`, `telnet/`.
- Both health-check systems (active-device singleton and saved-device parallel) and
  the discovery/connection manager.
- Slider and interactive-write hooks, config-write mutation hooks, polling cadence.
- CTA surfaces: Home controls, config rows, playback volume, diagnostics, device
  picker, telnet workflows.

**Intentionally not changed / not in scope:**

- Any production behaviour, including the confirmed bypasses (documented, not fixed).
- Existing tests (not weakened, relaxed, or added).
- Pre-existing unrelated working-tree edits owned by concurrent work
  (`.github/workflows/android.yaml`, `playwright/playback.part2.spec.ts`,
  `tests/unit/ci/telemetryGateWorkflow.test.ts`) — left untouched.
- Native (Capacitor) socket internals beyond confirming they are invoked inside the
  JS gateways (the actual TCP/Telnet socket and FTP bridge live behind
  `createTelnetClient` / `ftpClient.web.ts`, both called inside `with*Interaction`).

---

## Repository Evidence Base

**Search strategies used** (deterministic `rg`/`grep`/file reads — see Appendix A):

1. Protocol terms: `fetch(`, `withRestInteraction`, `withFtpInteraction`,
   `withTelnetInteraction`, `TelnetSocket`, `readMemory`, `writeMemory`.
2. Endpoint strings: `/v1/info`, `/v1/configs`, `/v1/machine`, `/v1/drives`,
   `:reset|:reboot|:pause`.
3. Service/client names: `deviceInteractionManager`, `scheduleConfigWrite`,
   `latestIntentWriteLane`, `deviceActivityGate`, `pollingPauseRegistry`,
   `healthCheckEngine`, `connectionManager`.
4. UI event terms: `onValueChange`, `onValueCommit`, `onClick`, `useDeviceBoundSlider`,
   `useInteractiveConfigWrite`, `mutate`.
5. Health/check terms: `runHealthCheck`, `useSavedDeviceHealthChecks`,
   `HEALTH_CHECK_CONTEXTS`, `probeRest|probeConfig|probeFtp|probeTelnet`.
6. Throttle/backoff/coalesce terms: `cooldown`, `backoff`, `circuit`, `throttle`,
   `coalesce`, `debounce`, `quiet`.
7. High-frequency control terms: slider/volume/brightness/colour.
8. Bypass terms: `immediate`, `__c64uBypass*`, `__c64uAllowDuring*`.

**Files inspected:** see Appendix B (≈30 source files + the prior task's
`PLANS.md`/`WORKLOG.md`, which document the just-landed device-safety fixes and were
re-verified against current code).

**Limitations:**

- No live `C64U`/`U64` hardware or attached Pixel 4 was exercised during this
  research; all conclusions are from static tracing. Hardware/HIL confirmation of the
  lock-up reproduction and of the fixes is listed as an acceptance criterion and open
  question, not claimed here.
- `c64api.ts` is 2407 lines; uploads (l.1820–2164) were confirmed to route through
  `fetchWithTimeout` (and therefore the gateway) but not each read line-by-line.

---

## Current Outbound Device-Call Architecture

**The intended safe path:** every device call must pass through one of four approved
boundaries, all in or fronting `deviceInteractionManager.ts`:

- `withRestInteraction(meta, handler)` — REST.
- `withFtpInteraction(meta, handler)` — FTP.
- `withTelnetInteraction(meta, handler)` — Telnet.
- `scheduleConfigWrite(task)` — a serialised FIFO **in front of** REST config writes
  (the task itself still calls `request()` → `withRestInteraction`). So config writes
  are *double*-gated.

Each REST/FTP/Telnet scheduler is an `InteractionScheduler` with three intent queues
drained in priority order `user` → `system` → `background`, a concurrency limit, a
`getReadyAtMs` deferred-drain for read cooldown/backoff, and `cancelAll` used by
`resetInteractionState` on device switch.

| File | Symbol | Protocol | Role | Rate-limit behaviour | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `lib/deviceInteraction/deviceInteractionManager.ts` | `withRestInteraction` | REST | **Approved boundary** | Circuit check, state gate, read cache+coalesce, cooldown per policy key, error-streak backoff, concurrency 1 | l.551–749 | Reads yield to user write bursts via `waitForBackgroundReadsToResume`; `isTestEnv()` short-circuits all gating (l.552). |
| same | `withFtpInteraction` | FTP | **Approved boundary** | Circuit, host-scoped inflight coalesce + cooldown, backoff, concurrency `ftpMaxConcurrency` | l.751–854 | Host:port scoped keys (PH9). |
| same | `withTelnetInteraction` | Telnet | **Approved boundary** | Circuit, backoff, concurrency 1 | l.856–929 | No cooldown/cache (sessions are coarse). |
| same | `InteractionScheduler` | all | Priority queue | `user`>`system`>`background`, deferred drain | l.129–234 | `cancelAll` → `InteractionCancelledError`. |
| same | `resolveRestPolicy` | REST | Cooldown/cache policy | `/v1/info`,`/v1/configs`,`/v1/drives`, machine-control (250ms), config-mutation (`configsCooldownMs`) | l.422–461 | **`readmem`/`writemem` fall through to `{key:null,cooldown:0}`** — no spacing. |
| same | `shouldBlockForState` | all | State gate | Blocks by `UNKNOWN/DISCOVERING/ERROR` per intent | l.463–477 | User may proceed during DISCOVERING; ERROR blocks background. |
| same | `computeBackoff` / `update*Failure` | all | Backoff + circuit | Exponential `base·factor^(streak-1)` capped at max; circuit at threshold | l.358–420 | Per-transport streaks; reset on success. |
| `lib/config/deviceSafetySettings.ts` | `loadDeviceSafetyConfig`, `MODE_DEFAULTS` | all | Policy source | 4 presets + AUTO→CONSERVATIVE(`C64U`)/BALANCED(U64) | l.66–311 | CONSERVATIVE: configsCooldown 1200ms, ftpListCooldown 800ms, ftpConcurrency 1, circuit threshold 2, no user circuit override. |
| `lib/config/configWriteThrottle.ts` | `scheduleConfigWrite`, `waitForInterval` | REST(config) | **Approved boundary (front)** | Serial FIFO, waits `max(appInterval, configsCooldownMs)` | l.16–62 | Single global queue/`lastWriteAt`. |
| `lib/deviceInteraction/latestIntentWriteLane.ts` | `createLatestIntentWriteLane` | n/a | Coalescing primitive | Latest-value-wins; supersedes stale jobs | l.23–104 | Used by interactive + volume writes. |
| `lib/deviceInteraction/deviceActivityGate.ts` | `beginInteractiveWriteBurst`, `areBackgroundReadsSuspended`, `waitForMachineTransitionsToSettle` | n/a | Yield gate | Counts write/transition bursts; background reads wait | l.61–151 | Drives the REST read-yield path. |
| `lib/query/c64PollingGovernance.ts` | `pollingPauseRegistry` | n/a | Pause registry | Ref-counted pause for polling + bg health | l.53–81 | Acquired by sliders. |
| `lib/c64api.ts` | `C64API.request` | REST | Caller → boundary | Wraps `withRestInteraction`; intent default `user` | l.792–1196 | + budget-replay cache + inflight dedupe. |
| `lib/c64api.ts` | `C64API.fetchWithTimeout` | REST | Caller → boundary | Wraps `withRestInteraction`; **intent hardcoded `user`** | l.1198–1300 | Used by `readMemory`, `writeMemoryBlock`, uploads. |
| `lib/c64api.ts` | `scheduleConfigWrite` callers (`setConfigValue`/`updateConfigBatch`/save/load/reset) | REST(config) | Caller → boundary | Double-gated | l.1519–1608 | `immediate` is now log-only. |
| `lib/ftp/ftpClient.ts` | `listFtpDirectory`/`readFtpFile`/`writeFtpFile` | FTP | Caller → boundary | All wrap `withFtpInteraction` | l.42/144/245/309 | — |
| `lib/telnet/telnetClient.ts` + `telnetSession.ts` | `createTelnetClient`/`createTelnetSession` | Telnet | Transport (inside boundary) | Socket; invoked inside `withTelnetInteraction` | client l.71, session l.47 | Native `TelnetSocket` bridge. |
| `hooks/useTelnetActions.ts` | `withTelnetInteraction` wrapper | Telnet | Caller → boundary | intent `system` | l.234–252 | — |

---

## Outgoing Device-Call Inventory

Classifications are exactly: **Safe**, **Probably safe**, **Risk**, **Confirmed
bypass**, **Not device traffic**.

| # | Category | File | Function/component | Protocol | Endpoint/operation | Final outbound boundary | Classification | Evidence | Required follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | App reads | `c64api.ts` | `getInfo/getCategory/getConfigItem/getDrives` via `request` | REST | `GET /v1/info`,`/v1/configs`,`/v1/drives` | `withRestInteraction` | **Safe** | l.858 | — |
| 2 | App config writes | `c64api.ts` | `setConfigValue`,`updateConfigBatch`,`saveConfig`… | REST | `PUT/POST /v1/configs*` | `scheduleConfigWrite`→`withRestInteraction` | **Safe** | l.1540,1600 | — |
| 3 | Machine control | `c64api.ts` | `machineReset/reboot/pause/resume/poweroff/menu_button` | REST | `PUT /v1/machine:*` | `request`→`withRestInteraction` (250ms cooldown) | **Safe** | l.1611–1657 | — |
| 4 | Memory read | `c64api.ts` | `readMemory` | REST | `GET /v1/machine:readmem` | `fetchWithTimeout`→`withRestInteraction` | **Risk** | l.1673–1684 | No cooldown key; intent forced `user`. Add `readmem` cooldown + thread intent. |
| 5 | Memory write | `c64api.ts` | `writeMemory`,`writeMemoryBlock` | REST | `PUT/POST /v1/machine:writemem` | `request`/`fetchWithTimeout`→`withRestInteraction` | **Probably safe** | l.1708–1738 | No cooldown key; intent `user`. Add `writemem` cooldown. |
| 6 | Uploads / programs | `c64api.ts` | upload helpers (run/load PRG, etc.) | REST | `POST /v1/runners:*`, file PUTs | `fetchWithTimeout`→`withRestInteraction` | **Probably safe** | l.1820–2164 | Confirm each path; intent `user`. |
| 7 | FTP browse/transfer | `ftp/ftpClient.ts` | `listFtpDirectory/readFtpFile/writeFtpFile` | FTP | LIST/RETR/STOR | `withFtpInteraction` | **Safe** | l.42/144/245/309 | — |
| 8 | Telnet actions | `hooks/useTelnetActions.ts` | `executeAction` session | Telnet | menu workflows | `withTelnetInteraction` (`system`) | **Safe** | l.234 | Consider `user` intent for user-pressed actions. |
| 9 | Home Telnet REU/config | `pages/HomePage.tsx` | REU + config-file workflows | Telnet | menu workflows | `withTelnetInteraction` (`user`) | **Safe** | l.305,308,377,383 | Fixed in prior task; verified. |
| 10 | Config-file apply | `lib/config/applyConfigFileReference.ts` | telnet apply | Telnet | menu workflow | `withTelnetInteraction` (`user`) | **Safe** | l.185 | Uses `immediate:true` config (log-only). |
| 11 | Background info poll | `hooks/useC64Connection.ts` | `c64-info` query | REST | `GET /v1/info` | `withRestInteraction` (`background`) | **Safe** | l.152–172 | Gated by screenActive/pause/suppression. |
| 12 | Drives poll | `hooks/useC64Connection.ts` | drives query | REST | `GET /v1/drives` | `withRestInteraction` | **Safe** | l.525–536 | 30s/60s; cancels on pause. |
| 13 | Config-drift scan | `lib/diagnostics/configDrift.ts` | `getCategories/getConfigItem` | REST | `GET /v1/configs*` | `withRestInteraction` (`system`,bypassCache) | **Safe** | l.49–94 | Cache bypass only; no circuit bypass. |
| 14 | Health REST probe | `lib/diagnostics/healthCheckEngine.ts` | `probeRest` | REST | `GET /v1/info` | `withRestInteraction` (`system`,**bypassCircuit+Cache**) | **Risk** | l.526–533 | Hits device after circuit trips. Gate behind budget/freshness. |
| 15 | Health CONFIG pulse (picker-open only) | `healthCheckEngine.ts` | `probeConfig` `setConfigValue` (write) + reads | REST(config) | `PUT /v1/configs/...` ×2 + 3 reads | `scheduleConfigWrite`→`withRestInteraction` (**default `user`**) | **Probably safe** | l.691–729 | Runs only in picker-open (wanted, kept). Background is read-only/skips CONFIG. Tag non-`user` intent for observability; do not change picker cadence. |
| 16 | Health JIFFY/RASTER | `healthCheckEngine.ts` | `probeJiffy`/`probeRaster` `readMemory` | REST | `GET /v1/machine:readmem` | `fetchWithTimeout`→`withRestInteraction` (**forced `user`**) | **Risk** | l.575,616 | Intent lost; +2-attempt retry. Thread intent; lower priority. |
| 17 | Health FTP probe | `healthCheckEngine.ts` | `probeFtp` | FTP | LIST `/` | `withFtpInteraction` (`system`) | **Probably safe** | l.787–798 | Runs ×N devices in parallel. |
| 18 | Health Telnet probe | `healthCheckEngine.ts` | `probeTelnet` | Telnet | connect/auth/banner | `withTelnetInteraction` (`system`) | **Probably safe** | l.1019 | New socket per device per cycle. |
| 19 | Discovery probe | `lib/connection/connectionManager.ts` | `probeOnce`/`probeInfoOnce` (C64API path) | REST | `GET /v1/info` | `withRestInteraction` (`system`,bypassCircuit+Cache) | **Probably safe** | l.372–383,462–477 | Repeats at `discoveryProbeIntervalMs`; bypasses circuit by design. |
| 20 | **Discovery fallback** | `connectionManager.ts` | `probeWithFetch` + inline fallbacks | REST | `GET /v1/info` | **raw `fetch`** | **Confirmed bypass** | l.194,322,426 | Fires on non-HTTP error (network/timeout) in prod. Route through gateway or a single guarded probe lane. |
| 21 | **Diagnostics validate** | `components/diagnostics/GlobalDiagnosticsOverlay.tsx` | `validateTarget` | REST | `GET /v1/info` | **raw `fetch`** | **Confirmed bypass** | l.59 | User-triggered. Route through a gateway probe with `user` intent + circuit override policy. |
| 22 | Manual rediscovery | `GlobalDiagnosticsOverlay.tsx` | `handleRetryConnection`→`discoverConnection("manual")` | REST | `GET /v1/info` loop | `probeOnce`→gateway (+#20 fallback) | **Probably safe** | l.358,366 | Inherits #20 risk via fallback. |
| 23 | Active-device health | `GlobalDiagnosticsOverlay.tsx` | `runHealthCheck()` | mixed | 6 probes | gateways (+#14–18) | **Risk** | l.365 | Manual; inherits probe-priority risks #14–16. |
| 24 | Saved-device health (picker open) | `hooks/useSavedDeviceHealthChecks.ts` | parallel `runHealthCheckForTarget` ×N @10s | mixed | full battery/device | gateways (+#14–18) | **Probably safe** | l.244–327 | Wanted; kept unchanged. |
| 24b | Saved-device health (background) | `hooks/useSavedDeviceHealthChecks.ts` | parallel `runHealthCheckForTarget` ×N @60s | mixed | REST+FTP+Telnet+2× memory/device | gateways (+#14,16–18) | **Risk** | l.244–327,367 | Redesign: selected-device-only, single `/v1/info`, traffic-derived, freshness-gated. |
| 25 | Volume slider writes | `pages/playFiles/hooks/useVolumeOverride.ts` | mixer lane | REST(config) | `POST /v1/configs` | latest-intent lane→`updateConfigBatch`→`scheduleConfigWrite` | **Safe** | l.295–340 | `immediate:true` log-only. |
| 26 | Lighting Studio apply | `hooks/useLightingStudio.tsx` | `updateConfigBatch({immediate:true})` | REST(config) | `POST /v1/configs` | `scheduleConfigWrite` | **Safe** | l.561 | log-only immediate. |
| 27 | FTP native bridge | `lib/native/ftpClient.web.ts` | bridge HTTP | FTP(bridge) | `/v1/ftp/*` | invoked inside `withFtpInteraction` | **Safe** | l.61 | Transport detail of #7. |
| 28 | Non-device fetches | hvsc/licenses/mockConfig/webServerLogs/secureStorage.web | various | HTTP | CDN/assets/local bridge | n/a | **Not device traffic** | rg results | Exclude from device policy. |

≥10 distinct device-call paths classified (28 rows; ≥4 in the Risk/Confirmed-bypass
categories).

---

## CTA and UI Interaction Trace

| UI surface | Component file | User action | Handler/hook | Service/function | Final boundary | Rate-limited? | High-freq risk? | Risk level | Required future change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Home case-light brightness | `pages/home/components/LightingSummaryCard.tsx` | Drag slider | `useDeviceBoundSlider`→`useInteractiveConfigWrite` | `updateConfigBatch` | `scheduleConfigWrite`→REST | Yes | Yes (coalesced) | Low | None (regression-test the coalescing bound). |
| Home case-light colour | same | Drag slider | same | `updateConfigBatch` | same | Yes | Yes (coalesced) | Low | None. |
| Home lighting selects/toggles | `LightingSummaryCard.tsx` | Tap toggle/select | `useSharedConfigActions.updateConfigValue` | `setConfigValue` | `scheduleConfigWrite`→REST | Yes | Low | Low | None. |
| Config page slider | `components/ConfigItemRow.tsx` | Drag slider | `useDeviceBoundSlider` | `setConfigValue` (preview+commit) | `scheduleConfigWrite`→REST | Yes | Yes (preview per throttle window) | Medium | Bound preview rate explicitly; assert ≤1 write/window in tests. |
| Config page select/text | `ConfigItemRow.tsx` | Commit value | `commitTextValue` | `setConfigValue` | `scheduleConfigWrite`→REST | Yes | Low | Low | None. |
| Playback volume | `pages/playFiles/hooks/useVolumeOverride.ts` | Drag volume | latest-intent lane | `updateConfigBatch` | `scheduleConfigWrite`→REST | Yes | Yes (coalesced) | Low | None. |
| Home machine controls | `pages/HomePage.tsx` | Tap reset/reboot/pause/resume/poweroff/menu | `useC64MachineActions` mutations | `machine*` | `request`→REST (250ms) | Yes | Low (button) | Low | None. |
| Home Telnet REU | `HomePage.tsx` | Tap save/restore REU | `createReuWorkflow` | telnet session | `withTelnetInteraction` (`user`) | Yes | Low | Low | None (verified). |
| Home Telnet config-file | `HomePage.tsx` | Tap save/load config file | config-file workflow | telnet session | `withTelnetInteraction` (`user`) | Yes | Low | Low | None. |
| Home Telnet power/clear-RAM/printer/drive | `HomePage.tsx` | Tap action | `telnet.executeAction` | telnet session | `withTelnetInteraction` (`system`) | Yes | Low | Low | Consider `user` intent for user-pressed telnet. |
| File browser / launch | `lib/playback/playbackRouter.ts` | Run/launch file | router | FTP + `machineReboot/Reset` + uploads | `withFtpInteraction`/`request`/`fetchWithTimeout` | Yes | Low | Low | None. |
| Device picker open | `components/UnifiedHealthBadge.tsx` | Open switcher | `useSavedDeviceHealthChecks(switchDeviceDialog)` | parallel `runHealthCheckForTarget` | gateways | Yes (gateways) | Yes (10s ×N, CONFIG writes) — **wanted** | None (kept) | **No change — keep the wanted full 10 s cycle.** |
| Idle app (badge mounted, picker closed) | `components/UnifiedHealthBadge.tsx` | none (background) | `useSavedDeviceHealthChecks(backgroundMaintenance)` | parallel `runHealthCheckForTarget` ×N @60s | gateways | Partly | **Yes (multi-protocol fan-out on idle `C64U`)** | **High** | Redesign: selected-device-only, single freshness-gated `/v1/info`, traffic-derived. |
| Diagnostics "Run health check" | `GlobalDiagnosticsOverlay.tsx` | Tap | `runHealthCheck()` | 6 probes | gateways | Partly | Medium | Medium | Thread probe intents; honour circuit/budget. |
| Diagnostics "Validate target" | `GlobalDiagnosticsOverlay.tsx` | Tap | `validateTarget` | **raw `fetch`** | **none** | **No** | Low | **High** | Route via gateway probe lane. |
| Pull/manual reconnect | `GlobalDiagnosticsOverlay.tsx` / refresh | Retry connection | `discoverConnection("manual")` | `probeOnce` (+raw fetch fallback) | gateway (+bypass) | Partly | Low | Medium | Fix fallback (#20). |
| Lighting Studio apply | `hooks/useLightingStudio.tsx` | Apply scene | `updateConfigBatch` | config batch | `scheduleConfigWrite`→REST | Yes | Medium (batch) | Low | None. |

≥10 CTA/interaction families traced (16 rows).

---

## Slider and High-Frequency Control Analysis

**Current behaviour (evidence: `useDeviceBoundSlider.ts`, `useInteractiveConfigWrite.ts`,
`useVolumeOverride.ts`, `ConfigItemRow.tsx`).**

- `useDeviceBoundSlider` keeps a **local draft value** (`draftSliderValue`) updated on
  every `onValueChange`; the visible value is `draft ?? pendingIntent ?? deviceValue`,
  so the UI is fully responsive without waiting on the device.
- During a drag it **acquires a polling pause** (`pollingPauseRegistry`) so info/drives
  polling — *and background health maintenance* — stop competing for the wire.
- Preview writes are **throttled latest-wins**: a leading write, then a single trailing
  timer carrying the most recent value; intermediate ticks are coalesced (logged as
  "coalesced write"). Only **one commit** fires on release (`onValueCommit`).
- A **pending-intent latch** holds the committed value and **ignores stale device
  echoes** until the device confirms (or a 2s watchdog / device-switch / tab-hidden
  clears it). This is the anti-"snap-back" mechanism.
- Lighting/SID sliders feed `useInteractiveConfigWrite`: a **latest-intent lane** +
  **400ms quiet window** + `waitForMachineTransitionsToSettle` + an interactive write
  burst, always `immediate:false, skipInvalidation:true`, with a single debounced
  reconciliation refetch. Volume uses an equivalent lane with `beginPlaybackWriteBurst`.

**Which interactions remain risky:**

- **Config-page sliders (`ConfigItemRow`)** go straight to `setConfigValue` for both
  preview and commit. The config queue (`scheduleConfigWrite`) serialises them and
  enforces `configsCooldownMs` (1200ms on `C64U`), so they are *bounded*, but the
  preview path can still emit **one write per throttle window** for a long drag rather
  than collapsing to a single in-flight intent the way the latest-intent lane does.
  Bounded ≠ minimal. This is **Medium**, not critical.
- Everything else (Home lighting, volume) is collapsed to latest-intent and is **Low**.

**How responsiveness should be preserved without bypassing rate limiting (proposal):**

- Keep local draft state and the pending-intent latch exactly as-is (UI never blocks on
  the device).
- Standardise **all** device-bound sliders on a latest-intent lane (as lighting/volume
  already do), so a drag of any length produces **at most one in-flight write plus one
  trailing latest-value write**, regardless of throttle windows. Migrate `ConfigItemRow`
  onto `useInteractiveConfigWrite` (or an equivalent lane) so its preview path coalesces
  to latest intent rather than per-window.
- Continue routing every committed write through `scheduleConfigWrite`. **Never** add a
  direct write for "snappiness"; snappiness comes from the latch, not from skipping the
  queue.

**Proposed future policy (slider):** *A slider updates local state immediately and may
emit a throttled preview, but (a) preview writes coalesce to a single latest-intent
in-flight write, (b) exactly one commit fires on release, (c) all writes traverse
`scheduleConfigWrite` → `withRestInteraction`, and (d) the visible value is latched
against stale device echoes until confirmation or watchdog. No slider may produce an
unbounded or per-tick outbound sequence.*

---

## Health-Check Architecture and Load Analysis

**Two systems exist.**

1. **Active-device, singleton** — `runHealthCheck()` (`healthCheckEngine.ts` l.1655).
   Triggered **manually** from the diagnostics overlay (l.365). One run at a time
   (`activeRun`), 12s global deadline, 6 probes **sequential**
   (REST→FTP→TELNET→CONFIG→RASTER→JIFFY) with REST-fail short-circuit.

2. **Saved-device, parallel** — `useSavedDeviceHealthChecks` (mounted in
   `UnifiedHealthBadge`). Runs `runHealthCheckForTarget` for **every saved device in
   parallel** (`Promise.allSettled(devices.map(...))`, l.244).

**Scheduling model / triggers (evidence: `useSavedDeviceHealthChecks.ts`):**

- Picker **open** → context `switchDeviceDialog`, interval **10s**, CONFIG pulse
  **allowed** (`visible-config-pulse-allowed`).
- Picker **closed** → context `backgroundMaintenance`, interval **60s**, CONFIG
  **read-only/skipped**.
- Re-runs immediately on mount and on `cycleScheduleKey` change (device list/host/port).

**Protocols checked & calls per cycle, per device:**

- REST `getInfo` (1) → if it fails, all others skipped.
- FTP `listFtpDirectory('/')` (1).
- Telnet connect + auth + banner read (1 session).
- CONFIG round-trip *(allowed contexts only)*: iterate up to 4 targets; for the first
  viable target → read + **write** + read-back + **write (revert)** + verify = ≥2 writes
  + 3 reads.
- RASTER `readMemory('D012')` (+ up to 1 retry).
- JIFFY `readMemory('00A2')` (+ up to 1 retry).

≈ **9–13 device operations per device per cycle** in the picker-open path; ≈ **5–7** in
background (no CONFIG). Multiplied across **N saved devices** running concurrently.

**Interaction with rate limiting:**

- All probes share the **module-singleton** schedulers. REST/FTP/Telnet cooldown keys
  are host/baseUrl-scoped, so different devices don't share cooldown, **but they all
  serialise through one concurrency slot** (REST=1, Telnet=1). So N devices' probes
  queue behind each other and behind user REST.
- **Priority is wrong for three probe types:**
  - REST probe is `system` **but** `__c64uBypassCircuit` + `__c64uBypassCache` — it
    keeps hitting a device whose circuit has tripped and never benefits from cache.
  - CONFIG-pulse `setConfigValue` carries **no intent** → defaults to **`user`** → its
    writes are indistinguishable from real user writes and run at the same priority on
    the same config queue.
  - JIFFY/RASTER `readMemory` **loses intent** inside `fetchWithTimeout` → forced
    **`user`**.

**Interaction with user actions / deferral:**

- `backgroundMaintenance` correctly **pauses** for: foreground device switch,
  diagnostics-overlay suppression, and the polling pause (slider drags) — and
  AbortControllers cancel in-flight probes (l.205–210, 136–149, 379–439).
- `switchDeviceDialog` (picker open, 10s, **with CONFIG writes**) intentionally does
  **not** apply those pause guards. **This is wanted and is kept unchanged:** the user
  is present, the picker is foreground, and live full health across devices is exactly
  the point of the picker. No change is proposed to the picker-open path. (The only
  background-derived improvement that incidentally benefits it is correct intent
  tagging for logging/observability; cadence, fan-out, and the CONFIG pulse stay.)

**Failure / retry behaviour:**

- REST failure short-circuits the remaining probes (good — avoids hammering a dead
  device with FTP/Telnet/CONFIG).
- JIFFY/RASTER memory probes retry once on transient failure (extra traffic).
- The REST probe's `bypassCircuit` means a failing device still receives a probe each
  cycle; combined with discovery's `discoverConnection` interval probing, an unreachable
  `C64U` can see steady probe traffic from multiple subsystems.
- Health result freshness **is recorded** (`lastCompletedAt`, `latestResult`) but is
  **not consulted to skip** a probe — every cycle re-probes regardless of how recent the
  last good result was.

**Load risks (summary), corrected per product direction:**

- **In scope (the real problem):** the **`backgroundMaintenance`** path probes **all
  saved devices in parallel every 60 s** with REST + FTP + Telnet + 2× memory reads.
  Idle, healthy devices should not generate this. The circuit-bypassing REST probe
  also keeps hitting a device whose circuit has tripped.
- **Explicitly out of scope (wanted, kept):** the **picker-open** 10 s full cycle —
  including the CONFIG write pulse and the parallel fan-out across devices — is the
  desired behaviour while the user is choosing a device and is **not** changed.

**Proposed target behaviour — keep the picker, redesign the background.**

*Device-picker open (`switchDeviceDialog`) — KEEP AS IS.* Full multi-protocol cycle
(REST → FTP → Telnet → CONFIG pulse → RASTER → JIFFY) every 10 s across all saved
devices. The user is present and comparing devices; live, complete health is the
point. No change to cadence, fan-out, or the CONFIG pulse.

*Background maintenance (`backgroundMaintenance`) — redesign for near-zero idle
overhead.* Principle: **derive idle health from the traffic the app already makes;
probe only as a last resort, only the selected device, and only lightly.**

1. **Health as a byproduct of real traffic.** Every REST/FTP/Telnet call already
   reports success (`noteReachable`) or failure (error classification + circuit
   breaker). Those are the primary background health signal. A device the user is
   actively using needs no separate probe — its health is whatever its real calls just
   reported.
2. **Selected device only.** Background maintenance probes only the active/selected
   device. Non-selected saved devices show "last seen <age>" / "unknown" and are
   refreshed by the picker-open cycle when the user actually looks at them. **No
   background parallel fan-out across all saved devices.**
3. **Freshness gate.** Skip the background probe entirely if any real device call (or a
   prior probe) succeeded within a freshness window. A probe fires only after silence
   (no recent evidence) or a recent failure.
4. **Lightweight single probe.** When a background probe is warranted it is a single
   read-only `GET /v1/info` at `background` intent — never FTP, Telnet, CONFIG writes,
   or memory probes. One call, lowest priority, yields to everything.
5. **Adaptive cadence + circuit respect.** Healthy + recent evidence → effectively idle
   (rely on real traffic; long ceiling). Last result failed → a bounded, slowing
   re-probe to detect recovery, capped, and **skipped entirely while the circuit is
   open** (report "device protecting itself" from state). Re-probe promptly on
   app-foreground and on an observed user-action failure (event-driven), not on a fast
   fixed timer.
6. **Keep the existing pause guards** (polling pause, diagnostics suppression,
   foreground switch) already present for background maintenance.

Net effect: the selected device's health is always current (it is whatever its real
traffic last reported, topped up by at most one lightweight probe after silence),
idle background overhead approaches zero for a healthy device, and an
unreachable/unhealthy selected device is still surfaced immediately — with full,
live, multi-protocol visibility the moment the picker is opened.

Also thread `__c64uIntent` through `readMemory` and stop `fetchWithTimeout` hardcoding
`user`, and stop the (background and active) REST probe from bypassing the circuit
breaker. These are correctness fixes that make health derivable and bound idle load;
they do not alter the wanted picker-open cadence.

**Rejected option — disable health checks entirely:** Rejected. Health checks provide
the user-facing confidence signal and recovery evidence (`recordRecoveryEvidence`) and
power the device picker. The fix is traffic-derived background health + a single
freshness-gated lightweight probe, not removal — and the picker-open cycle stays.

**Rejected option — also throttle/trim the picker-open cycle:** Rejected per product
direction. The 10 s full cycle while the picker is open is wanted and kept.

---

## Target Safe-Device-Traffic Policy

**Approved outbound boundaries (unchanged, made mandatory):** REST →
`withRestInteraction`; FTP → `withFtpInteraction`; Telnet → `withTelnetInteraction`;
config writes → `scheduleConfigWrite` (in front of REST). A single unified gateway is
**not** recommended over the current per-protocol gateways — the protocols have
genuinely different semantics (REST cache/cooldown keys, FTP host-scoped concurrency,
Telnet coarse sessions). *Pro of unifying:* one place to reason about global pressure.
*Con:* it would erase the per-protocol policy that already works. **Recommendation:**
keep three gateways but add a **shared device-pressure observer** (global in-flight +
recent-error view) they all consult, so cross-protocol bursts can back off together.

**Mandatory routing rules:**

- No production code may call `fetch`/socket/native-bridge to a device endpoint outside
  the four boundaries. Probes included.
- `readMemory`, `writeMemory*`, and uploads must **accept and forward `__c64uIntent`**;
  `fetchWithTimeout` must stop hardcoding `user`.
- `resolveRestPolicy` must assign cooldown keys to `readmem`/`writemem` (machine I/O), so
  rapid memory traffic is spaced.

**Priority rules:** `user` > `system` > `background`. User-initiated calls outrank all
health/background traffic. Health probes are `background` (config-pulse, memory) or at
most `system` (connectivity REST/FTP/Telnet), never `user`.

**Health-check budget rules:** *Picker open (`switchDeviceDialog`) is exempt and kept
as-is — full 10 s cycle incl. CONFIG pulse across saved devices (wanted).* For
**background maintenance only**: derive health from real traffic; probe only the
selected device; a single read-only `GET /v1/info` (no FTP/Telnet/CONFIG/memory, no
fan-out); freshness-gate to skip when recent evidence exists; adaptive cadence; honour
the circuit breaker (no `bypassCircuit`). Non-selected saved devices show last-seen age
and are refreshed by the picker-open cycle on demand.

**Slider / high-frequency rules:** local draft + latched pending intent; coalesce to
latest-intent in-flight write; one commit on release; all writes through
`scheduleConfigWrite`. No per-tick or unbounded sequences.

**Retry / backoff rules:** keep per-transport exponential backoff + circuit breaker.
Probe retries must respect backoff and must not bypass the circuit. Discovery/probe
loops use `discoveryProbeIntervalMs` and must not run a second uncoordinated raw-fetch
loop.

**Startup / reconnect rules:** discovery uses `probeOnce` through the gateway; the
non-HTTP-error **raw-fetch fallback must be removed or routed through a single guarded
probe lane**. `resetInteractionState` continues to cancel queued work on switch.

**Diagnostics rules:** "validate target" and any overlay device call must go through the
gateway (with explicit `user` intent + a documented circuit-override policy for recovery
actions), not raw `fetch`. Diagnostics overlay suppression continues to pause background
reads/health.

**Foreground/background rules:** background reads/health pause when the app is hidden
(already partly done via `appVisible` query cancellation); health maintenance must not
run while hidden; picker-open health must obey pause guards.

**Observability requirements:** every device call must emit the existing structured
debug logs (`Device request started/finished`, cooldown/backoff applied, coalesced,
stale-ignored, latest-intent-confirmed) **including intent and source (user/health/
discovery)**. Add counters for: outbound calls per source per minute, health ops per
cycle per device, circuit-open events, and "would-have-bypassed" guard hits.

---

## Risk Register

| Risk | Evidence | Likelihood | Impact | Priority | Proposed mitigation | Owner/phase |
| --- | --- | --- | --- | --- | --- | --- |
| Raw-fetch discovery fallback hammers a struggling device | `connectionManager.ts` l.194/322/426 (fires on network/timeout error) | Medium | High (defeats backoff exactly when needed) | P1 | **Remove the fallback outright** — discovery uses only the gateway probe | Phase 1 |
| Diagnostics "validate target" raw fetch | `GlobalDiagnosticsOverlay.tsx` l.59 | Low (manual) | Medium | P1 | Route through gateway probe | Phase 1 |
| **Background** health fan-out across all saved devices every 60 s (REST+FTP+Telnet+2× memory) | `useSavedDeviceHealthChecks` l.244 + `runHealthCheckForTarget`; `backgroundMaintenance` ctx | High | High (recurring multi-protocol hits on idle `C64U`) | P2 | Background = selected device only, single freshness-gated `/v1/info` probe; derive health from real traffic | Phase 2 |
| Background re-probes even when recent real traffic already proved health | `useSavedDeviceHealthChecks` records `lastCompletedAt` but never skips | High | Medium | P2 | Freshness gate + traffic-derived health; age display | Phase 2 |
| Health REST probe bypasses circuit breaker | `healthCheckEngine.ts` l.529–533 | High | Medium | P1/P2 | Drop `bypassCircuit`; when open, report from state | Phase 1/2 |
| Health CONFIG/memory probes run at `user` priority (observability/correctness) | l.691,575,616 + `fetchWithTimeout` l.1216 | High | Medium | P1 | Thread intent; tag probes non-`user` (picker cadence unchanged) | Phase 1 |
| `readmem`/`writemem` have no cooldown key | `resolveRestPolicy` l.422–461 | Medium | Medium | P1 | Add machine-I/O cooldown | Phase 1 |
| Dead/quirky code in REST/Telnet/FTP paths (log-only `immediate`, double timeout, raw-fetch fallbacks) | `c64api.ts` l.1595; `request` double timeout l.943/952; `connectionManager` fetches | Medium | Medium | P1 | Remove dead flag, simplify timeout to one mechanism, delete raw fetches — keep it simple | Phase 1 |
| Config-page slider preview emits per-window writes | `ConfigItemRow.tsx` l.336–351 | Low | Low | P1/P3 | Migrate to latest-intent lane | Phase 1/3 |
| New direct device calls reappear over time | structural | Medium | High | P3 | Lint/guard rule + review checklist | Phase 3 |
| Telnet user actions tagged `system` | `useTelnetActions.ts` l.238 | Low | Low | P3 | Tag user-pressed telnet as `user` | Phase 3 |
| *(Not a risk — kept by design)* picker-open 10 s full cycle incl. CONFIG pulse | `useSavedDeviceHealthChecks` `switchDeviceDialog` | n/a | n/a | — | **Keep unchanged (wanted)** | — |

---

## Prioritized Implementation Roadmap

### Phase 1 — Safety enforcement, bypass removal & quirk cleanup

- **Goal:** zero confirmed device-call bypasses; every device call observably routes
  through a gateway; the REST/Telnet/FTP paths are simple with no dead/quirky code;
  UI responsiveness unchanged.
- **Required changes:**
  - **Delete** the `connectionManager` raw-fetch fallbacks (`probeWithFetch` and the
    inline fallbacks in `probeInfoOnce`/`probeInfoWithConnectionConfig`). Discovery
    uses **only** the gateway `getInfo` path. No "wrapped fallback" — remove it.
  - Route `GlobalDiagnosticsOverlay.validateTarget` through the gateway (a `user`-intent
    `getInfo` probe), not raw `fetch`.
  - Thread `__c64uIntent` through `readMemory`/`writeMemory*`/uploads; stop
    `fetchWithTimeout` hardcoding `user`.
  - Add `readmem`/`writemem` cooldown keys in `resolveRestPolicy`.
  - Stop the REST probe (`probeRest`, discovery `probeOnce`) from setting
    `__c64uBypassCircuit`; when the circuit is open, surface state instead of forcing
    traffic.
  - **Simplify the quirks (keep behaviour identical, just simpler):** remove the
    now-dead `immediate` option from `updateConfigBatch` (and its log line); collapse
    the duplicate timeout in `request` (AbortController timeout *and* a `Promise.race`
    timeout) to one mechanism; audit the two read-cache layers (C64API budget-replay +
    scheduler cache) and keep one if duplication is confirmed.
  - Give health CONFIG-pulse + memory probes explicit non-`user` intent (observability;
    picker cadence unchanged).
- **Files likely affected:** `connection/connectionManager.ts`,
  `components/diagnostics/GlobalDiagnosticsOverlay.tsx`, `lib/c64api.ts`
  (`fetchWithTimeout`, `readMemory`, `writeMemory*`, `updateConfigBatch`, `request`),
  `deviceInteraction/deviceInteractionManager.ts` (`resolveRestPolicy`),
  `lib/diagnostics/healthCheckEngine.ts`.
- **Tests likely needed:** guard test (no raw device-endpoint `fetch`/socket outside
  gateways); intent-propagation test for `readMemory`; machine-I/O cooldown test;
  "discovery uses gateway only" test; "circuit open → no probe traffic" test.
- **Risks:** removing the fallback could expose a latent native-fetch difference —
  mitigate by confirming the gateway `getInfo` already covers native (it does:
  `request`→`fetch` inside the gateway). No behavioural regression intended.
- **Exit criteria:** static scan + guard find no device-endpoint `fetch`/socket outside
  gateways; all probe intents explicit; memory traffic spaced; no dead `immediate` flag.

### Phase 2 — Background-health redesign (picker-open cycle untouched)

- **Goal:** a healthy idle device incurs near-zero background health overhead, an
  unreachable/unhealthy **selected** device is surfaced immediately, and the
  **device-picker 10 s full cycle is kept exactly as-is**.
- **Required changes (only the `backgroundMaintenance` context):**
  - **Derive idle health from real traffic.** Feed REST/FTP/Telnet success/failure
    (`noteReachable`, error classification, circuit state) into the badge's health state
    so a device in active use needs no separate probe.
  - **Selected device only.** Background maintenance probes only the active/selected
    device. Non-selected saved devices display "last seen <age>"/"unknown"; their full
    health is produced by the picker-open cycle. Remove the background parallel fan-out.
  - **Freshness gate.** Skip the background probe if a real call (or prior probe)
    succeeded within a freshness window (scaled from device-safety cache values).
  - **Single lightweight probe.** When warranted, do **one** read-only `GET /v1/info`
    at `background` intent — never FTP/Telnet/CONFIG/memory.
  - **Adaptive cadence + circuit respect.** Idle/healthy → long ceiling (rely on real
    traffic); failed → bounded slowing re-probe; circuit open → no probe. Re-probe on
    app-foreground and on observed user-action failure (event-driven).
  - **Do NOT change `switchDeviceDialog`** — keep the 10 s full cycle, parallel fan-out,
    and CONFIG pulse.
- **Files likely affected:** `hooks/useSavedDeviceHealthChecks.ts` (background branch),
  `components/UnifiedHealthBadge.tsx` (consume traffic-derived health; age display),
  `lib/diagnostics/healthCheckEngine.ts` (a lightweight `background` probe entry +
  honour circuit), `lib/connection/connectionManager.ts` /
  `lib/deviceInteraction/deviceStateStore.ts` (expose last-reachable evidence),
  `lib/config/deviceSafetySettings.ts` (optional freshness/cadence knobs).
- **Tests likely needed:** "background probes selected device only (no fan-out)";
  "background probe is a single `/v1/info` read, no FTP/Telnet/CONFIG/memory";
  "freshness window skips re-probe after recent success"; "health derived from a failed
  real call without a dedicated probe"; "circuit open → no background traffic";
  "picker-open cycle unchanged (still 10 s full battery)".
- **Risks:** less aggressive idle probing could slow recovery detection — mitigated by
  event-driven re-probe on foreground/failure and immediate full visibility on picker open.
- **Exit criteria:** background health ops/min on an idle healthy `C64U` ≈ 0;
  unreachable selected device still flagged within one freshness window; picker-open
  behaviour byte-for-byte unchanged.

### Phase 3 — Verification and regression prevention

- **Goal:** lock in the routing + slider + health guarantees and prevent re-introduction.
- **Required changes:**
  - Unit/integration tests for safe routing per protocol (forced-scheduling mode via
    `__c64uForceInteractionScheduling`, since `isTestEnv()` otherwise bypasses gating).
  - Slider stress tests: ≥20–50 rapid changes → bounded outbound writes (≤1 in-flight +
    1 trailing), latched value, no stale snap-back.
  - Health-load tests: ops-per-cycle ceilings; deferral under polling pause / circuit
    open / app hidden.
  - A **guard** (ESLint `no-restricted-syntax`/custom rule or a CI grep test) forbidding
    `fetch(`/raw socket calls to device endpoints outside the gateway modules, plus a
    PR review checklist item.
  - Migrate `ConfigItemRow` sliders onto the latest-intent lane.
- **Files likely affected:** `tests/unit/**`, `eslint.config.js` or a new CI test,
  `components/ConfigItemRow.tsx`, docs.
- **Tests likely needed:** the guard test itself; slider/health regression suites.
- **Risks:** guard false-positives on legitimate non-device fetches — scope the rule to
  device-endpoint patterns / exclude the gateway + asset modules.
- **Exit criteria:** guard active in CI; slider/health regression suites green;
  coverage gate (≥91% branch) still satisfied.

### Phase 4 (optional) — Cross-protocol pressure coordination

- **Goal:** REST/FTP/Telnet back off **together** under combined load.
- **Changes:** a shared device-pressure observer (global in-flight + recent-error view)
  consulted by all three gateways; adaptive concurrency/cooldown when combined pressure
  is high. Justified only if Phase 1–2 telemetry still shows cross-protocol bursts
  triggering lock-ups.

---

## Acceptance Criteria for Future Implementation

Measurable / observable conditions only:

1. **Classification coverage:** 100% of device-call sites in this inventory are
   classified and tracked; a CI guard fails the build on any new device-endpoint
   `fetch`/socket outside the four gateways.
2. **Zero confirmed bypasses:** static scan + guard test show 0 raw-`fetch`/socket
   device calls in `connectionManager`, `GlobalDiagnosticsOverlay`, and anywhere else
   outside `deviceInteractionManager`/`c64api`/`ftpClient`/`telnet*`.
3. **Intent integrity:** automated test proves `readMemory`/`writeMemory*`/uploads and
   every health probe carry a non-`user` intent unless user-initiated; `fetchWithTimeout`
   no longer hardcodes `user`.
4. **Memory spacing:** `readmem`/`writemem` have a cooldown key; a test shows N rapid
   memory calls are spaced by the configured cooldown.
5. **Slider bound:** a stress test of ≥20 rapid changes on every device-bound slider
   produces ≤1 in-flight write + ≤1 trailing latest-value write per drag, with no stale
   snap-back; no unbounded sequence.
6. **Picker-open cycle unchanged (wanted):** a test proves the `switchDeviceDialog`
   context still runs the full multi-protocol cycle (incl. CONFIG pulse) every 10 s
   across saved devices — no regression to the wanted behaviour.
7. **Background overhead near-zero when idle/healthy:** with a healthy selected `C64U`
   and recent real traffic, the `backgroundMaintenance` path issues **0** device
   probes within the freshness window; idle background health ops/min ≈ 0.
8. **Background is selected-device-only & lightweight:** a test shows background
   maintenance probes only the selected device, with a single read-only `GET /v1/info`
   and **no** FTP/Telnet/CONFIG/memory probe and **no** parallel fan-out.
9. **Health derived from real traffic:** a failed real REST/FTP/Telnet call flips the
   selected device's badge to unhealthy/unreachable without a dedicated probe.
10. **Circuit respect:** with the circuit open, a test shows health/discovery issue no
    new device traffic and the UI reports state from cache.
11. **Testability without hardware:** all of the above are provable in Vitest using forced
    scheduling + mock transports (no real device required per test).
12. **Hardware/HIL validation (when available):** on a real `C64U`, rapid slider/CTA
    interaction for ≥60s with the picker periodically open does **not** cause REST/FTP/
    Telnet/ping listener lock-up; idle background health ops/min on `C64U` ≈ 0.
13. **Diagnostics still useful:** diagnostics health check and validate-target still
    produce results, now via the gateway, with no probe storm (assert ops count).
14. **Coverage gate:** `npm run test:coverage` ≥ 91% branch globally remains satisfied
    after implementation.

---

## Open Questions

Two prior questions were **answered by product direction** and are now decisions, not
open questions:

- **(Resolved) Raw-fetch fallback in `connectionManager`.** Decision: *"There must not
  be such a fallback. Clean it up."* The fallback is to be **deleted**, not wrapped.
  Discovery uses the gateway `getInfo` path only. More broadly, remove any strange
  quirks that crept into the REST/Telnet/FTP calls and keep them simple (Phase 1).
- **(Resolved) Exact `C64U` lock-up root cause.** Decision: *do not chase it — it's a
  rabbit hole.* Assume **any fast sequence of REST/Telnet (or FTP) calls** can wedge the
  listener surface and harden against that class. No firmware-trigger investigation.

Remaining open questions:

| # | Question | Why it matters | Current evidence | How to answer | Blocks impl? |
| --- | --- | --- | --- | --- | --- |
| 1 | Can native Telnet/FTP bridges emit traffic outside the JS gateway? | Confirms gateway completeness | `createTelnetClient`→`TelnetSocket`, `ftpClient.web.ts` both invoked inside gateways | Inspect native bridge code (`android/...`, plugin) for any auto-reconnect/keepalive | No |
| 2 | What freshness window best balances overhead vs. staleness for background health? | Sets the idle-overhead budget without misleading the user | `infoCacheMs`/`configsCacheMs` scale (1.2–2s on `C64U`); real-traffic recency | UX choice + measured probe duration; default to a multiple of `infoCacheMs` | No |
| 3 | How should non-selected saved devices present health while not background-probed? | Avoids implying "unknown" = "broken" | Picker-open cycle still refreshes them on demand | UX decision: "last seen <age>"/"unknown" affordance | No |
| 4 | Should user-pressed Telnet actions be `user` not `system`? | Affects priority vs. background | `useTelnetActions` hardcodes `system` | Product/priority decision | No (Phase 3) |
| 5 | Is the active-device `runHealthCheck` ever auto-scheduled? | Confirms manual-only assumption | Only caller is the overlay button (l.365) | Re-grep after any UI change | No |

---

## Appendix A — Search Log

| Search | Purpose | Key result |
| --- | --- | --- |
| `rg "fetch\(" src` (excl. tests, prefetch/refetch) | Find non-gateway device calls | `connectionManager` ×3, `GlobalDiagnosticsOverlay` ×1 (device); `c64api` ×2 (inside gateway); rest non-device |
| `rg "immediate:\s*true" src` | Residual config bypass | `useLightingStudio`, `applyConfigFileReference`, `useVolumeOverride` — all log-only now |
| `rg "__c64uBypass|__c64uAllowDuring" -l` | Bypass-flag callers | `c64api`, `connectionManager`, `healthCheckEngine`, `configDrift`, `useVolumeOverride`, `deviceInteractionManager` |
| `rg "withRestInteraction|withFtpInteraction|withTelnetInteraction"` | Confirm boundaries | transports + health + telnet actions route through gateways |
| `rg "fetchWithTimeout" src/lib/c64api.ts` | Memory/upload routing | 8 callers; all wrap gateway but intent hardcoded `user` |
| `rg "runHealthCheck|useSavedDeviceHealthChecks"` | Health entry points | active singleton (overlay button) + saved-device parallel (badge) |
| `rg "refetchInterval|staleTime|__c64uIntent" useC64Connection.ts` | Polling cadence/intent | info `background` 60s gated; drives 30/60s; intents threaded |
| `rg "useDeviceBoundSlider|useInteractiveConfigWrite"` | Slider surfaces | ConfigItemRow + lighting + volume |

## Appendix B — File Inspection Log

| File | Relevance |
| --- | --- |
| `lib/deviceInteraction/deviceInteractionManager.ts` | Core gateway: schedulers, cooldown, backoff, circuit, cancellation. |
| `lib/config/deviceSafetySettings.ts` | Presets + AUTO resolution (`C64U`→CONSERVATIVE). |
| `lib/config/configWriteThrottle.ts` | Serial config write queue. |
| `lib/deviceInteraction/latestIntentWriteLane.ts` | Latest-wins coalescing primitive. |
| `lib/deviceInteraction/deviceActivityGate.ts` | Write-burst gate / background-read yield. |
| `lib/query/c64PollingGovernance.ts` | Polling-pause registry + rate-limit helpers. |
| `lib/c64api.ts` | REST transport, config writes, machine control, memory, uploads. |
| `lib/ftp/ftpClient.ts` | FTP list/read/write through `withFtpInteraction`. |
| `lib/telnet/telnetClient.ts`, `telnet/telnetSession.ts` | Telnet transport (inside gateway). |
| `hooks/useTelnetActions.ts` | Telnet action scheduling (`system`). |
| `lib/diagnostics/healthCheckEngine.ts` | Both health-check engines + 6 probes. |
| `hooks/useSavedDeviceHealthChecks.ts` | Saved-device parallel health scheduler. |
| `components/UnifiedHealthBadge.tsx` | Mounts saved-device health; picker vs. background context. |
| `components/diagnostics/GlobalDiagnosticsOverlay.tsx` | Manual health, retry, raw-fetch validate-target. |
| `lib/connection/connectionManager.ts` | Discovery/probe + raw-fetch fallbacks. |
| `hooks/useC64Connection.ts` | Info/drives polling, config-write mutations, lifecycle cancellation. |
| `hooks/useDeviceBoundSlider.ts` | Slider local state, throttled preview, latched commit. |
| `hooks/useInteractiveConfigWrite.ts` | Latest-intent lane + quiet window for config writes. |
| `pages/playFiles/hooks/useVolumeOverride.ts` | Volume latest-intent lane + playback burst. |
| `pages/HomePage.tsx` | Home CTAs, machine controls, telnet REU/config workflows. |
| `components/ConfigItemRow.tsx` | Config-page sliders/selects → `setConfigValue`. |
| `lib/config/applyConfigFileReference.ts` | Config-file telnet workflow. |
| `lib/diagnostics/configDrift.ts` | System config scan (gateway, cache-bypass). |
| `lib/playback/playbackRouter.ts` | Program launch → FTP + machine control + uploads. |
| `lib/appLifecycle.ts` | Foreground/background state derivation. |
| `lib/native/ftpClient.web.ts` | FTP bridge transport (inside gateway). |
| `lib/deviceInteraction/restRequestIdentity.ts` | Path canonicalisation / machine-control & config-mutation classifiers (referenced by `resolveRestPolicy`). |
| `PLANS.md`, `WORKLOG.md` (prior task) | Documented the just-landed device-safety fixes; re-verified against current code. |

## Appendix C — Terminology

- **Device call:** any network operation targeting a `C64U`/`U64` endpoint over REST,
  FTP, or Telnet (incl. ping/probe `GET /v1/info`, memory I/O, config writes, telnet
  sessions, FTP listings).
- **Approved outbound boundary:** `withRestInteraction`, `withFtpInteraction`,
  `withTelnetInteraction`, or `scheduleConfigWrite` (front of REST config writes).
- **Bypass:** any device call that reaches the network without traversing an approved
  boundary (e.g. raw `fetch` to `/v1/info`).
- **Health check:** a diagnostic that probes device reachability/usability; it is a
  confidence signal, not a product feature, and must not impair real device use.
- **User-initiated call:** a device call directly caused by a user gesture (`user`
  intent); highest priority.
- **Background call:** scheduled/maintenance traffic (polling, background health,
  discovery); lowest priority; must yield to user-initiated calls.
- **High-frequency CTA:** a control that can emit many events quickly (sliders,
  repeated taps).
- **Coalescing:** collapsing multiple pending intents into a single outbound call
  (throttled-latest / latest-intent lane).
- **Supersession:** discarding an older queued intent because a newer one exists
  (`latestIntentWriteLane`).
- **Rate limiting:** enforced minimum spacing/concurrency between device calls
  (cooldowns, concurrency 1, config queue) — protecting the **physical device**, not
  just the UI.
- **Backoff:** growing delay after consecutive errors (`computeBackoff`), with a circuit
  breaker that blocks traffic once an error threshold is hit.
