# Device Safety Regression Plan

## Problem Summary

Rapid Home screen case light brightness and color changes can overload the C64U network listener after roughly 10 changes. The likely failure mode is excessive device-bound traffic from user-driven controls and/or background activity bypassing, interleaving with, or amplifying around the configured Device Safety backoff path. The UI must remain locally responsive while device writes are safely serialized, coalesced where appropriate, and protected from stale device refreshes.

## Explicit Assumptions

- Classification: `CODE_CHANGE` with required documentation artifacts. No visible UI redesign is intended.
- Existing Device Safety settings should be reused and not weakened or globally increased as the primary fix.
- Physical C64U hardware and Pixel 4 validation will be attempted only if reachable from this environment; otherwise mock/test evidence will be recorded honestly.
- The smallest robust fix should extend existing scheduling/backoff logic if present.

## Current Evidence

- User report: repeated Home case light brightness changes cause ping, REST, FTP, Telnet, and related interfaces to stop responding after roughly 10 changes.
- Repository orientation identifies `src/lib/c64api.ts`, `src/hooks/`, `src/pages/HomePage.tsx`, and `src/lib/config/deviceSafetySettings.ts` as likely relevant paths.
- Root cause set found: config writes could bypass Device Safety via `updateConfigBatch(..., { immediate: true })`; the config write queue used only app write spacing; REST config mutation cooldown was hardcoded to 120 ms instead of Device Safety `configsCooldownMs`.
- Home case light brightness/color use the shared device-bound slider and interactive config write path, so the shared config-write bypass and too-short cooldown affected the reported workflow.
- Test/log evidence is recorded in `WORKLOG.md`.

## Hypotheses

- Home case light slider/color handlers may call config write helpers that bypass the conservative Device Safety path.
- Slider responsiveness work may send one device request per visual change instead of coalescing latest intent.
- Background polling, health checks, config refreshes, REST refreshes, FTP probes, Telnet probes, or ping checks may interleave ahead of pending user writes.
- Device-confirmed or refreshed stale values may overwrite newer local slider intent while a write is pending.
- Some CTAs/toggles may use direct transport helpers rather than a shared safe scheduler.

## Investigation Steps

- Read required orientation docs and classify the change.
- Audit device-bound call paths across REST, FTP, Telnet, ping/health, config GET/POST, startup sync, polling, page refreshes, diagnostics, playback/status sync, Home controls, Config controls, and Settings safety controls.
- Trace Home case light brightness and color from UI event through local state, debounce/throttle/coalescing, device command construction, scheduling/backoff, transport, response handling, reconciliation, and logging.
- Identify actual bypasses, concurrency hazards, stale overwrite hazards, and missing observability.
- Inspect existing tests around config writes, Home controls, polling governance, and device safety.

## Implementation Steps

- Reuse or introduce the narrowest shared device-command scheduling/safety gate needed for user and background device operations.
- Ensure slider-like writes use latest-value-wins coalescing with immediate local UI intent and a final flush on release.
- Ensure non-slider user writes are serialized and backoff-protected without changing command semantics.
- Ensure background work yields to active/pending user commands and resumes safely afterward.
- Prevent stale device state from overwriting newer local intent while a write is pending.
- Add structured diagnostic logs for local intent, queued/coalesced writes, backoff, outbound request start/end, priority, stale response handling, confirmation, and failures.
- Update or add deterministic tests for the required scenarios.

## Test Plan

- Add focused unit/integration tests using fake timers or deterministic scheduler control.
- Cover rapid Home brightness changes with at least 20 local changes, coalesced writes, final value sent, backoff respected, no visual rollback, and no background interleaving.
- Cover rapid Home color changes with equivalent latest-value behavior.
- Cover stale background refresh while a write is pending.
- Cover background activity yielding to user writes.
- Cover at least one non-slider CTA/toggle user write through the safe path.
- Add a regression mechanism around shared slider/device-write abstractions to reduce future bypass risk.
- Run targeted tests first, then required coverage, lint, build, and Android deploy attempt per repository instructions.

## Log/Evidence Plan

- Capture automated test log records from mock transports/scheduler showing at least 20 local slider changes, fewer outbound writes, final value sent, backoff applied, background yielding, stale response ignored, and no visual rollback.
- If hardware is reachable, record the chosen C64U host and on-device validation result.
- If hardware is not reachable, record the exact blocker and provide a reproducible hardware verification scenario in `WORKLOG.md`.

## Acceptance Criteria

- All user-triggered device operations audited and relevant bypasses fixed.
- Home case light brightness rapid changes are safe and tested.
- Home case light color rapid changes are safe and tested.
- Sliders remain locally responsive and do not snap back to stale values while writes are pending.
- Device Safety settings govern relevant device-bound operations.
- User commands take precedence over background traffic; background resumes safely.
- Deterministic tests and logs prove coalescing, backoff, priority, stale response handling, and outbound call behavior.
- Existing affected tests pass.
- `PLANS.md` and `WORKLOG.md` are current.

## Open Questions or Risks

- Full physical reproduction may require reachable C64U hardware and attached Pixel 4.
- Some transport paths may be native-only and need audited guardrails rather than complete web/unit simulation.
- Existing coverage gate may expose unrelated pre-existing coverage or environment issues.
- Diagnostics/discovery probes still contain explicit bypass flags for recovery semantics. They now yield to user write bursts; stricter no-bypass diagnostics behavior would require follow-up policy work.

## Completed Work Checklist

- [x] Read required orientation docs.
- [x] Classify change.
- [x] Create `PLANS.md`.
- [x] Create `WORKLOG.md`.
- [x] Complete repository-wide device-bound call audit.
- [x] Identify root cause evidence.
- [x] Implement fix.
- [x] Add/update tests.
- [x] Capture log/test evidence.
- [ ] Run required validation.
- [ ] Attempt latest APK deployment to attached Pixel 4 or document blocker.
- [ ] Finalize `PLANS.md` and `WORKLOG.md`.
