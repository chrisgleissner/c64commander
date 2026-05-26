# Production Hardening 2 — Implementation Plan

> Companion to `research.md` (evidence) and `prompt.md` (executable handoff).
> This plan turns every finding into a concrete, ordered, testable work item.
> **It is a plan, not an implementation. Nothing here has been built yet.**

## Guiding constraints (non-negotiable)

1. **One way to talk to the device.** Every REST/FTP/Telnet call routes through
   `withRestInteraction` / `withFtpInteraction` / `withTelnetInteraction`
   (`src/lib/deviceInteraction/deviceInteractionManager.ts`), and every config write
   additionally through `scheduleConfigWrite`. No direct `fetch`/socket to a device
   endpoint anywhere else.
2. **Keep the device-picker 10 s full health cycle exactly as-is.** It is wanted. Do
   not change its cadence, parallel fan-out, or CONFIG pulse.
3. **The target is background overhead.** Idle, healthy devices must incur ~0 dedicated
   background health probes; an unreachable/unhealthy **selected** device must still be
   surfaced immediately.
4. **Keep it simple.** Delete dead/quirky code; do not add abstraction for its own sake.
5. **Do not chase the firmware lock-up root cause.** Harden against *any* fast sequence
   of REST/Telnet/FTP calls.
6. **UI responsiveness comes from local state**, latest-intent coalescing, and the
   pending-intent latch — never from bypassing the gateway.
7. Every behavioural change ships with a deterministic regression test that fails
   before and passes after. Maintain ≥91% branch coverage
   (`npm run test:coverage`); for `agents/` changes ≥90% (`npm run test:agents`).

---

## Work items (finding → fix)

Each item lists: **What**, **Where**, **How**, **Tests**, **Done when**.

### WI-1 — Delete the `connectionManager` raw-fetch fallbacks  *(Phase 1, P1)*

- **What:** Discovery/probe must use only the gateway `getInfo` path. Remove the raw
  `fetch(${baseUrl}/v1/info)` fallbacks.
- **Where:** `src/lib/connection/connectionManager.ts` — `probeWithFetch` (l.305),
  the inline `probeWithFetchForInfo` fallbacks in `probeInfoWithConnectionConfig`
  (l.181) and `probeInfoOnce` (l.413), and the `catch`-driven calls to them in
  `probeOnce` (l.389) / `probeInfoOnce` (l.487) / `probeInfoWithConnectionConfig`
  (l.260). Keep the `isTestEnv` deterministic path only if a test seam is still
  required; prefer routing tests through the gateway with mock transport instead.
- **How:** Let the `C64API.getInfo` call (already `__c64uIntent:"system"`,
  `allowDuringDiscovery/Error`, `bypassCache`) be the single source. On failure, return
  the failure — do **not** retry via raw fetch. Confirm `getInfo` works on native
  (it does: `request`→`fetch` inside the gateway).
- **Tests:** "discovery probe issues exactly one gateway `getInfo` and no raw fetch on
  network error"; guard test (WI-9) covers the static check.
- **Done when:** no raw `fetch` to `/v1/info` remains in `connectionManager.ts`;
  discovery still transitions correctly in unit tests + demo/offline flows.

### WI-2 — Route diagnostics "validate target" through the gateway  *(Phase 1, P1)*

- **What:** Replace the raw `fetch` in `validateTarget` with a gateway probe.
- **Where:** `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx` l.53–85.
- **How:** Use a `C64API` instance for the target host and call `getInfo` with
  `__c64uIntent:"user"` (user-initiated diagnostic) and an explicit, documented circuit
  policy for recovery (may allow-during-error, must not silently skip throttling). Keep
  the trace/record behaviour the overlay needs.
- **Tests:** "validate-target uses gateway `getInfo`, no raw fetch"; outcome shape
  unchanged (ok/status/duration/body/error).
- **Done when:** no raw `fetch` in the overlay; validate-target still reports a result.

### WI-3 — Thread intent through `readMemory`/`writeMemory*`/uploads  *(Phase 1, P1)*

- **What:** `fetchWithTimeout` must stop hardcoding `intent:"user"`; callers pass intent.
- **Where:** `src/lib/c64api.ts` — `fetchWithTimeout` (l.1198, hardcoded `intent` l.1216),
  `readMemory` (l.1673, currently drops `options.__c64uIntent`), `writeMemoryBlock`
  (l.1717), and upload helpers (l.1820–2164).
- **How:** Add an optional `intent` parameter (default `"user"`) to `fetchWithTimeout`
  and forward `__c64uIntent` from `readMemory`/`writeMemory*` options + upload callers.
- **Tests:** "readMemory with `__c64uIntent:'system'` schedules at system priority";
  "fetchWithTimeout default intent is user".
- **Done when:** health JIFFY/RASTER and any system/background memory read carry the
  correct intent; no path forces `user` implicitly.

### WI-4 — Add machine-I/O cooldown keys  *(Phase 1, P1)*

- **What:** `readmem`/`writemem` get a cooldown policy so rapid memory traffic is spaced.
- **Where:** `src/lib/deviceInteraction/deviceInteractionManager.ts` — `resolveRestPolicy`
  (l.422–461) currently returns `{key:null,cooldown:0}` for these. Add a `machine-io`
  key with a conservative cooldown (reuse `MACHINE_CONTROL_COOLDOWN_MS` or a dedicated
  device-safety value). Use `restRequestIdentity` classifiers.
- **Tests:** "N rapid readMemory calls are spaced by the configured cooldown".
- **Done when:** memory reads/writes are spaced; existing memory-dependent flows
  (health, RAM tools) still pass.

### WI-5 — Stop probes bypassing the circuit breaker  *(Phase 1, P1/P2)*

- **What:** Remove `__c64uBypassCircuit` from the health REST probe and discovery probe;
  when the circuit is open, surface state instead of forcing traffic.
- **Where:** `src/lib/diagnostics/healthCheckEngine.ts` `probeRest` (l.529–533);
  `src/lib/connection/connectionManager.ts` `probeOnce`/`probeInfoOnce`/
  `probeInfoWithConnectionConfig` getInfo options (l.378–382, 467–471, 239–243).
  (`bypassCache` may stay — freshness is desired; `bypassCircuit` must go.)
- **How:** Drop the flag; rely on `allowDuringError`/`allowUserOverrideCircuit` semantics
  already in `withRestInteraction`. When the circuit is open, report from
  `getConnectionSnapshot()` / health state.
- **Tests:** "circuit open → health/discovery issue no new device traffic; UI reports
  state from cache".
- **Done when:** no `bypassCircuit` on routine probes; circuit-open is respected.

### WI-6 — Remove quirks; keep REST/Telnet/FTP simple  *(Phase 1, P1)*

- **What:** Delete dead/duplicated code paths flagged as quirks.
- **Where & how:**
  - `src/lib/c64api.ts` `updateConfigBatch` (l.1563–1608): remove the now-dead
    `immediate` option + its log line (l.1595–1599); update the signature and the four
    callers (`useLightingStudio` l.561, `applyConfigFileReference` l.257,
    `useVolumeOverride` l.298/338) to drop `immediate`.
  - `src/lib/c64api.ts` `request` (l.943–968): collapse the **duplicate** timeout
    (AbortController `setTimeout(controller.abort)` *and* a `Promise.race` reject
    timeout) to a single mechanism (prefer AbortController + one timer). Same review for
    `fetchWithTimeout` (l.1257–1270).
  - Audit the two read-cache layers — C64API budget-replay/in-flight dedupe (l.828–854,
    1184–1196) vs. scheduler `restCache`/`restInflight`. If they duplicate, keep one
    and document why. (Conservative: keep both but document; remove only if proven
    redundant by tests.)
- **Tests:** existing `c64api` tests must stay green; add a timeout-behaviour test if the
  mechanism changes.
- **Done when:** no `immediate` flag anywhere; one timeout mechanism per request path;
  cache layering documented (and de-duplicated if safe).

### WI-7 — Tag health probe intents (observability)  *(Phase 1, P1)*

- **What:** Health probes carry explicit, correct intent so logs/metrics and the
  background path can distinguish health from user traffic. Picker cadence unchanged.
- **Where:** `src/lib/diagnostics/healthCheckEngine.ts` — `probeConfig` `setConfigValue`
  (l.691, 708) and `readMemory` probes (l.575, 616) currently default/force `user`.
- **How:** Pass `__c64uIntent` for the run's context: picker-open may stay effectively
  user-equivalent in *cadence* but should still be tagged (e.g. `system`) for logging;
  the new background path (WI-8) uses `background`.
- **Tests:** "health probe traffic is tagged non-`user`".
- **Done when:** health traffic is identifiable by intent in logs/metrics; picker
  behaviour unchanged.

### WI-8 — Background-health redesign  *(Phase 2, P2)* — **core item**

- **What:** Replace the background-maintenance fan-out with traffic-derived health +
  selected-device-only + freshness-gated single lightweight probe. **Picker-open path
  untouched.**
- **Where:**
  - `src/hooks/useSavedDeviceHealthChecks.ts` — split behaviour by `context`. For
    `backgroundMaintenance`: (a) probe only the selected device; (b) gate on freshness;
    (c) run a single lightweight probe, not `runHealthCheckForTarget`'s full battery;
    (d) keep existing pause guards (l.136–149, 379–439). Leave `switchDeviceDialog`
    branch (full battery, 10 s, fan-out) exactly as-is.
  - `src/lib/diagnostics/healthCheckEngine.ts` — add a lightweight background entry
    (e.g. `runConnectivityProbeForTarget`) that does a single read-only `GET /v1/info`
    at `background` intent, honouring the circuit (WI-5).
  - `src/components/UnifiedHealthBadge.tsx` — consume traffic-derived health for the
    selected device; show "last seen <age>"/"unknown" for non-selected devices; render
    result age / "deferred" state.
  - `src/lib/connection/connectionManager.ts` + `src/lib/deviceInteraction/deviceStateStore.ts`
    — expose last-reachable evidence (`noteReachable`, `lastProbeSucceededAtMs`,
    circuit state) for the badge to derive health without a probe.
  - `src/lib/config/deviceSafetySettings.ts` — optional freshness-window / background
    cadence knobs (scaled from `infoCacheMs`).
- **How:** Health for the selected device = most recent of {real-traffic success/failure,
  last lightweight probe}. Background timer: if recent evidence within freshness window →
  skip; else fire one `/v1/info`. Adaptive cadence: long when healthy, bounded slowing
  re-probe when failing, none when circuit open. Event-driven re-probe on app-foreground
  and on observed user-action failure.
- **Tests:**
  - "background probes selected device only — no parallel fan-out".
  - "background probe is a single `/v1/info` read — no FTP/Telnet/CONFIG/memory".
  - "freshness window skips re-probe after a recent successful real call".
  - "failed real call flips selected-device badge without a dedicated probe".
  - "circuit open → zero background probe traffic".
  - "picker-open cycle unchanged — still 10 s full battery across devices".
- **Done when:** idle healthy `C64U` background health ops/min ≈ 0; unreachable selected
  device flagged within one freshness window; picker behaviour byte-for-byte unchanged.

### WI-9 — Guard against new direct device calls  *(Phase 3, P3)*

- **What:** A CI guard forbidding raw `fetch(`/socket calls to device endpoints outside
  the gateway modules, + a PR review checklist line.
- **Where:** `eslint.config.js` (custom `no-restricted-syntax`) or a dedicated CI test
  under `tests/unit/`; scope to device-endpoint patterns (`/v1/`, telnet/ftp socket
  APIs); allowlist `deviceInteractionManager`, `c64api`, `ftp/`, `telnet/`,
  `native/ftpClient.web.ts`, and the mock server.
- **Tests:** the guard test itself (passes on clean tree; fails on a planted violation).
- **Done when:** guard is active in CI and green.

### WI-10 — Slider hardening (config rows)  *(Phase 3, P1/P3)*

- **What:** Migrate `ConfigItemRow` sliders onto the latest-intent lane so a long drag
  coalesces to a single in-flight write rather than one-per-throttle-window.
- **Where:** `src/components/ConfigItemRow.tsx` (l.336–351) → use
  `useInteractiveConfigWrite` (or equivalent) for preview/commit.
- **Tests:** "≥20 rapid changes → ≤1 in-flight + ≤1 trailing write; latched value;
  no stale snap-back" for ConfigItemRow (extend the existing `useDeviceBoundSlider`
  stress test pattern).
- **Done when:** config-row sliders match lighting/volume coalescing guarantees.

### WI-11 (optional) — User-pressed Telnet intent  *(Phase 3, P3)*

- Tag user-pressed telnet actions `user` instead of `system`
  (`src/hooks/useTelnetActions.ts` l.238). Small; do only if it doesn't disturb ordering.

---

## Phase ordering & dependencies

- **Phase 1 (safety + cleanup):** WI-1, WI-2, WI-3, WI-4, WI-5, WI-6, WI-7. Independent;
  WI-3 precedes WI-7 (intent plumbing) and benefits WI-8.
- **Phase 2 (background health):** WI-8 (depends on WI-3, WI-5, WI-7).
- **Phase 3 (regression prevention):** WI-9, WI-10, WI-11 (WI-9 after WI-1/WI-2 so the
  guard passes on a clean tree).

## Validation per phase

- Targeted Vitest first (the new/changed specs), then `npm run test`, `npm run lint`,
  `npm run build`, then `npm run test:coverage` (≥91% branch). Scheduler behaviour must
  be exercised with `__c64uForceInteractionScheduling` (since `isTestEnv()` otherwise
  bypasses gating).
- Per repo policy, deploy the latest APK to the attached Pixel 4 and validate the
  touched areas (sliders responsive, picker health live, idle app quiet) before
  declaring done; record the device/host used or the concrete blocker.
- Golden-trace stewardship: if REST routing/trace semantics change (WI-1/2/6), re-record
  and commit golden traces; never weaken assertions.

## Exit criteria (whole effort)

Maps 1:1 to `research.md` → "Acceptance Criteria for Future Implementation" (items 1–14).
Headline: zero device-endpoint bypasses (guarded), picker-open cycle unchanged, idle
background health ≈ 0 probes, unreachable selected device surfaced within one freshness
window, sliders bounded, circuit respected, coverage ≥91%.

## Out of scope

- Firmware lock-up root-cause investigation (assume any fast REST/Telnet/FTP sequence).
- Any change to the picker-open 10 s full health cycle.
- Pre-existing unrelated working-tree edits owned by concurrent work
  (`.github/workflows/android.yaml`, `playwright/playback.part2.spec.ts`,
  `tests/unit/ci/telemetryGateWorkflow.test.ts`).
