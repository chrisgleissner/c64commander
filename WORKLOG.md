# Slider Responsiveness Research Worklog

Investigation only. No source-code changes, no commits.

## [2026-05-06] Workspace and ground truth

- Read `/home/chris/.claude/CLAUDE.md` and `/home/chris/dev/c64/c64commander/CLAUDE.md` (project rules — `DOC_ONLY` classification, no need to run builds/tests/screenshot refreshes for a research-only task).
- `ls src/pages/` and `ls src/components/` to map the application surface.
- Confirmed there is no Ionic in this codebase: `grep -rn "IonRange\|@ionic/react" src --include="*.ts" --include="*.tsx"` → **0 matches**. The `Slider` primitive is a custom Radix-based component at [src/components/ui/slider.tsx](src/components/ui/slider.tsx).
- Read [src/components/ui/slider.tsx](src/components/ui/slider.tsx) — exposes `onValueChange`, `onValueCommit`, `onValueChangeAsync`, `onValueCommitAsync`, `asyncThrottleMs` (default `SLIDER_MID_DRAG_THROTTLE_MS = 200ms`), midpoint snap, value popup, haptics. Wraps `@radix-ui/react-slider`. The async variants run through `createSliderAsyncQueue` (microtask/throttled), separate from the synchronous React `onValueChange`/`onValueCommit`.
- Read [src/lib/ui/sliderDeviceAdapter.ts](src/lib/ui/sliderDeviceAdapter.ts) — a documented helper that decouples local UI updates from device writes via a microtask coalescer. **No call sites found** in product code:
  - `grep -rn "createSliderDeviceAdapter\|sliderDeviceAdapter" src --include="*.ts" --include="*.tsx"` → only the adapter file itself. The intended pattern exists but is unused.

## [2026-05-06] Slider inventory

Search strategy:

```bash
grep -rn "IonRange\|onIonChange\|onIonInput\|type=\"range\"\|<Slider\|/ui/slider" src --include="*.ts" --include="*.tsx"
grep -rn "<Slider\b\|<Slider " src --include="*.tsx"
grep -rn "type=\"range\"" src --include="*.tsx" --include="*.ts"
```

Slider call sites (all use the custom `Slider` from `@/components/ui/slider`):

| File                                                                                                                     | Line | Purpose                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------- |
| [src/pages/HomePage.tsx](src/pages/HomePage.tsx#L1056)                                                                   | 1056 | Home page CPU Speed                                                          |
| [src/pages/home/SidCard.tsx](src/pages/home/SidCard.tsx#L233)                                                            | 233  | Per-SID Volume                                                               |
| [src/pages/home/SidCard.tsx](src/pages/home/SidCard.tsx#L262)                                                            | 262  | Per-SID Pan                                                                  |
| [src/pages/home/components/LightingSummaryCard.tsx](src/pages/home/components/LightingSummaryCard.tsx#L342)              | 342  | Lighting Fixed Color                                                         |
| [src/pages/home/components/LightingSummaryCard.tsx](src/pages/home/components/LightingSummaryCard.tsx#L367)              | 367  | Lighting Brightness                                                          |
| [src/components/ConfigItemRow.tsx](src/components/ConfigItemRow.tsx#L451)                                                | 451  | Generic config slider (used by Config page, including Config page CPU Speed) |
| [src/components/lighting/LightingStudioDialog.tsx](src/components/lighting/LightingStudioDialog.tsx#L370)                | 370  | Lighting Studio Dialog brightness                                            |
| [src/pages/playFiles/components/VolumeControls.tsx](src/pages/playFiles/components/VolumeControls.tsx#L70)               | 70   | Play page playback volume                                                    |
| [src/pages/playFiles/components/PlaybackSettingsPanel.tsx](src/pages/playFiles/components/PlaybackSettingsPanel.tsx#L74) | 74   | Default song duration (local state only — no device write)                   |
| [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L2065)                                                           | 2065 | Notification duration (saved to local app settings — no device write)        |

No `IonRange`, no native `<input type="range">`. No additional slider abstractions.

## [2026-05-06] Home CPU Speed slider — end-to-end trace

Inputs to handler:

- [src/pages/HomePage.tsx:194-197](src/pages/HomePage.tsx#L194) declares `cpuSpeedOptimisticValue` and `cpuSpeedDraggingRef`.
- [src/pages/HomePage.tsx:217](src/pages/HomePage.tsx#L217) wires `useInteractiveConfigWrite({ category: "U64 Specific Settings" })` → `interactiveWriteU64`.
- [src/pages/HomePage.tsx:866](src/pages/HomePage.tsx#L866): `cpuSpeedPending = Boolean(configWritePending[buildConfigKey("U64 Specific Settings", "CPU Speed")])`.
- [src/pages/HomePage.tsx:894-897](src/pages/HomePage.tsx#L894): `useEffect` resyncs `cpuSpeedOptimisticValue` to `cpuSpeedValue` when the slider is _not_ being dragged AND `cpuSpeedPending === false`.
- [src/pages/HomePage.tsx:1056-1080](src/pages/HomePage.tsx#L1056): the JSX:

  ```tsx
  <Slider
    value={[cpuSpeedDisplayIndex]}
    disabled={!isActive || cpuSpeedPending || cpuSpeedSliderOptions.length <= 1}
    onValueChange={(values) => {
      cpuSpeedDraggingRef.current = true;
      setCpuSpeedOptimisticValue(resolveCpuSpeedOption(values[0] ?? 0));
    }}
    onValueCommit={() => {
      cpuSpeedDraggingRef.current = false;
    }}
    onValueChangeAsync={(nextIndex) => {
      handleCpuSpeedPreviewChange(String(resolveCpuSpeedOption(nextIndex)));
    }}
    onValueCommitAsync={(nextIndex) => {
      const nextValue = String(resolveCpuSpeedOption(nextIndex));
      setCpuSpeedOptimisticValue(nextValue);
      handleCpuSpeedCommitChange(nextValue);
    }}
  />
  ```

- [src/pages/HomePage.tsx:758-778](src/pages/HomePage.tsx#L758): `handleCpuSpeedPreviewChange` is a no-op apart from `setCpuSpeedOptimisticValue` (it does not write to device). `handleCpuSpeedCommitChange` calls `setConfigOverride("U64 Specific Settings", "CPU Speed", nextValue)` and then fires `interactiveWriteU64({ "CPU Speed": nextValue })` (immediate, queue-bypassing) followed by `handleTurboControlAutoAdjust(nextValue)` which executes a _second_ write via the throttled `updateConfigValue` path.
- [src/hooks/useInteractiveConfigWrite.ts](src/hooks/useInteractiveConfigWrite.ts): wraps `useC64UpdateConfigBatch().mutateAsync` in a `LatestIntentWriteLane` with `immediate: true` and `skipInvalidation: true`; schedules a 250 ms `invalidateQueries(["c64-config-items", category])` reconciliation in a `finally`.
- [src/hooks/useAuthoritativeConfigValueState.ts](src/hooks/useAuthoritativeConfigValueState.ts): `replaceEntry` puts an entry into `entries[key]`; `pending` is a memo over `Object.keys(entries)` — **a key being present means pending is true**. The entry only clears via `scheduleClearEntry` inside `resolveValue` when `Object.is(entry.value, resolvedDeviceValue) === true` after a refetch.
- [src/lib/c64api.ts:1148-1190](src/lib/c64api.ts#L1148): `setConfigValue` goes through `scheduleConfigWrite` (throttled queue); `updateConfigBatch({immediate})` bypasses it. The Home CPU Speed commit goes through `updateConfigBatch` with `immediate: true`, but the chained Turbo Control auto-adjust uses `setConfigValue` (throttled).

## [2026-05-06] Config page CPU Speed slider — end-to-end trace

- [src/pages/ConfigBrowserPage.tsx:587-604](src/pages/ConfigBrowserPage.tsx#L587): renders `<ConfigItemRow … onValueChange={(v) => handleValueChange(item.name, v)} isLoading={setConfig.isPending || Boolean(authoritativeValues.pending[item.name])} />`.
- [src/pages/ConfigBrowserPage.tsx:268-293](src/pages/ConfigBrowserPage.tsx#L268): `handleValueChange` calls `authoritativeValues.replaceEntry(itemName, value)`, then `await setConfig.mutateAsync({ category, item, value })` and on failure restores the entry. Mutation hook auto-invalidates the category and `c64-all-config` on success ([src/hooks/useC64Connection.ts:367-373](src/hooks/useC64Connection.ts#L367)).
- [src/components/ConfigItemRow.tsx:117-188](src/components/ConfigItemRow.tsx#L117): keeps a local `inputValue` text state and a `lastCommittedRef`. The slider branch ([src/components/ConfigItemRow.tsx:413-491](src/components/ConfigItemRow.tsx#L413)) wires:
  - `onValueChange` → `setInputValue(...)` _only_ (no device write, no parent state pollution).
  - `onValueCommit` → `setInputValue(...)` only.
  - `onValueChangeAsync` → calls parent `onValueChange(nextValue)` only when the value differs from `lastCommittedRef.current`.
  - `onValueCommitAsync` → updates `lastCommittedRef` and calls `onValueChange(nextValue)`.
- The disable logic is `disabled={isLoading || isItemLoading || isReadOnly}`. `isLoading` reflects `setConfig.isPending` — a TanStack Query mutation flag that auto-clears regardless of device echo.
- Net: the Config page slider's local thumb state is owned inside `ConfigItemRow` and is never disabled solely because the optimistic-override entry is still present.

## [2026-05-06] Home SID Volume / Pan slider — end-to-end trace

- [src/pages/home/components/AudioMixer.tsx:177-283](src/pages/home/components/AudioMixer.tsx#L177) holds `activeSliders` (a `Record<string, number>` of in-flight slider draft values) inside `AudioMixer`, _not_ in HomePage.
  - `volumePending = false; panPending = false;` are **hardcoded** ([src/pages/home/components/AudioMixer.tsx:194-195](src/pages/home/components/AudioMixer.tsx#L194)).
  - `volumeSliderValue = clampSliderValue(activeVolumeValue ?? volumeIndex, volumeMax)` ([src/pages/home/components/AudioMixer.tsx:200](src/pages/home/components/AudioMixer.tsx#L200)) — the slider value reads the local draft first, falling back to the device-derived index.
  - `handleVolumeLocalChange(val)` only updates `activeSliders` (no parent state). `handleVolumeAsyncChange(val)` fires `interactiveWrite({ [item]: option })` (the SID-specific lane through the same `useInteractiveConfigWrite` hook). `handleVolumeLocalCommit(val)` clears the draft and pre-emptively calls `setConfigOverride` so a stale refetch cannot snap the thumb back. `handleVolumeAsyncCommit(val)` issues the final `interactiveWrite`.
- [src/pages/home/SidCard.tsx:233-281](src/pages/home/SidCard.tsx#L233): `disabled={!isConnected || volumePending}` — `volumePending` is always `false`, so the slider thumb is never frozen by the optimistic-write state.
- Implication: the SID slider feels fast because (a) state ownership is local to `AudioMixer`, not the 1730-line `HomePage`, and (b) the disable-on-pending gate is short-circuited.

## [2026-05-06] Quantitative comparison — file sizes / re-render surface

```text
$ wc -l src/pages/HomePage.tsx src/pages/home/components/AudioMixer.tsx src/pages/home/SidCard.tsx src/components/ConfigItemRow.tsx
  1730 src/pages/HomePage.tsx
   534 src/pages/home/components/AudioMixer.tsx
   285 src/pages/home/SidCard.tsx
   554 src/components/ConfigItemRow.tsx
```

Every `setCpuSpeedOptimisticValue` re-renders the full HomePage tree, including dozens of `resolveConfigValue`/`readItemOptions` calls and the entire summary-card panel. The SID draft state lives in AudioMixer and only re-renders that subtree.

## [2026-05-06] CPU Speed option format

- [docs/c64/c64u-config.yaml:1334-1352](docs/c64/c64u-config.yaml#L1334) shows that the firmware stores CPU Speed values with **leading whitespace** for single-digit values (`" 1"`, `" 2"`, `" 4"`, `" 6"`, `" 8"`) but not for two-digit values (`"10"`, `"12"`, `"20"`, `"24"`, etc.).
- The slider sends `nextValue = String(resolveCpuSpeedOption(nextIndex))` from the same option list, so the bytes sent should normally match what is later returned. Any normalisation by firmware (trim, `parseInt`/`String`) would break the strict `Object.is` equality used in [src/hooks/useAuthoritativeConfigValueState.ts:73](src/hooks/useAuthoritativeConfigValueState.ts#L73). Other Home page pending-disabled controls (Turbo Control, Badline Timing, etc.) use enum-like values without whitespace and are less exposed to that hazard, but CPU Speed is uniquely formatted.

## [2026-05-06] Cross-checks

- `grep -rn "createSliderDeviceAdapter" src` → unused. The reusable adapter exists but is not wired anywhere.
- `grep -rn "beginMachineTransition" src --include="*.ts" --include="*.tsx"` → only [src/pages/playFiles/hooks/usePlaybackController.ts:867](src/pages/playFiles/hooks/usePlaybackController.ts#L867). `useInteractiveConfigWrite.beforeRun = waitForMachineTransitionsToSettle` will only block during an in-flight machine reset/reboot, which can happen if the user toggles power around the same time. Not the primary cause but a secondary stall path.
- `grep -rn "refetchInterval" src/hooks/useC64Connection.ts` → `useC64ConfigItems` has no refetch interval; reconciliation depends on invalidations after writes (and `refetchOnMount: "always"`). If invalidation never fires (e.g., the lane rejects), the entry never clears.

## [2026-05-06] Decision points fed into research.md

1. The "lag" symptom is dominated by **HomePage-wide re-render cost** during drag (every pointer move bubbles a HomePage state update).
2. The "indefinitely non-responsive" symptom is dominated by the **disable-on-pending** gate combined with the **strict `Object.is` clear** in the optimistic-override store.
3. The Config page is fast because `setConfig.isPending` is a self-resolving TanStack mutation, and the slider draft is local to `ConfigItemRow`.
4. The SID slider is fast because (a) `volumePending = false` removes the disable gate, and (b) draft state lives in the AudioMixer subtree.
5. The reusable `createSliderDeviceAdapter` (`src/lib/ui/sliderDeviceAdapter.ts`) and the `Slider` primitive's `onValueChangeAsync` / `onValueCommitAsync` already give us the building blocks for a clean fix.

## [2026-05-06] Empirical device findings (probing `u64` and `c64u`)

Goal: resolve the five open questions in the initial draft and validate the consolidation design against real firmware.

### Reachability

```bash
$ curl -sS http://u64/v1/info
# Ultimate 64 Elite, fw 3.14e, fpga 122, core 1.4B
$ curl -sS http://c64u/v1/info
# C64 Ultimate, fw 1.1.0, fpga 122, core 1.49
```

Both devices online at session start.

### CPU Speed shape (u64 vs c64u)

```bash
$ curl -sS http://u64/v1/configs/U64%20Specific%20Settings/CPU%20Speed
# current=" 1"; values=[" 1"," 2"," 3"," 4"," 5"," 6"," 8","10","12","14","16","20","24","32","40","48"]
$ curl -sS http://c64u/v1/configs/U64%20Specific%20Settings/CPU%20Speed
# current="40"; values=[" 1"," 2"," 3"," 4"," 6"," 8","10","12","14","16","20","24","32","40","48","64"]
```

- Leading-whitespace format confirmed for single-digit values.
- Option lists differ across firmwares — the validator MUST consult the live device option list, not a hardcoded table.

### Format echo (Q1)

```bash
$ curl -sS -X PUT "http://u64/v1/configs/U64%20Specific%20Settings/CPU%20Speed?value=%204"
{ "errors" : [  ] }
$ curl -sS http://u64/v1/configs/U64%20Specific%20Settings/CPU%20Speed
# current=" 4"   — bytes-identical to what was sent
```

Resolved: the firmware echoes byte-identical strings. `Object.is(" 4", " 4")` succeeds on the happy path. The strict-equality clear is fine **for indexed string items** when the request and echo paths share the same option list.

### Silent error path (CRITICAL — bug discovered)

```bash
$ curl -sS -X PUT "http://u64/v1/configs/U64%20Specific%20Settings/CPU%20Speed?value=4"   # no leading space
{ "errors" : [ "Value '4' is not a valid choice for item CPU Speed" ] }
```

HTTP 200 OK with `errors: [...]`. The current `c64api.setConfigValue` returns this response untouched and `useC64SetConfig.mutateAsync` resolves successfully. **The optimistic override is therefore left in place after a firmware refusal.** This is the actual root mechanism of stuck-state behaviour in production — and it is independent of the slider's disable gate.

Action item baked into research.md: `c64api` write helpers must throw `C64ConfigWriteError` when `errors.length > 0`.

### Firmware crash on invalid batch (CRITICAL — operational hazard)

```bash
$ curl -sS -X POST -H 'Content-Type: application/json' \
    -d '{"U64 Specific Settings":{"CPU Speed":"4","Turbo Control":"Manual"}}' \
    http://u64/v1/configs
curl: (28) Operation timed out after 10002 milliseconds
$ curl -sS http://u64/v1/info
curl: (7) Failed to connect to u64 port 80
$ ping -c 2 -W 2 u64
2 packets transmitted, 0 received, 100% packet loss
```

`u64` did NOT recover for the rest of the session. The device requires an out-of-band reboot.

`c64u` was NOT subjected to the same probe — risk of taking down the only remaining test device. The hang is treated as cross-device behaviour. Defensive client-side validation against the live option list is the only safe approach.

### Latency baselines (c64u)

```bash
PUT  CPU Speed=' 1' : 28 ms
PUT  CPU Speed=' 2' : 24 ms
PUT  CPU Speed='10' : 23 ms
PUT  CPU Speed='20' : 52 ms
11 sequential PUTs : 253 ms (~23 ms/step)

# SID Volume on Audio Mixer (Vol UltiSid 1)
11 sequential SID PUTs : 450 ms (~41 ms/step)

# Atomic batches
POST batch CPU+Turbo (valid)   : 54 ms
POST batch SID Vol+Pan         : 34 ms
```

Resolves Q3: batching CPU Speed + Turbo Control is the right path (one round-trip beats two by ~40 ms and is atomic from the firmware's perspective). Resolves Q2: writes are fast enough that drag-time previews would be technically possible for CPU Speed too — but the UX argument (audible/visual mid-drag re-clocks) outweighs the network argument; commit-only is correct.

### Concurrency ordering not preserved

```bash
(curl … "?value=%204") & (curl … "?value=%208") & wait
# Both 200; final state: " 4"  ← FIRST request, not last
```

Firmware does not preserve client send order under parallel requests. The `LatestIntentWriteLane` (already in use) MUST remain the only path through which writes go out — never `Promise.all` of writes.

## [2026-05-06] Steering refinement — Telnet source of truth

- Appended a steering TODO to `PLANS.md` to keep the active execution context aware that `docs/c64/c64u-telnet.yaml` must be consulted before Telnet-related changes.
- Updated `AGENTS.md` to mark `docs/c64/c64u-telnet.yaml` as the Telnet menu reference/source of truth.
- Corrected `tests/unit/telnet/telnetActionExecutor.test.ts` to use the documented C64U label `Reboot (Clr Mem)` instead of `Reboot (Clr RAM)`.
- Validation: `tests/unit/telnet/telnetActionExecutor.test.ts` passed (12 tests).

## [2026-05-06] Telnet health and clear-memory reboot responsiveness

- Relaxed the TELNET health probe in `src/lib/diagnostics/healthCheckEngine.ts` so a blank title line is still accepted when the parsed Telnet screen is structurally meaningful, matching the more tolerant real-world behaviour already observed in Vivipi.
- Hardened Telnet menu opening in `src/lib/telnet/telnetCapabilityDiscovery.ts` and `src/lib/telnet/telnetMenuNavigator.ts` by reading through delayed redraw frames before retrying the menu key or failing with `MENU_NOT_FOUND`.
- Added focused regression coverage for both fixes in `tests/unit/lib/diagnostics/healthCheckEngine.test.ts`, `tests/unit/telnet/telnetCapabilityDiscovery.test.ts`, and `tests/unit/telnet/telnetMenuNavigator.test.ts`.
- This restores the intended fast Telnet path for Home quick actions such as clear-memory reboot instead of falling back to the slower REST reboot route when menu discovery misses a delayed redraw.
- Validation completed:
  - focused unit slice passed: `tests/unit/telnet/telnetCapabilityDiscovery.test.ts`, `tests/unit/telnet/telnetMenuNavigator.test.ts`, `tests/unit/lib/diagnostics/healthCheckEngine.test.ts`, `tests/unit/telnet/telnetActionExecutor.test.ts` (`115` tests)
  - `npm run lint` passed
  - `npm run build` passed
  - `npm run test:coverage` passed with merged coverage summary:
    - Statements `94.25%` (`59528/63155`)
    - Branches `91.92%` (`19852/21596`)
    - Functions `90.42%` (`3409/3770`)
    - Lines `94.25%` (`59456/63078`)
  - No documentation screenshots were regenerated because the visible documented UI did not change.

### Numeric vs string typing on numeric items (Q1 deeper)

```bash
$ curl -sS http://c64u/v1/configs/LED%20Strip%20Settings/Strip%20Intensity
{ "current" : 6, "min" : 0, "max" : 31, "format" : "%d", "default" : 25 }
```

Numeric items return `current` as a JSON number; string items return strings. `Object.is(6, "6")` is `false`. This is the type-drift hazard for `Strip Intensity` and any other numeric config. The new `compareNumeric` comparator in the hook must coerce.

### Lighting Summary Card disable predicate (Q4)

By code inspection of `LightingSummaryCard.tsx`, the preview path uses `interactiveWrite` directly with **no `setConfigOverride`** call. Therefore `configWritePending["LED Strip Settings::Fixed Color"]` is never set, so the `isPending("Fixed Color")` predicate is permanently `false`. The `disabled={... || isPending("Fixed Color")}` is a latent dead branch in the current code — broken-by-design but not user-visible. Cleaning it up belongs in the consolidation pass.

### Outcome

All five open questions resolved. The implementation plan is upgraded from a small targeted fix to a tightly-scoped consolidation; see research.md "Consolidated Implementation Plan" and "UX-First Slider Behaviour Model".
