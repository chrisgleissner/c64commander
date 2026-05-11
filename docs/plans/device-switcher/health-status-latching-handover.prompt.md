# Device Switcher Health Status Latching Handover Prompt

ROLE

You are an expert Capacitor/React engineer working in the C64 Commander repository. The app controls C64 Ultimate, Ultimate 64, and related networked C64 devices. Treat this as a late production go-live stabilization task: make small, low-risk bug fixes only.

MISSION

Refine device-switcher and top-level health badge status behavior so device health becomes visibly healthy quickly when evidence says it is healthy, while stale or weak negative signals do not immediately make the UI look alarming. This must be a small refinement of the current implementation, not a broad refactor.

CURRENT CONTEXT

The current branch already contains a device-switcher resiliency pass:

- `src/lib/diagnostics/healthCheckEngine.ts` has explicit health-check contexts:
  - `switch-device-dialog`: visible config pulse allowed.
  - `manual-diagnostics`: visible config pulse allowed.
  - `background-maintenance`: read-only.
- `src/hooks/useSavedDeviceHealthChecks.ts` preserves last-known per-device results while a new health check is pending.
- `src/components/UnifiedHealthBadge.tsx` passes switch-dialog context while the Switch Device bottom sheet is open and closes the sheet promptly on row tap.
- `src/hooks/useSavedDeviceSwitching.ts` resets stale interaction state and cancels old C64 query families on saved-device switch.
- `src/lib/c64api.ts` avoids deterministic config item fallback fan-out after `"Device not ready for requests"`.
- `src/lib/diagnostics/healthModel.ts` treats expected abort/cancel/superseded events as cancellation noise.

NEW USER-VISIBLE PROBLEM

The device switcher and the top-level badge are still not harmonized enough:

- The Switch Device bottom sheet can show all connected devices as healthy.
- The top-right badge, visible underneath/behind the bottom sheet, can still show an outdated unhealthy status.
- This is confusing and worrying because the user sees a healthy selected device in the switcher while the global badge still claims unhealthy.

DESIRED BEHAVIOR

1. A device should become visibly healthy quickly when a fresh successful probe proves that it is healthy.
2. The top-level badge should eagerly reflect a newly healthy selected device, including health evidence produced by the switch-device health checks.
3. The switcher rows should also eagerly update to healthy when their own latest cycle proves health.
4. Healthy status should be sticky enough that weak, stale, cancelled, pending, skipped, or generation-mismatched signals do not immediately downgrade it.
5. A device should become degraded or unhealthy only when there is current, device-matched evidence that a meaningful probe failed.
6. Default mental model: assume a known/reachable device remains healthy unless:
   - it has never been reached before, or
   - a current probe for that same device proves it is degraded/unhealthy.
7. Do not hide real failures. Do not delay probes. Do not simply mask unhealthy states. Use better evidence selection and latching.
8. Keep the implementation small and consistent with the existing architecture.

LIKELY FIX DIRECTION

Investigate and minimally refine how the top-level badge chooses health state versus how the switcher rows choose health state.

Likely files:

- `src/components/UnifiedHealthBadge.tsx`
- `src/hooks/useHealthState.ts`
- `src/hooks/useSavedDeviceHealthChecks.ts`
- `src/hooks/useSavedDevices.ts`
- `src/lib/savedDevices/store.ts`
- `src/lib/diagnostics/healthModel.ts`
- `src/lib/diagnostics/healthCheckState.ts`
- `src/lib/diagnostics/diagnosticsTestBridge.ts`

Hypothesis:

- The switcher rows use `useSavedDeviceHealthChecks` per-device snapshots.
- The top-level badge uses `useHealthState`, which likely favors global/current health-check state, connection state, trace events, or stale contributor state.
- A selected saved-device health success from the switcher may not be propagated into the top-level badge's selected-device health view quickly enough.
- A previous unhealthy global state may be retained even after the selected saved-device row has fresh healthy evidence.

Small implementation options to consider:

1. Introduce a tiny selected-device health reconciliation path:
   - When the selected saved device has a fresh `useSavedDeviceHealthChecks` result with `connectivity === "Online"` and `overallHealth === "Healthy"`, allow the top-level badge to display that healthy state immediately.
   - Guard this by selected device id/host so another device's result cannot mark the selected badge healthy.

2. Add a helper that chooses the best current health evidence:
   - Prefer fresh selected-device successful health-check evidence.
   - Preserve last-known healthy state during pending/cancelled/skipped cycles.
   - Use global degraded/unhealthy only when it is current and belongs to the selected device/generation.

3. Store or expose last-known selected-device health in the saved-device summary:
   - `DeviceSwitchSummary.lastHealthState`
   - `lastConnectivityState`
   - `lastProbeSucceededAt`
   - `lastProbeFailedAt`
   Use this only if the existing store already supports it cleanly. Do not create a new large state subsystem.

4. Tighten downgrade criteria:
   - Pending checks should show `Checking` over the previous healthy state, not replace it with unhealthy/offline.
   - Cancelled/superseded checks should not downgrade.
   - Read-only background skipped CONFIG should not downgrade.
   - A single failed non-primary subprobe should not make the top badge alarming if REST/connectivity is healthy and the switcher has just proven the selected device is reachable.

NON-GOALS

- Do not redesign the health model.
- Do not add new polling loops.
- Do not delay or suppress probes.
- Do not treat all failures as success.
- Do not create a new global health store unless a very small addition to an existing store is clearly the smallest safe fix.
- Do not rewrite the Switch Device bottom sheet.
- Do not broaden scope into unrelated diagnostics, Telnet, FTP, config, or screenshot work.

TEST REQUIREMENTS

Add focused regression tests that fail before the fix:

1. Top-level badge adopts selected-device healthy evidence:
   - Seed two saved devices.
   - Open Switch Device.
   - Provide a fresh healthy health-check result for the selected device.
   - Assert the switcher selected row shows healthy.
   - Assert the top-level badge also shows healthy instead of stale unhealthy.

2. Healthy status is sticky during pending/cancelled checks:
   - Start with selected device healthy.
   - Begin a new cycle that is pending or cancelled/superseded.
   - Assert the badge does not downgrade to unhealthy/offline solely from pending/cancelled state.

3. Real current failures still downgrade:
   - Start with selected device healthy.
   - Provide a current selected-device health result with a meaningful REST/connectivity failure.
   - Assert the badge can become degraded/unhealthy/offline as appropriate.

4. Distinct device isolation:
   - A healthy result for non-selected `u64` must not mark selected `c64u` healthy.
   - A failure for old/unselected `c64u` must not poison selected `u64`.

Likely test files:

- `tests/unit/components/UnifiedHealthBadge.test.tsx`
- `tests/unit/hooks/useSavedDeviceHealthChecks.test.tsx`
- `tests/unit/lib/diagnostics/healthModel.test.ts`
- Add a small `useHealthState` regression test if one exists or can be added without heavy setup.

VALIDATION

Classification: `CODE_CHANGE` and likely `UI_CHANGE`.

Run at minimum:

```bash
npx vitest run tests/unit/components/UnifiedHealthBadge.test.tsx tests/unit/hooks/useSavedDeviceHealthChecks.test.tsx tests/unit/lib/diagnostics/healthModel.test.ts
npm run lint
npm run test:coverage
npm run build
```

If visible documented UI changes, refresh only affected screenshots. This task should ideally not require screenshot refresh because the intended visible behavior is status correctness, not layout or copy.

If Android/HIL is available:

1. Deploy the newest APK to Pixel 4.
2. Configure `c64u` and `u64`.
3. Open Switch Device and wait for a poll where selected device row becomes healthy.
4. Confirm the top-level badge visible behind the sheet also becomes healthy promptly.
5. Switch both directions and confirm stale unhealthy does not linger after selected-device health succeeds.
6. Confirm real failures still show degraded/unhealthy when the selected device truly fails.

ACCEPTANCE CRITERIA

- A fresh healthy selected-device health result updates both the switcher row and top-level badge promptly.
- Last-known healthy selected-device state survives pending, skipped, cancelled, and superseded cycles.
- Current selected-device real failures still downgrade health accurately.
- Non-selected or old-generation failures do not poison the selected-device badge.
- The fix is small, local, and covered by focused tests.
- No broad refactor, no polling delay workaround, and no hidden real failures.
