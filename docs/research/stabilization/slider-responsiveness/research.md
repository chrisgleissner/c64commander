# Slider Responsiveness Research

## Summary

The Home page **CPU Speed** slider is laggy and occasionally non-responsive because of three compounding effects:

1. **The slider disables itself while a write is pending.** [src/pages/HomePage.tsx:1061](../../../../src/pages/HomePage.tsx#L1061) sets `disabled={... || cpuSpeedPending || ...}`, where `cpuSpeedPending` is derived from the optimistic-override store ([src/hooks/useAuthoritativeConfigValueState.ts](../../../../src/hooks/useAuthoritativeConfigValueState.ts)). The store only clears the override entry when the next refetch returns a value that satisfies `Object.is(entry.value, deviceValue)`. CPU Speed values are stored with leading whitespace (`" 1"`, `" 2"`, …, but `"10"`, `"20"`) — any firmware-side normalisation, latency, or queue back-pressure leaves the entry permanently set, so the slider stays disabled "forever".
2. **Optimistic state lives on `HomePage`, a 1730-line component with ~19 hooks and dozens of derived `resolveConfigValue` calls.** Every pointer move during drag fires `setCpuSpeedOptimisticValue`, re-rendering the entire HomePage tree. The thumb appears to drag through molasses.
3. **Every commit chains a second config write** through the throttled `scheduleConfigWrite` queue (`handleTurboControlAutoAdjust` → `updateConfigValue` → `api.setConfigValue`, [src/pages/HomePage.tsx:731-755](../../../../src/pages/HomePage.tsx#L731)), so the reconciliation refetch is delayed and the disabled window widens.

By contrast, the Home page **SID Volume / Pan** sliders are fast because:

- Their pending flag is **hardcoded to `false`** ([src/pages/home/components/AudioMixer.tsx:194-195](../../../../src/pages/home/components/AudioMixer.tsx#L194)), so they never disable.
- Drag-time draft state lives in `AudioMixer`'s local `activeSliders` record, not in HomePage, so re-renders are scoped.
- The committed value is also written via `setConfigOverride`, but the slider does not gate on it.

The Config page **CPU Speed** slider is fast because [src/components/ConfigItemRow.tsx:413-491](../../../../src/components/ConfigItemRow.tsx#L413) keeps its draft in a local `inputValue` state and gates on `setConfig.isPending` (a TanStack Query mutation flag that always self-resolves), not on the optimistic-override store.

The recommended fix is a small, targeted change: move the slider draft into a self-contained Home subcomponent, drop the `cpuSpeedPending`-based disable gate, and write through the existing `interactiveWriteU64` lane plus a guaranteed final commit — mirroring the SID slider semantics. The existing `createSliderDeviceAdapter` helper at [src/lib/ui/sliderDeviceAdapter.ts](../../../../src/lib/ui/sliderDeviceAdapter.ts) is unused but already encodes the right primitive; the follow-up should adopt it rather than reinvent it.

> **Revised recommendation after empirical device testing.** Live REST experimentation against `u64` (fw 3.14e) and `c64u` (fw 1.1.0) — recorded in `WORKLOG.md` and summarised in "Empirical Device Findings" below — surfaced four findings that promote the recommended approach from a small targeted fix to a single, narrowly-scoped consolidation:
>
> 1. **Firmware-crash hazard.** Sending an invalid value inside a batch `POST /v1/configs` took `u64` offline for the rest of the session. (See the "CPU Speed invalid in BATCH POST" probe.) Client-side validation against the live option list is now a release blocker.
> 2. **Silent error discard.** [src/lib/c64api.ts:1148-1190](../../../../src/lib/c64api.ts#L1148) does not inspect the response's `errors` array. Firmware refusals (`errors: ["Value '4' is not a valid choice for item CPU Speed"]`) are silently treated as success — and that is the actual mechanism by which a stuck override entry can develop in production. The `c64api` write helpers must throw on `errors.length > 0`.
> 3. **Type-drift hazard.** Numeric items like `Strip Intensity` are returned as JSON numbers (`current: 6`) while string items return strings; the override store's `Object.is` clear ([src/hooks/useAuthoritativeConfigValueState.ts:73](../../../../src/hooks/useAuthoritativeConfigValueState.ts#L73)) cannot recover from this drift.
> 4. **Three parallel draft/write mechanisms** already exist in the codebase (the `Slider` primitive's internal `dragValue` + `createSliderAsyncQueue`, the unused `createSliderDeviceAdapter`, and five bespoke per-call-site draft states). They contradict each other; consolidating onto a single `useDeviceBoundSlider` hook is now the smallest change that satisfies the user's non-negotiable UX requirements ("immediate feedback", "never frozen", "never out of sync with the device").
>
> The eight slider invariants formalising those requirements are listed in "UX-First Slider Behaviour Model"; the five-step consolidation is in "Consolidated Implementation Plan"; revised acceptance criteria (11–16) extend the originals.

## Observed Problem

- Reported: dragging the **Home page CPU Speed slider** is significantly laggier than the **Config page CPU Speed slider**, and intermittently the Home page slider becomes effectively non-responsive indefinitely.
- Reported: **SID sliders** on the Home page (e.g. SID pan) feel consistently fast.
- Reported impact: a slow or non-responsive slider makes the whole app feel laggy even when the device eventually accepts the value.

## Methodology

1. Mapped the slider primitive — there is exactly one (`Slider` at [src/components/ui/slider.tsx](../../../../src/components/ui/slider.tsx)). No Ionic and no native `<input type="range">` is used (`grep -rn "IonRange\|@ionic/react\|type=\"range\"" src` returns 0 matches).
2. Enumerated every call site of `<Slider`, classified by host page / context, state ownership, write pathway, and disable predicate. (See "Exhaustive Slider Inventory" below.)
3. Traced the full path of three representative slider interactions — Home CPU Speed, Config CPU Speed, Home SID Volume — through component, hook, mutation, REST API, query invalidation, and authoritative-override store.
4. Read the supporting infrastructure: the slider primitive (`createSliderAsyncQueue`, popup state machine, midpoint snap), the interactive-write hook (`useInteractiveConfigWrite` + `LatestIntentWriteLane` + `deviceActivityGate`), the optimistic-override store (`useAuthoritativeConfigValueState`), and the global throttled write queue (`scheduleConfigWrite`).
5. Cross-referenced the firmware option strings ([docs/c64/c64u-config.yaml](../../../../docs/c64/c64u-config.yaml)) for CPU Speed to evaluate format-equality risk.
6. Built a differential analysis comparing fast vs. slow slider paths.

## Exhaustive Slider Inventory

All sliders use the custom `Slider` from [src/components/ui/slider.tsx](../../../../src/components/ui/slider.tsx) (Radix-based; supports `onValueChange`, `onValueCommit`, `onValueChangeAsync`, `onValueCommitAsync`, midpoint snap, value popup, haptics).

| Area | File | Component | Slider Purpose | Control Type | Event Path | Local State Behaviour | Write Behaviour | Notes |
| ---- | ---- | --------- | -------------- | ------------ | ---------- | --------------------- | --------------- | ----- |
| Home / CPU | [src/pages/HomePage.tsx:1056-1080](../../../../src/pages/HomePage.tsx#L1056) | `HomePage` | CPU Speed | Discrete index over `cpuSpeedSliderOptions` | sync `onValueChange` updates `cpuSpeedOptimisticValue` (HomePage state); async preview `onValueChangeAsync` re-affirms it; `onValueCommitAsync` calls `handleCpuSpeedCommitChange` | Optimistic value is on **HomePage** (large tree); `cpuSpeedDraggingRef` guards the resync `useEffect` ([HomePage.tsx:894-897](../../../../src/pages/HomePage.tsx#L894)) | Commit: `setConfigOverride` ⇒ `replaceEntry` ⇒ `pending=true`; `interactiveWriteU64({"CPU Speed": …})` (immediate batch); then chained `handleTurboControlAutoAdjust` via the **throttled** `setConfigValue` path | **Disabled when pending.** Disabled while `cpuSpeedPending` is true ([HomePage.tsx:1061](../../../../src/pages/HomePage.tsx#L1061)). Entry only clears via `Object.is` equality with refetched device value. CPU Speed options carry leading whitespace (`" 1"` vs `"10"`). |
| Home / SID | [src/pages/home/SidCard.tsx:233-251](../../../../src/pages/home/SidCard.tsx#L233) | `SidCard` (used by `AudioMixer`) | SID Volume | Discrete index over volume option list | sync `onValueChange` ⇒ `handleVolumeLocalChange` ⇒ `setActiveSliders[volumeSliderId] = snapped`; async `onValueChangeAsync` ⇒ `handleVolumeAsyncChange` ⇒ `interactiveWrite({[item]: option})`; commit clears local draft + pre-emptively `setConfigOverride` | Draft lives in `AudioMixer.activeSliders` (subtree only) | `interactiveWrite` (immediate batch via `useInteractiveConfigWrite({category:"Audio Mixer"})`); commit fires a final write | **Never disabled by pending.** `volumePending = false` is hardcoded ([AudioMixer.tsx:194](../../../../src/pages/home/components/AudioMixer.tsx#L194)). |
| Home / SID | [src/pages/home/SidCard.tsx:262-281](../../../../src/pages/home/SidCard.tsx#L262) | `SidCard` | SID Pan | Same as SID Volume | Same as SID Volume | Draft in `AudioMixer.activeSliders` | Same as SID Volume | `panPending = false` hardcoded ([AudioMixer.tsx:195](../../../../src/pages/home/components/AudioMixer.tsx#L195)). |
| Home / Lighting | [src/pages/home/components/LightingSummaryCard.tsx:342-358](../../../../src/pages/home/components/LightingSummaryCard.tsx#L342) | `LightingSummaryCard` | Fixed Color | Discrete index over color names | sync `onValueChange` ⇒ `setFixedColorDraftIndex`; async `onValueChangeAsync` ⇒ `handleFixedColorPreview` ⇒ `interactiveWrite({"Fixed Color": …})` | Draft in `LightingSummaryCard` local state | `interactiveWrite` immediate path; useEffect resets draft when refetched value changes | **Disabled when pending.** Same `disabled={isPending("Fixed Color")}` pattern as CPU Speed. Same theoretical disable-stall risk if the device echo never matches. |
| Home / Lighting | [src/pages/home/components/LightingSummaryCard.tsx:367-379](../../../../src/pages/home/components/LightingSummaryCard.tsx#L367) | `LightingSummaryCard` | Strip Intensity | Numeric in [min,max] | Same shape as Fixed Color | Draft in local state | `interactiveWrite` immediate; commit fires final write | Same disable-on-pending pattern. |
| Lighting Studio | [src/components/lighting/LightingStudioDialog.tsx:370-377](../../../../src/components/lighting/LightingStudioDialog.tsx#L370) | `LightingStudioDialog` | Brightness | Numeric | sync `onValueChange` only; no async | Modal-local; immediately updates studio model | No REST during drag — studio "apply" pushes the result | Drag inside dialog is purely local; behaviour decoupled from main page. |
| Config | [src/components/ConfigItemRow.tsx:451-485](../../../../src/components/ConfigItemRow.tsx#L451) | `ConfigItemRow` (used everywhere on Config page) | Generic numeric / enum config | Discrete index over derived `sliderOptions` | sync `onValueChange` / `onValueCommit` ⇒ local `setInputValue` only; `onValueChangeAsync` ⇒ parent `onValueChange(nextValue)` if differs from `lastCommittedRef`; `onValueCommitAsync` ⇒ updates `lastCommittedRef` and calls parent | Draft is **local** to `ConfigItemRow` (`inputValue` + `lastCommittedRef`) | Parent (`ConfigBrowserPage.handleValueChange`) goes through **throttled** `useC64SetConfig` ⇒ `api.setConfigValue` ⇒ `scheduleConfigWrite` queue ⇒ TanStack Query auto-invalidates category | **Disabled while `setConfig.isPending`** — but that's a TanStack mutation flag that always self-clears. Optimistic override is set by `replaceEntry`/`restoreEntry` but `isLoading` is bound to `setConfig.isPending`, not the override store. |
| Play page | [src/pages/playFiles/components/VolumeControls.tsx:70-82](../../../../src/pages/playFiles/components/VolumeControls.tsx#L70) | `VolumeControls` (used by `PlayFilesPage`) | Playback volume | Discrete index over volume steps | sync `onValueChange` ⇒ `handleVolumeLocalChange` (parent local); `onValueChangeAsync` ⇒ throttled preview write at `previewIntervalMs`; `onValueCommitAsync` ⇒ final commit | Draft in PlayFilesPage; throttle interval is the user-tunable `volumeSliderPreviewIntervalMs` | Same `useInteractiveConfigWrite` immediate path | `disabled={!canControlVolume}` only — does **not** read the optimistic-override store. The model the SID/CPU Speed sliders should converge to. |
| Play page | [src/pages/playFiles/components/PlaybackSettingsPanel.tsx:74-83](../../../../src/pages/playFiles/components/PlaybackSettingsPanel.tsx#L74) | `PlaybackSettingsPanel` | Default song duration | Numeric | sync `onValueChange` only | Pure local state — no device write | n/a | Pure UI slider; not a stabilization concern. |
| Settings | [src/pages/SettingsPage.tsx:2065-2074](../../../../src/pages/SettingsPage.tsx#L2065) | `SettingsPage` | Notification duration | Numeric | sync `onValueChange` ⇒ persists to local app settings | App-settings local | n/a | App-only; not a device interaction. |

## Home Page CPU Speed Slider

Files: [src/pages/HomePage.tsx](../../../../src/pages/HomePage.tsx), [src/hooks/useInteractiveConfigWrite.ts](../../../../src/hooks/useInteractiveConfigWrite.ts), [src/hooks/useAuthoritativeConfigValueState.ts](../../../../src/hooks/useAuthoritativeConfigValueState.ts), [src/lib/c64api.ts](../../../../src/lib/c64api.ts), [src/lib/config/configWriteThrottle.ts](../../../../src/lib/config/configWriteThrottle.ts), [src/pages/home/hooks/useConfigActions.ts](../../../../src/pages/home/hooks/useConfigActions.ts).

End-to-end path of a single drag-then-release:

1. **Pointer move (on each Radix step).** Radix `onValueChange` fires synchronously inside `Slider`. The primitive ([src/components/ui/slider.tsx:263-289](../../../../src/components/ui/slider.tsx#L263)) updates its internal `dragValue`, calls the parent `onValueChange`, and schedules an async value via `asyncQueueRef.current.schedule(value)` (default throttle = `SLIDER_MID_DRAG_THROTTLE_MS = 200ms`).
2. **HomePage's sync `onValueChange`** ([HomePage.tsx:1062-1066](../../../../src/pages/HomePage.tsx#L1062)) sets `cpuSpeedDraggingRef.current = true` and calls `setCpuSpeedOptimisticValue(resolveCpuSpeedOption(values[0] ?? 0))`. **The state lives on HomePage**. Every drag step re-renders the entire HomePage tree (~1730 lines, dozens of `resolveConfigValue` derivations, multiple summary cards).
3. **HomePage's async `onValueChangeAsync`** ([HomePage.tsx:1070-1072](../../../../src/pages/HomePage.tsx#L1070)) ⇒ `handleCpuSpeedPreviewChange` ⇒ `setCpuSpeedOptimisticValue(nextValue)`. **No device write fires during drag** for CPU Speed (preview is a no-op apart from re-affirming the optimistic value).
4. **Pointer release.** Radix fires `onValueCommit` (sync) — HomePage clears `cpuSpeedDraggingRef` ([HomePage.tsx:1067-1069](../../../../src/pages/HomePage.tsx#L1067)). Radix also fires the queue's commit, which calls `onValueCommitAsync` ([HomePage.tsx:1073-1077](../../../../src/pages/HomePage.tsx#L1073)) ⇒ `handleCpuSpeedCommitChange(nextValue)`.
5. **`handleCpuSpeedCommitChange`** ([HomePage.tsx:762-778](../../../../src/pages/HomePage.tsx#L762)):
   - `setConfigOverride("U64 Specific Settings", "CPU Speed", nextValue)` — calls `replaceEntry(key, value)` in [useAuthoritativeConfigValueState.ts:26-33](../../../../src/hooks/useAuthoritativeConfigValueState.ts#L26). **Side effect: `pending[key]` becomes `true` because the `pending` memo is `Object.fromEntries(Object.keys(entries).map((k) => [k, true]))` ([useAuthoritativeConfigValueState.ts:91-94](../../../../src/hooks/useAuthoritativeConfigValueState.ts#L91)).**
   - `setCpuSpeedOptimisticValue(nextValue)`.
   - `Promise.resolve(interactiveWriteU64({ "CPU Speed": nextValue })).then(...)`.
6. **`interactiveWriteU64`** ([useInteractiveConfigWrite.ts:124-147](../../../../src/hooks/useInteractiveConfigWrite.ts#L124)) routes through a `LatestIntentWriteLane`. The lane awaits `waitForMachineTransitionsToSettle()` (which blocks if a machine reset/reboot is in flight; otherwise resolves immediately) and then `mutateAsync({ category, updates, immediate: true, skipInvalidation: true })`, i.e. `api.updateConfigBatch(..., { immediate: true })` which **bypasses** the `scheduleConfigWrite` throttle ([c64api.ts:1186-1189](../../../../src/lib/c64api.ts#L1186)).
7. **On settle**, `scheduleReconciliation()` fires after a 250 ms debounce ([useInteractiveConfigWrite.ts:103-113](../../../../src/hooks/useInteractiveConfigWrite.ts#L103)) and calls `queryClient.invalidateQueries({ queryKey: ["c64-config-items", "U64 Specific Settings"] })`. This triggers a refetch of the home page's CPU Speed view.
8. **Chained Turbo Control auto-adjust.** After the immediate batch, the `.then(() => handleTurboControlAutoAdjust(nextValue))` chain fires `updateConfigValue("U64 Specific Settings", "Turbo Control", desiredTurbo, …, { suppressToast: true })` ([HomePage.tsx:731-746](../../../../src/pages/HomePage.tsx#L731)). That goes through the regular **non-immediate** `setConfigValue` ⇒ `scheduleConfigWrite` queue ([useConfigActions.ts:29-41](../../../../src/pages/home/hooks/useConfigActions.ts#L41)). Two consequences: (a) it adds round-trip latency before the next reconciliation refetch and (b) it can serialize behind any prior queued write.
9. **Refetch returns the updated category.** `cpuSpeedValue = String(resolveConfigValue(u64Category, "U64 Specific Settings", "CPU Speed", "1"))` ([HomePage.tsx:697](../../../../src/pages/HomePage.tsx#L697)). `resolveConfigValue` calls `authoritativeValues.resolveValue` ([useAuthoritativeConfigValueState.ts:68-80](../../../../src/hooks/useAuthoritativeConfigValueState.ts#L68)), which compares the entry value with the device value via `Object.is`:
   - If they match: `scheduleClearEntry(key)` runs in a microtask, `entries[key]` is removed, `pending[key]` becomes `undefined`, the resync `useEffect` ([HomePage.tsx:894-897](../../../../src/pages/HomePage.tsx#L894)) fires `setCpuSpeedOptimisticValue(cpuSpeedValue)`, and the `disabled` predicate flips off. Slider re-enables. **Happy path.**
   - If they do not match: the entry is **never cleared**, `cpuSpeedPending` stays `true`, the slider stays `disabled` until the user navigates away from the page (which discards the hook state).

Failure modes that block step 9:

- **Whitespace/format drift.** CPU Speed options are stored with leading whitespace for single-digit values (`" 1"`, `" 2"`, `" 4"`, `" 6"`, `" 8"`, then `"10"`, `"12"`, `"20"`, etc.) — see [docs/c64/c64u-config.yaml:1334-1352](../../../../docs/c64/c64u-config.yaml#L1334). The slider sends bytes from the same option list, but if any layer (firmware echo, JSON renderer, network proxy) trims, `Object.is(" 4", "4")` is `false` and the entry never clears.
- **Type drift.** Some firmware payload nodes return numbers; others strings. If `selected` comes back as `4` (number) while the entry is `" 4"` (string), `Object.is` is `false`.
- **Reconciliation never lands.** If the lane rejects (no waiter completes the `finally`), `scheduleReconciliation` is not called and the invalidation never fires. Possible causes: `waitForMachineTransitionsToSettle` blocks indefinitely if `machineTransitionCount` never decrements (e.g. a buggy `endTransition`).
- **Refetch is gated off-screen.** `useC64ConfigItems` checks `useScreenActivity()` ([useC64Connection.ts:286](../../../../src/hooks/useC64Connection.ts#L286)). If the page is in the background when the reconciliation invalidation fires, the refetch is deferred until screen activity resumes.

## Config Page CPU Speed Slider

Files: [src/pages/ConfigBrowserPage.tsx](../../../../src/pages/ConfigBrowserPage.tsx), [src/components/ConfigItemRow.tsx](../../../../src/components/ConfigItemRow.tsx), [src/hooks/useC64Connection.ts](../../../../src/hooks/useC64Connection.ts), [src/lib/c64api.ts](../../../../src/lib/c64api.ts).

End-to-end path:

1. **Render.** [ConfigBrowserPage.tsx:587-604](../../../../src/pages/ConfigBrowserPage.tsx#L587) renders `<ConfigItemRow … value={item.value} options={item.options} onValueChange={(v) => handleValueChange(item.name, v)} isLoading={setConfig.isPending || Boolean(authoritativeValues.pending[item.name])} … />`. **Important:** the `isLoading` here is true when *any* `setConfig` mutation is in flight or when an authoritative override sits on the same key, but the slider's `disabled` ([ConfigItemRow.tsx:456](../../../../src/components/ConfigItemRow.tsx#L456)) maps to `isLoading || isItemLoading || isReadOnly`. `setConfig.isPending` is a TanStack Query mutation flag; it is set when the mutation starts and cleared on success **and** on failure. It is self-resolving regardless of value-equality.
2. **Drag.** `Slider`'s sync `onValueChange` ([ConfigItemRow.tsx:457-462](../../../../src/components/ConfigItemRow.tsx#L457)) only updates the *local* `inputValue` state and writes the resolved option string. **No parent state and no device write fires during drag.** `onValueChangeAsync` (throttled 200ms by default) calls the parent `onValueChange` with the resolved option string only if it differs from `lastCommittedRef.current`. `onValueCommitAsync` writes `lastCommittedRef.current` and calls the parent.
3. **Commit.** Parent `handleValueChange` ([ConfigBrowserPage.tsx:268-293](../../../../src/pages/ConfigBrowserPage.tsx#L268)) optimistically `replaceEntry(itemName, value)` and `await setConfig.mutateAsync(...)`. On error it `restoreEntry`s and re-shows the previous value.
4. **`useC64SetConfig`** ([useC64Connection.ts:359-374](../../../../src/hooks/useC64Connection.ts#L359)) calls `api.setConfigValue` (which goes through the **throttled** `scheduleConfigWrite` queue). On success it invalidates `["c64-category", category]` and `["c64-all-config"]`.
5. **Re-render.** When the mutation resolves, `setConfig.isPending` flips to `false`. The slider re-enables immediately whether the device echoes back exactly the same string or not. If the optimistic override entry is still set, `inferControlKind` and `mergedValue` favour the freshly-arriving payload value.
6. **Why this is fast.** Drag-time state lives inside `ConfigItemRow` (small subtree). The pending gate is bound to a self-resolving mutation, not the optimistic-override store. The slider is also fundamentally re-enableable: even if the device echoes a different value, `ConfigItemRow`'s effect resyncs `inputValue` from `mergedValue` ([ConfigItemRow.tsx:184-188](../../../../src/components/ConfigItemRow.tsx#L184)).

## Home Page SID Sliders

Files: [src/pages/home/components/AudioMixer.tsx](../../../../src/pages/home/components/AudioMixer.tsx), [src/pages/home/SidCard.tsx](../../../../src/pages/home/SidCard.tsx).

End-to-end path of a SID Volume drag-then-release (Pan is structurally identical):

1. **Render.** `AudioMixer` reads SID entries from `useSidData`. For each entry it computes `volumeSliderId`, `volumeMax`, `volumeCenterIndex`, and **`volumePending = false`** (hardcoded, [AudioMixer.tsx:194](../../../../src/pages/home/components/AudioMixer.tsx#L194)).
2. **Pointer move.** `Slider`'s sync `onValueChange` ⇒ `handleVolumeLocalChange(val)` ⇒ `setActiveSliders((prev) => ({ ...prev, [volumeSliderId]: snapped }))` ([AudioMixer.tsx:217-223](../../../../src/pages/home/components/AudioMixer.tsx#L217)). State lives in `AudioMixer.activeSliders` — only AudioMixer's subtree re-renders. The slider value reads `clampSliderValue(activeVolumeValue ?? volumeIndex, volumeMax)` ([AudioMixer.tsx:200](../../../../src/pages/home/components/AudioMixer.tsx#L200)).
3. **Throttled async preview.** `onValueChangeAsync` ⇒ `handleVolumeAsyncChange(val)` ⇒ `interactiveWrite({ [entry.volumeItem]: resolveVolumeOption(val) })` ([AudioMixer.tsx:234-236](../../../../src/pages/home/components/AudioMixer.tsx#L234)). Same `useInteractiveConfigWrite` lane (immediate batch, queue-bypassing) as CPU Speed, but with `category: "Audio Mixer"`.
4. **Pointer release.** Sync `onValueCommit` ⇒ `handleVolumeLocalCommit(val)` pre-emptively `setConfigOverride("Audio Mixer", entry.volumeItem, resolveVolumeOption(val))` and **deletes** the local draft. Async `onValueCommitAsync` ⇒ `handleVolumeAsyncCommit(val)` issues a final `interactiveWrite` and on rejection rolls the override back to the device's last value.
5. **Reconciliation.** Same 250ms debounce + invalidation as CPU Speed.
6. **Why this is fast.**
   - The slider's `disabled` check is `!isConnected || volumePending` ([SidCard.tsx:248](../../../../src/pages/home/SidCard.tsx#L248)) and `volumePending` is constant `false` — **the slider can never freeze itself**. The optimistic override entry being stuck (e.g., from format drift) does not lock the UI.
   - Drag-time state ownership is `AudioMixer`-local. Re-render scope is small.
   - The slider's controlled `value` is `[volumeSliderValue]` which prefers the local draft, so even if the device snaps the value to a different option, the user's drag is uninterrupted.

## Other Sliders

- **Lighting Fixed Color / Strip Intensity** ([LightingSummaryCard.tsx](../../../../src/pages/home/components/LightingSummaryCard.tsx)): drafts are local to the card; commit goes through `interactiveWrite` (immediate batch). Slider gating is `disabled={isPending(<itemName>)}` — same pattern as CPU Speed and same theoretical disable-stall risk. The user did not report symptoms here, but the same fix should apply.
- **Lighting Studio brightness** ([LightingStudioDialog.tsx:370-377](../../../../src/components/lighting/LightingStudioDialog.tsx#L370)): pure modal-local state; "apply" pushes the result. No drag-time device writes.
- **Play page volume** ([VolumeControls.tsx:70-82](../../../../src/pages/playFiles/components/VolumeControls.tsx#L70)): `disabled={!canControlVolume}` only; does not bind to the optimistic-override store. Throttled async preview, final commit. This is the existing reference implementation that the rest of the app should converge towards.
- **Play page default duration** ([PlaybackSettingsPanel.tsx:74-83](../../../../src/pages/playFiles/components/PlaybackSettingsPanel.tsx#L74)): pure local state.
- **Settings notification duration** ([SettingsPage.tsx:2065-2074](../../../../src/pages/SettingsPage.tsx#L2065)): pure app-settings; no device.
- **`createSliderDeviceAdapter`** ([sliderDeviceAdapter.ts](../../../../src/lib/ui/sliderDeviceAdapter.ts)): a documented, microtask-coalescing adapter that exposes `onChange` / `onCommit`. **Currently unused.** Encodes exactly the contract Home CPU Speed needs.

## Behavioural Differences

| Dimension | Home CPU Speed (slow) | Config CPU Speed (fast) | Home SID Volume / Pan (fast) |
| --------- | --------------------- | ----------------------- | --------------------------- |
| Drag-time state owner | **`HomePage`** (`cpuSpeedOptimisticValue`) — re-renders the entire 1730-line page | `ConfigItemRow` local (`inputValue`) | `AudioMixer` local (`activeSliders`) |
| Disable predicate | `cpuSpeedPending` from optimistic-override store, gated on `Object.is` device echo | `setConfig.isPending` — TanStack mutation flag, self-resolving | Hardcoded `false` |
| Drag-time device write | **None** (preview is a no-op) | None (preview only re-affirms parent if differs) | Throttled `interactiveWrite` per async tick |
| Commit write path | `interactiveWriteU64` (immediate batch, bypasses throttle) **plus** chained `handleTurboControlAutoAdjust` through the throttled queue | `setConfig.mutateAsync` ⇒ throttled `setConfigValue` | `interactiveWrite` (immediate batch) |
| Reconciliation refetch | 250 ms debounced invalidation of `["c64-config-items", "U64 Specific Settings"]` | TanStack mutation `onSuccess` invalidates `["c64-category", category]` and `["c64-all-config"]` | 250 ms debounced invalidation of `["c64-config-items", "Audio Mixer"]` |
| Re-enable trigger | Override entry clears via `Object.is` match in `resolveValue` | `setConfig.isPending` falls (always) | Slider never disables in the first place |
| Risk of indefinite stall | **Yes** — strict `Object.is` against firmware echo; if any format/timing drift, slider stays disabled until page unmount | No | No |
| User-visible cost during drag | Whole-page re-render per pointer step ⇒ visible lag | Subtree re-render in row ⇒ smooth | Subtree re-render in `AudioMixer` ⇒ smooth |

## Root-Cause Candidates

### Confirmed

1. **C1 — Disable-on-pending gate combined with strict-equality entry clearing.** [src/pages/HomePage.tsx:1061](../../../../src/pages/HomePage.tsx#L1061) (`disabled={... || cpuSpeedPending || ...}`); [src/hooks/useAuthoritativeConfigValueState.ts:68-80](../../../../src/hooks/useAuthoritativeConfigValueState.ts#L68) (only clears via `Object.is`); the `pending` memo derives from "any key in `entries`" ([useAuthoritativeConfigValueState.ts:91-94](../../../../src/hooks/useAuthoritativeConfigValueState.ts#L91)). On commit, the slider becomes disabled and stays disabled until a refetch returns a value that satisfies `Object.is`, which is brittle against any whitespace/type drift. SID and Play page sliders bypass this gate; Config page binds to a self-resolving mutation flag. **Directly explains the "indefinitely non-responsive" symptom.**
2. **C2 — Optimistic-state ownership is on a 1730-line `HomePage`.** [src/pages/HomePage.tsx](../../../../src/pages/HomePage.tsx) hosts `cpuSpeedOptimisticValue`. Every drag step calls `setCpuSpeedOptimisticValue`, re-rendering HomePage and its many derived `resolveConfigValue`/`readItemOptions` calls. SID drafts live in `AudioMixer`, ConfigItemRow drafts live in itself. **Directly explains the "laggy thumb" symptom even when the slider is technically responsive.**
3. **C3 — Chained Turbo Control auto-adjust adds throttled-queue latency.** [src/pages/HomePage.tsx:731-755](../../../../src/pages/HomePage.tsx#L731) and [src/pages/home/hooks/useConfigActions.ts:41](../../../../src/pages/home/hooks/useConfigActions.ts#L41). After a CPU Speed write succeeds, a second write (`updateConfigValue` ⇒ `setConfigValue` ⇒ `scheduleConfigWrite`) fires for `Turbo Control` through the throttled queue. This delays the moment the reconciliation refetch lands.

### Strongly Suggested

1. **S1 — CPU Speed values carry leading whitespace.** [docs/c64/c64u-config.yaml:1334-1352](../../../../docs/c64/c64u-config.yaml#L1334) defines options as `" 1"`, `" 2"`, …, `"10"`, `"20"`. The send-side and receive-side both come from the same firmware-rendered list and *should* match byte-for-byte, but any normalisation in the JSON pipeline, proxy, or middleware would defeat `Object.is`. Other Home page Pending-disabled enums (Turbo Control, Badline Timing, …) use word strings without whitespace and are less exposed to this hazard, which is consistent with CPU Speed standing out.
2. **S2 — Heavy summary-card panel renders alongside the slider.** HomePage renders `SummaryConfigCard`, `MachineControls`, `DriveCard`, `LightingSummaryCard`, `AudioMixer`, etc. inside the same render. Even if React reconciliation is fast, the per-render `resolveConfigValue` lookups, ResizeObserver-driven layout effects in `SummaryConfigControlRow`/`ConfigItemRow`, and Framer Motion `motion` wrappers compound during continuous slider drag.

### Plausible But Unproven

1. **P1 — `waitForMachineTransitionsToSettle` stall.** If a machine transition handle is acquired and the cleanup is not called (e.g., during an interrupted reset), `machineTransitionCount` would not decrement and the lane's `beforeRun` would block indefinitely. The only caller is [src/pages/playFiles/hooks/usePlaybackController.ts:867](../../../../src/pages/playFiles/hooks/usePlaybackController.ts#L867); the handle is wrapped in `try/finally` there, so this is unlikely in practice. Listed for completeness.
2. **P2 — Off-screen reconciliation.** If the user drags CPU Speed and immediately switches to another tab/page, `useScreenActivity` may suspend the refetch, deferring the entry-clear. Probably contributes less than C1 because the slider also unmounts, but on quick flicks it could leave the entry stuck for a moment.
3. **P3 — Successive commits build up overrides.** The current implementation only sets one override per commit, but if a user drags-pauses-drags-pauses, multiple commits stack and each one resets the 250ms reconciliation timer. Eventually one refetch lands and clears them, but the disabled window can extend.

### Disproved Or Unlikely

1. **D1 — Slow REST endpoint.** Both the SID and CPU Speed paths use the same `interactiveWrite` lane and `updateConfigBatch({immediate:true})` API. SID is fast through the same network code; if the network were the bottleneck, SID would also be slow.
2. **D2 — Slider primitive itself.** The same `Slider` component runs on Config page, Play page, SID, and Home CPU Speed. Three of those are smooth.
3. **D3 — Radix slider step granularity.** The CPU Speed slider has only ~16 steps; the SID volume slider has many more. Coarser stepping would, if anything, fire `onValueChange` *less* often during drag.

## Stabilization Design Goals

A correct fix must achieve all of the following:

1. **Visual immediacy.** The thumb tracks the pointer at native frame-rate. Every pointer step should update only a localised React subtree, not HomePage as a whole.
2. **Non-blocking writes.** The slider control must never become `disabled` because of a pending or stuck override entry. Disable is reserved for genuine impossibility (`!isConnected`, no options, machine transitioning).
3. **Coalesced previews.** During drag, intermediate values are written via the existing immediate-batch lane with the slider's async throttle (default 200 ms) — so the device follows the drag without flooding.
4. **Reliable final value.** On pointer release, the latest value is guaranteed to be sent (commit fires the final `interactiveWrite` via the lane's "latest intent" semantics, even if previews were dropped).
5. **Refresh resilience.** A device refetch in flight must not snap the thumb back to a stale value during drag (the existing `setConfigOverride` after commit handles this; the optimistic-override store should still be used).
6. **Failure visibility without freezing.** Write failures surface via `reportUserError`/`addErrorLog` (already present) and roll the optimistic override back, but the slider remains usable.
7. **Consistent semantics across pages.** The Home CPU Speed slider should follow the same "fast" pattern as SID / Play page volume, unless there is a documented, narrowly-scoped reason to differ.
8. **No regression of the auto-Turbo-Control behaviour.** The chained Turbo Control adjust must continue to fire after a successful CPU Speed change, but it must not re-disable the CPU Speed slider.

## Implementation Options

### Option 1: Minimal Targeted Home Page CPU Speed Fix

Description:

- Drop the `cpuSpeedPending` term from the `disabled` predicate on the Home CPU Speed slider.
- Move `cpuSpeedOptimisticValue` (and the `cpuSpeedDraggingRef` resync `useEffect`) from `HomePage` into a small new component `HomeCpuSpeedSlider` colocated under `src/pages/home/components/`. Pass in `cpuSpeedOptions`, `cpuSpeedValue`, `isActive`, `onCommit(value)`, and the chained Turbo Control auto-adjust callback.
- Inside the new component, do drag-time `setCpuSpeedDraft` updates, throttled previews via `interactiveWriteU64({"CPU Speed": …})` (instead of the current preview no-op), and a final commit that writes both CPU Speed and the Turbo-Control auto-adjust serially **without** the throttled queue (use `interactiveWriteU64` for both, batching them into one `updateConfigBatch` payload `{ "CPU Speed": x, "Turbo Control": y }`).
- Keep the optimistic-override (`setConfigOverride`) on commit so a stale refetch cannot snap the thumb back, but **do not gate `disabled` on it**.

Files likely affected:

- New: `src/pages/home/components/HomeCpuSpeedSlider.tsx`.
- Edit: `src/pages/HomePage.tsx` (replace the inline slider block; remove `cpuSpeedOptimisticValue`, `cpuSpeedDraggingRef`, `cpuSpeedPending`-based disable, and the resync `useEffect`).
- Edit: `src/pages/home/hooks/useConfigActions.ts` (no change required) and possibly `src/pages/HomePage.tsx`'s `handleCpuSpeedCommitChange` / `handleTurboControlAutoAdjust` — fold them into the new component.
- Tests: extend `tests/unit/pages/HomePage*` (or add a new spec) covering the slider's drag and commit semantics.

Expected behaviour:

- Drag is smooth (re-renders contained to the new component).
- Slider never freezes — the disable predicate is `!isActive || cpuSpeedSliderOptions.length <= 1`, mirroring the Play page volume control.
- Final value reliably reaches the device; intermediate values stream via the immediate batch lane.
- Auto-Turbo-Control still adjusts but does not block CPU Speed responsiveness.

Risks:

- Auto-Turbo-Control formerly went through the throttled `setConfigValue` queue; combining it into the same `updateConfigBatch` call shifts the ordering. The firmware should accept either order, but we need a regression test for the Turbo Control side-effect.
- Drag-time preview writes are a behaviour change for CPU Speed (currently it only writes on commit). They should be safe — the device handles immediate-batch updates routinely for SID volume — but it does mean the C64 will momentarily speed up/down through every step the user drags through. We can keep commit-only writes and just fix the disable + ownership issues if that side-effect is undesired.

Test strategy:

- Unit test the new component with React Testing Library: simulate `pointerdown`, multiple `pointermove`, `pointerup`; assert that draft state is local, the slider is not disabled mid-drag, the final commit fires `interactiveWriteU64` once with the chosen value, and Turbo Control was adjusted.
- Playwright (`playwright/`) test: drag CPU Speed slider on Home page, assert the home CPU Speed value reflects the drag, the slider remains interactive throughout, and the device receives the final value (mocked REST in `playwright/uiMocks.ts`).
- Regression test for the existing failure mode: simulate a refetch returning a value with format drift (e.g., `"4"` instead of `" 4"`) and assert the slider remains enabled and the user can keep dragging.

Why prefer or not prefer:

- Prefer this if we want a low-risk, scoped change that ships fastest and clearly resolves the user's reported symptoms.
- Avoid this if we want to systemically de-risk the same pattern across LightingSummaryCard's `disabled={isPending(...)}` sliders in the same PR.

### Option 2: Shared Responsive Slider Hook Or Component

Description:

- Adopt the existing-but-unused [src/lib/ui/sliderDeviceAdapter.ts](../../../../src/lib/ui/sliderDeviceAdapter.ts) (or a slightly enriched version) as the canonical pattern. Its contract — *"sync local state, fire-and-forget device write, microtask coalesce, guarantee a final commit"* — is exactly the contract we want every device-bound slider to obey.
- Wrap it with a React hook `useDeviceBoundSlider({ value, options, write, onCommit })` that:
  - Owns local draft state (`useState`).
  - Returns `value`, `min`, `max`, `step`, `onValueChange`, `onValueCommit`, `onValueChangeAsync`, `onValueCommitAsync`, plus a `disabled` boolean fed from `!isConnected || sliderOptions.length <= 1` only (callers can OR-in their own disable terms but the hook does not bind to `pending`).
  - Internally calls `interactiveWrite({ [item]: value })` on async previews and on commit, and delegates `setConfigOverride` post-commit for refetch resilience.
- Refactor Home CPU Speed and Lighting Summary Card to use this hook. Optionally refactor SID Volume / Pan to use it, eliminating their hand-rolled `activeSliders` map and `volumePending = false` workaround.

Files likely affected:

- Edit: `src/lib/ui/sliderDeviceAdapter.ts` (extend with React hook wrapper or add `src/hooks/useDeviceBoundSlider.ts`).
- Edit: `src/pages/HomePage.tsx`, `src/pages/home/components/HomeCpuSpeedSlider.tsx` (new), `src/pages/home/components/AudioMixer.tsx`, `src/pages/home/components/LightingSummaryCard.tsx`.
- Tests across all migrated call sites; update Playwright fixtures.

Expected behaviour:

- All device-bound sliders behave identically: smooth drag, never frozen, guaranteed final commit, refetch-resilient.

Risks:

- Larger blast radius — touches SID Volume, SID Pan, Lighting, CPU Speed in one PR. Each migration carries its own regression risk (notably SID has soft detents and `applySoftDetent` semantics that must be preserved).
- The hook needs to support both numeric-domain sliders (Lighting Brightness) and option-index domain sliders (CPU Speed, SID Volume); generalising correctly takes more design care than a one-off fix.

Test strategy:

- Unit test the hook in isolation with a fake `write` function (assert microtask coalescing, final commit always fires the latest value).
- Migrate one consumer at a time; keep the existing AudioMixer / LightingSummaryCard tests green at each step.
- Playwright regression on each migrated slider.

Why prefer or not prefer:

- Prefer this if we want a single, future-proof pattern and are willing to take a bigger PR.
- Avoid this if delivery speed for the user-reported regression is the priority.

### Option 3: Config/Field-Level Normalization

Description:

- Address the failure at the override-store level rather than at each call site. Modify [src/hooks/useAuthoritativeConfigValueState.ts:73](../../../../src/hooks/useAuthoritativeConfigValueState.ts#L73) so that `resolveValue` clears the entry whenever the device-side value's *normalised* form (e.g., `String(deviceValue).trim()`) matches the override's normalised form, not just on `Object.is`.
- Also schedule a hard-reset of the override entry after a bounded timeout (e.g., 3 seconds after the last write) regardless of whether the device echo has matched, so the slider can never freeze indefinitely.

Files likely affected:

- Edit: `src/hooks/useAuthoritativeConfigValueState.ts`.
- Edit: tests in `tests/unit/hooks/useAuthoritativeConfigValueState.test.tsx` (if present) — search and add coverage.
- Optional: still drop the `cpuSpeedPending` term in `disabled` if we want defence-in-depth.

Expected behaviour:

- Even with format drift, the override entry clears on the next refetch.
- The watchdog timeout guarantees that even pathological cases recover within seconds.

Risks:

- **Cross-cutting change.** Every consumer of `useAuthoritativeConfigValueState` (Home, Lighting, Audio Mixer, Config Browser) inherits the new normalisation rules. We must not accidentally clear an entry that the user is still actively trying to set (e.g., user types a new hex string).
- Trim-based equality may mask real firmware misbehaviour (e.g., the device returns `"3"` when we asked for `"30"`) and silently surface the wrong value. This is a regression in observability.
- Watchdog clearing during an active drag could cause the slider to flash back to the device value mid-interaction.

Test strategy:

- Unit tests covering: format-drift clear, watchdog clear, no-clear on diverging numeric value, no-clear during active drag (we'd need to plumb a "user is interacting" signal — adds complexity).

Why prefer or not prefer:

- Prefer this if we believe other parts of the codebase also suffer from `Object.is` clear failures and a central fix is warranted.
- Avoid this as the primary fix because it changes the semantics of an integration boundary used elsewhere; the slider freeze is better fixed at the slider level.

## Recommended Approach

> **Update after empirical device testing and consolidation analysis (see "Empirical Device Findings", "Overengineering And Consolidation", "UX-First Slider Behaviour Model", and "Consolidated Implementation Plan" below):** the recommended approach is no longer the small Option 1 fix in isolation. Empirical device probing surfaced (a) a firmware-crash hazard from invalid batch values, (b) silent error-array discard in `c64api`, (c) numeric/string type-drift in the override store, and (d) three parallel "slider draft + async write" mechanisms in the codebase. These together justify a **single consolidation pass** structured as the five-step plan in "Consolidated Implementation Plan". Option 1 below is preserved as the minimal hot-fix should the consolidation need to be split across releases.

**Primary (revised)**: the five-step consolidation, with Step 1 (`c64api` correctness) a non-negotiable foundation, Step 2 introducing the canonical `useDeviceBoundSlider` hook, Step 3 migrating call sites in defined order (HomePage CPU Speed first), and Steps 4–5 demolishing the dead code and renaming the override store.

**Fallback**: Option 1 (Minimal Targeted Home Page CPU Speed Fix), with **Option 2 listed as a follow-up** for the Lighting Summary Card sliders.

Rationale:

- Option 1 directly resolves the user's reported regression (Home CPU Speed) with a small, well-scoped change. The new `HomeCpuSpeedSlider` mirrors the proven Play-page-volume / SID-volume pattern.
- Removing the `cpuSpeedPending` term from `disabled` is the single most important change and trivially auditable. Moving the draft state into a subcomponent eliminates the whole-page re-render cost during drag.
- Folding CPU Speed and Turbo Control into a single `updateConfigBatch` payload removes the chained throttled write that currently extends the disabled window.
- Option 1 stops short of restructuring the optimistic-override store (Option 3), avoiding cross-cutting risk, and stops short of refactoring SID/Lighting (Option 2), which can be sequenced separately.
- Lighting Summary Card sliders use the same `disabled={isPending(...)}` pattern but were not reported as broken; they should be migrated to the shared hook (Option 2) as a clearly-scoped follow-up rather than dragged into the urgent fix.

Expected user-visible improvement:

- Home CPU Speed thumb tracks the pointer at native frame-rate.
- The slider never enters the indefinitely-disabled state.
- Final selected value reaches the device reliably; Turbo Control continues to auto-adjust.
- Other slider behaviours unchanged.

Why this avoids regression:

- The fix touches only the Home page's CPU Speed slider, the new colocated component, and (lightly) `useConfigActions` for the chained write semantics. SID, Lighting, Config, and Play page sliders are untouched.
- The existing `setConfigOverride` is preserved on commit — refetch races still cannot snap the thumb back.
- Existing tests around `handleCpuSpeedChange` / `handleTurboControlAutoAdjust` should still pass after the merge into a single batched write.

Why it is appropriately scoped:

- One file added (`HomeCpuSpeedSlider.tsx`), one file simplified (`HomePage.tsx`), one helper consolidation. Clear ownership of state. No store-level changes.

Follow-up implementation tasks to create:

1. **TASK-A — Home CPU Speed slider stabilization (Option 1).** Implement `HomeCpuSpeedSlider` as described and remove the `cpuSpeedPending`-based disable. Acceptance: see "Acceptance Criteria" below.
2. **TASK-B — Migrate Lighting Summary Card sliders to a shared `useDeviceBoundSlider` hook (Option 2 partial).** Same disable-on-pending pattern applies; fix proactively.
3. **TASK-C — Optional: harden `useAuthoritativeConfigValueState.resolveValue` to clear on string-trim equality plus a 3 s watchdog (Option 3).** Defence in depth; only if a follow-up review finds additional cases.
4. **TASK-D — Document the slider-state-ownership convention** in `docs/ux-guidelines.md` (or a new note in `src/lib/ui/`): "Device-bound sliders MUST own draft state in a localised component, MUST NOT bind `disabled` to the optimistic-override store, and MUST guarantee a final commit via the slider primitive's `onValueCommitAsync`."

## Files Likely To Change In A Follow-Up Implementation

- `src/pages/HomePage.tsx` — remove the inline CPU Speed slider, `cpuSpeedOptimisticValue`/`cpuSpeedDraggingRef` state, the `cpuSpeedPending` derivation, the resync `useEffect`, and the `handleCpuSpeedPreviewChange` / `handleCpuSpeedCommitChange` / `handleTurboControlAutoAdjust` chain. Render `<HomeCpuSpeedSlider … />` instead.
- `src/pages/home/components/HomeCpuSpeedSlider.tsx` — **new**. Encapsulates draft state, options resolution, the commit batch (CPU Speed + Turbo Control), error handling.
- `src/pages/home/hooks/useConfigActions.ts` — left untouched; the new component uses `useInteractiveConfigWrite` and `useSharedConfigActions().setConfigOverride` directly.
- `src/pages/home/utils/HomeConfigUtils.ts` — possibly extend with a `resolveTurboControlForCpuSpeed` helper if not present (currently lives at the top of HomePage.tsx as `handleTurboControlAutoAdjust`'s logic). Optional cleanup.
- `tests/unit/pages/HomePage*` (or a new `tests/unit/pages/home/HomeCpuSpeedSlider.test.tsx`) — drag and commit semantics.
- `playwright/` — add or extend an existing home-page slider spec to cover the failure mode.

For TASK-B (Lighting follow-up), additionally:

- `src/lib/ui/sliderDeviceAdapter.ts` or new `src/hooks/useDeviceBoundSlider.ts`.
- `src/pages/home/components/LightingSummaryCard.tsx`.

## Test And Validation Plan

Manual:

- **M1** — Drag the Home CPU Speed slider full-range slowly and quickly. The thumb tracks the pointer at native rate; the displayed CPU Speed text updates each step; the device echoes the final value.
- **M2** — Tap the Home CPU Speed slider repeatedly to stress commit-frequency. Slider never enters a disabled visual state.
- **M3** — On a slow network (use the existing diagnostics throttling or browser DevTools throttle), drag and release. The thumb stays at the released position; the device eventually catches up; the slider remains interactive.
- **M4** — Trigger a machine reset while the slider is being dragged. The drag completes locally; the commit defers behind `waitForMachineTransitionsToSettle` but the slider does not freeze.
- **M5** — Drag the slider, immediately navigate to another tab, then back. The slider is interactive on return and reflects the device's authoritative value.
- **M6** — Confirm Turbo Control still auto-adjusts after CPU Speed change (e.g., from `" 1"` to `"10"` flips Turbo Control from `Off` to `Manual`).
- **M7** — Repeat M1–M5 against a real device. Per AGENTS.md, prefer `u64` (Ultimate 64 Elite) over `c64u`, and validate via the adb-attached Pixel 4 if present.

Automated:

- **A1** — Vitest unit test for `HomeCpuSpeedSlider`:
  - Mount with mocked `interactiveWriteU64`. Simulate Radix `onValueChange` with a stream of values; assert the local draft updates and `interactiveWriteU64` is invoked with the latest value at most once per throttle window.
  - Simulate `onValueCommitAsync`; assert a final `updateConfigBatch` payload `{ "CPU Speed": x, "Turbo Control": y }` (or two coalesced calls if we choose not to batch).
  - Assert the slider stays enabled even when the optimistic-override entry is set in the test render.
- **A2** — Vitest unit test for `useAuthoritativeConfigValueState` covering the format-drift path: with an entry of `" 4"` and a refetched device value of `"4"`, today the entry persists. Add a regression test asserting the new behaviour after Option 3 is implemented (only relevant if TASK-C ships).
- **A3** — Playwright spec on Home page:
  - Drag CPU Speed slider; assert the displayed `home-cpu-speed-value` updates during drag.
  - Assert no `disabled` attribute appears on `home-cpu-speed-slider` between drag start and commit.
  - Mock the REST PUT to delay 2 s; assert the slider remains operable during that delay.
  - Mock the REST GET to return `"4"` instead of `" 4"`; assert the slider does not freeze (regression for the format-drift path).
- **A4** — Coverage: meet the project's 91% branch-coverage gate (per CLAUDE.md). Specifically cover the new component's failure paths.

Regression checks:

- **R1** — SID Volume / Pan continue to behave exactly as before. (No code change in `AudioMixer.tsx` for Option 1.)
- **R2** — Config page CPU Speed continues to behave exactly as before.
- **R3** — Lighting Summary Card sliders unchanged unless TASK-B is included.
- **R4** — `tests/unit/scripts/buildFastPath.test.ts` and other unrelated suites continue to pass.

Slow-network / delayed-device simulation:

- **N1** — Use the existing `playwright/uiMocks.ts` or DevTools throttling to inject 1–3 s latency on `/v1/configs` PUT. Slider must remain operable; final value must still reach the device.

Repeated drag interactions:

- **D1** — Drag-pause-drag-pause-drag-pause for 30 s. No accumulating override entries should leave the slider in a disabled state at the end.

Drag while config refresh / polling happens:

- **P1** — Trigger a manual `queryClient.invalidateQueries(["c64-config-items", "U64 Specific Settings"])` at the moment the user releases the thumb. The slider must reflect the released value (not snap back), thanks to `setConfigOverride`.

Drag followed by immediate navigation:

- **NV1** — Drag, release, immediately navigate to Settings. Return to Home. The slider reflects the committed value.

Drag failure or REST error:

- **E1** — Simulate a 500 from the REST PUT. The slider returns to the prior value via the existing `addErrorLog` + `setConfigOverride(... cpuSpeedValue)` rollback ([HomePage.tsx:768-774](../../../../src/pages/HomePage.tsx#L768)). The slider remains interactive.

Confirmation that final device value matches the final slider value:

- **F1** — On every successful drag, after reconciliation, the device's reported `CPU Speed` matches the slider's last released option string. Asserted in both Playwright (mocked) and manual real-device validation.

## Acceptance Criteria

The follow-up implementation is complete when all of the following hold:

1. The Home page CPU Speed slider thumb visibly tracks pointer movement at native frame-rate during a continuous drag (no perceptible lag versus the SID Volume slider on the same screen).
2. The Home page CPU Speed slider never enters a disabled state in response to in-flight optimistic-override entries. The disable predicate references only `!isActive` and `cpuSpeedSliderOptions.length <= 1`.
3. After a drag-and-release, the device reports the released CPU Speed value within the existing reconciliation window, and Turbo Control auto-adjusts as today.
4. With injected REST latency of 2 s on `/v1/configs`, the user can still drag and release the CPU Speed slider repeatedly; the final device value matches the last released option.
5. With a simulated REST GET returning `"4"` while the slider is set to `" 4"` (format drift), the slider remains interactive and the user can change CPU Speed again.
6. Neither SID nor Config page nor Play page nor Lighting sliders regress (existing Vitest and Playwright suites pass; specifically the audio-mixer and config-browser specs).
7. `npm run test:coverage` reports ≥ 91% branch coverage globally (per CLAUDE.md).
8. `npm run lint`, `npm run test`, and `npm run build` succeed.
9. Manual on-device validation against `u64` (preferred) or `c64u`, deployed via the adb-attached Pixel 4, confirms the four scenarios M1, M3, M5, and M6.
10. The PR description and (if needed) `docs/ux-guidelines.md` document the new slider-state-ownership convention so the same regression cannot reappear elsewhere.

## Open Questions

All five questions raised in the initial draft were answered by direct REST experimentation against `u64` (Ultimate 64 Elite, firmware 3.14e) and `c64u` (C64 Ultimate, firmware 1.1.0). See "Empirical Device Findings" below for the raw evidence and the resolved answers, summarised here:

1. **Firmware echo format.** *Resolved.* The firmware echoes CPU Speed bytes-identical to what is sent (`" 1"` ↔ `" 1"`, `"10"` ↔ `"10"`) on both `u64` and `c64u`. The strict-`Object.is` clear in `resolveValue` is **not** broken by the happy-path echo — but it is broken by **type drift on numeric items** (e.g. `"Strip Intensity"` returns `current: 6` as a JSON number while client-side state may hold `"6"` as a string). Section "Empirical Device Findings" details this.
2. **Drag-time CPU Speed previews.** *Resolved.* Acceptable in principle (firmware accepts and applies each value in 24–60 ms) but **undesirable for UX** — every drag step would actually re-clock the C64 mid-drag, producing audible/visual artefacts. Recommendation: **commit-only writes for CPU Speed**, while SID Volume / Pan continue to use throttled previews (where preview latency is part of the UX). Section "UX-First Slider Behaviour Model" formalises this per-domain.
3. **Auto-Turbo-Control batching.** *Resolved.* The firmware accepts a single batch payload `{"U64 Specific Settings":{"CPU Speed":" 4","Turbo Control":"Manual"}}` in 50–55 ms and applies both atomically. **Always send CPU Speed and Turbo Control in one `updateConfigBatch`.** This eliminates the chained-write latency contributing to root-cause C3.
4. **Lighting follow-up scope.** *Resolved.* Empirical inspection of the Lighting Summary Card code confirms that `handleFixedColorPreview` / `handleIntensityPreview` do **not** call `setConfigOverride`, so the override store is never populated for those keys and `isPending(...)` is effectively always `false` there. The `disabled={isPending(...)}` lighting predicate is therefore a latent dead branch — broken-by-design but not currently observable. Recommendation: clean it up in the consolidation pass (TASK-B), not as a hot-fix.
5. **Pending memo redesign.** *Resolved.* The "any-key-in-`entries`-is-pending" memo in `useAuthoritativeConfigValueState` is a misuse of the override store as a write-tracker. A separate `useC64WriteRegistry` (mutation-bound) is the correct primitive. Plan: introduce it inside the consolidation pass and remove the `pending` memo's slider call sites.

### Empirical Device Findings

All commands recorded; full transcripts are in `WORKLOG.md`. Performed 2026-05-06.

| Probe | Command | Result |
| ----- | ------- | ------ |
| Reachability | `curl http://u64/v1/info`, `curl http://c64u/v1/info` | u64 = `Ultimate 64 Elite`, fw `3.14e`; c64u = `C64 Ultimate`, fw `1.1.0`. Both online at the start of the session. |
| CPU Speed read (u64) | `GET /v1/configs/U64%20Specific%20Settings/CPU%20Speed` | `current: " 1"`; `values: [" 1"," 2"," 3"," 4"," 5"," 6"," 8","10","12","14","16","20","24","32","40","48"]` — leading whitespace preserved. |
| CPU Speed read (c64u) | same on c64u | Different option set (`" 1"," 2"," 3"," 4"," 6"," 8","10","12","14","16","20","24","32","40","48","64"`) — proves option lists are firmware-specific and **must be read from the live device, never hardcoded**. |
| CPU Speed valid PUT (u64) | `PUT …?value=%204` | `errors: []`; subsequent `GET` returns `current: " 4"` — byte-identical echo confirmed. |
| CPU Speed invalid PUT (u64) | `PUT …?value=4` (no leading space) | **HTTP 200** with `errors: ["Value '4' is not a valid choice for item CPU Speed"]`. The transport is happy; the operation failed. **The current `c64api.setConfigValue` ignores the `errors` array and returns this as success** — a silent-failure path. |
| CPU Speed invalid in BATCH POST (u64) | `POST /v1/configs` with `{"U64 Specific Settings":{"CPU Speed":"4","Turbo Control":"Manual"}}` | **Request hung for 10 s and the device went offline indefinitely** (TCP connection refused, ICMP ping `100% packet loss` for the rest of the session). u64 did not recover before this report was written. **An invalid value inside a batch can crash the firmware.** This is a CRITICAL operational hazard and the strongest argument for client-side validation against the live option list before any write. |
| Single-PUT latency (c64u) | 4 sequential PUTs | 24 / 28 / 23 / 52 ms each. |
| 11 sequential PUTs (c64u) | full CPU Speed sweep | 253 ms total (~23 ms/step, single-flight). |
| 11 sequential SID Volume PUTs (c64u) | full ramp on `Vol UltiSid 1` | 450 ms total (~41 ms/step). |
| Batch CPU + Turbo (c64u) | `POST /v1/configs` valid payload | 54 ms (vs. ~30 ms × 2 sequential — saves a round-trip). |
| Batch SID Vol + Pan (c64u) | `POST /v1/configs` | 34 ms (one round-trip wins). |
| Parallel PUTs (c64u) | two concurrent PUTs to `CPU Speed` (`" 4"` and `" 8"`) | Both return HTTP 200; final `current` was `" 4"` (the *first* request, not the last). **Firmware does not preserve client-send order under concurrency.** All slider writes must be serialised by the client (the existing `LatestIntentWriteLane` already does this for the SID/CPU Speed paths). |
| Numeric-typed item (c64u) | `GET .../Strip%20Intensity` | `current: 6` (JSON number), `min: 0`, `max: 31`, `format: "%d"`, `default: 25`. **Numeric items are returned as numbers**; string items are returned as strings. The override store currently uses `Object.is` which would treat `"6"` and `6` as different — a real type-drift hazard for `Strip Intensity` and any other numeric item. |
| LED Strip Settings shape (c64u) | `GET /v1/configs/LED%20Strip%20Settings` | Mixed payload — most items return scalar values directly (`"LedStrip Mode": "Fixed Color"`), but per-item `GET` returns the rich `{current, options, default}` envelope. The two shapes flow through `extractConfigValue` already. |

**Critical defensive consequence:** because (i) invalid values in a *batch* request can hang the firmware, (ii) the current code silently ignores response `errors`, and (iii) the override store can never clear stuck entries on type drift, the consolidation MUST add (a) client-side option-membership validation before every write, and (b) explicit error handling on the response payload. These are non-negotiable preconditions for moving more sliders to the immediate-batch path.

## Overengineering And Consolidation

The codebase currently carries **three parallel mechanisms** for "slider draft + async device write" — none of which is used consistently:

1. **`Slider` primitive's own async machinery.** [src/components/ui/slider.tsx](../../../../src/components/ui/slider.tsx) (377 lines) embeds:
   - An internal `dragValue` state (line 94).
   - A microtask-driven `createSliderAsyncQueue` ([src/lib/ui/sliderBehavior.ts:64-137](../../../../src/lib/ui/sliderBehavior.ts#L64)) with a 200 ms throttle and a "pending or last changed value" dedupe.
   - A 5-state popup state machine ([src/lib/ui/sliderPopupStateMachine.ts](../../../../src/lib/ui/sliderPopupStateMachine.ts)) with idle-timeout reduction.
   - Midpoint snap (`resolveMidpointSnap`), midpoint haptics, value formatter, value popup with computed left percentage.
   - A `window`-level event listener for `c64u-app-settings-updated` to live-tune the throttle ([slider.tsx:193-202](../../../../src/components/ui/slider.tsx#L193)).
2. **`createSliderDeviceAdapter`** ([src/lib/ui/sliderDeviceAdapter.ts](../../../../src/lib/ui/sliderDeviceAdapter.ts)) — a microtask coalescer with `onChange`/`onCommit` semantics that exactly mirrors the Slider's async queue logic. **Not used by any call site.**
3. **Per-call-site bespoke draft state.** Five different shapes:
   - HomePage: `cpuSpeedOptimisticValue: string | null` + `cpuSpeedDraggingRef: Ref<boolean>` + a resync `useEffect`.
   - AudioMixer: `activeSliders: Record<string, number>` keyed by per-slider id, plus per-slider `volumeSliderId`/`panSliderId`.
   - LightingSummaryCard: `fixedColorDraftIndex: number | null` and `intensityDraft: number | null`, plus two `useEffect`s that null them out when the device value changes.
   - ConfigItemRow: `inputValue: string` + `lastCommittedRef: Ref<string>` + a `mergedValue` `useEffect`.
   - PlayFilesPage / VolumeControls: `volumeIndex` derived in `usePlaybackController`, no slider-local draft.

Each implementation reasons about the same problem (display the user's draft, send a coalesced preview, guarantee a final commit, recover from network failure, avoid stale-refetch overwrites) and reaches a different answer. The result is the asymmetry that makes Home CPU Speed broken while Home SID Volume is fast.

Other forms of accidental complexity:

- **`useAuthoritativeConfigValueState` is double-duty.** It is both an *optimistic-override store* (via `replaceEntry` / `resolveValue`) **and** a *pending-write tracker* (via the `pending` memo). The two responsibilities have different lifecycles and conflicting clear semantics: an optimistic override should clear when the device echoes back any consistent value (or when the user moves on), while a pending tracker should clear when the in-flight mutation settles. Coupling them through `Object.is` makes both worse.
- **Two write paths in parallel.** `useC64SetConfig` (Config page) goes through the throttled `scheduleConfigWrite` queue; `useInteractiveConfigWrite` (Home page sliders) bypasses it. The two paths invalidate different query keys (`["c64-category", category]` and `["c64-all-config"]` vs. `["c64-config-items", category]`). This duplicates business logic and produces inconsistent post-write reconciliation.
- **`scheduleConfigWrite` is a static singleton** ([src/lib/config/configWriteThrottle.ts:11-13](../../../../src/lib/config/configWriteThrottle.ts#L11)). Combined with the immediate-bypass path, the queue is impossible to reason about as a system: identical logical operations may serialise or parallelise depending on which call site invoked them.
- **`emitUiTraceMarker` is fired from inside the slider primitive** ([slider.tsx:131-145](../../../../src/components/ui/slider.tsx#L131)) for popup open/close. UI tracing on a low-level primitive ties low-level rendering to high-level analytics; the call site should opt in.
- **Response-error handling absent.** [src/lib/c64api.ts:1148-1190](../../../../src/lib/c64api.ts#L1148) returns the response object directly. Callers do not check `errors`. The empirical "value '4' is not a valid choice" rejection comes back as `errors: ["..."]` with HTTP 200 — silently treated as success. **This is the actual reason a stuck override entry can develop in production**: the firmware rejected a write, the optimistic state stayed in place, the slider stayed disabled.

A single, opinionated consolidation removes all five layers. The consolidation is the right thing to do; it is also the smallest change that satisfies the user's stated requirements ("immediate user feedback", "no possibility of slider ever jumping back unless apply could not be applied", "absolutely avoid C64 Commander world view out of sync with real state of the remote world").

## UX-First Slider Behaviour Model

The user's requirements yield a precise contract that every device-bound slider must satisfy. I translate it into invariants here so the implementation is unambiguous.

### Invariants (the "slider contract")

1. **Immediate-feedback invariant.** From `pointerdown` to `pointerup`, the slider thumb position is the most recently interpolated user value. The displayed value text matches the thumb. Neither the device nor any background refetch can move the thumb during interaction. (Implementation: the slider hook owns `draft` state and renders `value = draft ?? deviceValue`; `useEffect`s that resync to the device value MUST guard on `isInteracting`.)
2. **Truth-on-success invariant.** When a write succeeds (HTTP 200 **and** `errors.length === 0` **and** the next reconciling read returns the same value or a domain-equivalent one), the slider settles on the value the user released and the local view matches the device. The optimistic override is dropped.
3. **Truth-on-failure invariant.** When a write fails (network error, HTTP non-2xx, response `errors.length > 0`, or watchdog timeout — see below), the slider snaps back to the last known device value, the user is informed via `reportUserError`/`addErrorLog`, and the slider remains immediately interactive. **The slider may "jump back to original" only in this branch and only because the device truthfully refused the change.**
4. **Never-frozen invariant.** The slider is `disabled` only for *intrinsic* reasons (`!isConnected`, `options.length <= 1`, `!isActive`). It is **never** `disabled` because of the optimistic-override store, an in-flight write, or a pending reconciliation refetch.
5. **No-out-of-sync invariant.** Every successful write is followed by a refetch of the affected category. If the refetch returns a value different from the released slider value (e.g. the firmware coerced it, snapped it, or rejected it via `errors[]`), the slider updates to the firmware truth. The optimistic override never overrules the device; it only fills the gap until the next refetch.
6. **Bounded-staleness invariant.** A "watchdog" timer expires the optimistic override after `WRITE_RECONCILIATION_BUDGET_MS` (default proposed: **1500 ms after the last commit**, comfortably above the empirical 50–60 ms write latency plus a 250 ms reconciliation debounce, with margin). After expiry, the slider value falls back to the device value regardless of equality. This is the **only** mechanism by which a stuck client view can clear; it makes invariant #5 self-healing.
7. **Order-preservation invariant.** When the user drags through several values in a burst, intermediate previews are best-effort but the final commit is guaranteed to be the value at pointer-release. The "latest intent" lane already implements this contract for parallel writes; the consolidated hook must always go through it.
8. **Validation invariant.** Every value sent to the device must be a member of the live option list (or, for numeric items, in `[min, max]` and step-aligned). Empirically, sending an invalid value in a *batch* hangs the firmware (`u64`, fw 3.14e). The hook validates client-side before scheduling.

### Per-domain interaction style

Not all sliders should fire device writes during drag. The user's mental model differs by domain:

| Domain | Drag-time previews? | Why | Examples |
| ------ | ------------------- | --- | -------- |
| **Auditory continuous** | Yes, throttled to 200 ms | The user listens for the change in real time | SID Volume / Pan, Play page playback volume |
| **Visual continuous** | Yes, throttled to 200 ms | The user watches LEDs change | Lighting Strip Intensity, Lighting Fixed Color |
| **Discrete machine state** | **No — commit-only** | Mid-drag transitions would re-clock the C64 / restart subsystems unpredictably | CPU Speed, Turbo Control |
| **Pure UI** | No — local only | No device involved | Default song duration, notification duration |

The shared hook accepts a `previewMode: "throttled" | "commitOnly"` to encode this.

### Reconciliation and error semantics

- **Happy path.** `pointerup` ⇒ batch write fires ⇒ `errors: []` ⇒ 250 ms debounced invalidation ⇒ refetch ⇒ `deviceValue === draft` ⇒ override dropped ⇒ slider shows device value (which equals draft) ⇒ done.
- **Coercion path.** `pointerup` ⇒ batch write fires ⇒ `errors: []` ⇒ refetch returns a *different* value (firmware coerced it, e.g. clamped to `[min, max]`) ⇒ optimistic override is dropped ⇒ slider visibly snaps to firmware value. Toast: "Adjusted to nearest valid value." This satisfies the no-out-of-sync invariant.
- **Refusal path.** `pointerup` ⇒ batch write returns `errors: [...]` (or HTTP non-2xx) ⇒ optimistic override is rolled back to the pre-write device value ⇒ slider snaps back ⇒ `reportUserError` shown with retry. This is the **only** legitimate "jump back to original" path.
- **Watchdog path.** `pointerup` ⇒ batch write fires ⇒ no reconciliation in `WRITE_RECONCILIATION_BUDGET_MS` ⇒ optimistic override dropped ⇒ slider falls back to last known device value ⇒ `addErrorLog` "reconciliation timed out". Treated like the refusal path with a softer message.
- **Concurrent-drag path.** User starts a new drag before the previous reconciliation lands ⇒ the new draft replaces the old override; the watchdog timer is reset; the previous in-flight write is superseded by the LatestIntentWriteLane.

## Consolidated Implementation Plan

A single PR (or a tight, sequenced two-PR train) replaces the three parallel mechanisms with one.

### Step 1 — `c64api` correctness (foundation)

- Edit [src/lib/c64api.ts:1148-1190](../../../../src/lib/c64api.ts#L1148): `setConfigValue` and `updateConfigBatch` must inspect the response's `errors` array. If non-empty, throw a typed `C64ConfigWriteError` carrying `category`, `item`, the offending value, and the firmware's error strings. Tests in `tests/unit/c64api.test.ts` already exist; extend them.
- Add an option-membership / range validator. New module `src/lib/config/validateConfigWrite.ts`: `validateWriteAgainstSpec(category, updates, categorySpec)` ⇒ throws `C64ConfigWriteError` *before* calling the network. The categorySpec is the same payload `useC64ConfigItems` already fetches, so the validator can reuse it.
- Wire the validator into `useC64UpdateConfigBatch` and `useC64SetConfig` in [src/hooks/useC64Connection.ts:359-407](../../../../src/hooks/useC64Connection.ts#L359). Refuse to send invalid values; surface `reportUserError`. **This single change defuses the firmware-hang hazard demonstrated empirically against u64.**

### Step 2 — `useDeviceBoundSlider` hook (the canonical primitive)

New module `src/hooks/useDeviceBoundSlider.ts`. Public API (illustrative):

```ts
type DeviceBoundSliderInput =
  | { kind: "indexed"; options: readonly string[]; deviceValue: string }
  | { kind: "numeric"; min: number; max: number; step?: number; deviceValue: number };

export interface UseDeviceBoundSliderArgs {
  category: string;
  itemName: string;            // e.g. "CPU Speed"
  spec: DeviceBoundSliderInput;
  previewMode: "throttled" | "commitOnly";
  isConnected: boolean;
  /** extra writes to send atomically with this slider's commit (e.g. Turbo Control) */
  coalesceWith?: () => Record<string, string | number> | undefined;
  /** Optional value transform (snap, soft detent, etc.) applied to draft + writes. */
  transform?: (raw: number) => number;
}

export interface UseDeviceBoundSlider {
  value: number;                                  // index for indexed, raw for numeric
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  formatValue: (v: number) => string;
  onValueChange: (vals: number[]) => void;        // sync
  onValueCommit: (vals: number[]) => void;        // sync
  // No async props leaked — the hook owns coalescing internally.
}
```

Internal behaviour (single source of truth):

- Owns `draft: number | null`, `isInteracting: boolean`, `lastCommittedDraft: number | null`, `lastDeviceValue: T`, `watchdogTimer: ref`.
- `onValueChange` sets `draft` and `isInteracting=true`. If `previewMode === "throttled"`, schedules a coalesced `interactiveWrite` via the `LatestIntentWriteLane` after a 200 ms timer (configurable via the existing `loadVolumeSliderPreviewIntervalMs`).
- `onValueCommit` clears `isInteracting`, validates the value via `validateWriteAgainstSpec`, calls `interactiveWrite({[itemName]: resolved, ...coalesceWith?.() })` through the same lane. On success, schedules a 250 ms reconciliation invalidation; starts the watchdog. On failure, rolls back `draft = null` (restoring `lastDeviceValue`) and surfaces `reportUserError`.
- Reconciliation: when the next refetched `deviceValue` arrives, the hook uses a domain-aware comparator (`compareIndexedOption`, `compareNumeric` — both type-coercing and trim-aware) to decide whether to drop the override or whether the device's authoritative value differs (coercion path). Either way, the override is dropped after settle.
- Watchdog: the override expires after `WRITE_RECONCILIATION_BUDGET_MS = 1500ms` regardless of equality.
- `disabled` returns only `!isConnected || (kind === "indexed" && options.length <= 1)`.
- `value` returns `draft ?? deviceIndex` (indexed) or `draft ?? deviceValue` (numeric).
- `useEffect` resync: when `deviceValue` changes AND `!isInteracting` AND `draft === null`, no-op (slider already shows device truth). When `deviceValue` changes AND `!isInteracting` AND `draft !== null` AND the watchdog has expired, drop `draft`.

The hook delegates network and validation to Step 1 helpers — no overlap.

### Step 3 — Migrate call sites

Migrate in this exact order (smallest-blast-radius first):

1. **HomePage CPU Speed.** `previewMode: "commitOnly"`, `coalesceWith: () => ({ "Turbo Control": resolveTurboControlValue(draft) })`. Extract into `src/pages/home/components/HomeCpuSpeedSlider.tsx`. Remove `cpuSpeedOptimisticValue`, `cpuSpeedDraggingRef`, the resync `useEffect`, `handleCpuSpeedPreviewChange`, `handleCpuSpeedCommitChange`, `handleTurboControlAutoAdjust` from HomePage (re-export the helper from `HomeConfigUtils.ts` if needed elsewhere).
2. **AudioMixer SID Volume / Pan.** `previewMode: "throttled"`, `transform: applySoftDetent`. Replace `activeSliders` and `handleVolume*`/`handlePan*` with the hook. Drop the `volumePending = false` sentinel.
3. **LightingSummaryCard Fixed Color / Strip Intensity.** Same hook. Remove `fixedColorDraftIndex` / `intensityDraft` and their two resync `useEffect`s.
4. **ConfigItemRow** (slider branch only, [ConfigItemRow.tsx:413-491](../../../../src/components/ConfigItemRow.tsx#L413)). Same hook with `previewMode: "throttled"` (matches today's behaviour). Removes `inputValue` / `lastCommittedRef` / `mergedValue` resync from the slider branch (other branches keep `inputValue` for the text input).
5. **VolumeControls** (Play page playback volume). Migrate to the hook for consistency. The current implementation is already close — this is mainly removing a layer.

### Step 4 — Demolish the dead code

- Delete [src/lib/ui/sliderDeviceAdapter.ts](../../../../src/lib/ui/sliderDeviceAdapter.ts). Unused after migration.
- Simplify [src/components/ui/slider.tsx](../../../../src/components/ui/slider.tsx):
  - Remove `onValueChangeAsync`, `onValueCommitAsync`, `asyncThrottleMs` from the props.
  - Remove `createSliderAsyncQueue` usage and the volume-preview interval listener; the hook now owns throttling.
  - Keep `dragValue`, the popup state machine, midpoint snap, haptics, and value formatter — these are pure UX and belong on the primitive.
- Delete [src/lib/ui/sliderBehavior.ts](../../../../src/lib/ui/sliderBehavior.ts)'s `createSliderAsyncQueue` (the midpoint snap / soft-detent helpers stay).
- Remove the `pending` memo's slider-related call sites from [src/hooks/useAuthoritativeConfigValueState.ts:91-94](../../../../src/hooks/useAuthoritativeConfigValueState.ts#L91). The override store remains but its `pending` projection is no longer used by sliders. (Selects and the Config page mutation flag continue to work.)

### Step 5 — Rename and document

- Rename `useAuthoritativeConfigValueState` to `useOptimisticConfigOverrideStore` (one responsibility: optimistic overrides), or split it into `useOptimisticConfigOverrideStore` + `useC64WriteRegistry` if the cleanup pass touches selects too.
- Add a short note in `docs/ux-guidelines.md` codifying the eight invariants from "UX-First Slider Behaviour Model" and pointing future authors at `useDeviceBoundSlider`.

### Why this is the right amount of change

- Every line removed (sliderDeviceAdapter.ts, sliderBehavior.ts queue, the five bespoke draft states, the `pending` slider gate) is dead or duplicate by the time the migration lands.
- The hook is one small new module (~150 lines), its tests live next to it, and it absorbs all the contract logic that today is scattered across five components.
- The `c64api` correctness fixes (Step 1) are independent value — they prevent the firmware-crash hazard regardless of whether the slider migration ships.
- The migration is reversible per call site: each step in Step 3 is a small PR that swaps one component to the hook, with the rest untouched.

### Risk register

- **R-CONS-1 — Migrating SID Volume changes its preview cadence.** Currently `interactiveWrite` is fired on every async tick (200 ms throttled by the slider primitive). The hook re-implements this; tests must compare wall-clock cadence on a real device.
- **R-CONS-2 — `applySoftDetent` semantics for SID Volume / Pan.** The transform must be applied to **both** the draft and the value sent to the device, in the same way the current code does it. Add a regression test asserting the centre-snap behaviour.
- **R-CONS-3 — ConfigItemRow text/numeric branches still need their own `inputValue`.** Only the slider branch migrates; do not refactor the other branches in the same PR.
- **R-CONS-4 — Watchdog at 1500 ms.** Empirically generous (50–60 ms typical write + 250 ms reconciliation debounce + headroom for slow Wi-Fi). If a future device proves slower, the budget is configurable at the hook level.
- **R-CONS-5 — Validator correctness.** The validator must accept the **live** option list (e.g. `c64u` has `"64"` while `u64` lacks it). Reading from the same `useC64ConfigItems` data the slider already consumes guarantees parity.
- **R-CONS-6 — Recovery of `u64`.** The empirical hang of `u64` left it offline for the duration of this research session. Implementers should expect this hazard during testing and plan for a reboot path; the manual validation plan (M7) explicitly preconditions on a healthy device.

### Updated Acceptance Criteria (consolidation)

In addition to the ten criteria already listed, the consolidation pass adds:

11. `c64api.setConfigValue` and `c64api.updateConfigBatch` reject (throw) when the response contains a non-empty `errors` array. Existing `c64api.test.ts` extended.
12. A `validateWriteAgainstSpec` helper rejects values that are not in the live option list (or out of `[min, max]` for numeric items) **before** any network call. Unit test included.
13. All device-bound sliders in the inventory render through the same `useDeviceBoundSlider` hook; `sliderDeviceAdapter.ts` and `createSliderAsyncQueue` are removed.
14. The override store no longer powers any slider's `disabled` predicate. Search the codebase for `isPending(` / `configWritePending[` in slider contexts and assert zero matches.
15. Manual M-series validation against `c64u` (preferred to `u64` until u64 recovers from the empirical crash) shows the eight invariants holding for CPU Speed, SID Volume, SID Pan, Lighting Fixed Color, Lighting Strip Intensity, Play page volume, and the generic Config page slider.
16. The watchdog acceptance test: artificially block the reconciliation invalidation for 5 s; the slider falls back to the last known device value automatically and remains interactive.

## Appendix: Evidence

Key files and symbols (all paths are relative to repo root):

- Slider primitive: [src/components/ui/slider.tsx](../../../../src/components/ui/slider.tsx); throttle constant `SLIDER_MID_DRAG_THROTTLE_MS = 200` in [src/lib/ui/sliderBehavior.ts:9](../../../../src/lib/ui/sliderBehavior.ts#L9); unused adapter [src/lib/ui/sliderDeviceAdapter.ts](../../../../src/lib/ui/sliderDeviceAdapter.ts).
- Home CPU Speed: [src/pages/HomePage.tsx:194-218](../../../../src/pages/HomePage.tsx#L194), [src/pages/HomePage.tsx:694-697](../../../../src/pages/HomePage.tsx#L694), [src/pages/HomePage.tsx:731-778](../../../../src/pages/HomePage.tsx#L731), [src/pages/HomePage.tsx:866](../../../../src/pages/HomePage.tsx#L866), [src/pages/HomePage.tsx:880-897](../../../../src/pages/HomePage.tsx#L880), [src/pages/HomePage.tsx:1056-1080](../../../../src/pages/HomePage.tsx#L1056).
- Home SID: [src/pages/home/components/AudioMixer.tsx:177-283](../../../../src/pages/home/components/AudioMixer.tsx#L177), [src/pages/home/components/AudioMixer.tsx:470-528](../../../../src/pages/home/components/AudioMixer.tsx#L470), [src/pages/home/SidCard.tsx:233-281](../../../../src/pages/home/SidCard.tsx#L233).
- Config page: [src/pages/ConfigBrowserPage.tsx:268-293](../../../../src/pages/ConfigBrowserPage.tsx#L268), [src/pages/ConfigBrowserPage.tsx:587-604](../../../../src/pages/ConfigBrowserPage.tsx#L587), [src/components/ConfigItemRow.tsx:413-491](../../../../src/components/ConfigItemRow.tsx#L413).
- Optimistic-override store: [src/hooks/useAuthoritativeConfigValueState.ts:17-106](../../../../src/hooks/useAuthoritativeConfigValueState.ts#L17), specifically the `Object.is`-gated clear at [line 73](../../../../src/hooks/useAuthoritativeConfigValueState.ts#L73) and the "any-key-is-pending" memo at [lines 91-94](../../../../src/hooks/useAuthoritativeConfigValueState.ts#L91).
- Interactive write lane: [src/hooks/useInteractiveConfigWrite.ts:49-150](../../../../src/hooks/useInteractiveConfigWrite.ts#L49), [src/lib/deviceInteraction/latestIntentWriteLane.ts](../../../../src/lib/deviceInteraction/latestIntentWriteLane.ts), [src/lib/deviceInteraction/deviceActivityGate.ts:108-150](../../../../src/lib/deviceInteraction/deviceActivityGate.ts#L108).
- C64 API: [src/lib/c64api.ts:1148-1190](../../../../src/lib/c64api.ts#L1148); throttled queue [src/lib/config/configWriteThrottle.ts:34-46](../../../../src/lib/config/configWriteThrottle.ts#L34).
- TanStack mutation paths: [src/hooks/useC64Connection.ts:282-407](../../../../src/hooks/useC64Connection.ts#L282).
- CPU Speed firmware option list: [docs/c64/c64u-config.yaml:1334-1352](../../../../docs/c64/c64u-config.yaml#L1334).
- File sizes (re-render scope): `wc -l` for HomePage.tsx (1730), AudioMixer.tsx (534), SidCard.tsx (285), ConfigItemRow.tsx (554).
- No Ionic / native range usage: `grep -rn "IonRange\|@ionic/react\|type=\"range\"" src` returned 0 matches.

Empirical device evidence (2026-05-06; full transcripts in `WORKLOG.md`):

```bash
# Reachability — both online at session start
$ curl -sS http://u64/v1/info
{ "product" : "Ultimate 64 Elite", "firmware_version" : "3.14e", ... }
$ curl -sS http://c64u/v1/info
{ "product" : "C64 Ultimate", "firmware_version" : "1.1.0", ... }

# Format echo — bytes-identical
$ curl -sS -X PUT "http://u64/v1/configs/U64%20Specific%20Settings/CPU%20Speed?value=%204"
{ "errors" : [  ] }
$ curl -sS "http://u64/v1/configs/U64%20Specific%20Settings/CPU%20Speed"
{ "current" : " 4", ... }

# Firmware refusal as HTTP 200 with errors[] — silently discarded by current client
$ curl -sS -X PUT "http://u64/v1/configs/U64%20Specific%20Settings/CPU%20Speed?value=4"
{ "errors" : [ "Value '4' is not a valid choice for item CPU Speed" ] }

# Firmware crash on invalid value in batch — u64 went offline
$ curl -sS -X POST -H 'Content-Type: application/json' \
    -d '{"U64 Specific Settings":{"CPU Speed":"4","Turbo Control":"Manual"}}' \
    http://u64/v1/configs
curl: (28) Operation timed out after 10002 milliseconds with 0 bytes received
$ ping -c 2 u64
2 packets transmitted, 0 received, 100% packet loss

# Latency baselines on c64u
PUT  CPU Speed=' 1' : 28 ms
PUT  CPU Speed=' 2' : 24 ms
PUT  CPU Speed='10' : 23 ms
PUT  CPU Speed='20' : 52 ms
11 sequential PUTs : 253 ms (~23 ms/step)
11 sequential SID Volume PUTs : 450 ms (~41 ms/step)
POST batch CPU+Turbo (valid)   : 54 ms
POST batch SID Vol+Pan         : 34 ms

# Ordering under concurrency: not preserved by firmware
$ curl … "?value=%204" &  curl … "?value=%208" &  wait
both 200 OK; final state: " 4" (the *first* request)

# Numeric vs string typing on numeric items
$ curl -sS http://c64u/v1/configs/LED%20Strip%20Settings/Strip%20Intensity
{ "current" : 6, "min" : 0, "max" : 31, "format" : "%d", "default" : 25 }
```
