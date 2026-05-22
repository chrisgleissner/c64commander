# FEATURE_INVENTORY — User-perceived feature audit (Responsiveness 3)

Generated 2026-05-18 during investigation Stage 1, against branch
`feat/reduce-latency-and-fix-errors2` (HEAD `d7325920`, PR #258 merged).
Priority is a stabilization rank where 1 = ship-blocking, 5 = nice-to-have.

This audit is a *delta* against `responsiveness2/FEATURE_INVENTORY.md`. Items
the prior pass left in their priority bucket are still in the same bucket
unless the new evidence revealed a higher cost.

## Priority 1 — Cold-boot latency (NEW BUCKET)

Responsiveness2 treated cold boot as a secondary concern because the badge
landed HEALTHY within ~6 s. This pass shows that the badge is HEALTHY but the
Home page is still rendering and bridging requests for another 5-6 seconds
during which the user sees stale or partial state. The cold-boot REST storm
is the highest-leverage open defect.

### Cold-boot REST storm

- Source: `src/lib/c64api.ts:1248-1343`, `src/hooks/useC64Connection.ts:309-348`,
  `src/pages/HomePage.tsx:119-148` and home/hook tree.
- Network shape: ~17 category bulk reads + ~78 per-item enrichment reads per
  cold boot (measured at 95 total). Reproducible across two cold boots.
- Failure mode: per-item enrichment is triggered because Ultimate firmware
  returns flat strings (`"CPU Speed": "40"`) at the category endpoint and
  only the per-item endpoint returns structured options/values.
- Tests existing: ad-hoc unit coverage in `tests/unit/lib/c64api/getConfig*.test.ts`
  ensures the enrichment loop is correct; no test forbids it.
- Suggested priority: **1** — first impression. Storm visible to anyone who
  cold-launches the app.

### App-config snapshot capture

- Source: `src/hooks/useAppConfigState.ts:111-178,217-260`.
- Failure mode: eager mount-time category-by-category read for every category
  in `cats.categories` (concurrency 4) at first-connect.
- Suggested priority: **1** — adds a second pass of bridge cost on top of the
  Home storm.

### Cold-boot Telnet capability discovery

- Source: `src/hooks/useTelnetActions.ts:273-306`, `src/lib/telnet/
  telnetCapabilityDiscovery.ts:72-93`.
- Failure mode: cache is in-memory; cache key races `deviceInfo` population;
  discovery cycle takes 3-5 s and serializes against TELNET health probe.
- Suggested priority: **1** — gates first user-initiated Telnet action.

## Priority 1 — Diagnostics fidelity (UNCHANGED from responsiveness2)

The badge contract responsiveness2 locked in survives intact on real hardware
in this session. No new defects observed in this area. See
`responsiveness2/FINDINGS.md F-DIAG-1..3, F-CONN-1..3` and the matching
closeout in `responsiveness2/IMPLEMENTATION_PLANS.md`.

## Priority 2 — Slider / volume / mute controls

### Home page sliders (CPU Speed, Lighting, SID, Drives)

- Source: `src/hooks/useDeviceBoundSlider.ts`, `src/pages/home/components/
  HomeCpuSpeedSlider.tsx`, `src/pages/home/SidCard.tsx`, `src/pages/home/
  components/LightingSummaryCard.tsx`, `src/components/ConfigItemRow.tsx`.
- Failure modes (new since responsiveness2):
  - `pollingPauseRegistry` is observed by `useSavedDeviceHealthChecks`
    (responsiveness2 fix) but NOT by `useC64Drives` or `useC64Info`. A 30 s
    drives tick or a periodic info tick can land mid-drag.
  - The pause is released immediately on commit; a tick queued behind the
    pause can fire before the device echo lands, causing the thumb to flash
    back one step.
- Suggested priority: **2**.

### Play page volume + mute

- Source: `src/pages/playFiles/components/VolumeControls.tsx`, `src/pages/
  playFiles/hooks/useVolumeOverride.ts`.
- Failure modes (new):
  - Volume slider acquires the pause (via `useDeviceBoundSlider`).
  - Mute button does NOT acquire the pause — it's a bare `Button onClick`
    that calls `onToggleMute` directly.
- Responsiveness2 closed H-VOL-1 and H-VOL-2 with unit tests; this pass does
  not re-litigate them.
- Suggested priority: **2**.

## Priority 2 — App resume / visibility behaviour (NEW)

### `visibilitychange` reconciler

- Source: `src/App.tsx:84-94`, `src/lib/diagnostics/diagnosticsReconciler.ts:
  77-125`, `src/lib/query/c64QueryInvalidation.ts:117-121`.
- Failure mode: every WebView return-to-foreground invalidates and refetches
  every active query matching the route prefix. On `/`, this is `c64-info`,
  `c64-drives`, `c64-config-items`, which causes the per-item enrichment
  storm to replay.
- Suggested priority: **2** — affects every screen-lock/unlock cycle.

### Backgrounded-app traffic

- Source: `src/hooks/useScreenActivity.tsx` (TBD), poll lifecycle.
- Failure mode (observed in `evidence/nav-to-play-2-logcat.txt`): 12 CapacitorHttp
  + 12 Telnet plugin calls fired after pressing the Android home key. Either
  `useScreenActivity` doesn't flip fast enough, or the home-tap accidentally
  reloaded Home before sending the app to the background.
- Suggested priority: **2** (pending a clean reproduction).

## Priority 3 — Playback start/stop/pause (UNCHANGED)

Responsiveness2 H-PLAY-1 already locked in the 6 s stop grace and
machine-transition pause. No new defects observed.

## Priority 3 — Telnet plugin native constraints (NEW)

- Source: `android/app/src/main/java/uk/gleissner/c64commander/Telnet
  SocketPlugin.kt`.
- Failure mode: single-thread executor + single Socket field. Two concurrent
  Telnet sessions are structurally impossible from native side.
- Suggested priority: **3** — document the contract today; refactor only if
  a real concurrency need lands.

## Priority 4 — Configuration browsing & writes (UNCHANGED with caveat)

- Source: `src/pages/ConfigBrowserPage.tsx`, `src/pages/SettingsPage.tsx`,
  `src/components/ConfigItemRow.tsx`.
- Failure mode: same per-item storm as Home, scoped to whichever category the
  user opens. Fixing F3-CACHE-1 (persistent enrichment cache) collapses this
  too.
- Suggested priority: **4** — single-screen impact.

## Priority 5 — Feature flags & device profile (UNCHANGED)

- Not a likely root cause for current symptoms.

## Cross-cutting features (NEW)

### Silent-catch surface

- 36 `} catch { ... }` blocks across `src/**`. Most are harmless URL parsers.
  Eight cluster in `src/lib/hvsc/hvscBrowseIndexStore.ts` and deserve a focused
  audit before the next HVSC ingestion bug surfaces.
- Suggested priority: **5** (code health, not a live defect).

### CapacitorHttp dispatcher constraint

- Single bridge thread on Android. JS-side `Promise.allSettled` parallelism is
  collapsed inside the plugin. Documented in FINDINGS.md F3-HTTP-5 as a
  design constraint.

## Suggested implementation order

1. **F3-HTTP-1 (Home enrichment storm)** — biggest win, unlocks the rest.
2. **F3-CACHE-1 (persistent enrichment cache)** — pairs with #1; halves
   cold-boot cost again on repeat starts.
3. **F3-TELNET-1 + F3-TELNET-2 (capability discovery)** — removes the 3-5 s
   discovery cycle from cold boot.
4. **F3-PAUSE-1 + F3-HTTP-3 + F3-HTTP-4 + F3-PAUSE-2 (pause-registry sweep)**
   — single PR that wires the four remaining polling/interaction consumers
   to the registry.
5. **F3-RESUME-1 (visibility reconciler)** — prevents replays.
6. **F3-HTTP-2 (eager snapshot capture)** — defer to lazy/idle.
7. **F3-PAUSE-3 (pause tail-grace)** — UX polish.
8. **F3-NAV-1 (backgrounded traffic)** — confirm hypothesis first.
9. **F3-TELNET-4 (disconnect catch arm)** — small follow-up.
10. **F3-TELNET-3 (single-thread plugin)** — document only; defer.
11. **F3-LOG-1 (silent-catch audit)** — code health; can ride with anything.
