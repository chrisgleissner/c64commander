## [2026-05-12] PR convergence steering: implementation-focused PR summary

- Appended and completed the active PLANS steering TODO to update PR metadata without changing the execution scope.
- Amended GitHub PR #254 so the description now leads with the performance improvements that actually landed in the branch, separates those from investigation-only artifacts, and keeps the added regression coverage explicit.
- Validation:
  - verified the steering TODO was present in `PLANS.md` before executing the GitHub update
  - updated the PR body with `gh pr edit 254 --body-file /tmp/c64commander-pr254-body.md`
  - confirmed the active PR still targets `main` from `fix/improve-ux-performance` and re-read the current check rollup during the same GitHub session

## [2026-05-11] Android real-device performance stabilization investigation

- Opened the repository-level planning surface and started a dedicated late-stage performance investigation focused on Android against real `u64` and `c64u` hardware.
- Mapped the first concrete implementation surfaces before any edits:
  - `src/lib/diagnostics/healthCheckEngine.ts`
  - `src/lib/diagnostics/latencyTracker.ts`
  - `src/lib/tracing/traceSession.ts`
  - `src/hooks/useSavedDeviceSwitching.ts`
  - `src/hooks/useSavedDeviceHealthChecks.ts`
  - `src/lib/deviceInteraction/deviceInteractionManager.ts`
  - `src/lib/savedDevices/savedDeviceSwitchMetrics.ts`
  - `src/components/diagnostics/DiagnosticsDialog.tsx`
- Confirmed the repository already contains useful timing infrastructure for this task:
  - rolling p50/p90/p99 latency samples for REST and FTP
  - per-event trace timestamps plus lifecycle/device context
  - saved-device switch attempt timings with selection and verification phases
  - health-check probe durations and outcomes
- Confirmed diagnostics is primarily an overlay/dialog concern rather than a route-level page, which changes how Diagnostics-open latency needs to be measured and analyzed.
- Confirmed request scheduling is already serialized or bounded for REST and Telnet, with cooldown, backoff, and circuit-breaker state that must be included in responsiveness analysis rather than treated as incidental behavior.
- Created dedicated iteration documents under `docs/plans/performance/iteration1/` for the execution plan, chronological worklog, and final investigation report.
- Verified live hardware state before planning:
  - host probes confirmed `u64` REST availability and `c64u` REST instability.
  - resolved addresses during this session were `u64 = 192.168.1.13` and `c64u = 192.168.1.167`.
- Ran the existing real-Android switch soak on the Pixel 4 with bare hostnames and captured `docs/plans/performance/iteration1/switch-soak-real-android.json`:
  - 10 transitions, 10 failures.
  - `p50 = 14317 ms`, `p90 = 14397 ms`, `max = 14445 ms`.
  - The dominant stall pattern was `c64u -> u64`, matching Android failure to resolve bare `u64` during verification.
- Rebuilt with IP-based saved devices and reran the same soak into `docs/plans/performance/iteration1/switch-soak-real-android-ip.json`:
  - `u64` success path recovered to `p50 = 140 ms`, `p90 = 176 ms`, `max = 226 ms`.
  - Remaining failures were all `u64 -> c64u` offline outcomes, which isolates `c64u` REST unavailability from switch orchestration overhead.
- Collected Android-shell transport probes on the same Pixel 4:
  - `u64` REST `/v1/info`: 27-33 ms over 10 samples.
  - `u64` config read `/v1/configs/U64 Specific Settings/CPU Speed`: 31-36 ms over 10 samples.
  - `u64` Telnet TCP connect: 14-24 ms over 5 samples.
  - `c64u` REST `/v1/info`: curl exit 56 in 17-161 ms.
  - `c64u` Telnet TCP connect: 15-22 ms.
- Collected `docs/plans/performance/iteration1/startup-baseline/startup-baseline.json` with `TTFSC p50 = 615 ms`, `p95 = 703 ms`, then marked it non-representative because the probe build auto-launched the switch lab and skipped normal startup request traffic.
- Read the current Diagnostics surfaces after measurement:
  - `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
  - `src/components/diagnostics/DiagnosticsDialog.tsx`
  - `src/hooks/useSavedDeviceHealthChecks.ts`
  - `src/lib/deviceInteraction/deviceInteractionManager.ts`
- Concluded that Diagnostics-open latency is not directly measurable without adding executable instrumentation, but the current code already shows three likely contributors:
  - eager action-summary and export-payload derivation in `GlobalDiagnosticsOverlay`
  - eager unified evidence-list assembly/sort/filter work in `DiagnosticsDialog`
  - overlap with 10 s saved-device background health polling and on-open reconciliation.
- Restored the Pixel 4 to a normal non-probe debug APK after the measurement runs:
  - `npm run cap:build` passed.
  - `npm run android:apk` passed.
  - `adb install -r /home/chris/dev/c64/c64commander/android/app/build/outputs/apk/debug/c64commander-0.8.2-debug.apk` passed.
  - Relaunched `uk.gleissner.c64commander/.MainActivity` successfully.

## [2026-05-11] Telnet diagnostics preservation and `c64u` probe hardening

- Steering follow-up implemented for the active device-switch/diagnostics plan: appended the plan TODO for intermittent `c64u` TELNET probe failures and missing transport-preserved Diagnostics evidence.
- Updated [src/lib/diagnostics/healthCheckEngine.ts](/home/chris/dev/c64/c64commander/src/lib/diagnostics/healthCheckEngine.ts) so the TELNET health probe now records structured `telnet-operation` diagnostics traces on both success and failure, instead of only writing generic app logs. This makes failed TELNET calls visible under the Diagnostics contributor filter the same way REST and FTP calls already were.
- Reduced TELNET probe brittleness against `c64u` by aligning the connect budget with the probe timeout and making the visible-text drain less aggressive after connect: post-data idle wait increased from `20 ms` to `100 ms`, and the empty-read budget increased from `1` to `2`.
- Updated [src/lib/tracing/traceFormatter.ts](/home/chris/dev/c64/c64commander/src/lib/tracing/traceFormatter.ts) so FTP and TELNET trace rows render transport-specific titles instead of generic `*-operation` placeholders.
- Added regression coverage in [tests/unit/lib/diagnostics/healthCheckEngine.test.ts](/home/chris/dev/c64/c64commander/tests/unit/lib/diagnostics/healthCheckEngine.test.ts) for TELNET health-probe trace emission and the revised probe timing budget, and in [tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx](/home/chris/dev/c64/c64commander/tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx) for finding TELNET traces through the Diagnostics contributor filter.
- Validation:
  - `runTests` passed for `tests/unit/lib/diagnostics/healthCheckEngine.test.ts` and `tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx`.
  - `get_errors` reported no TypeScript diagnostics in the touched source and test files.
  - `npm run lint` passed.
  - `npm run build` passed.
  - `env -u VITE_DEBUG_DEVICE_SWITCH_SOAK_JSON npm run test:coverage` passed with global branch coverage `91.84%`. The first coverage attempt inherited a stale soak env and falsely routed `App.runtime` into the switch lab; rerunning with that env cleared restored the normal suite.
  - `npm run cap:build` passed.
  - `npm run android:apk` passed.
  - Reinstalled `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` to Pixel 4 `9B081FFAZ001WX`, relaunched `uk.gleissner.c64commander/.MainActivity`, and captured the live Home screen after waking the device from doze.

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

# Device Switch Health / README Coverage Worklog (2026-05-11)

## Initial Setup

- Read mandatory repo instructions: `README.md`, `.github/copilot-instructions.md`, `docs/ux-guidelines.md`, plus existing `PLANS.md` and `WORKLOG.md`.
- Classification: `DOC_PLUS_CODE` and `UI_CHANGE`.
- `git status --short` initially returned clean.
- Diagnostics archive captured locally outside the repository.
- Archive listing confirms five files: actions, error logs, logs, supplemental, and traces JSON.

## Concrete Observations

- README Home references:
  - `docs/img/app/home/00-overview-light.png` with alt `Home overview (Light)`, but image inspection shows it is the C64 Commander intro/logo.
  - `docs/img/app/home/01-overview-dark.png` is a dark top Home screenshot.
  - `docs/img/app/home/sections/01-system-info-to-cpu-ram.png` is the missing light top Home screenshot.
  - Existing section screenshots `01` through `05` cover the Home page from system info through config.
- Switch Device bottom sheet:
  - Implemented in `src/components/UnifiedHealthBadge.tsx`.
  - Opens by long press/context menu and calls `refreshAll()` once when opened.
  - `useSavedDeviceHealthChecks(savedDevices.devices, canSwitchDevices)` means saved-device polling also runs while the sheet is closed.
- Health checks:
  - `src/hooks/useSavedDeviceHealthChecks.ts` currently passes `{ mode: "passive" }` for every saved-device poll.
  - `src/lib/diagnostics/healthCheckEngine.ts` has `HealthCheckTargetRunMode = "full" | "passive"`.
  - Passive target mode skips CONFIG with reason `Skipped: passive mode disables CONFIG pulse`.
  - The CONFIG probe performs the visible pulse by writing a temporary config value and reverting it.
- Readiness/request guard:
  - `src/lib/deviceInteraction/deviceInteractionManager.ts` emits `"Device not ready for requests"` when global device state is `UNKNOWN`, `DISCOVERING`, or `ERROR` and the request is not allowed through.
  - `src/lib/deviceInteraction/deviceStateStore.ts` maintains a global selected-device readiness model rather than a per-host model.
- Config fallback:
  - `C64API.getConfigItems` logs `"Category config fetch failed; falling back to item fetches"` for most category fetch failures and then fans out per-item requests.
  - This is unsafe/noisy when the root cause is the readiness gate because every item request will deterministically fail the same way.

## Active Plan

- Update `PLANS.md` with the May 11 task section and use it as the authoritative plan.
- Implement explicit health-check context/pulse policy.
- Pass switch-device-open context to saved-device checks.
- Close Switch Device promptly on target selection and defer heavy invalidation until verification completes.
- Reset stale interaction state when switching target devices.
- Suppress deterministic config-item fallback after readiness-gate category failure.
- Update README Home screenshot references and add deterministic README screenshot coverage test.

## Implemented Changes

- `README.md` Home screenshot table now explicitly covers the intro image, light top Home row, dark top Home row, and existing full Home-page section coverage.
- `tests/unit/readmeScreenshotCoverage.test.ts` validates the required README screenshot references and file existence.
- `src/lib/diagnostics/healthCheckEngine.ts` now accepts explicit health-check run contexts:
  - `switch-device-dialog` with `visible-config-pulse-allowed`.
  - `manual-diagnostics` with `visible-config-pulse-allowed`.
  - `background-maintenance` with `read-only`.
- `src/hooks/useSavedDeviceHealthChecks.ts` receives the context from callers; closed/background saved-device checks stay read-only while the open Switch Device sheet can run the CONFIG pulse.
- `src/components/UnifiedHealthBadge.tsx` passes the switch-dialog context only while the sheet is open, changes the sheet title to `Switch Device`, and closes the sheet immediately when a target row is tapped while verification continues.
- `src/hooks/useSavedDeviceSwitching.ts` resets stale interaction guard state on saved-device switch and cancels old C64 query families asynchronously so previous-device work does not block the new target.
- `src/lib/deviceInteraction/deviceInteractionManager.ts` allows user-intent requests through `DISCOVERING`, keeping Home quick actions usable during the switch handoff.
- `src/lib/c64api.ts` skips item fallback fan-out when category fetch fails with `"Device not ready for requests"`; other category failures still use the item fallback path.
- `src/lib/diagnostics/healthModel.ts` classifies abort/cancel/superseded events as expected cancellation noise so stale switch cancellations are not promoted as current primary health problems.

## Automated Validation

- Focused regression slice passed:

  ```bash
  npx vitest run tests/unit/readmeScreenshotCoverage.test.ts tests/unit/hooks/useSavedDeviceHealthChecks.test.tsx tests/unit/components/UnifiedHealthBadge.test.tsx tests/unit/lib/diagnostics/healthCheckEngine.test.ts tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts tests/unit/hooks/useSavedDeviceSwitching.test.tsx tests/unit/c64api.branches.test.ts tests/unit/lib/diagnostics/healthModel.test.ts
  ```

  Result: 8 files, 309 tests passed.

- `npm run lint` initially failed on Prettier drift in `tests/unit/hooks/useAppConfigState.test.tsx` and `tests/unit/pages/HomePage.test.tsx`; ran Prettier on those two test files only, then `npm run lint` passed.
- `npm run test:coverage` passed with branch coverage `91.86%` globally.
- `npm run build` passed. Existing Vite warnings remained: Node `url` browser externalization, circular chunk warning, and dynamic/static import warning.
- Targeted screenshot refresh passed:

  ```bash
  npx playwright test playwright/screenshots.spec.ts -g "capture switch-device screenshots"
  ```

  Result: 1 test passed. Refreshed only the Switch Device screenshots because the visible title changed.

- `npm run cap:build` passed; iOS sync was skipped by the Linux host as expected.
- `npm run android:apk` passed and produced `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk`.

## Screenshot Updates

- Updated Switch Device screenshots under:
  - `docs/img/app/diagnostics/switch-device/profiles/compact/`
  - `docs/img/app/diagnostics/switch-device/profiles/medium/`
  - `docs/img/app/diagnostics/switch-device/profiles/expanded/`
- Files refreshed in each profile: `01-picker.png` through `06-picker-one-unhealthy-expanded.png`.
- No full README screenshot corpus refresh was needed; README coverage uses existing Home screenshot assets and is enforced by `tests/unit/readmeScreenshotCoverage.test.ts`.

## Android Deploy And HIL Evidence

- Attached Pixel 4 detected as `9B081FFAZ001WX`.
- Initial install failed with Android version downgrade protection:

  ```text
  INSTALL_FAILED_VERSION_DOWNGRADE: Downgrade detected: Update version code 1968 is older than current 2843
  ```

- Per repository instructions, uninstalled `uk.gleissner.c64commander` and retried the newest APK. Install succeeded:

  ```bash
  adb -s 9B081FFAZ001WX uninstall uk.gleissner.c64commander
  adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk
  ```

- Launched the app with:

  ```bash
  adb -s 9B081FFAZ001WX shell monkey -p uk.gleissner.c64commander 1
  ```

- Foreground proof:
  - `topResumedActivity=uk.gleissner.c64commander/.MainActivity`
  - installed package metadata: `versionCode=1968`, `versionName=0.7.9-rc1`
  - screenshot: `.tmp/android-check/device-switch-fix-launch.png`

- Hardware reachability from the workstation:
  - `http://u64/v1/info` returned `Ultimate 64 Elite`, firmware `3.14e`, unique id `38C1BA`.
  - `http://c64u/v1/info` connected to `192.168.1.167:80` but reset the HTTP connection; ICMP ping to `c64u` succeeded.
- Hardware reachability from the Pixel 4:
  - `adb shell ping -c 2 -W 2 u64` succeeded.
  - `adb shell ping -c 2 -W 2 c64u` succeeded.

- Because uninstalling for the version downgrade cleared app data, seeded two saved devices through WebView CDP localStorage for HIL:
  - `hil-c64u` host `c64u`, selected first.
  - `hil-u64` host `u64`.
- Opened Switch Device via WebView CDP, waited for a switch-dialog health poll, and captured `.tmp/android-check/switch-device-sheet-after-poll.png`.
- Measured switch handoff timings on the Pixel 4:
  - `c64u -> u64`: sheet closed in `1147 ms`, `selectedDeviceId=hil-u64`, current host `u64`, Home title present, quick-action Reset/Reboot buttons were not disabled. Screenshot: `.tmp/android-check/after-switch-u64.png`.
  - `u64 -> c64u`: sheet closed in `1314 ms`, `selectedDeviceId=hil-c64u`, current host `c64u`, Home title present, quick-action Reset/Reboot buttons were not disabled. Screenshot: `.tmp/android-check/after-switch-c64u.png`.
- During the reverse switch sheet state, rows were not both collapsed to offline: `c64u` showed `Checking ... Healthy` while `u64` was selected and `Checking ... Unhealthy`.

## Remaining HIL Limits / Risks

- Full acceptance HIL with two healthy REST devices was blocked by the local `c64u` HTTP service resetting `/v1/info` despite ICMP reachability.
- Visible LED/config pulse verification requires human observation of the physical C64 device. Automated tests prove the app calls CONFIG only for `switch-device-dialog`/manual contexts and skips it for background read-only context; this run could not physically confirm the visible light pulse.
- A fresh post-run diagnostics ZIP was not exported from the device during this automated session. WebView-local logs were inspected through CDP and still contained expected warnings from the partially unhealthy hardware state, especially `c64u` HTTP failures; this is not a clean signal for duplicate-warning acceptance because the run was performed after app-data reseeding and against a failing `c64u` REST endpoint.

## [2026-05-21] Iteration 3: Restore E2E Android pipeline after AUTO safety mode regression

### Environment

- Branch: `fix/performance-iteration-2`.
- Concurrent uncommitted edits found in worktree (Play page background-cleanup stale-callback fix, previous-with-repeat wrap, volume guard tests, soak runner improvements). Per CLAUDE.md policy, left intact.

### Repository Baseline

- `npm run test` before edits: 6516/6516 passing in 237.93s.

### Investigation Notes

- CI error reported `TypeError: Cannot read properties of undefined (reading 'VITE_DEBUG_SAVED_DEVICES_JSON') at src/lib/savedDevices/store.ts:350` during `npx playwright test --list --project=android-phone`. The shard script then exits non-zero, failing all 12 Android shards.
- Reproduced the exact failure mode with `tsx`: `fakeMeta.env.VITE_DEBUG_SAVED_DEVICES_JSON` where `fakeMeta.env = undefined` throws with the same message.
- Eager module-init call chain (proof):
  - `playwright/itemSelection.spec.ts` imports from `../src/pages/playFiles/playFilesUtils`.
  - `playFilesUtils.ts` imports from `@/lib/playback/playbackRouter`.
  - `playbackRouter.ts` imports from `@/lib/c64api`.
  - `c64api.ts` imports `withRestInteraction` from `@/lib/deviceInteraction/deviceInteractionManager`.
  - `deviceInteractionManager.ts:186` runs at module init: `let config: DeviceSafetyConfig = loadDeviceSafetyConfig();`.
  - `loadDeviceSafetyConfig` (in `deviceSafetySettings.ts:274`) calls `getActiveAutoResolutionContext()`.
  - `getActiveAutoResolutionContext` (line 215) calls `getSelectedSavedDeviceProductFamilySync()`.
  - `getSelectedSavedDeviceProductFamilySync` (store.ts:676) calls `getSavedDevicesSnapshot()` -> `loadEnvelope()` -> `createInitialEnvelope()` -> `createDebugBootstrapDevices()` -> the unsafe `import.meta.env.X` access.
- Commit blame: this chain was created by commit `6dc4813d Implement AUTO device safety mode` (2026-05-19). Before AUTO mode, `loadDeviceSafetyConfig` did not call into the saved-devices store.
- Other safe pattern available in repo: `src/lib/fuzz/fuzzMode.ts:39` uses `typeof import.meta !== "undefined" && import.meta.env?.VITE_FUZZ_MODE === "1"`.

### Bugs Found

- **High priority production-release blocker**: E2E Android test pipeline non-functional because of the unsafe `import.meta.env.VITE_DEBUG_SAVED_DEVICES_JSON` access at `src/lib/savedDevices/store.ts:350`, triggered by the AUTO device safety mode chain executing at module init under non-Vite TypeScript loaders (playwright list, ts-node, tsx, etc.).

### Fixes Applied

- `src/lib/savedDevices/store.ts`: extracted the env read into `readDebugSavedDevicesEnv()` that:
  1. defensively probes `typeof import.meta === "undefined" || !import.meta.env` before reading,
  2. wraps the read in `try/catch` to log via `console.warn` rather than throw,
  3. returns `undefined` for any non-string value, preserving the original "no bootstrap if unset" semantics.

### Tests Added Or Updated

- `tests/unit/lib/savedDevices/store.test.ts`:
  - **Functional smoke regression**: "falls back to the legacy device when the debug bootstrap env is missing or empty (no import.meta.env crash)" - stubs the env to an empty string and asserts the legacy `c64u` device is created instead of throwing.
  - **Contract regression**: "guards the debug bootstrap env read with a typeof check so module init survives non-Vite runners" - asserts the source contains the exact `typeof import.meta === "undefined" || !import.meta.env` guard and the renamed `readDebugSavedDevicesEnv()` call site, locking in the safe pattern so a future engineer cannot silently revert it.

### Commands Run

- `npm run test` (baseline): 6516/6516 passed.
- `timeout 120 npx vitest run tests/unit/lib/savedDevices/store.test.ts`: 20/20 passed after fix.
- `timeout 200 npx vitest run tests/unit/lib/savedDevices/ tests/unit/lib/config/ tests/unit/config/ tests/unit/lib/deviceInteraction/`: 487/487 passed.
- `npx tsc -p tsconfig.app.json --noEmit`: no output (clean).
- `npx eslint src/lib/savedDevices/store.ts tests/unit/lib/savedDevices/store.test.ts`: no output (clean).
- `npx prettier --check src/lib/savedDevices/store.ts tests/unit/lib/savedDevices/store.test.ts`: "All matched files use Prettier code style!".
- `npx tsx -e "import { getSavedDevicesSnapshot } from './src/lib/savedDevices/store.ts'; ..."`: succeeds after fix (would crash before).

### Evidence

- `tsx` reproduction emitted: `CRASH (matches reported error): Cannot read properties of undefined (reading 'VITE_DEBUG_SAVED_DEVICES_JSON')`.
- `tsx` post-fix run emitted: `OK, devices= 1`.

### Remaining Risks

- Other module-init paths that touch `import.meta.env` may be added in the future. The contract test guards only the savedDevices store path. A broader lint rule (`no-unsafe-import-meta-env-access`) would be the durable defense but is out of scope for this iteration.
- The lower-priority feature areas (RAM/REU, stream controls, Telnet) were not inspected in this iteration because the urgent E2E blocker took priority.
