# Production Hardening 3 - Execution Plan

> Status: in progress. Classification: CODE_CHANGE with required tests, documentation, coverage, build, and Android/device validation evidence.
>
> Scope source: `docs/research/stabilization/prod-hardening-3/prompt.md`.

## Execution constraints

1. Preserve the approved REST, FTP, Telnet, and config-write gateways.
2. Preserve the `switchDeviceDialog` 10 second full saved-device health cycle exactly.
3. Harden `backgroundMaintenance` only: selected-device-only, freshness-gated, traffic-derived, circuit-respecting, and at most one read-only `GET /v1/info`.
4. Use local UI state and latest-intent coalescing for high-frequency controls; never bypass safety queues.
5. Add deterministic regression coverage for every behavior fix.
6. Keep docs current as implementation progresses.

## Phase status

| Phase | Focus                                    | Status      | Current notes                                                                                                                |
| ----- | ---------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0     | Re-audit prod-hardening-2 guarantees     | Done        | Removed remaining diagnostics circuit bypass and strengthened gateway guard coverage.                                        |
| 1     | Device pressure and connection lifecycle | Done        | Background saved-device maintenance now suppresses hidden-app probes and resumes with one selected-device lightweight probe. |
| 2     | High-frequency interactions              | Done        | Device-bound slider previews are single-flight with one trailing latest intent.                                              |
| 3     | Playback, playlist, volume               | Done        | Auto-advance duplicate/suppression tests and resume-signal dedupe added; existing volume ordering coverage retained.         |
| 4     | Disk, drive, reconciliation              | Done        | Mounted-delete now stops on eject failure and keeps library/device state truthful.                                           |
| 5     | HVSC native workflows                    | Done        | Cancel is idle-idempotent; browse and ingestion bridge availability are split.                                               |
| 6     | Observability, CI guards, docs           | Done        | Full validation passed; Pixel 4 APK deploy and `u64` smoke validation completed.                                             |

## Highest-risk backlog

1. Completed: zero production direct device endpoint guard remains active, with additional planted bypass/immediate regressions.
2. Completed: routine diagnostics validate-target no longer passes `__c64uBypassCircuit`; background health circuit-open tests remain active.
3. Completed: `backgroundMaintenance` stays selected-device-only, freshness-gated, circuit-respecting, hidden-app suppressed, and resumes with one selected-device probe.
4. Completed: saved-device picker health remains on the unchanged full `switchDeviceDialog` cycle and test context.
5. Completed: existing switch cancellation and stale result tests remain active; hidden/background lifecycle cancellation was extended.
6. Completed: shared device-bound slider writes are bounded with a slow-preview single-flight regression.
7. Completed: playback auto-advance duplicate and post-stop suppression regressions were added.
8. Completed: existing pause/resume volume ordering tests remain active; clustered resume events are deduped.
9. Completed: mounted-delete failure is surfaced and does not remove the library row after failed eject.
10. Completed: HVSC cancel is idle-idempotent and install/ingest availability requires an ingestion bridge, not just browse/filesystem availability.

## Validation plan

Run targeted tests after each changed area. Final required validation:

1. `npm run test`
2. `npm run lint`
3. `npm run build`
4. `npm run test:coverage` with global branch coverage >= 91%
5. Android APK build/deploy to Pixel 4 when available, preferring serial prefix `9B0`
6. Hardware target probe preference: `u64` first, then `c64u`

If hardware, adb, or network targets are unavailable, record the exact blocker in `WORKLOG.md` and `results.md`.

## Documentation deliverables

1. Keep this plan current after meaningful implementation milestones.
2. Append every inspection, change, command result, and blocker to `WORKLOG.md`.
3. Create `results.md` with findings, changes, tests, hardware validation, and risks.
4. Create `pr-desc.md` with a concise PR-ready summary.
