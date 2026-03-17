# Config Update API Approaches

This document analyzes the four distinct patterns the app uses to update C64U
configuration items and explains the UX behavioural difference between them.

---

## Context

The C64U exposes two REST endpoints for writing configuration:

| Endpoint | Method | Body | Purpose |
|---|---|---|---|
| `/v1/configs/{category}/{item}?value={val}` | PUT | none | Single-item update |
| `/v1/configs` | POST | JSON (`{ category: { item: val } }`) | Batch update |

Both endpoints write to the C64U's active in-memory configuration. Whether the
change takes effect immediately on running hardware or requires a menu re-entry is
**a firmware decision** that depends on which config category is being written and
what the C64U is currently doing.

For the **Audio Mixer** category specifically:

- While SIDplay is active, the Ultimate firmware continuously reads Audio Mixer
  config values and applies them to the hardware in real-time. Volume and pan
  changes therefore take effect instantly during playback.
- When the C64 is running normally (menu is not open, SIDplay is not active),
  Audio Mixer value changes are persisted to in-memory config but are only
  re-applied when the firmware re-processes them — which occurs on menu re-entry
  or device restart.

This firmware difference explains the observable UX gap:
**the Play page applies volume instantly; the Home page requires menu re-entry.**

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

On success, invalidates `["c64-category", category]` queries. The next render
uses fresh data from the device.

### Optimistic UI

`configOverrides` (local `useState`) is written before the request fires.
On error the override is rolled back to its previous value.

`configWritePending` tracks in-flight writes per config key. Components use it to
show pending indicators and disable further writes until settled.

### UX

- Toast notification shown on success.
- Retry action offered via the error toast on failure.

### Effects on hardware

Audio Mixer changes land in device config memory but are only consumed by the
hardware after the next firmware re-processing cycle (typically menu re-entry).
Non-Audio-Mixer categories (CPU speed, drive settings, etc.) behave according to
their own firmware rules.

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

Identical to Approach A — menu re-entry required for Audio Mixer settings.

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

Same firmware rules apply; Audio Mixer still requires menu re-entry when SIDplay
is not active.

---

## Approach D — Immediate batch write via `useVolumeOverride` (Play page)

**Used by:** `PlayFilesPage.tsx` → `usePlaybackController` →
`useVolumeOverride.ts`

This is the only approach that produces an immediate audible effect during SID
playback.

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

| Phase | Trigger | Rate limit | Behaviour |
|---|---|---|---|
| `preview` | `onValueChangeAsync` (mid-drag) | `previewIntervalMs` (configurable, default 150 ms) | Fires only if enough time has elapsed since the last preview |
| `commit` | `onValueCommit` (drag released) | None | Always fires; resets the preview timer |

### UX

- No toast notifications for volume changes.
- The volume slider moves immediately with local state updates.
- Pending state tracked via `updateConfigBatch.isPending`.
- If the write fails, an error is logged; the slider position is not rolled back
  (the reconciliation refetch corrects state shortly after).

### Effects on hardware

Because the Ultimate firmware continuously reads Audio Mixer values during SIDplay,
the volume change takes effect on the hardware within the round-trip time of the
POST request — typically < 100 ms over a local network.

---

## Comparison table

| | A — Home (single) | B — Config Browser (single) | C — Config Browser (batch) | D — Play (batch, immediate) |
|---|---|---|---|---|
| **HTTP method** | PUT | PUT | POST | POST |
| **Endpoint** | `/v1/configs/{cat}/{item}` | `/v1/configs/{cat}/{item}` | `/v1/configs` | `/v1/configs` |
| **Write throttle** | Yes (`scheduleConfigWrite`) | Yes | Yes | **No** (`immediate: true`) |
| **Cache invalidation** | `c64-category/{cat}` | `c64-category` + `c64-all-config` | `c64-category` + `c64-all-config` | **None** (`skipInvalidation: true`) |
| **Optimistic override** | Yes (`configOverrides`) | No | No | No (slider local state) |
| **Toast on success** | Yes | Yes | Yes | **No** |
| **Immediate hardware effect** | Only during SIDplay | Only during SIDplay | Only during SIDplay | **Yes — always during SIDplay** |
| **Menu re-entry required** | Yes (when not in SIDplay) | Yes | Yes | Not needed (SIDplay is active) |
| **Write coalescing** | No | No | No | Yes (`LatestIntentWriteLane`) |
| **Rate limiting** | `configWriteIntervalMs` (global) | `configWriteIntervalMs` (global) | `configWriteIntervalMs` (global) | `previewIntervalMs` (per-slider) |

---

## Why the Play page feels instant

The Play page is the only surface that:

1. Sends `POST /v1/configs` **without** joining the `scheduleConfigWrite` queue
   (`immediate: true`).
2. Targets the **Audio Mixer** category while the Ultimate's SIDplay firmware is
   active — at that moment the firmware reads Audio Mixer values in real-time.
3. Updates **all** enabled SID volume items in a single batch request, matching
   the firmware's expectation of a consistent snapshot.
4. Coalesces preview writes to avoid flooding the device during rapid slider drags.

The Home page Audio Mixer sends the same values to the same config items via PUT
but goes through the write queue, invalidates the cache (causing a refetch), and
shows a toast. More importantly, if the user is not in SIDplay, those Audio Mixer
values sit dormant in device config until the menu is re-entered.

---

## Implications for future development

- If a future page needs **instant audible effect during playback**, it should use
  `POST /v1/configs` with `immediate: true` and `skipInvalidation: true`, and
  follow the `LatestIntentWriteLane` + reconciliation pattern from
  `useVolumeOverride.ts`.
- If a future page only needs **persistent config changes** (applied on next
  menu cycle), either `PUT /v1/configs/{item}` or the non-immediate
  `POST /v1/configs` batch is sufficient.
- The `configWriteIntervalMs` throttle (settable in Settings → Device Safety →
  Advanced Controls) only affects Approaches A, B, and C.  Approach D is
  deliberately exempt so that audio feedback remains responsive.
