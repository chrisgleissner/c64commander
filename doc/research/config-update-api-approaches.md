# Config Update API Approaches

This document analyses the four distinct patterns the app uses to update C64U
configuration items, explains how the firmware processes these writes, and
documents the UX difference between them. It also proposes a path to making the
entire app feel as responsive as the Play page volume slider.

---

## Context

The C64U exposes two REST endpoints for writing configuration:

| Endpoint                                    | Method | Body                                 | Purpose            |
| ------------------------------------------- | ------ | ------------------------------------ | ------------------ |
| `/v1/configs/{category}/{item}?value={val}` | PUT    | none                                 | Single-item update |
| `/v1/configs`                               | POST   | JSON (`{ category: { item: val } }`) | Batch update       |

Both endpoints write to the C64U's active in-memory configuration.

---

## Firmware architecture: how config writes are processed

_(Source: `1541ultimate/software/api/route_configs.cc`,
`1541ultimate/software/components/config.h`,
`1541ultimate/software/components/config.cc`,
`1541ultimate/software/u64/u64_config.cc`)_

### The change-hook mechanism

Every REST write, whether PUT or POST, calls `setValue()` on each affected
`ConfigItem`. `setValue()` always calls `setChanged()`, which:

```cpp
int ConfigItem::setChanged() {
  store->set_need_flash_write(true);
  if (hook) {
    return hook(this);          // ← fires IMMEDIATELY, synchronously
  } else {
    store->set_need_effectuate(); // deferred; picked up by at_close_config()
  }
  return 0;
}
```

If the item has a registered **change hook**, that hook fires synchronously
inside the HTTP request handler, before the HTTP response is returned.
If no hook is registered, the change is deferred until `at_close_config()` is
called — which happens at the end of each REST handler.

### Audio Mixer: always-immediate hardware writes

The Audio Mixer category registers `U64Config::setMixer` as a change hook on
**all** volume and pan items (`CFG_MIXER0_VOL`…`CFG_MIXER9_VOL` and
`CFG_MIXER0_PAN`…`CFG_MIXER9_PAN`):

```cpp
for (uint8_t b = CFG_MIXER0_VOL; b <= CFG_MIXER9_VOL; b++)
    cfg->set_change_hook(b, U64Config::setMixer);
// same for PAN items
```

`setMixer` writes all ten channel volumes directly to the FPGA memory-mapped
register `U64_AUDIO_MIXER`:

```cpp
int U64Config::setMixer(ConfigItem *it) {
    volatile uint8_t *mixer = (volatile uint8_t *)U64_AUDIO_MIXER;
    ConfigStore *cfg = it->store;
    for (int i = 0; i < 10; i++) {
        uint8_t vol  = volume_ctrl[cfg->get_value(CFG_MIXER0_VOL + i)];
        uint8_t pan  = cfg->get_value(CFG_MIXER0_PAN + i);
        // ... pan math ...
        *(mixer++) = vol_right;
        *(mixer++) = vol_left;
    }
    return 0;
}
```

**Consequence:** every Audio Mixer write — via PUT _or_ POST, during BASIC boot,
SIDplay, or any other mode — produces an **immediately audible hardware change**
within the first round-trip of the HTTP response. SIDplay is _not_ a
prerequisite. The audio effect is always instant.

### The C64U on-screen menu and display staleness

The C64U's own on-screen menu renders item values by calling
`BrowsableConfigItem::getDisplayString()` → `item->get_display_string()`, which
reads the live `ConfigItem.value` at render time.

However, the menu only re-renders a section **on navigation** (key press into or
out of a section). It has no auto-refresh from external config changes. When a
REST write lands on the device, the `ConfigItem.value` is updated, but the
on-screen display shows the new value only the next time it is re-rendered.

This explains the observable difference between the approaches:

- **Approach D** (`immediate: true`, no queue): the write lands in ≤ 50 ms. If
  you open the C64U menu after moving the slider, the new value is already in
  `ConfigItem.value` and the display shows it immediately on first render.
- **Approaches A–C** (queued, up to 500 ms delay by default): if you check the
  C64U menu within the first 500 ms, the write has not yet landed, so the display
  shows the old value. After the write does land, navigating away and back
  (re-rendering the section) shows the updated value.

The user-observable "menu re-entry required" for Approaches A–C is therefore
**not** a firmware limitation — it is a direct consequence of the 500 ms write
queue on the app side creating an observable staleness window.

---

## Approach A — Single-item write via `useConfigActions` (Home page)

**Used by:** `AudioMixer.tsx` (SID volume, pan, address, shaping controls),
`HomePage.tsx` (CPU speed, drive power, LED, stream targets, etc.)

### Call chain

```
AudioMixer.tsx
  → useSharedConfigActions().updateConfigValue(category, item, value)
    → useConfigActions.ts:updateConfigValue()
      → api.setConfigValue(category, item, value)          // c64api.ts
        → scheduleConfigWrite(PUT /v1/configs/{cat}/{item}?value={val})
```

### API call

```
PUT /v1/configs/{category}/{item}?value={value}
```

Goes through `scheduleConfigWrite` (enforces `configWriteIntervalMs` minimum gap
between writes, serialises concurrent writes into a sequential queue).

### Cache behaviour

On success, invalidates queries matching `["c64-config-items", category]` via a
predicate filter. Unlike Approaches B and C, it does **not** invalidate
`["c64-all-config"]`. The next render uses fresh data from the device.

### Optimistic UI

`configOverrides` (local `useState`) is written before the request fires.
On error the override is rolled back to its previous value.

`configWritePending` tracks in-flight writes per config key. Components use it to
show pending indicators and disable further writes until settled.

### UX

- Toast notification shown on success.
- Retry action offered via the error toast on failure.

### Effects on hardware

Audio Mixer writes land on the FPGA hardware register **immediately** via the
`setMixer` change hook (see Firmware architecture above). The write is queued in
`scheduleConfigWrite`, so the actual HTTP request fires 0–500 ms after the user
gesture (default throttle). From that point the hardware change is instantaneous.

Non-Audio-Mixer categories (CPU speed, drive settings, etc.) behave according to
whether their config items have change hooks or rely on `effectuate()`.

---

## Approach B — Single-item write via `useC64SetConfig` (Config Browser page)

**Used by:** `ConfigBrowserPage.tsx` (every selectable config item in the UI)

### Call chain

```
ConfigBrowserPage.tsx
  → setConfig.mutateAsync({ category, item, value })   // useC64SetConfig()
    → api.setConfigValue(category, item, value)         // c64api.ts
      → scheduleConfigWrite(PUT /v1/configs/{cat}/{item}?value={val})
```

### API call

Same as Approach A: `PUT /v1/configs/{category}/{item}?value={value}`

### Cache behaviour

On success, invalidates **both** `["c64-category", category]` **and**
`["c64-all-config"]`, which is a wider invalidation than Approach A.

### UX

- Toast: `"${itemName} updated"` on success.
- No optimistic overrides; the displayed value comes from the most recent fetch.

### Effects on hardware

Identical to Approach A — Audio Mixer writes produce an immediate hardware change
once the queued HTTP request fires. The observable display staleness window is the
same as Approach A (up to 500 ms by default).

---

## Approach C — Batch write via `updateConfigBatch` without `immediate`

**Used by:** `ConfigBrowserPage.tsx` (audio solo routing, bulk value commits)

### Call chain

```
ConfigBrowserPage.tsx
  → updateConfigBatch.mutateAsync({ category, updates })  // useC64UpdateConfigBatch()
    → api.updateConfigBatch({ [category]: updates })       // c64api.ts
      → scheduleConfigWrite(POST /v1/configs with JSON body)
```

### API call

```
POST /v1/configs
Body: { "Audio Mixer": { "SID1 Volume": "15", "SID2 Volume": "15" } }
```

Goes through `scheduleConfigWrite` (same throttle as Approaches A and B).

### Cache behaviour

On success, invalidates `["c64-category", category]` and `["c64-all-config"]`.

### UX

- Toast on success.
- Used for audio solo routing: multiple volume items are updated atomically in one
  HTTP request instead of one PUT per item.

### Effects on hardware

Same as Approaches A and B. All items in the batch are written atomically in one
HTTP request; each `setValue()` call fires the change hook. Audio Mixer hardware
is updated once the queued request fires.

---

## Approach D — Immediate batch write via `useVolumeOverride` (Play page)

**Used by:** `PlayFilesPage.tsx` → `usePlaybackController` →
`useVolumeOverride.ts`

This is the only approach that produces a **perceptually instantaneous** audible
effect. All four approaches produce an immediate hardware change once the HTTP
request reaches the device (the firmware `setMixer` hook is the same in every
case); the difference is that Approach D eliminates the app-side queue delay,
so the request reaches the device tens of milliseconds after the gesture instead
of up to 500 ms later.

### Call chain

```
PlayFilesPage.tsx (VolumeControls slider)
  → handleVolumeAsyncChange(index) / handleVolumeCommit(index)
    → sendVolumeWrite(index, phase)
      → queuePlaybackMixerWrite(write)
        → playbackWriteLane.run(write)
          → waitForMachineTransitionsToSettle()          // deviceActivityGate.ts
          → beginPlaybackWriteBurst()
          → updateConfigBatch.mutateAsync({             // useC64UpdateConfigBatch
               category: "Audio Mixer",
               updates,
               immediate: true,
               skipInvalidation: true,
             })
            → api.updateConfigBatch({ "Audio Mixer": updates },
                                    { immediate: true })  // c64api.ts
              → (no scheduleConfigWrite) POST /v1/configs  // direct call
```

### API call

```
POST /v1/configs
Body: { "Audio Mixer": { "SID1 Volume": "12", "SID2 Volume": "12", ... } }
```

**Bypasses `scheduleConfigWrite`** via `immediate: true`. The request fires
immediately without joining the write queue.

### Cache behaviour

With `skipInvalidation: true`, no React Query invalidation occurs. The app does
not refetch Audio Mixer data after each volume slider step—this would cause
flicker and stale-data overwrites during rapid dragging.

A separate reconciliation timer fires 250 ms after the last write and refetches
Audio Mixer, SID Sockets, and SID Addressing to resync the UI.

### Write coalescing and gating

`createLatestIntentWriteLane` ensures only the latest intent is written when the
slider is moved faster than the device can respond. Intermediate positions are
discarded.

`waitForMachineTransitionsToSettle` (from `deviceActivityGate.ts`) delays writes
if a machine-state transition (reset, power-off, etc.) is in progress, preventing
race conditions between config writes and machine control commands.

`beginPlaybackWriteBurst` marks the device as being in an active write burst,
suppressing background polling that could overwrite in-flight values.

### Preview vs. commit phases

| Phase     | Trigger                         | Rate limit                                         | Behaviour                                                    |
| --------- | ------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| `preview` | `onValueChangeAsync` (mid-drag) | `previewIntervalMs` (configurable, default 200 ms) | Fires only if enough time has elapsed since the last preview |
| `commit`  | `onValueCommit` (drag released) | None                                               | Always fires; resets the preview timer                       |

### UX

- No toast notifications for volume changes.
- The volume slider moves immediately with local state updates.
- Pending state tracked via `updateConfigBatch.isPending`.
- If the write fails, an error is logged; the slider position is not rolled back
  (the reconciliation refetch corrects state shortly after).

### Effects on hardware

The `setMixer` change hook fires within the round-trip of the POST request
(typically ≤ 50 ms on a local network). This is the same hardware mechanism as
Approaches A–C, but the write arrives at the device orders of magnitude faster
because it bypasses the app-side write queue. The audio and display effects are
**perceptually instantaneous** for the user.

---

## Comparison table

|                                | A — Home (single)                | B — Config Browser (single)       | C — Config Browser (batch)        | D — Play (batch, immediate)         |
| ------------------------------ | -------------------------------- | --------------------------------- | --------------------------------- | ----------------------------------- |
| **HTTP method**                | PUT                              | PUT                               | POST                              | POST                                |
| **Endpoint**                   | `/v1/configs/{cat}/{item}`       | `/v1/configs/{cat}/{item}`        | `/v1/configs`                     | `/v1/configs`                       |
| **Write throttle**             | Yes (`scheduleConfigWrite`)      | Yes                               | Yes                               | **No** (`immediate: true`)          |
| **Cache invalidation**         | `c64-config-items/{cat}` only    | `c64-category` + `c64-all-config` | `c64-category` + `c64-all-config` | **None** (`skipInvalidation: true`) |
| **Optimistic override**        | Yes (`configOverrides`)          | No                                | No                                | No (slider local state)             |
| **Toast on success**           | Yes                              | Yes                               | Yes                               | **No**                              |
| **Hardware effect**            | Immediate once request fires     | Immediate once request fires      | Immediate once request fires      | **Immediate** (no queue, ≤ 50 ms)   |
| **C64U menu staleness window** | Up to 500 ms (queue wait)        | Up to 500 ms                      | Up to 500 ms                      | **≤ 50 ms (imperceptible)**         |
| **Write coalescing**           | No                               | No                                | No                                | Yes (`LatestIntentWriteLane`)       |
| **Rate limiting**              | `configWriteIntervalMs` (global) | `configWriteIntervalMs` (global)  | `configWriteIntervalMs` (global)  | `previewIntervalMs` (per-slider)    |

---

## Why the Play page feels instant

The Audio Mixer hardware is updated by the firmware's `setMixer` change hook
regardless of which REST endpoint is used and regardless of playback state.
The Play page feels instant for two reasons that have nothing to do with SIDplay:

1. **No write queue** (`immediate: true`): the HTTP request fires in ≤ 50 ms
   instead of waiting up to 500 ms in `scheduleConfigWrite`.
2. **No cache invalidation** (`skipInvalidation: true`): no React Query refetch
   is triggered after each slider step, so the UI does not stutter or flash
   stale→fresh state during rapid dragging. A single reconciliation refetch runs
   250 ms after the last write to resync the cache.

The Home page AudioMixer sends values to the same firmware change hook via PUT but
waits in the write queue (0–500 ms), invalidates the React Query cache on success
(triggering an immediate background refetch), and shows a toast on commit.
The user-observable "stale C64U menu display" is a direct consequence of the
500 ms queue window, not of any firmware limitation.

---

## Complete page and widget audit

### Home page — all widgets use Approach A

All interactive controls on the Home page route through
`useSharedConfigActions().updateConfigValue()` → `api.setConfigValue()` →
`scheduleConfigWrite(PUT /v1/configs/{cat}/{item})`.

| Component                      | Config category                           | Items written                                |
| ------------------------------ | ----------------------------------------- | -------------------------------------------- |
| `AudioMixer.tsx`               | Audio Mixer                               | SID volumes, pan, address mode, SID shaping  |
| `DriveManager.tsx`             | Drive A / Drive B                         | Drive type, power, disk swap                 |
| `PrinterManager.tsx`           | Printer / RS232                           | Printer port, baud rate                      |
| `LightingSummaryCard.tsx`      | LED Settings                              | LED brightness, LED mode                     |
| `StreamStatus.tsx`             | Network                                   | Stream target URL                            |
| `UserInterfaceSummaryCard.tsx` | User Interface                            | Interface type, overlay, startup             |
| `SidCard.tsx`                  | SID Sockets / SID Addressing              | SID socket type, SID addresses               |
| `HomePage.tsx` (direct)        | C64 and Cartridge / Network / many others | CPU speed, drive power, cartridge port, etc. |

Shared behaviour across all Home page writes:

- Optimistic UI override via `configOverrides` written before the request
- `configWritePending` flag set per config key; components disable re-interaction
- Success toast shown on commit; slider mid-drag previews pass `suppressToast: true`
- Cache invalidated on success → background refetch triggered
- On error: override rolled back, error toast with retry action shown

### Config Browser page — Approaches B and C

| Trigger                         | Approach                       | Notes                                                                                                |
| ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Drop-down / enum item selection | B (PUT)                        | `useC64SetConfig` per item; toast on success                                                         |
| Audio Mixer volume edits        | B (PUT) then no-immediate POST | Falls through `handleAudioValueChange` which uses PUT for non-solo, batch POST for solo-restore      |
| Audio solo routing              | C (POST)                       | `api.updateConfigBatch` (via direct call, not mutation) — bypasses cache invalidation hook; no toast |
| Sync clock bulk update          | C (POST)                       | `updateConfigBatch.mutateAsync` without `immediate`; toast on success                                |
| Audio Mixer reset               | C (POST)                       | `updateConfigBatch.mutateAsync` without `immediate`; then explicit `refetch()`                       |

### Play Files page — Approach D

Volume slider and mute/unmute operations on the Play page route through
`useVolumeOverride.ts` → `playbackWriteLane.schedule()` →
`updateConfigBatch.mutateAsync({ immediate: true, skipInvalidation: true })`.
Pause/resume volume adjustments use `applyAudioMixerUpdates()` directly (same
`immediate: true` + `skipInvalidation: true` flags, but no write lane).

| Control                         | Trigger               | Rate limiting                                                      |
| ------------------------------- | --------------------- | ------------------------------------------------------------------ |
| Volume slider (preview)         | `onValueChangeAsync`  | `previewIntervalMs` (default 200 ms), only if enough time elapsed  |
| Volume slider (commit)          | `onValueCommit`       | None — always fires; resets preview timer                          |
| Mute/unmute button              | `onClick`             | `queuePlaybackMixerWrite` via `playbackWriteLane`                  |
| Pause/resume volume adjustment  | Playback state change | `applyAudioMixerUpdates` (direct, no lane queue)                   |
| Playback-sync volume adjustment | Playback state change | `queuePlaybackMixerWrite` via `playbackWriteLane`                  |

Write coalescing: `LatestIntentWriteLane` discards intermediate slider positions
if a new intent arrives before the previous HTTP request completes. Only the
latest value is actually sent.

Post-write reconciliation: `schedulePlaybackReconciliation()` fires 250 ms after
the last write, refetching Audio Mixer, SID Sockets, and SID Addressing.

### Other pages

| Page               | REST calls to C64U config endpoints? | Notes                                                                                               |
| ------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `DisksPage.tsx`    | Yes (Approach A)                     | `HomeDiskManager` writes drive config items (drive type, Soft IEC) via `api.setConfigValue()` (PUT) |
| `SettingsPage.tsx` | No                                   | App-local settings written to localStorage only                                                     |
| `DocsPage.tsx`     | No                                   | Read-only documentation                                                                             |

---

## Toast and overlay behaviour

The app uses a Radix UI `Toast` component rendered in `Toaster.tsx` with a
`ToastViewport` positioned at:

- **Mobile / full-width** (`< sm` breakpoint): `fixed left-0 top-0 z-[100]` —
  slides in from the top of the screen, overlapping the AppBar and the status
  circle indicators in the top-right corner.
- **Larger screens** (`sm:` breakpoint): `sm:bottom-[...] sm:right-0 sm:top-auto`
  — bottom-right corner, does not overlap the status circles.

The Radix `ToastProvider` default `duration` is 5 000 ms. The app's
`use-toast.ts` hook sets `TOAST_REMOVE_DELAY = 1 000 000` ms (permanent until
explicitly dismissed), which means toasts are only removed by Radix's own
auto-dismiss timer or by an explicit `dismiss()` call.

### The "REST activity" toast

`AppBar.tsx` tracks `restInFlight` (active HTTP requests) via
`useDiagnosticsActivity()`. When `restInFlight > 0` and no other toast is
showing, it pushes a "REST activity — N request(s) in flight" toast. It is
dismissed as soon as `restInFlight` drops to zero.

On mobile, this toast covers the status circles (connectivity + diagnostics
indicators) in the AppBar for the entire duration of any in-flight REST call.
Because Approaches A–C can keep `restInFlight > 0` for many seconds during rapid
interaction (each queued write extends the window), the status circles are
frequently obscured.

Approach D does not suppress the REST activity toast either, but its writes
complete in ≤ 50 ms, so the toast appears and disappears before the user can
notice it.

### Success toasts from Approach A / B

`updateConfigValue` calls `toast({ title: successTitle })` on every successful
write unless `suppressToast: true` is passed. Slider mid-drag previews
(`AudioMixer` volume/pan, `LightingSummaryCard` intensity/tint) pass
`suppressToast: true` during the drag and only show a toast on the final commit.
Non-slider interactions (drop-downs, toggles, enum selectors) show a toast on
every change. Each toast lives for ~5 s (Radix default), further extending the
window during which the status circles are hidden.

---

## Implications for future development

- The fast path for interactive controls is `POST /v1/configs` with
  `immediate: true` and `skipInvalidation: true`, plus `LatestIntentWriteLane`
  for coalescing and a 250 ms post-write reconciliation refetch.
- If a future page needs **immediate hardware feedback**, it should follow the
  `useVolumeOverride.ts` pattern, not just pass `immediate: true` to the existing
  `useC64UpdateConfigBatch` hook without coalescing.
- The `configWriteIntervalMs` throttle (settable in Settings → Device Safety →
  Advanced Controls) only applies to Approaches A, B, and C. Approach D is
  deliberately exempt to keep audio feedback responsive.

---

## Responsiveness brainstorm: making the whole app feel like the Play page

### Problem statement

The Play page volume slider is the only interaction in the app that feels
**truly instant**. All other config-writing widgets go through
`scheduleConfigWrite`, which enforces a global minimum gap of 500 ms between
consecutive writes (configurable, default). This creates several UX problems:

1. **Perceptible lag** between a user gesture and hardware response: up to 500 ms.
2. **Serial global queue**: all writes compete in one queue. Clicking ten controls
   in quick succession queues ten requests that fire one-by-one, 500 ms apart,
   for a total delay of up to 5 s.
3. **No coalescing**: rapid interaction (e.g., clicking a slider several times)
   enqueues every intermediate value, wasting bandwidth and device processing.
4. **Cache invalidation on every write**: each completed write triggers a React
   Query refetch, causing a stale → loading → fresh cycle visible in the UI.
5. **A toast per change on the Home page**: adds visual noise and permanently
   covers the status circles on mobile for 5 s per interaction.
6. **The 500 ms default is very conservative** — empirically, volume slider
   writes at 200 ms intervals (five per second per slider) have caused no adverse
   effects on the device.

### What actually protects the device

The C64U firmware processes REST config writes synchronously: the HTTP handler
calls `setValue()`, the change hook fires, and the FPGA register is written
immediately. There is no firmware-side rate limiting. The app-side
`scheduleConfigWrite` queue is the **only** rate-limiting mechanism.

The queue provides two things:

1. A minimum gap between writes to avoid flooding the device.
2. Serialisation so writes targeting the same item do not interleave.

`LatestIntentWriteLane` (used only on the Play page today) is a **strictly
stronger** mechanism: it coalesces rapid writes (discarding intermediate intents)
and serialises execution (only one in-flight request at a time per lane). It does
not impose a fixed minimum gap, but because it awaits the completion of each write
before issuing the next, the effective gap equals the round-trip time of a single
request (~30–100 ms on a local Wi-Fi network) — well below the 500 ms default of
`scheduleConfigWrite`.

### Proposal: a universal interactive-write hook

Extract the Approach D pattern into a reusable hook,
e.g. `useInteractiveConfigWrite(category, items, options?)`, that any widget can
adopt:

```
widget gesture
  → local state update (optimistic UI, no pending flag shown to user)
    → LatestIntentWriteLane.schedule(latestValues)
      →   api.updateConfigBatch({ [category]: updates },
                                { immediate: true })   // no scheduleConfigWrite
      →   after write: scheduleReconciliation(250 ms)  // delayed cache resync
```

Key properties:

- **`immediate: true`** bypasses `scheduleConfigWrite` for the interactive path.
- **`skipInvalidation: true`** prevents cache churn during rapid edits.
- **Per-control lane** (not global): independent controls do not block each other.
- **Coalescing**: only the latest value per lane is issued; intermediate values
  are dropped like non-slider-related data.
- **Bounded cadence**: the lane awaits HTTP round-trip before issuing the next
  write, so effective rate ≈ 1 000 ms / RTT ≈ 10–30 writes/sec max (vs.
  `scheduleConfigWrite`'s 2 writes/sec global ceiling).
- **250 ms post-burst reconciliation**: a delayed refetch resynchronises the
  cache after interaction ends, exactly as the Play page does today.

### What to keep from the existing safety model

The interactive-write hook is **not** a replacement for all existing write paths.
The following should continue using `scheduleConfigWrite`:

| Scenario                                    | Why keep the queue                                      |
| ------------------------------------------- | ------------------------------------------------------- |
| Config Browser bulk form submits            | One-shot deliberate changes; latency is acceptable      |
| Clock sync batch write                      | One-shot; correctness matters more than speed           |
| Audio solo routing                          | Complex multi-item snapshot/restore; not interactive    |
| `saveConfig` / `loadConfig` / `resetConfig` | High-impact operations; deliberate user intent required |
| Machine control (reset, reboot, power-off)  | Already separate; safety gating by `deviceActivityGate` |

For these operations the 500 ms minimum gap is harmless. For interactive controls
(sliders, toggles, dropdowns that the user may click repeatedly) it is actively
harmful.

### Eliminating unnecessary toasts

Success toasts for routine config changes should be removed from the interactive
path:

- For single-item Home page writes (`updateConfigValue`), the optimistic UI
  override (`configOverrides`) already provides instant confirmation — the
  displayed value changes before the request fires.
- A success toast for "SID1 Volume updated" or "Printer port updated" adds no
  information the user didn't already see in the control itself.
- Error toasts (and error toasts with retry) should remain: failures are
  unexpected and require user attention.

The "REST activity" toast in `AppBar.tsx` is a useful debugging aid but should
not block the status indicators. Options include:

- Moving it to a non-blocking corner (bottom-centre) on mobile, or
- integrating it into the `DiagnosticsActivityIndicator` that already lives in
  the AppBar without covering content.

### Suggested priority order

1. **Create `useInteractiveConfigWrite` hook** based on `useVolumeOverride`'s
   `LatestIntentWriteLane` + `immediate: true` + `skipInvalidation: true` +
   250 ms reconciliation pattern.
2. **Migrate Home page widget interactions** to the new hook: AudioMixer sliders
   and toggles, DriveManager, PrinterManager, LightingSummaryCard, StreamStatus,
   UserInterfaceSummaryCard.
3. **Migrate Config Browser interactive slider** (`handleAudioValueChange`) to
   the new hook.
4. **Remove success toasts from interactive write paths**; keep error toasts.
5. **Fix AppBar "REST activity" toast position** so it no longer covers status
   circles on mobile.
6. **Evaluate `configWriteIntervalMs` default**: given empirical evidence that
   200 ms intervals caused no issues on real hardware, the default could be
   reduced from 500 ms to 100 ms for the deliberate-write queue without risk,
   if the interactive path is migrated to the lane-based pattern first.

---

## Verification notes

_Added 2026-03-17 after exhaustive cross-referencing of the C64 Commander
codebase and the symlinked 1541ultimate firmware source._

### Firmware claims — all verified

| Claim | Source file | Status |
| --- | --- | --- |
| `setValue()` always calls `setChanged()` | `config.h:151` — inline `int setValue(int v) { value = v; return setChanged(); }` | Verified |
| `setChanged()` calls `set_need_flash_write(true)`, then hook or `set_need_effectuate()` | `config.cc:903-913` | Verified |
| `at_close_config()` calls `effectuate()` if `need_effectuate()` is true | `config.h:197-203` | Verified |
| `at_close_config()` is called at end of REST handler | `route_configs.cc:158` — `apply_config()` calls `at_close_config()` per store | Verified |
| All 20 mixer items (10 vol + 10 pan) have `setMixer` hook | `u64_config.cc:416-420` | Verified |
| `setMixer` writes to `U64_AUDIO_MIXER` FPGA register | `u64_config.cc:1150-1167` | Verified |
| `volume_ctrl` has 31 entries (indices 0-30) | `u64_config.cc:261-264` | Verified |
| `pan_ctrl` has 11 entries (0-10); pan math: `panL = pan_ctrl[pan]`, `panR = pan_ctrl[10 - pan]` | `u64_config.cc:266` | Verified |
| No firmware-side rate limiting on REST config writes | Full search of `route_configs.cc` for sleep/delay/rate/limit/throttle | Verified: none found |
| PUT path accepts 2 or 3 path elements (category + item + optional value-in-path) | `route_configs.cc:188` | Verified |
| POST accepts `application/json` bulk body | `route_configs.cc:251` | Verified |

### App-side claims — verified with corrections applied above

| Claim | Status | Notes |
| --- | --- | --- |
| `scheduleConfigWrite` enforces serial global queue with `configWriteIntervalMs` gap | Verified | `configWriteThrottle.ts` — promise chain + `waitForInterval()` |
| Default `configWriteIntervalMs` is 500 ms | Verified | `appSettings.ts:18` — `DEFAULT_CONFIG_WRITE_INTERVAL_MS = 500` |
| `configWriteIntervalMs` clamped to 0-2000, step 100 | Verified | `appSettings.ts` clamp function + `SettingsPage.tsx` input constraints |
| `immediate: true` bypasses `scheduleConfigWrite` entirely | Verified | `c64api.ts:1141-1144` — conditional bypass |
| `previewIntervalMs` default | **Corrected** from 150 ms to **200 ms** | `appSettings.ts:25` — `DEFAULT_VOLUME_SLIDER_PREVIEW_INTERVAL_MS = 200` |
| `previewIntervalMs` clamped to 100-500, step 10 | Verified | `appSettings.ts` clamp + `SettingsPage.tsx:1525-1551` |
| `useC64SetConfig` invalidates both `c64-category` and `c64-all-config` | Verified | `useC64Connection.ts:350-354` |
| Approach A invalidates `c64-config-items` only (not `c64-all-config`) | **Corrected** — was listed as `c64-category/{cat}` | `useConfigActions.ts:33-36` — predicate filter on `c64-config-items` |
| Home page `configOverrides` is `useState`-based | Verified | `useConfigActions.ts:13` |
| Mute/unmute uses write lane | **Corrected** — was listed as direct `applyAudioMixerUpdates` | `useVolumeOverride.ts:621,658` — both call `queuePlaybackMixerWrite` |
| Pause/resume uses `applyAudioMixerUpdates` directly | Verified | `usePlaybackController.ts:614,649` |
| 250 ms reconciliation refetches Audio Mixer, SID Sockets, SID Addressing | Verified | `useVolumeOverride.ts:254-262` |
| DisksPage makes no config writes | **Corrected** — `HomeDiskManager` writes drive config | `HomeDiskManager.tsx:534,576` — calls `api.setConfigValue()` |
| Home page slider toasts | **Corrected** — mid-drag suppressed via `suppressToast: true` | `AudioMixer.tsx:232,262`, `LightingSummaryCard.tsx:259,301` |
| `TOAST_REMOVE_DELAY` is 1 000 000 ms | Verified | `use-toast.ts:14` |
| Toast viewport: `fixed left-0 top-0 z-[100]` on mobile, `sm:bottom-[…] sm:right-0 sm:top-auto` on desktop | Verified | `toast.tsx:24-25` |
| AppBar REST activity toast uses `useDiagnosticsActivity().restInFlight` | Verified | `AppBar.tsx:31,81-94` |

### Additional firmware observations

- The firmware `route_configs.cc` also exposes `PUT /configs/load_from_flash`,
  `PUT /configs/save_to_flash`, and `PUT /configs/reset_to_default` endpoints.
  These are used by the app's save/load/reset flows (mentioned in the "What to
  keep from the existing safety model" table) but are not config-item writes.
- The `setMixer` hook returns 0 unconditionally (no error path). This means the
  HTTP handler will always report success for Audio Mixer writes, even if the
  FPGA register write produces no audible effect (e.g., if audio output is
  physically muted).
- Items with hooks skip `set_need_effectuate()` entirely. This means
  `at_close_config()` → `effectuate()` is never called for hooked items. For
  Audio Mixer this is correct because `setMixer` already wrote the hardware.
  For other categories with hooks, the same pattern applies — the hook is the
  sole effectuation path.
