# Saved-Device Health Regression Fix Prompt

## Role

You are a senior TypeScript / React / Capacitor engineer working in `/home/chris/dev/c64/c64commander`.

Implement the smallest clean fix for two saved-device health regressions.

Read and follow `README.md`, `.github/copilot-instructions.md`, and `AGENTS.md` first.

Do not redesign diagnostics or saved-device switching from scratch.

## Task Classification

Classify this as `CODE_CHANGE`.

This is a user-visible behavior fix, but do not refresh screenshots unless you change a documented screenshot surface under `docs/img/`.

## Mandatory Read Order

Read only this minimum set before editing:

1. `README.md`
2. `.github/copilot-instructions.md`
3. `AGENTS.md`
4. `docs/research/device-switching-diagnostics/diagnostics-device-switching.md`
5. `src/hooks/useHealthState.ts`
6. `src/lib/diagnostics/healthCheckState.ts`
7. `src/lib/diagnostics/healthCheckEngine.ts`
8. `src/hooks/useSavedDeviceHealthChecks.ts`
9. `src/components/UnifiedHealthBadge.tsx`
10. `src/hooks/useSavedDeviceSwitching.ts`
11. `src/lib/savedDevices/store.ts`
12. `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
13. `tests/unit/hooks/useHealthState.test.tsx`
14. `tests/unit/hooks/useSavedDeviceHealthChecks.test.tsx`
15. `tests/unit/lib/diagnostics/healthCheckEngine.test.ts`
16. `tests/unit/components/UnifiedHealthBadge.test.tsx`
17. `tests/unit/hooks/useSavedDeviceSwitching.test.tsx`

Update `PLANS.md` at the repo root as you work. Keep it short and factual.

## Repo Reality You Must Account For

Do not start from the generic brief. Start from the current code:

- `src/hooks/useSavedDeviceHealthChecks.ts` already maintains a per-device cache keyed by `device.id`.
- That hook already preserves `latestResult` while a new run is in progress by updating `running`, `liveProbes`, and `probeStates` without clearing the prior result.
- `src/lib/diagnostics/healthCheckEngine.ts` already has an explicit `mode: "full" | "passive"` split.
- In passive mode the CONFIG pulse is already skipped and `setConfigValue` is not called.
- There are currently only two real health-check call sites in app code:
  - `useSavedDeviceHealthChecks.ts` via `runHealthCheckForTarget(...)`
  - `GlobalDiagnosticsOverlay.tsx` via `runHealthCheck()`
- `UnifiedHealthBadge.tsx` currently enables `useSavedDeviceHealthChecks(...)` whenever multiple saved devices exist, and the existing unit tests already encode that this polling starts on cold boot even when the switcher sheet is closed.
- `src/hooks/useSavedDeviceHealthChecks.ts` currently calls `runHealthCheckForTarget(..., { mode: "full" })`. That is the likely cause of the visible pulse during switcher/background polling.
- `src/hooks/useHealthState.ts` currently derives the device label from `useSavedDevices()` but reads the health result from the single global `healthCheckState.latestResult` with no saved-device identity attached.
- `docs/research/device-switching-diagnostics/diagnostics-device-switching.md` already identifies the unkeyed global `latestResult` as the main selected-device correctness risk after a switch.

## Objective

Fix these two regressions with the least invasive change that matches the current architecture:

1. While the device switcher sheet is still open, selecting a different device must not cause the switcher to instantly show `Offline` for both devices before the sheet closes and the newly selected device becomes active.
2. The incessant visible heartbeat or blinking device light must stop for all health checks that occur while the device switcher is not open. A visible heartbeat is only allowed for health checks performed while the device switcher sheet is open. All closed-switcher and automatic checks must be read-only and must not trigger the CONFIG pulse / visible light write.

## Problem 1: Switcher Shows `Offline` For Both Devices Immediately After Selection

Clarify the actual user-facing failure before changing code:

- the bug happens inside the open switcher sheet
- the bug happens immediately when the user taps a different device row
- the switcher can briefly show `Offline` for both the previously selected device and the newly selected device
- this bad intermediate state appears before the sheet closes and before the newly selected device becomes the active connected device

The current codebase does **not** need a brand new per-device health subsystem.

The likely bug is narrower:

- the switcher's row status and health summary can temporarily collapse pending or stale data into `Offline` during the selection handoff
- if the selected-device badge is also affected, treat that as secondary fallout, not as permission to ignore the open-switcher regression

Fix this with the smallest correct approach.

### Preferred fix direction

Start with the open-switcher path that actually renders the failing state:

- `src/components/UnifiedHealthBadge.tsx`
- `src/hooks/useSavedDeviceHealthChecks.ts`
- `src/lib/savedDevices/store.ts`
- `src/hooks/useSavedDeviceSwitching.ts`

Prefer the smallest fix that preserves last-known row state during selection handoff and prevents pending or switching state from being rendered as `Offline`.

If you find that stale selected-device badge state is also contributing, attach stable target identity to the global health-check snapshot or result and teach `useHealthState()` to ignore a `latestResult` that does not belong to the currently selected device / configured host.

Examples of acceptable identity:

- selected saved-device id, if available at the health-check boundary
- configured `deviceHost`, if that is the narrowest stable identity already available

### Acceptable fallback only if clearly smaller

If identity threading would be materially wider than needed, a smaller fix may reset or invalidate the stale global health snapshot during saved-device switching so `useHealthState()` falls back to the existing trace / idle logic instead of showing a mismatched offline result.

That fallback is only acceptable if the primary open-switcher regression is still fixed.

If you choose this fallback:

- explain in `PLANS.md` why it is smaller than attaching identity
- do not regress the manual Diagnostics health check flow
- do not add a parallel per-device global cache

### Constraints for Problem 1

- Do not redesign the switcher into a new global store.
- Do not replace the switcher cache with a reducer or context unless a test proves that is required.
- Do not map missing data to offline.
- Do not add arbitrary delays to hide the bug.
- Do not change switcher-close timing just to hide the bad intermediate render.
- Do not touch `src/lib/savedDevices/store.ts` unless you can prove `runtimeStatuses` or `getSavedDeviceSwitchStatus()` are part of this regression.

## Problem 2: Visible CONFIG Pulse During Automatic Checks

The current repo already has the passive/full split.

Do not invent a new health-check mode.

Clarify the actual user-facing failure before changing code:

- the device can blink incessantly even when the switcher is not open
- that means a write-based health check is escaping into cold-boot, background, or otherwise closed-switcher execution
- this is the bug to eliminate

Product rule:

- visible heartbeat behavior is allowed only while the switcher sheet is open
- if the switcher is closed, every health check path must be passive and read-only
- missing, background, startup, or periodic checks must never make the device visibly blink

The minimal fix is expected to be:

- keep `runHealthCheck()` unchanged unless evidence proves it can run while the switcher is closed and is part of the blinking path
- stop any closed-switcher path from using `mode: "full"`
- at minimum, switch `useSavedDeviceHealthChecks.ts` to `mode: "passive"` for the current always-on multi-device polling path
- preserve the existing passive-mode behavior in `healthCheckEngine.ts` where CONFIG is skipped and no write occurs
- if any `full` / write-based health check remains after the fix, it must be explicitly gated to the switcher-open state

### Important scope rule

This repo does **not** currently expose a clearly separated switcher-open-only heartbeat action.

Do not add a new switcher heartbeat UX just to satisfy the old generic brief.
Do not broaden the task into redesigning Diagnostics manual health checks unless you find an actual failing path in the current code.
Do not leave any path where the switcher is closed but a write-based probe can still blink the device.

## Required Changes

### 1. Fix the automatic switcher polling path

- Update `src/hooks/useSavedDeviceHealthChecks.ts` to use the existing passive mode.
- Ensure automatic multi-device polling remains concurrent and keyed per device.
- Preserve the current behavior that in-flight refreshes keep the device's previous `latestResult` visible.
- Make the prompt's intended invariant explicit in code: if the switcher is closed, this path must not emit a visible heartbeat.

### 2. Fix the selected-device status derivation

- Update the smallest owning layer so the open switcher sheet does not render `Offline` for both devices immediately after selection.
- If the root cause extends into selected-device badge derivation, fix that too in the smallest supporting layer.
- Prefer fixing the switcher row path first, then `src/hooks/useHealthState.ts` only if needed.
- Keep the badge semantics current-device-only and the switcher semantics row-specific.

### 3. Keep existing good behavior intact

- `UnifiedHealthBadge` long press still opens the switch sheet.
- The switch sheet still shows per-device health rows.
- Switcher rows keep their previous known result while a new run is pending.
- Manual Diagnostics `Run health check` still works.
- Passive checks remain read-only.

## Tests You Must Add Or Update

Add the smallest set of focused regression tests that prove the real root cause in this repo.

### Mandatory

1. `tests/unit/hooks/useSavedDeviceHealthChecks.test.tsx`

- Update the existing expectation so switcher polling uses `mode: "passive"`, not `"full"`.
- Add or update a regression asserting a rerun keeps the device's previous `latestResult` visible while `running` is true.
- Add or update a regression asserting an aborted / superseded cycle does not replace an existing result with an offline state.
- Add or update a regression proving the closed-switcher / cold-boot polling path does not use a write-based mode.

2. `tests/unit/lib/diagnostics/healthCheckEngine.test.ts`

- Keep or strengthen the existing passive-mode assertion that CONFIG is skipped and `setConfigValue` is never called.
- Make the passive test explicitly serve as the regression proof for switcher-closed, startup, and background checks being read-only.

3. `tests/unit/hooks/useHealthState.test.tsx`

- Add a focused regression only if your final fix touches `useHealthState()`.
- If used, reproduce a switch where the selected device changes but `healthCheckState.latestResult` still belongs to the previous target.
- If used, assert `useHealthState()` does not present that stale result as the new selected device's current health.

4. `tests/unit/components/UnifiedHealthBadge.test.tsx`

- Add or update one mandatory UI-facing regression that proves the bug as reported:
  - the switcher is open
  - device A is currently selected
  - the user taps device B
  - before the sheet closes, the switcher must not show `Offline` for both devices
  - device A must retain its previous known state or neutral non-offline status
  - device B must retain its previous known state or show a neutral checking / verifying state, but not `Offline` merely because activation is in progress
- Use the existing stable test ids already present in the component. Do not add new ids unless you prove a selector gap.

### Optional only if your chosen fix needs them

- `tests/unit/hooks/useSavedDeviceSwitching.test.tsx` if you clear or invalidate global health state during a switch

## Validation

Run the smallest honest code-change validation set required by the repo:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

If any command fails for an unrelated existing reason, document the command, the failure, and why it is unrelated in `PLANS.md`.

## Out Of Scope

Do not widen into any of the following unless the focused fix forces it:

- a new per-device global health cache for the main badge
- a new diagnostics architecture
- route invalidation changes
- saved-device verification flow redesign
- a new switcher UI action for visible heartbeat
- screenshot refreshes unrelated to an actual docs image change
- commits or branch management unless the human explicitly asks for them

## Acceptance Criteria

The task is complete only when all of the following are true:

- automatic saved-device polling uses passive mode
- passive saved-device polling does not call `setConfigValue`
- the device no longer blinks incessantly while the switcher is closed
- visible heartbeat behavior, if it still exists anywhere after the fix, is reachable only while the switcher sheet is open
- while the switcher sheet is open, tapping a different device does not briefly show `Offline` for both devices before the sheet closes
- switcher rows preserve their previous known result while a refresh is in progress
- switcher selection handoff never maps pending, stale, or not-yet-activated state to `Offline`
- aborted or superseded automatic checks do not convert prior known state into offline
- if `useHealthState()` is touched, the selected-device health derivation no longer trusts an unkeyed stale result after a switch
- the focused regressions in `useSavedDeviceHealthChecks`, `healthCheckEngine`, `useHealthState`, and `UnifiedHealthBadge` all pass
- `PLANS.md` records the root cause, chosen fix, changed files, validation commands, and residual risk
