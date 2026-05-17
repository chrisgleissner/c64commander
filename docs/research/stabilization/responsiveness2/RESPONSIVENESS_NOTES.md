# RESPONSIVENESS_NOTES

Specific responsiveness observations and the model used to grade them.

## The responsiveness contract

For any user action against the device, the app must satisfy:

1. **Immediate local feedback (<50 ms)**: the touched control shows the new state immediately, without waiting for a network round-trip. Sliders move with the finger; mute toggles change icon; play button changes state.
2. **Device convergence (eventual)**: the device receives the user's *latest* intent. Coalescing of intermediate values is required; intermediate writes can be elided.
3. **State reconciliation (must not regress)**: a later refetch must not overwrite a newer user intent. Optimistic state survives until either the device echoes the intended value, the user changes it, or a watchdog clears the override.
4. **Error reporting (must not silence)**: if the latest intended write fails, surface that specific failure with context; reconcile UI to a known device state.
5. **Diagnostics integrity (must not over-claim)**: degraded/error states must reflect real failures of the active device — not of saved-but-inactive peers, not of a single transient event, not for 5 minutes after recovery.

## What is correctly implemented

- `useDeviceBoundSlider` provides immediate local feedback (`draftSliderValue`) and pending-intent until device echo, with watchdog clearing.
- `useAuthoritativeConfigValueState` uses trim-and-coerce equality so device echoes like `" 4"` clear the override of `4`.
- `createLatestIntentWriteLane` collapses rapid intent to the latest job; older waiters complete when the latest job's version reaches `settledVersion`.
- `pollingPauseRegistry` pauses drives/info polling during user interaction.
- Volume hook tracks `lastManualWriteRef` with a 1500 ms window to ignore stale device echoes.

## Where the contract is broken or fragile

### R-NOTE-1 — `pollingPauseRegistry` does not bind saved-device probes

`useSavedDeviceHealthChecks.runCycle` runs every 10 s and does not subscribe to the pause registry. A slider drag that lands during a cycle competes with:

- 1× FTP `LIST /` per saved device
- 1× Telnet connect/send/read/disconnect cycle per saved device
- 1× REST `/v1/info` per saved device
- 1× REST `/v1/machine:readmem` (CONFIG/RASTER) per saved device
- ... × N saved devices

Through CapacitorHttp+CapacitorCookies serialization, each REST hits at least one JNI hop on the same thread queue. This stalls the slider's preview writes behind background traffic.

**Fix shape**: `runCycle` must observe `pollingPauseRegistry`. While paused, the cycle defers (does not abort mid-flight, but skips the next tick). Watchdog still ensures eventual reachability check.

### R-NOTE-2 — Cold-boot config-tree fan-out vs. transport overhead

LED Strip Settings boot fan-out issues 9 sequential REST calls (~700 ms) before the home page is fully populated. With CapacitorHttp + CapacitorCookies each request pays ~30–80 ms marshalling on top of ~20 ms wire time.

**Fix shape**: Batch via `getConfigItems(category, items)` (already exists). Reduce per-item fan-out to ≤ 2 calls per category at cold boot. Defer Keyboard Lighting until the user opens a section that needs it.

### R-NOTE-3 — Discovery probe gating produces false OFFLINE banner

`connectionManager.discover('startup')` does not promote `OFFLINE_NO_DEMO` → `REAL_CONNECTED` opportunistically when a normal REST call succeeds. The discovery probe must run its own `/v1/info` and beat its own 700 ms scheduling interval before the badge reflects connectivity.

**Fix shape**: Either share the first config-tree fetch as the discovery probe, or expose an internal `noteReachable(host)` that any successful REST in `c64api` can call to promote the state. Either way, the user must not see OFFLINE during a successful first paint.

### R-NOTE-4 — Background contributor windows ignore deviceId

Already detailed in `FINDINGS.md F-DIAG-1`. Responsiveness implication: when the user drags a slider on u64, every saved-device cycle (every 10 s) writes events that may flip the active device's badge to Degraded mid-drag, which can trigger React re-renders of `UnifiedHealthBadge.tsx` (697 LOC, many memoized branches) on top of the drag. Even if the badge color change is innocuous, the re-render fan-out is not.

### R-NOTE-5 — Console-bridge noise floor

`logger.ts` intercepts `console.warn`/`console.error` and pipes them to addLog. But the bridged `console.info` is NOT intercepted, and a `Msg: undefined` source is emitting through `console.info` (or similar) on every Telnet tick. Beyond the diagnostic confusion, this is bridge bandwidth that competes with user-driven REST traffic on the main thread.

## Slider/volume/mute acceptance criteria (proposed for Stage 2)

| Criterion | Metric | Target |
|---|---|---|
| Slider draft latency | time from `onValueChange` to visible thumb update | ≤ 16 ms p95 |
| Preview write coalescing | number of REST writes per 1 s of dragging | ≤ 6 (lane throttle dependent) |
| Commit settled latency | time from commit to UI echo (badge stops "pending") | ≤ 250 ms p95 over 10 commits |
| Stale-response rollback | once an optimistic override is in place, a later refetch with the *old* value must NOT overwrite the override | 0 occurrences in 30 trials |
| Mute → Unmute → Mute (rapid 200 ms triple) | terminal device state matches user's last toggle within 1500 ms | 100% over 10 trials |
| Volume slider while playing | volume change reflected on hardware within 250 ms; UI shows no flicker back to prior value | 0 flickers in 30 commits |

## Playback/volume/mute acceptance criteria (proposed for Stage 2)

| Criterion | Metric | Target |
|---|---|---|
| Play from cold app | first audible playback within 5 s of pressing Play (assuming local SID file) | ≥ 9/10 trials |
| Stop reset reliability | `handleStop` reset succeeds within 3 s timeout | ≥ 9/10 trials |
| Pause/resume round-trip | Telnet `machinePause` + `machineResume` returns the device to running with audio | ≥ 9/10 trials |
| Volume restore on stop | device volume returns to pre-playback values; user not informed of "could not restore" toast unexpectedly | ≥ 9/10 trials |
| Auto-advance reliability | next-track fires within 1 s of duration end | ≥ 9/10 trials |

## Diagnostics acceptance criteria (proposed for Stage 2)

| Criterion | Metric | Target |
|---|---|---|
| Cross-device contamination | unreachable saved-but-inactive device → active device's badge stays HEALTHY | 100% over 5 minute soak |
| Recovery latency | after 1 transient failure followed by 5 successes, contributor state returns to HEALTHY | within 60 s |
| Cold-boot badge truthfulness | badge never shows OFFLINE while a `/v1/info` call against the active device is in-flight or has returned 200 within the last 5 s | 0 false OFFLINE seconds in 10 cold starts |
| App contributor sensitivity | a single isolated console.warn 4 minutes ago does NOT push the badge to Degraded | locked in by unit test |
| Logcat noise floor | 30 s of foreground Home with saved-device probes active emits 0 `Msg: undefined` lines | locked in by smoke test |
