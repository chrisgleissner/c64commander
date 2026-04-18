# Plan

## Classification

- `DOC_PLUS_CODE`
- `UI_CHANGE`

## Objective

Converge the diagnostics and config UI onto deterministic behavior so:

- user intent is the authoritative visible state during interaction
- sliders never jump back to stale device values
- health checks run intentionally and reproducibly
- swipe navigation is disabled by default and safe when enabled
- page scroll is not reset by avoidable remounts

## Research Findings

### 1. UI state ownership model

- `ConfigBrowserPage` owns category expansion and delegates item writes directly through `useC64SetConfig` / `useC64UpdateConfigBatch`.
- `ConfigItemRow` buffers text input locally, but slider/select/checkbox state is still driven by props derived from device-backed query data.
- Home-page config widgets use `useConfigActions`, which keeps an override map plus pending flags in React state.
- `LightingSummaryCard` and `AudioMixer` add their own local draft state on top of shared config state.

### 2. Slider update flow

- Generic config browser slider flow today:
  `drag -> local slider thumb state -> async write -> prop value from query cache`
- Home audio flow today:
  `drag -> local active slider state -> commit -> shared override -> interactive write lane -> query invalidation`
- Lighting flow today:
  `drag -> local draft state -> interactive write lane -> query invalidation`

### 3. Device -> UI update path

- Device-backed config data is fetched with React Query through:
  - `useC64Category`
  - `useC64ConfigItems`
  - `useC64ConfigItem`
- Route visibility resume triggers `runConfigReconciler`, which invalidates and refetches active route queries.
- Many visible config queries use `VISIBLE_C64_QUERY_OPTIONS`, which sets `refetchOnMount: "always"`.
- `useC64Connection` also runs background `c64-info` refresh polling while the screen is active.

### 4. Existing coalescing / merge logic

- There is a partial coalescing system:
  - `useInteractiveConfigWrite` uses `LatestIntentWriteLane`
  - `AudioMixer` uses local active-slider state plus `setConfigOverride`
  - `LightingSummaryCard` uses local draft state
- The generic config browser lacks per-control pending ownership.
- `useConfigActions` currently leaves overrides in memory after success, which creates a hidden-state override risk if the device later diverges.
- No shared timestamp/version-based reconciliation exists for config controls.

### 5. Page lifecycle / remount behavior

- Primary pages are rendered through `SwipeNavigationLayer`.
- Idle inactive slots are rendered as placeholders only.
- Transition keys are currently tied to both panel position and page index, which causes the target page to remount when it moves from transition slot to idle center slot.
- That remount is the most likely root cause of unexpected scroll-to-top / refresh-like behavior at the end of navigation.

### 6. Swipe gesture implementation

- `useSwipeGesture` uses pointer events with:
  - axis lock threshold: `AXIS_LOCK_THRESHOLD_PX`
  - symmetric distance threshold: `resolveSwipeCommitThresholdPx`
  - direction mapping: `dx < 0 -> next`, `dx > 0 -> previous`
- Sliders and swipe-excluded controls are filtered through `data-swipe-exclude`, `role="slider"`, and scrollability checks.
- Gestures are currently always active once the swipe container is mounted.

### 7. Telnet probe lifecycle

- `probeTelnet` uses:
  `createTelnetSession(createTelnetClient(...)) -> connect -> readScreen -> disconnect in finally`
- Current health-check logic accepts only a single `readScreen` result and fails if the first screen is blank or unexpected.

### 8. Background refresh

- Yes, background refresh exists.
- Sources:
  - React Query refetch-on-mount for visible config surfaces
  - route visibility resume reconciliation
  - `c64-info` polling while screen is active
- Current system can reintroduce stale device values while local interaction is still semantically in progress.

## State System Classification

- `TYPE 2: Partial / flawed system`

Reason:

- The app already contains optimistic state, write-lane coalescing, and pending flags in some surfaces.
- Those mechanisms are inconsistent across pages and controls.
- The generic config browser still lets device-backed props retake ownership too early.
- Home-page overrides can outlive the interaction and become hidden state.

## Impact Map

### Code surfaces

- `src/lib/diagnostics/healthCheckEngine.ts`
- `src/components/SwipeNavigationLayer.tsx`
- `src/hooks/useSwipeGesture.ts`
- `src/lib/config/appSettings.ts`
- `src/pages/home/hooks/useConfigActions.ts`
- `src/pages/ConfigBrowserPage.tsx`
- possible small supporting additions for shared authoritative config state

### Test surfaces

- `tests/unit/lib/diagnostics/healthCheckEngine.test.ts`
- `tests/unit/components/SwipeNavigationLayer.test.tsx`
- `tests/unit/hooks/useSwipeGesture.test.ts`
- `tests/unit/lib/config/appSettings.test.ts`
- `tests/unit/pages/home/useConfigActions.test.tsx`
- `tests/unit/pages/ConfigBrowserPage.test.tsx`

### Docs / screenshots

- `PLANS.md`
- `WORKLOG.md`
- No screenshot refresh planned unless a visible documented surface is intentionally changed.
- Current intent is to keep the swipe setting non-UI and avoid screenshot churn.

## Task Breakdown

### A. CONFIG probe LED pulse refinement

- [ ] Increase pulse delta to `16`
- [ ] Use symmetric bounded direction selection
- [ ] Add `CONFIG_PULSE_DELAY_MS = 80`
- [ ] Guarantee revert with `try/finally`
- [ ] Remove passive CONFIG skip logic
- [ ] Preserve readback and post-revert validation

### B. TELNET probe robustness fix

- [ ] Increase TELNET timeout to `3000`
- [ ] Retry screen reads until a valid banner appears
- [ ] Ignore blank initial reads
- [ ] Preserve `connect -> read -> disconnect` lifecycle
- [ ] Add retry/time-to-valid-screen debug logging

### C. Swipe navigation disable + fix

- [ ] Add `enableSwipeNavigation = false` app setting
- [ ] Gate gesture handling at entry
- [ ] Preserve correct `dx > 0 -> previous`, `dx < 0 -> next`
- [ ] Keep thresholds symmetric both directions
- [ ] Preserve slider/scroll exclusion behavior

### D. Scroll/reset investigation and fix

- [ ] Remove avoidable page remount at transition completion
- [ ] Keep active page identity stable through route transitions
- [ ] Ensure scroll only resets on actual navigation change, not on runway bookkeeping

### E. Slider state correctness

- [ ] Implement per-control authoritative state for config writes
- [ ] Track `value`, `pending`, and `lastUserUpdateTimestamp`
- [ ] Block stale device props from overriding pending user intent
- [ ] Clear local authority once device state catches up

### F. Config/device state coalescing

- [ ] Formalize the existing partial override system into deterministic control authority
- [ ] Keep page-entry refresh device-authoritative once no control is pending
- [ ] Prevent background refetch from overriding pending controls
- [ ] Remove hidden long-lived overrides after acknowledgement

## Execution Order

1. Replace tracking files with the current task state.
2. Fix diagnostics determinism first (`A`, `B`).
3. Stabilize navigation/remount behavior (`C`, `D`).
4. Repair config authority and slider ownership (`E`, `F`).
5. Add regression coverage and run required validation.
6. Update this plan and `WORKLOG.md` to final truth only after validation passes.

## Completion Tracking

- [ ] Research recorded in `PLANS.md`
- [ ] Classification recorded as `TYPE 2`
- [ ] Tasks A-F implemented or explicitly concluded
- [ ] Regression tests added/updated for each bug fix
- [ ] `npm run test:coverage` executed and branch coverage >= 91%
- [ ] Relevant targeted tests/builds executed honestly
- [ ] `WORKLOG.md` finalized with files changed, reasoning, and before/after behavior
