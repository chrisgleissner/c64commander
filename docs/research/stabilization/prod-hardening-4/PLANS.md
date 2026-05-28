# Production Hardening 4 - Execution Plan

## Classification

`CODE_CHANGE` with required deterministic regression tests, lint, build, coverage, Android APK deploy, and hardware/mobile validation evidence.

No documented visible UI surface is expected to change, so screenshot regeneration is not planned.

## Constraints to preserve

- Keep REST, FTP, Telnet, and config-write traffic behind the approved gateways.
- Preserve the 10 second saved-device health cycle used by the switch-device dialog.
- Do not chase Ultimate FTP firmware behavior; harden app pacing/retry behavior instead.
- Preserve production-hardening-3 guarantees: gateway routing, bounded slider writes, exact-once auto-advance, disk origin fetch, disk/page consistency, and exception discipline.
- Keep changes minimal and targeted; do not re-architect playback or source navigation.

## Impact map

- FTP resilience: `src/lib/ftp/ftpClient.ts`, `src/lib/deviceInteractionManager.ts`, Android native FTP plugin timeout constants if required, and FTP/unit tests.
- Manual skip coalescing: `src/hooks/usePlaybackController.ts` and focused playback-controller tests.
- Background auto-skip listener: `src/pages/PlayFilesPage.tsx` and focused Play Files page/background listener tests.
- Documentation deliverables: this plan, `WORKLOG.md`, `results.md`, and `pr-desc.md`.

## Implementation plan

1. Inspect current FTP gateway/native timeout code and existing failure taxonomy/tests.
2. Lower FTP connect timeout while preserving read/data timeouts, add one transient retry through the gateway, and enforce per-host connect pacing for list and read operations without bypassing the circuit breaker.
3. Add regression tests for transient retry success, non-retryable failure, circuit-open no-retry, lowered connect-timeout propagation, and persistent transient failure surfacing once.
4. Inspect current playback transport queue and tests, then coalesce rapid user Next/Previous to a single debounced net target while preserving single-flight and auto-advance behavior.
5. Add regression tests for rapid Next coalescing, single Next, auto-advance preservation, end-of-playlist stop, and Repeat wrap.
6. Inspect the Play Files background listener effect, then register `backgroundAutoSkipDue` once and read volatile state/callbacks through refs.
7. Add regression tests for one native listener registration across state churn and unchanged exactly-once auto-advance behavior on simulated background events.
8. Run targeted tests during implementation, then full validation: `npm run test`, `npm run lint`, `npm run build`, `npm run test:coverage`, plus patch coverage evidence.
9. Build/deploy the debug APK to Pixel 4, probe `u64` then `c64u`, and validate the three fixes and protected stable behaviors on live hardware where reachable.
10. Finalize `WORKLOG.md`, create `results.md` and `pr-desc.md`, and record any concrete blockers.

## Current status

- Implemented all three hardening fixes:
  - FTP connect timeout split/lowered to 1500 ms with transfer timeout preserved at 8000 ms.
  - One bounded transient FTP retry and per-host connect pacing now live in `withFtpInteraction`.
  - Rapid user Next/Previous now coalesce to one net target launch; auto-advance remains non-coalesced.
  - Android background auto-skip listener registration now uses stable refs and avoids volatile re-subscribe churn.
- Added deterministic regression coverage for FTP retry/no-retry/circuit-open/default-timeout behavior, manual skip coalescing, playlist boundary behavior, and background listener contracts.
- Validation completed:
  - `npm run test` passed.
  - `npm run lint` passed.
  - `npm run build` passed.
  - `npm run test:coverage` passed with 91.66% branch coverage.
  - Local changed-line coverage check over executable TS/TSX patch lines reported 357/357 = 100.00%.
  - `cd android && ./gradlew :app:testDebugUnitTest --tests uk.gleissner.c64commander.FtpClientPluginTest` passed.
  - `npm run cap:build && npm run android:apk` passed.
- Hardware/mobile validation completed on Pixel 4 `9B081FFAZ001WX` against `u64` (`Ultimate 64 Elite`, firmware `3.14e`, host `192.168.1.13`).
- `c64u` (`http://c64u/v1/info`) remained unavailable for cross-device validation with `curl: (56) Recv failure: Connection reset by peer`; cross-device disk-origin revalidation is therefore blocked by that concrete host outage.
- No screenshot regeneration was needed because no documented visible UI surface changed.
