# Production Hardening 2 — Research Plan (Device Call Safety & Health-Check Load)

> **Task type:** Research-only. No production code/test/format changes.
> **Deliverable:** `docs/research/stabilization/prod-hardening-2/research.md`
> **Working files:** this `PLANS.md` + `WORKLOG.md` (repurposed from the prior
> device-safety *implementation* task — that content is preserved in git history;
> these now track the prod-hardening-2 *research* task).

## Problem Statement

The C64 Ultimate (`C64U`) network listener surface can become indefinitely
unresponsive under rapid/concurrent REST/Telnet/FTP/ping traffic. A
conservative back-off / rate-limiting layer exists (`deviceInteractionManager`,
`configWriteThrottle`, `deviceSafetySettings`), but later responsiveness work
(sliders, CTAs) may bypass it. Separately, health checks may consume scarce
rate-limit capacity and compete with user actions. Converge to a written,
evidence-backed research document.

## Investigation Phases

| Phase | Description | Status |
| ----- | ----------- | ------ |
| P0 | Set up PLANS.md / WORKLOG.md; mine prior task artifacts | complete |
| P1 | Map approved outbound architecture (Objective 1) | complete |
| P2 | Enumerate & classify all outgoing device-call sites (Objective 2) | complete |
| P3 | Trace CTAs / UI interactions to outbound calls (Objective 3) | complete |
| P4 | Slider & high-frequency control analysis (Objective 3) | complete |
| P5 | Health-check architecture & load analysis (Objective 4) | complete |
| P6 | Target safe-traffic policy (Objective 5) | complete |
| P7 | Prioritized roadmap (Objective 6) | complete |
| P8 | Acceptance criteria (Objective 7) | complete |
| P9 | Gap closure — re-run searches with discovered names | complete |
| P10 | Write research.md | complete |
| P11 | Self-audit; verify no code changes remain | complete |

## Files / Subsystems Checklist

- [x] `src/lib/deviceInteraction/deviceInteractionManager.ts` (REST/FTP/Telnet scheduler)
- [x] `src/lib/config/deviceSafetySettings.ts` (presets, AUTO resolution)
- [x] `src/lib/config/configWriteThrottle.ts` (serialized config queue)
- [x] `src/lib/deviceInteraction/latestIntentWriteLane.ts` (latest-wins lane)
- [x] `src/lib/deviceInteraction/deviceActivityGate.ts` (write-burst gate)
- [x] `src/lib/deviceInteraction/deviceStateStore.ts`
- [x] `src/lib/deviceInteraction/machineTransitionCoordinator.ts`
- [x] `src/lib/deviceInteraction/restRequestIdentity.ts`
- [x] `src/lib/c64api.ts` + `src/lib/c64api/*` (REST transport)
- [x] `src/lib/ftp/*` (FTP transport)
- [x] `src/lib/telnet/*` (Telnet transport)
- [x] `src/lib/diagnostics/healthCheckEngine.ts` + diagnostics
- [x] `src/lib/connection/connectionManager.ts`
- [x] `src/lib/deviceControl/deviceControl.ts`
- [x] `src/hooks/useSavedDeviceHealthChecks.ts`, `useHealthState.ts`
- [x] `src/hooks/useC64Connection.ts`, `useConnectionState.ts`, `useRefreshControl.tsx`
- [x] `src/hooks/useDeviceBoundSlider.ts`, `useInteractiveConfigWrite.ts`
- [x] `src/lib/query/c64PollingGovernance.ts`
- [x] `src/lib/playback/*` (playback writes)
- [x] `src/lib/appLifecycle.ts`, `src/lib/startup/*`
- [x] UI surfaces: `HomePage`, `home/components/*`, `ConfigItemRow`, `VolumeControls`, devices, diagnostics
- [x] Tests under `tests/unit/**` for scheduler/slider/config/health

## Hypotheses

1. `immediate: true` writes once bypassed `scheduleConfigWrite` (fixed) — verify no
   residual bypass remains and that all config writes route through the queue.
2. Sliders update local UI immediately and coalesce, but some commit/preview paths
   may still emit one device write per change under certain conditions.
3. Health checks (`useSavedDeviceHealthChecks`, `healthCheckEngine`) may issue
   probes that consume scheduler capacity and compete with user actions.
4. Diagnostics/discovery probes carry explicit `bypass*` flags — confirmed
   architectural exception; verify scope and risk.
5. Telnet/FTP helper sessions outside `useTelnetActions`/`ftpClient` may open raw
   sessions outside the scheduler.
6. Playback/volume writes may use `immediate`/burst paths needing verification.

## Convergence Criteria

- ≥30 relevant files inspected (or justify fewer).
- ≥10 outgoing device-call paths classified.
- ≥10 CTA/UI interaction families traced.
- All health-check entry points documented.
- Every confirmed/suspected bypass has a remediation recommendation.
- research.md contains all required sections, evidence vs hypothesis separated,
  open questions, exec summary, roadmap, measurable acceptance criteria.
- No production code changes in the working tree.

## Open Uncertainties (running)

- Whether native (Capacitor) Telnet/FTP bridges can emit traffic outside JS gateways.
- Whether any `fetch`/`XMLHttpRequest` exists that does not route through `C64API`.
- Exact health-check cadence and overlap across startup/reconnect/device-switch.
